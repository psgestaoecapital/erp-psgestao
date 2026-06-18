// nfe-recebidas-f1-distribuicao-dfe · edge nfe-distribuicao
// Puxa NFes recebidas/destinadas ao CNPJ via Focus NFe e upserta em
// erp_nfe_recebidas (status='resumo'). Itens/duplicatas ficam pra F2
// (apos manifestacao do destinatario com o XML completo).
//
// Auth: verify_jwt=true. JWT do usuario passa pelo cliente sb_user
// (RLS valida via get_user_company_ids). Service role lê o token do
// Vault (fn_fiscal_obter_token).
//
// Pilar 2: token nunca em log; basic auth montado so na hora do fetch.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!

const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type Ambiente = "homologacao" | "producao"

interface Payload {
  company_id: string
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

interface NotaResumo {
  chave: string
  numero: string | null
  serie: string | null
  emitente_cnpj: string | null
  emitente_razao: string | null
  emitente_ie: string | null
  data_emissao: string | null
  valor_total: number | null
  natureza: string | null
  status_manifestacao: string
  raw: Record<string, unknown>
}

// Tenta normalizar campos comuns retornados pela Focus.
// A Focus tem variacoes de payload entre /v2/nfes_recebidas (resumo do
// MDe) e /v2/nfes (notas autorizadas onde a empresa eh dest.).
// Aceita ambos os shapes; pega o que tiver.
function normalizar(o: Record<string, unknown>): NotaResumo {
  const chave = String(
    o.chave_nfe ?? o.chNFe ?? o.chave_acesso ?? o.chave ?? ""
  ).replace(/\D/g, "")
  const cnpjEmit = String(
    (o.emitente as Record<string, unknown> | undefined)?.cnpj ??
    o.cnpj_emitente ?? o.CNPJ ?? o.emit_cnpj ?? ""
  ).replace(/\D/g, "")
  const razaoEmit = String(
    (o.emitente as Record<string, unknown> | undefined)?.razao_social ??
    o.razao_social_emitente ?? o.xNome ?? o.emit_razao ?? ""
  )
  const ieEmit = String(
    (o.emitente as Record<string, unknown> | undefined)?.inscricao_estadual ??
    o.ie_emitente ?? o.IE ?? ""
  )
  const numero = o.numero != null ? String(o.numero) : (o.nNF != null ? String(o.nNF) : null)
  const serie = o.serie != null ? String(o.serie) : null
  const dataEmissao =
    typeof o.data_emissao === "string" ? o.data_emissao :
    typeof o.dhEmi === "string" ? o.dhEmi :
    null
  const valor =
    typeof o.valor_total === "number" ? o.valor_total :
    typeof o.vNF === "number" ? o.vNF :
    typeof o.valor_total === "string" ? Number(o.valor_total) :
    null
  const natureza = (typeof o.natureza_operacao === "string" ? o.natureza_operacao : null)
    ?? (typeof o.natOp === "string" ? o.natOp : null)

  // Mapeia manifestacao Focus -> nosso enum
  // Possiveis: pendente | ciencia_emissao | confirmada | desconhecida | nao_realizada | sem_manifestacao
  const rawMan = String(o.manifestacao ?? o.status_manifestacao ?? "").toLowerCase()
  let man = "pendente"
  if (rawMan.includes("ciencia")) man = "ciencia"
  else if (rawMan.includes("confir")) man = "confirmada"
  else if (rawMan.includes("descon")) man = "desconhecida"
  else if (rawMan.includes("nao_real") || rawMan.includes("nao realiz")) man = "nao_realizada"

  return {
    chave,
    numero,
    serie,
    emitente_cnpj: cnpjEmit || null,
    emitente_razao: razaoEmit || null,
    emitente_ie: ieEmit || null,
    data_emissao: dataEmissao,
    valor_total: valor,
    natureza,
    status_manifestacao: man,
    raw: o,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== "POST") {
    return respond(405, { ok: false, erro: "Method not allowed" })
  }

  // Pilar 2: JWT obrigatorio (verify_jwt=true gating); valida acesso a empresa
  const auth = req.headers.get("authorization") ?? ""
  const jwt = auth.replace(/^Bearer\s+/i, "").trim()
  if (!jwt) return respond(401, { ok: false, erro: "sem token" })

  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return respond(400, { ok: false, erro: "JSON invalido" })
  }
  if (!payload.company_id) {
    return respond(400, { ok: false, erro: "company_id obrigatorio" })
  }

