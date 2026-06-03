// GE-F6 · Focus NFe webhook receiver
// Endpoint: POST /functions/v1/focus-nfe-webhook
// Auth: verify_jwt=false (publico · validacao via HMAC X-Focus-Signature)
//
// Fluxo:
//   1. Recebe POST + body raw
//   2. Detecta tipo (nfse | nfe | mde) via campos do payload
//   3. Resolve company_id via provider_reference -> webhook_secret da config
//   4. Valida assinatura HMAC SHA256 (constant-time)
//   5. Registra log SEMPRE (auditoria · idempotente via constraint)
//   6. Se valido: chama fn_webhook_atualizar_{nfse|nfe} via RPC
//   7. Sempre 200 em erro interno (evita Focus reenviar 1000x · log mantem rastro)
//
// RPCs usadas (ja aplicadas em prod via MCP · GE-F6 schema):
//   - fn_webhook_registrar_log
//   - fn_webhook_atualizar_nfse
//   - fn_webhook_atualizar_nfe
//   - fn_webhook_marcar_processado

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { createHmac, timingSafeEqual } from "node:crypto"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

type Tipo = "nfse" | "nfe" | "mde" | "unknown"

interface FocusPayload {
  ref?: string
  referencia?: string
  status?: string
  tipo?: string
  motivo?: string
  mensagem_sefaz?: string
  numero?: string
  codigo_verificacao?: string
  url_xml?: string
  caminho_xml_nota_fiscal?: string
  url_pdf?: string
  caminho_danfse?: string
  caminho_danfe?: string
  chave_nfe?: string
  chave?: string
  chave_acesso?: string
  protocolo?: string
  cnpj_prestador?: string
  [k: string]: unknown
}

function detectarTipo(p: FocusPayload): Tipo {
  if (p.tipo === "nfse" || p.cnpj_prestador) return "nfse"
  if (p.tipo === "nfe" || p.chave_nfe) return "nfe"
  if (p.tipo === "mde" || p.chave_acesso) return "mde"
  if (p.codigo_verificacao) return "nfse"
  if (p.chave) return "nfe"
  return "unknown"
}

function hmacHex(body: string, secret: string): string {
  const h = createHmac("sha256", secret)
  h.update(body)
  return h.digest("hex")
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, "utf-8"), Buffer.from(b, "utf-8"))
  } catch {
    // fallback manual
    let r = 0
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return r === 0
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ erro: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    })
  }

  const ipOrigem =
    req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown"
  const userAgent = req.headers.get("user-agent") || "unknown"
  const signature = req.headers.get("x-focus-signature") || ""

  const rawBody = await req.text()
  let payload: FocusPayload
  try {
    payload = JSON.parse(rawBody) as FocusPayload
  } catch {
    return new Response(JSON.stringify({ erro: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const providerReference = String(payload.ref ?? payload.referencia ?? "")
  const statusRecebido = String(payload.status ?? "")
  const tipo = detectarTipo(payload)

  // Resolve company_id via provider_reference pra achar webhook_secret correto
  let companyId: string | null = null
  if (tipo === "nfse") {
    const { data } = await sb
      .from("erp_nfse_emitidas")
      .select("company_id")
      .eq("provider_reference", providerReference)
      .maybeSingle()
    companyId = data?.company_id ?? null
  } else if (tipo === "nfe") {
    const { data } = await sb
      .from("erp_nfe_emitidas")
      .select("company_id")
      .eq("provider_reference", providerReference)
      .maybeSingle()
    companyId = data?.company_id ?? null
  }

  let webhookSecret: string | null = null
  if (companyId) {
    const { data: config } = await sb
      .from("erp_fiscal_provider_config")
      .select("webhook_secret")
      .eq("company_id", companyId)
      .eq("provider", "focusnfe")
      .eq("ativo", true)
      .maybeSingle()
    webhookSecret = config?.webhook_secret ?? null
  }

  const signatureValid =
    !!webhookSecret &&
    !!signature &&
    constantTimeEqual(signature, hmacHex(rawBody, webhookSecret))

  // Registra log SEMPRE (auditoria)
  const { data: logId } = await sb.rpc("fn_webhook_registrar_log", {
    p_provider: "focus_nfe",
    p_tipo: tipo,
    p_provider_reference: providerReference,
    p_status_recebido: statusRecebido,
    p_ip_origem: ipOrigem,
    p_user_agent: userAgent,
    p_payload_raw: payload,
    p_signature_valid: signatureValid,
  })

  if (!signatureValid) {
    await sb.rpc("fn_webhook_marcar_processado", {
      p_log_id: logId,
      p_resultado: { ok: false, motivo: "signature_invalid" },
      p_erro: webhookSecret ? "Assinatura HMAC invalida" : "Webhook secret nao encontrado",
    })
    return new Response(JSON.stringify({ erro: "Invalid signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }

  try {
    let resultado: Record<string, unknown> = { ok: false }

    if (tipo === "nfse") {
      const { data } = await sb.rpc("fn_webhook_atualizar_nfse", {
        p_provider_reference: providerReference,
        p_status: statusRecebido,
        p_motivo_rejeicao: payload.motivo ?? payload.mensagem_sefaz ?? null,
        p_numero: payload.numero ?? null,
        p_codigo_verificacao: payload.codigo_verificacao ?? null,
        p_xml_url: payload.url_xml ?? payload.caminho_xml_nota_fiscal ?? null,
        p_pdf_url: payload.url_pdf ?? payload.caminho_danfse ?? null,
        p_provider_raw: payload,
      })
      resultado = (data as Record<string, unknown>) ?? { ok: true }
    } else if (tipo === "nfe") {
      const { data } = await sb.rpc("fn_webhook_atualizar_nfe", {
        p_provider_reference: providerReference,
        p_status: statusRecebido,
        p_motivo_rejeicao: payload.motivo ?? payload.mensagem_sefaz ?? null,
        p_chave: payload.chave_nfe ?? payload.chave ?? null,
        p_numero: payload.numero ?? null,
        p_protocolo: payload.protocolo ?? null,
        p_xml_url: payload.caminho_xml_nota_fiscal ?? payload.url_xml ?? null,
        p_danfe_url: payload.caminho_danfe ?? payload.url_pdf ?? null,
        p_provider_raw: payload,
      })
      resultado = (data as Record<string, unknown>) ?? { ok: true }
    } else if (tipo === "mde") {
      // GE-F8 implementa MDe · por enquanto so loga
      resultado = { ok: true, info: "MDe ainda nao implementado (GE-F8)" }
    } else {
      resultado = { ok: false, motivo: "tipo_desconhecido" }
    }

    await sb.rpc("fn_webhook_marcar_processado", {
      p_log_id: logId,
      p_resultado: resultado,
      p_erro: resultado.ok ? null : String(resultado.erro ?? resultado.motivo ?? "erro"),
    })

    return new Response(JSON.stringify({ ok: true, processado: resultado }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  } catch (erro) {
    const msg = erro instanceof Error ? erro.message : String(erro)
    await sb.rpc("fn_webhook_marcar_processado", {
      p_log_id: logId,
      p_resultado: { ok: false },
      p_erro: msg,
    })
    // Retorna 200 mesmo em erro interno (Focus NFe nao reenvia)
    return new Response(JSON.stringify({ ok: false, erro: "internal_error" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }
})
