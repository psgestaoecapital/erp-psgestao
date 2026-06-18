// FEAT-NFSE-CONSULTA-v1 · gov-nfse-consultar
// Consulta status da NFS-e na Focus NFe (GET /v2/nfsen/{ref}) e
// atualiza erp_nfse_emitidas com o veredito final.
//
// Body aceito:
//   { record_id: uuid }                       (preferido · le tudo do registro)
//   { company_id: uuid, ref: string }         (fallback)
//
// Auth: verify_jwt=true (chamado autenticado pela tela).
//
// FIX-NFSE-CONSULTA-SERVICEROLE-v1:
//   - CORS preflight (OPTIONS) handler · resolvido 30+ "OPTIONS 405" no log
//   - .select() apos UPDATE pra confirmar linhas afetadas
//   - console.log da resposta Focus + resultado do update (diagnostico)
//   - Surface de erro: ok:false em qualquer falha · sem silenciar

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type Ambiente = "homologacao" | "producao"

interface Payload {
  record_id?: string
  company_id?: string
  ref?: string
}

function respond(s: number, b: unknown) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  })
}

function focusBase(amb: Ambiente): string {
  return amb === "producao"
    ? "https://api.focusnfe.com.br"
    : "https://homologacao.focusnfe.com.br"
}

function basicAuth(token: string): string {
  return "Basic " + btoa(token + ":")
}

function mapearStatus(focusStatus: string): "autorizada" | "rejeitada" | "processando" | "cancelada" {
  switch (focusStatus) {
    case "autorizado": return "autorizada"
    case "cancelado": return "cancelada"
    case "erro_autorizacao":
    case "denegado": return "rejeitada"
    case "processando_autorizacao":
    default: return "processando"
  }
}

