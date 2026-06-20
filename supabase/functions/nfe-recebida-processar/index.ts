// DF-e Onda 2.1 · Edge nfe-recebida-processar (fluxo assincrono)
//
// Fluxo:
//   1. GET /v2/nfes_recebidas/{chave}.xml direto. Se vier 200 + XML,
//      manifestacao previa ja foi feita e o Focus tem o procNFe ->
//      parseia, aplica no banco, gera pagar se pedido.
//   2. Caso contrario (404 / corpo nao-XML), POST /manifesto
//      {tipo:'ciencia'} e marca status='aguardando_xml'. O worker
//      nfe-baixar-xml-pendentes pega depois (cron 30 min).
//
// Pilar 1: ciencia (210210) e neutra. 1-a-1 por chave.
// Pilar 2: token via Vault (fn_fiscal_obter_token). NUNCA em log.
// Pilar 3: lag de ~2h e EXPOSTO no toast da UI, sem spinner infinito.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { XMLParser } from "https://esm.sh/fast-xml-parser@4.4.1"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!

const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const FOCUS_BASE = "https://api.focusnfe.com.br"

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  })
}

function basicAuth(token: string): string {
  return "Basic " + btoa(token + ":")
}

function digitsOnly(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "")
}

interface Payload {
  company_id: string
  nfe_recebida_id: string
  gerar_pagar?: boolean
  tipo_manifestacao?: "ciencia" | "confirmacao" | "desconhecimento" | "nao_realizada"
}

function erro(etapa: string, http_status?: number, bodyPreview?: string) {
  return {
    ok: false,
    etapa,
    ...(http_status !== undefined && { http_status }),
    ...(bodyPreview && { body_preview: bodyPreview.slice(0, 500) }),
  }
}

// ----- Helpers Focus -----------------------------------------------

// GET /v2/nfes_recebidas/{chave}.xml · sem ?cnpj=, Basic token:.
// Retorna { xml, status, body_preview }. Aceita gzip via DecompressionStream.
async function focusBaixarXml(
  chave: string,
  token: string,
): Promise<{ xml: string | null; status: number; body_preview: string }> {
  const url = `${FOCUS_BASE}/v2/nfes_recebidas/${chave}.xml`
  const r = await fetch(url, {
    headers: {
      Authorization: basicAuth(token),
      "User-Agent": "PSGestao-ERP/3.0",
      Accept: "application/xml, text/xml, */*",
    },
  })
  if (!r.ok) {
    const txt = await r.text()
    return { xml: null, status: r.status, body_preview: txt.slice(0, 500) }
  }
  const ce = (r.headers.get("Content-Encoding") ?? "").toLowerCase()
  let text: string
  if (ce === "gzip") {
    const ds = new DecompressionStream("gzip")
    text = await new Response(r.body!.pipeThrough(ds)).text()
  } else {
    text = await r.text()
  }
  const trimmed = text.trimStart()
  const ehXml = trimmed.startsWith("<?xml") || trimmed.startsWith("<nfeProc") || trimmed.startsWith("<NFe")
  if (!ehXml) {
    // 200 sem XML (Focus pode mandar JSON de resumo ou aviso)
    return { xml: null, status: r.status, body_preview: text.slice(0, 500) }
  }
  return { xml: text, status: r.status, body_preview: text.slice(0, 200) }
}

