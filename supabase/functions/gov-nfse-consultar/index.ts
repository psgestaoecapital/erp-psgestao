// FEAT-NFSE-CONSULTA-v1 · gov-nfse-consultar
// Consulta status da NFS-e na Focus NFe (GET /v2/nfsen/{ref}) e
// atualiza erp_nfse_emitidas com o veredito final.
//
// Body aceito:
//   { record_id: uuid }                       (preferido · le tudo do registro)
//   { company_id: uuid, ref: string }         (fallback)
//
// Auth: verify_jwt=true (chamado autenticado pela tela).

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

type Ambiente = "homologacao" | "producao"

interface Payload {
  record_id?: string
  company_id?: string
  ref?: string
}

function respond(s: number, b: unknown) {
  return new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } })
}

function focusBase(amb: Ambiente): string {
  return amb === "producao"
    ? "https://api.focusnfe.com.br"
    : "https://homologacao.focusnfe.com.br"
}

function basicAuth(token: string): string {
  return "Basic " + btoa(token + ":")
}

// Mapeia status Focus -> enum local (erp_nfse_emitidas.status):
//   processando | autorizada | rejeitada | cancelada
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
  if (req.method !== "POST") return respond(405, { erro: "Method not allowed" })

  let p: Payload
  try { p = await req.json() } catch { return respond(400, { erro: "JSON invalido" }) }

  if (!p.record_id && !(p.company_id && p.ref)) {
    return respond(400, { erro: "Obrigatorio: record_id OU (company_id + ref)" })
  }

  try {
    // 1. Carrega o registro
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
        return respond(404, { ok: false, erro: "Registro nao encontrado", detalhe: error?.message })
      }
      companyId = row.company_id
      ref = row.provider_reference ?? undefined
      ambiente = (row.ambiente === "producao" ? "producao" : "homologacao")
    } else {
      // fallback por company_id + ref
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

    // 2. Token Focus por ambiente
    const tokenEnv = ambiente === "producao"
      ? "FOCUS_NFE_TOKEN_PRODUCAO"
      : "FOCUS_NFE_TOKEN_HOMOLOGACAO"
    const token = Deno.env.get(tokenEnv)
    if (!token) {
      return respond(500, { ok: false, erro: `Secret ${tokenEnv} nao configurado` })
    }

    // 3. GET na Focus
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

    let getJson: Record<string, unknown> | null = null
    try { getJson = getBody ? JSON.parse(getBody) : null } catch { getJson = null }

    // 4. 404 ou ref desconhecida
    if (getStatus === 404 || (getJson && (getJson.codigo as string) === "nao_encontrado")) {
      const update = {
        status: "rejeitada" as const,
        motivo_rejeicao: "Referência não encontrada na Focus (provável emissão legada)",
        provider_raw: { get: { status: getStatus, body: getBody.slice(0, 4000), erro: getErr } },
        atualizado_em: new Date().toISOString(),
      }
      if (recordId) await sb.from("erp_nfse_emitidas").update(update).eq("id", recordId)
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

    // 5. Mapeia status
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

    // Normaliza xml/pdf urls relativas do Focus
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
      const { error } = await sb.from("erp_nfse_emitidas").update(update).eq("id", recordId)
      if (error) {
        return respond(500, { ok: false, erro: "Falha update", detalhe: error.message })
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
    return respond(500, {
      ok: false,
      erro: "Erro interno",
      detalhe: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    })
  }
})