  // cliente como usuario · respeita RLS
  const sbUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })

  // valida acesso
  const { data: empresaCheck, error: empCheckErr } = await sbUser
    .from("companies")
    .select("id, cnpj")
    .eq("id", payload.company_id)
    .maybeSingle()
  if (empCheckErr || !empresaCheck) {
    return respond(403, { ok: false, erro: "sem acesso a empresa" })
  }
  const cnpjEmpresa = String(empresaCheck.cnpj ?? "").replace(/\D/g, "")

  try {
    // 1) config do provider · ambiente
    const { data: cfg } = await sbAdmin
      .from("erp_fiscal_provider_config")
      .select("ambiente, provider")
      .eq("company_id", payload.company_id)
      .eq("ativo", true)
      .maybeSingle()
    const ambiente: Ambiente = cfg?.ambiente === "producao" ? "producao" : "homologacao"

    // 2) token Focus via Vault (service_role)
    const { data: tokenVault } = await sbAdmin.rpc("fn_fiscal_obter_token", {
      p_company_id: payload.company_id,
      p_ambiente: ambiente,
    })
    let token = typeof tokenVault === "string" ? tokenVault.trim() : ""
    if (!token) {
      // fallback transitorio (env legado · remover quando todos no vault)
      const envName = ambiente === "producao"
        ? "FOCUS_NFE_TOKEN_PRODUCAO"
        : "FOCUS_NFE_TOKEN_HOMOLOGACAO"
      token = Deno.env.get(envName) ?? ""
    }
    if (!token) {
      return respond(400, {
        ok: false,
        erro: "Token Focus nao configurado · cole o token em Configuracoes > Fiscal (passo 6)",
      })
    }

    // 3) puxa NFes recebidas
    // Endpoint Focus: /v2/nfes_recebidas (recurso "Recebimento de NFes" ligado).
    // Auth: HTTP Basic com token:vazio.
    // ATENCAO: confirmar com a doc Focus atual; se mudar, ajustar URL/parser.
    const url = `${focusBase(ambiente)}/v2/nfes_recebidas`
    const r = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: basicAuth(token),
        "User-Agent": "PSGestao-ERP/3.0",
      },
    })
    const body = await r.text()
    if (!r.ok) {
      return respond(502, {
        ok: false,
        erro: "Focus rejeitou listagem · " + (r.status === 401 || r.status === 403
          ? "token invalido ou conta sem permissao 'Recebimento de NFes'"
          : `HTTP ${r.status}`),
        body_preview: body.slice(0, 400),
      })
    }

    let lista: Record<string, unknown>[] = []
    try {
      const parsed = JSON.parse(body)
      if (Array.isArray(parsed)) lista = parsed
      else if (Array.isArray((parsed as { resumos?: unknown })?.resumos)) {
        lista = (parsed as { resumos: Record<string, unknown>[] }).resumos
      }
      else if (Array.isArray((parsed as { nfes?: unknown })?.nfes)) {
        lista = (parsed as { nfes: Record<string, unknown>[] }).nfes
      }
    } catch {
      return respond(502, {
        ok: false,
        erro: "Focus retornou JSON invalido",
        body_preview: body.slice(0, 400),
      })
    }

    let novas = 0
    let atualizadas = 0
    for (const item of lista) {
      const n = normalizar(item)
      if (!n.chave || n.chave.length !== 44) continue

      const upsertRow = {
        company_id: payload.company_id,
        chave_acesso: n.chave,
        numero: n.numero,
        serie: n.serie,
        modelo: "55",
        emitente_cnpj: n.emitente_cnpj,
        emitente_razao: n.emitente_razao,
        emitente_ie: n.emitente_ie,
        natureza_operacao: n.natureza,
        data_emissao: n.data_emissao,
        valor_total: n.valor_total,
        status_manifestacao: n.status_manifestacao,
        status: "resumo",
        resumo_raw: n.raw,
        origem: "focus_distribuicao",
        updated_at: new Date().toISOString(),
      }

      const { data: existing } = await sbAdmin
        .from("erp_nfe_recebidas")
        .select("id")
        .eq("company_id", payload.company_id)
        .eq("chave_acesso", n.chave)
        .maybeSingle()

      if (existing) {
        const { error } = await sbAdmin
          .from("erp_nfe_recebidas")
          .update({
            status_manifestacao: upsertRow.status_manifestacao,
            updated_at: upsertRow.updated_at,
            resumo_raw: upsertRow.resumo_raw,
          })
          .eq("id", existing.id)
        if (!error) atualizadas++
      } else {
        const { error } = await sbAdmin
          .from("erp_nfe_recebidas")
          .insert(upsertRow)
        if (!error) novas++
      }
    }

    return respond(200, {
      ok: true,
      ambiente,
      cnpj_empresa: cnpjEmpresa,
      recebidas: lista.length,
      novas,
      atualizadas,
    })
  } catch (e) {
    return respond(500, {
      ok: false,
      erro: "Erro interno",
      detalhe: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    })
  }
})