// POST /v2/nfes_recebidas/{chave}/manifesto {"tipo":...}
// Tolera "duplicidade / ja manifestada" como ok.
async function focusManifestar(
  chave: string,
  tipo: string,
  token: string,
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${FOCUS_BASE}/v2/nfes_recebidas/${chave}/manifesto`
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: basicAuth(token),
      "User-Agent": "PSGestao-ERP/3.0",
    },
    body: JSON.stringify({ tipo }),
  })
  const body = await r.text()
  if (r.ok) return { ok: true, status: r.status, body }
  const lower = body.toLowerCase()
  const jaManif =
    lower.includes("duplicidade") ||
    lower.includes("duplicada") ||
    lower.includes("ja registrad") ||
    lower.includes("já registrad") ||
    lower.includes("ja manifest") ||
    lower.includes("já manifest")
  return { ok: jaManif, status: r.status, body }
}

// ----- Parser ------------------------------------------------------

interface DadosParseados {
  emitente: { cnpj: string | null; razao: string | null; ie: string | null }
  ide: {
    numero: string | null
    serie: string | null
    modelo: string | null
    natureza_operacao: string | null
  }
  totais: { valor_total: number | null; valor_produtos: number | null }
  itens: Array<Record<string, unknown>>
  duplicatas: Array<Record<string, unknown>>
  manifestacao: string
}

function s(v: unknown): string | null {
  if (v === null || v === undefined) return null
  return String(v).trim() || null
}
function n(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}
function intOf(v: unknown): number | null {
  const x = n(v)
  return x === null ? null : Math.trunc(x)
}

interface InfNFe {
  emit?: Record<string, unknown>
  ide?: Record<string, unknown>
  total?: { ICMSTot?: Record<string, unknown> }
  det?: Array<Record<string, unknown>> | Record<string, unknown>
  cobr?: { dup?: Array<Record<string, unknown>> | Record<string, unknown> }
}

export function parseProcNFe(xml: string, manifestacao: string): DadosParseados | null {
  const parser = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) => name === "det" || name === "dup",
  })
  const doc = parser.parse(xml) as Record<string, unknown>
  const nfeProc = (doc.nfeProc as Record<string, unknown> | undefined) ?? null
  const NFe = (nfeProc?.NFe ?? doc.NFe) as Record<string, unknown> | undefined
  const infNFe = NFe?.infNFe as InfNFe | undefined
  if (!infNFe) return null

  const emit = infNFe.emit ?? {}
  const ide = infNFe.ide ?? {}
  const tot = infNFe.total?.ICMSTot ?? {}
  const detArr = Array.isArray(infNFe.det) ? infNFe.det : (infNFe.det ? [infNFe.det] : [])
  const dupArrRaw = infNFe.cobr?.dup
  const dupArr = Array.isArray(dupArrRaw) ? dupArrRaw : (dupArrRaw ? [dupArrRaw] : [])

  const itens = detArr.map((det) => {
    const prod = (det.prod ?? {}) as Record<string, unknown>
    return {
      numero_item: intOf(det["@_nItem"]),
      codigo_produto: s(prod.cProd),
      descricao: s(prod.xProd),
      ncm: s(prod.NCM),
      cfop: s(prod.CFOP),
      unidade: s(prod.uCom),
      quantidade: n(prod.qCom),
      valor_unitario: n(prod.vUnCom),
      valor_total: n(prod.vProd),
    }
  })

  const duplicatas = dupArr.map((dup) => ({
    numero_dup: s((dup as Record<string, unknown>).nDup),
    data_vencimento: s((dup as Record<string, unknown>).dVenc),
    valor: n((dup as Record<string, unknown>).vDup),
  }))

  return {
    emitente: {
      cnpj: digitsOnly(s(emit.CNPJ)) || null,
      razao: s(emit.xNome),
      ie: s(emit.IE),
    },
    ide: {
      numero: s(ide.nNF),
      serie: s(ide.serie),
      modelo: s(ide.mod),
      natureza_operacao: s(ide.natOp),
    },
    totais: {
      valor_total: n(tot.vNF),
      valor_produtos: n(tot.vProd),
    },
    itens,
    duplicatas,
    manifestacao,
  }
}

async function resolverToken(company_id: string): Promise<string> {
  const { data } = await sbAdmin.rpc("fn_fiscal_obter_token", {
    p_company_id: company_id,
    p_ambiente: "producao",
  })
  return typeof data === "string" ? data.trim() : ""
}

// ----- Handler -----------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST") return respond(405, erro("metodo_nao_permitido"))

  let payload: Payload
  try { payload = (await req.json()) as Payload }
  catch { return respond(400, erro("payload_invalido")) }

  const company_id = payload.company_id
  const nfe_id = payload.nfe_recebida_id
  const gerarPagar = payload.gerar_pagar !== false
  const tipoManif = payload.tipo_manifestacao ?? "ciencia"

  if (!company_id || !nfe_id) return respond(400, erro("payload_invalido"))

  // --- Guarda RLS via JWT do usuario ---
  const authHeader = req.headers.get("Authorization") ?? ""
  if (!authHeader) return respond(401, erro("nao_autenticado"))
  const sbUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData } = await sbUser.auth.getUser()
  if (!userData?.user) return respond(401, erro("nao_autenticado"))

  const { data: nfeGuard, error: guardErr } = await sbUser
    .from("erp_nfe_recebidas")
    .select("id, company_id, chave_acesso, status, lancado_pagar")
    .eq("id", nfe_id)
    .maybeSingle()
  if (guardErr) return respond(500, erro("rls_check", undefined, guardErr.message))
  if (!nfeGuard || nfeGuard.company_id !== company_id) {
    return respond(403, erro("sem_acesso"))
  }

  const chave = digitsOnly(nfeGuard.chave_acesso)
  if (!chave || chave.length !== 44) return respond(400, erro("chave_acesso_invalida"))

  // Idempotencia: ja lancada -> retorna estado atual sem chamar Focus
  if (nfeGuard.lancado_pagar) {
    const { data: detail } = await sbAdmin
      .from("erp_nfe_recebidas")
      .select("fornecedor_id, valor_total, status, status_manifestacao")
      .eq("id", nfe_id)
      .maybeSingle()
    return respond(200, {
      ok: true,
      ja_processada: true,
      status: detail?.status ?? "completa",
      fornecedor_id: detail?.fornecedor_id ?? null,
      pagar_criadas: 0,
      valor_total: detail?.valor_total ?? null,
    })
  }

  // --- Token Vault ---
  const token = await resolverToken(company_id)
  if (!token) return respond(412, erro("token_focus_ausente"))

  // ===================================================================
  // PASSO 1 · Tenta GET do XML direto (manifesto previo + Focus sync OK)
  // ===================================================================
  const xmlResp = await focusBaixarXml(chave, token)
  if (xmlResp.xml) {
    let dados: DadosParseados | null
    try { dados = parseProcNFe(xmlResp.xml, tipoManif) }
    catch (e) {
      return respond(500, erro("parse_xml", undefined, e instanceof Error ? e.message : String(e)))
    }
    if (!dados) {
      return respond(500, erro("infNFe_nao_encontrado", undefined, xmlResp.xml.slice(0, 300)))
    }

    const aplicar = await sbAdmin.rpc("fn_nfe_recebida_aplicar_xml", {
      p_id: nfe_id, p_xml: xmlResp.xml, p_dados: dados,
    })
    if (aplicar.error) {
      return respond(500, erro("rpc_aplicar_xml", undefined, aplicar.error.message))
    }

    let pagarCriadas = 0
    let fornecedorId: string | null = null
    let valorTotal: number | null = dados.totais.valor_total
    if (gerarPagar) {
      const gp = await sbAdmin.rpc("fn_nfe_recebida_gerar_pagar", { p_nfe_recebida_id: nfe_id })
      if (gp.error) {
        return respond(500, erro("rpc_gerar_pagar", undefined, gp.error.message))
      }
      const gpRes = gp.data as { ok: boolean; fornecedor_id?: string; pagar_criadas?: number; valor_total?: number; erro?: string } | null
      if (!gpRes?.ok) {
        return respond(500, erro("rpc_gerar_pagar", undefined, gpRes?.erro ?? "sem retorno"))
      }
      pagarCriadas = gpRes.pagar_criadas ?? 0
      fornecedorId = gpRes.fornecedor_id ?? null
      if (typeof gpRes.valor_total === "number") valorTotal = gpRes.valor_total
    }

    return respond(200, {
      ok: true,
      status: "completa",
      fornecedor_id: fornecedorId,
      pagar_criadas: pagarCriadas,
      valor_total: valorTotal,
    })
  }

  // ===================================================================
  // PASSO 2 · XML ainda nao liberado -> manifesta e marca aguardando
  // ===================================================================
  const manif = await focusManifestar(chave, tipoManif, token)
  if (!manif.ok) {
    return respond(502, erro("focus_manifestacao", manif.status, manif.body))
  }

  const up = await sbAdmin
    .from("erp_nfe_recebidas")
    .update({
      status: "aguardando_xml",
      status_manifestacao: tipoManif,
      manifestado_em: new Date().toISOString(),
      lancar_ao_completar: gerarPagar,
      updated_at: new Date().toISOString(),
    })
    .eq("id", nfe_id)
  if (up.error) {
    return respond(500, erro("update_aguardando_xml", undefined, up.error.message))
  }

  return respond(200, {
    ok: true,
    status: "aguardando_xml",
    mensagem:
      "Ciência registrada na SEFAZ. O XML completo é liberado em até 2h — a conta é criada automaticamente quando chegar.",
  })
})