function montarMotivoRejeicao(json: Record<string, unknown> | null): string | null {
  if (!json) return null
  const erros = json.erros as Array<{ codigo?: string; mensagem?: string }> | undefined
  if (Array.isArray(erros) && erros.length > 0) {
    const e = erros[0]
    const cod = e.codigo ?? ""
    const msg = e.mensagem ?? ""
    return cod && msg ? `${cod}: ${msg}` : (cod || msg || null)
  }
  return (json.mensagem_sefaz as string)
    ?? (json.motivo_status as string)
    ?? (json.mensagem as string)
    ?? null
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== "POST") return respond(405, { erro: "Method not allowed" })

  let p: Payload
  try { p = await req.json() } catch { return respond(400, { erro: "JSON invalido" }) }

  if (!p.record_id && !(p.company_id && p.ref)) {
    return respond(400, { erro: "Obrigatorio: record_id OU (company_id + ref)" })
  }

  try {
    let recordId = p.record_id
    let companyId = p.company_id
    let ref = p.ref
    let ambiente: Ambiente = "homologacao"

    if (recordId) {
      const { data: row, error } = await sb
        .from("erp_nfse_emitidas")
        .select("id, company_id, provider_reference, ambiente")
        .eq("id", recordId)
        .single()
      if (error || !row) {
        console.log("consultar.select_record_failed", { recordId, error: error?.message })
        return respond(404, { ok: false, erro: "Registro nao encontrado", detalhe: error?.message })
      }
      companyId = row.company_id
      ref = row.provider_reference ?? undefined
      ambiente = (row.ambiente === "producao" ? "producao" : "homologacao")
    } else {
      const { data: row } = await sb
        .from("erp_nfse_emitidas")
        .select("id, ambiente")
        .eq("company_id", companyId!)
        .eq("provider_reference", ref!)
        .single()
      if (row) {
        recordId = row.id
        ambiente = (row.ambiente === "producao" ? "producao" : "homologacao")
      }
    }

    if (!ref) {
      return respond(400, { ok: false, erro: "Registro sem provider_reference (NFS-e legada/sem ref Focus)" })
    }

    // fiscal-token-vault-self-service-v1: dual-read Vault -> env var (transitorio)
    let token: string | undefined
    try {
      const { data: tokenVault } = await sb.rpc("fn_fiscal_obter_token", {
        p_company_id: companyId,
        p_ambiente: ambiente,
      })
      if (typeof tokenVault === "string" && tokenVault.trim().length > 0) {
        token = tokenVault.trim()
      }
    } catch (_e) {
      // RPC indisponivel · cai no fallback
    }
    let tokenEnvNome = ""
    if (!token) {
      let secretConfig: string | null = null
      if (companyId) {
        const { data: cfg } = await sb
          .from("erp_fiscal_provider_config")
          .select("focus_token_secret_homolog, focus_token_secret_prod")
          .eq("company_id", companyId)
          .eq("provider", "gov_nfse_nacional")
          .eq("ativo", true)
          .maybeSingle()
        if (cfg) {
          secretConfig = ambiente === "producao"
            ? (cfg as { focus_token_secret_prod?: string | null }).focus_token_secret_prod ?? null
            : (cfg as { focus_token_secret_homolog?: string | null }).focus_token_secret_homolog ?? null
        }
      }
      const secretLegacyFallback = ambiente === "producao"
        ? "FOCUS_NFE_TOKEN_PRODUCAO"
        : "FOCUS_NFE_TOKEN_HOMOLOGACAO"
      tokenEnvNome = (secretConfig && secretConfig.trim()) || secretLegacyFallback
      token = Deno.env.get(tokenEnvNome)
    }
    if (!token) {
      console.log("consultar.token_missing", { tokenEnvNome, ambiente })
      return respond(500, {
        ok: false,
        erro: "Token Focus nao configurado para esta empresa · cole o token no wizard (Configuracoes > Fiscal) ou peca pro admin definir o secret " + tokenEnvNome,
      })
    }

    const base = focusBase(ambiente)
    const url = `${base}/v2/nfsen/${encodeURIComponent(ref)}`
    let getStatus = 0
    let getBody = ""
    let getErr: string | null = null
    try {
      const r = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: basicAuth(token),
          "User-Agent": "PSGestao-ERP/3.0",
        },
      })
      getStatus = r.status
      getBody = await r.text()
    } catch (e) {
      getErr = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    }

    console.log("consultar.focus_response", {
      ref,
      ambiente,
      getStatus,
      getErr,
      bodyPreview: getBody.slice(0, 500),
    })

    let getJson: Record<string, unknown> | null = null
    try { getJson = getBody ? JSON.parse(getBody) : null } catch { getJson = null }

    // Token invalido (Focus retorna 401) — nao classificar como rejeitada
    if (getStatus === 401 || getStatus === 403) {
      return respond(502, {
        ok: false,
        erro: "Focus rejeitou autenticacao (token invalido ou ausente)",
        get_status: getStatus,
        body: getBody.slice(0, 1500),
      })
    }

    // 404 ou ref desconhecida
    if (getStatus === 404 || (getJson && (getJson.codigo as string) === "nao_encontrado")) {
      const update = {
        status: "rejeitada" as const,
        motivo_rejeicao: "Referência não encontrada na Focus (provável emissão legada)",
        provider_raw: { get: { status: getStatus, body: getBody.slice(0, 4000), erro: getErr } },
        atualizado_em: new Date().toISOString(),
      }
      if (recordId) {
        const { data: rows, error: upErr } = await sb
          .from("erp_nfse_emitidas").update(update).eq("id", recordId).select("id")
        console.log("consultar.update_404", { recordId, rows_affected: rows?.length ?? 0, upErr: upErr?.message })
        if (upErr) return respond(500, { ok: false, erro: "Falha update", detalhe: upErr.message })
        if (!rows || rows.length === 0) return respond(500, { ok: false, erro: "Update afetou 0 linhas (RLS?)" })
      }
      return respond(200, { ok: true, status_novo: "rejeitada", motivo: update.motivo_rejeicao })
    }

    if (getStatus >= 400 || !getJson) {
      return respond(502, {
        ok: false,
        erro: "Focus respondeu com erro",
        get_status: getStatus,
        body: getBody.slice(0, 1500),
      })
    }

    const focusStatus = (getJson.status as string) ?? "desconhecido"
    const statusLocal = mapearStatus(focusStatus)
    const motivo = statusLocal === "rejeitada" ? montarMotivoRejeicao(getJson) : null
    const numero = (getJson.numero as string) ?? (getJson.numero_nfse as string) ?? null
    const chave = (getJson.chave_nfse as string) ?? (getJson.chave_acesso as string) ?? null
    const codigoVerif = (getJson.codigo_verificacao as string) ?? null
    const xmlUrl = (getJson.caminho_xml_nota_fiscal as string)
      ?? (getJson.url_xml as string)
      ?? (getJson.caminho_xml as string)
      ?? null
    const pdfUrl = (getJson.caminho_danfse as string)
      ?? (getJson.url_danfse as string)
      ?? (getJson.url_pdf as string)
      ?? null
    const dataEmissao = (getJson.data_emissao as string) ?? null

    const fullUrl = (u: string | null) =>
      u && u.startsWith("/") ? `${base}${u}` : u

    const update: Record<string, unknown> = {
      status: statusLocal,
      provider_raw: { get: { status: getStatus, body: getBody.slice(0, 4000), erro: getErr } },
      atualizado_em: new Date().toISOString(),
    }
    if (motivo) update.motivo_rejeicao = motivo
    if (numero) update.numero = numero
    if (codigoVerif) update.codigo_verificacao = codigoVerif
    if (xmlUrl) update.xml_url = fullUrl(xmlUrl)
    if (pdfUrl) update.pdf_url = fullUrl(pdfUrl)
    if (dataEmissao) update.data_emissao = dataEmissao

    if (recordId) {
      const { data: rows, error: upErr } = await sb
        .from("erp_nfse_emitidas").update(update).eq("id", recordId).select("id")
      console.log("consultar.update_main", {
        recordId,
        rows_affected: rows?.length ?? 0,
        upErr: upErr?.message,
        statusLocal,
        focusStatus,
      })
      if (upErr) return respond(500, { ok: false, erro: "Falha update", detalhe: upErr.message })
      if (!rows || rows.length === 0) {
        return respond(500, { ok: false, erro: "Update afetou 0 linhas (RLS?)" })
      }
    }

    return respond(200, {
      ok: true,
      status_novo: statusLocal,
      status_focus: focusStatus,
      motivo,
      numero,
      chave_nfse: chave,
    })
  } catch (e) {
    console.log("consultar.exception", { erro: e instanceof Error ? e.message : String(e) })
    return respond(500, {
      ok: false,
      erro: "Erro interno",
      detalhe: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    })
  }
})
