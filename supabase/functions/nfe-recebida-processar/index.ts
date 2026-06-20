// F2 · Edge nfe-recebida-processar
// Manifesta ciencia, baixa XML completo, parseia, popula tabelas e gera
// contas a pagar de uma NFe recebida que esta como 'resumo'.
//
// Pilar 1 (Conformidade): manifestacao 'ciencia' (210210, neutra).
// Pilar 2 (Seguranca):    token nunca em log; Vault via fn_fiscal_obter_token;
//                         RLS por company + is_admin().
// Pilar 3 (UX):           1 clique no front; este edge resolve tudo.

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

interface ErroEtapa {
  ok: false
  etapa: string
  http_status?: number
  body_preview?: string
}

function erroEtapa(etapa: string, http_status?: number, bodyPreview?: string): ErroEtapa {
  return {
    ok: false,
    etapa,
    ...(http_status !== undefined && { http_status }),
    ...(bodyPreview && { body_preview: bodyPreview.slice(0, 500) }),
  }
}

interface FocusNotaInfo {
  caminho_xml?: string | null
  caminho_xml_nota_fiscal?: string | null
  status?: string
  status_protocolo?: string
  manifesto?: { tipo?: string } | null
  [k: string]: unknown
}

// Tenta GET na nota. Se houver caminho do XML, retorna; senao, retorna null.
async function focusObterCaminhoXml(
  chave: string,
  cnpj: string,
  token: string,
): Promise<{ caminho: string | null; status: number; body: string }> {
  const url = `${FOCUS_BASE}/v2/nfes_recebidas/${chave}?cnpj=${cnpj}`
  const r = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: basicAuth(token),
      "User-Agent": "PSGestao-ERP/3.0",
    },
  })
  const body = await r.text()
  if (!r.ok) return { caminho: null, status: r.status, body }
  let json: FocusNotaInfo
  try { json = JSON.parse(body) as FocusNotaInfo } catch { return { caminho: null, status: r.status, body } }
  const caminho =
    (typeof json.caminho_xml_nota_fiscal === "string" && json.caminho_xml_nota_fiscal) ||
    (typeof json.caminho_xml === "string" && json.caminho_xml) ||
    null
  return { caminho, status: r.status, body }
}

// POST manifestacao. Tolera 'ja manifestada' (Focus geralmente retorna 400 com
// codigo de duplicidade · tratamos como sucesso pra seguir o fluxo).
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
  const jaManifestada =
    lower.includes("duplicidade") ||
    lower.includes("duplicada") ||
    lower.includes("ja registrad") ||
    lower.includes("já registrad") ||
    lower.includes("ja manifest") ||
    lower.includes("já manifest")
  if (jaManifestada) return { ok: true, status: r.status, body }
  return { ok: false, status: r.status, body }
}

// Baixa o XML do caminho retornado pelo Focus. Aceita gzip via DecompressionStream.
async function focusBaixarXml(
  caminho: string,
  token: string,
): Promise<{ xml: string | null; status: number; body_preview: string }> {
  const url = caminho.startsWith("http") ? caminho : `${FOCUS_BASE}${caminho.startsWith("/") ? "" : "/"}${caminho}`
  const r = await fetch(url, {
    headers: {
      Authorization: basicAuth(token),
      "User-Agent": "PSGestao-ERP/3.0",
    },
  })
  if (!r.ok) {
    const txt = await r.text()
    return { xml: null, status: r.status, body_preview: txt.slice(0, 500) }
  }
  const ct = (r.headers.get("Content-Type") ?? "").toLowerCase()
  const ce = (r.headers.get("Content-Encoding") ?? "").toLowerCase()
  if (ce === "gzip" || ct.includes("gzip")) {
    const ds = new DecompressionStream("gzip")
    const decoded = r.body!.pipeThrough(ds)
    const txt = await new Response(decoded).text()
    return { xml: txt, status: r.status, body_preview: txt.slice(0, 200) }
  }
  const txt = await r.text()
  return { xml: txt, status: r.status, body_preview: txt.slice(0, 200) }
}

interface InfNFe {
  emit?: Record<string, unknown>
  ide?: Record<string, unknown>
  total?: { ICMSTot?: Record<string, unknown> }
  det?: Array<Record<string, unknown>> | Record<string, unknown>
  cobr?: { dup?: Array<Record<string, unknown>> | Record<string, unknown> }
}

interface DadosParseados {
  emitente: { cnpj: string | null; razao: string | null; ie: string | null }
  ide: {
    numero: string | null
    serie: string | null
    modelo: string | null
    natureza_operacao: string | null
  }
  totais: { valor_total: number | null; valor_produtos: number | null }
  itens: Array<{
    numero_item: number | null
    codigo_produto: string | null
    descricao: string | null
    ncm: string | null
    cfop: string | null
    unidade: string | null
    quantidade: number | null
    valor_unitario: number | null
    valor_total: number | null
  }>
  duplicatas: Array<{
    numero_dup: string | null
    data_vencimento: string | null
    valor: number | null
  }>
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
function i(v: unknown): number | null {
  const x = n(v)
  if (x === null) return null
  return Math.trunc(x)
}

function parseXml(xml: string, manifestacao: string): DadosParseados | null {
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
      numero_item: i(det["@_nItem"]),
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST") return respond(405, { ok: false, erro: "metodo nao permitido" })

  let payload: Payload
  try {
    payload = (await req.json()) as Payload
  } catch {
    return respond(400, erroEtapa("payload_invalido"))
  }

  const company_id = payload.company_id
  const nfe_id = payload.nfe_recebida_id
  const gerarPagar = payload.gerar_pagar !== false
  const tipoManif = payload.tipo_manifestacao ?? "ciencia"

  if (!company_id || !nfe_id) {
    return respond(400, erroEtapa("payload_invalido"))
  }

  // --- Guarda de acesso: RLS via JWT do usuario ---
  const authHeader = req.headers.get("Authorization") ?? ""
  if (!authHeader) return respond(401, erroEtapa("nao_autenticado"))
  const sbUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData } = await sbUser.auth.getUser()
  if (!userData?.user) return respond(401, erroEtapa("nao_autenticado"))

  // Tenta ler a NFe via cliente do usuario (RLS). Se RLS bloquear OU a nota
  // nao for da company informada, nega acesso. Cobre as duas pontas: company
  // pertence ao usuario E nfe pertence aquela company.
  const { data: nfeGuard, error: guardErr } = await sbUser
    .from("erp_nfe_recebidas")
    .select("id, company_id, chave_acesso, status, lancado_pagar")
    .eq("id", nfe_id)
    .maybeSingle()
  if (guardErr) return respond(500, erroEtapa("rls_check", undefined, guardErr.message))
  if (!nfeGuard || nfeGuard.company_id !== company_id) {
    return respond(403, erroEtapa("sem_acesso"))
  }

  const chave = digitsOnly(nfeGuard.chave_acesso)
  if (!chave || chave.length !== 44) {
    return respond(400, erroEtapa("chave_acesso_invalida"))
  }

  // Idempotencia preguicosa: ja completa + ja lancada -> retorna estado atual
  if (nfeGuard.lancado_pagar) {
    const { data: detail } = await sbAdmin
      .from("erp_nfe_recebidas")
      .select("fornecedor_id, valor_total, status, status_manifestacao")
      .eq("id", nfe_id)
      .maybeSingle()
    return respond(200, {
      ok: true,
      ja_processada: true,
      status: detail?.status ?? "completo",
      itens: 0,
      duplicatas: 0,
      fornecedor_id: detail?.fornecedor_id ?? null,
      pagar_criadas: 0,
      valor_total: detail?.valor_total ?? null,
    })
  }

  // --- Token ---
  const token = await resolverToken(company_id)
  if (!token) return respond(412, erroEtapa("token_focus_ausente"))

  // --- CNPJ da empresa ---
  const { data: comp } = await sbAdmin
    .from("companies")
    .select("cnpj")
    .eq("id", company_id)
    .maybeSingle()
  const cnpj = digitsOnly(comp?.cnpj)
  if (!cnpj || cnpj.length !== 14) {
    return respond(412, erroEtapa("cnpj_empresa_ausente"))
  }

  // --- Caminho do XML (tenta primeiro, manifesta so se faltar) ---
  let info = await focusObterCaminhoXml(chave, cnpj, token)
  if (info.status >= 500) {
    return respond(502, erroEtapa("focus_get_info", info.status, info.body))
  }
  if (!info.caminho) {
    const manif = await focusManifestar(chave, tipoManif, token)
    if (!manif.ok) {
      return respond(502, erroEtapa("focus_manifestacao", manif.status, manif.body))
    }
    info = await focusObterCaminhoXml(chave, cnpj, token)
    if (!info.caminho) {
      return respond(502, erroEtapa("xml_indisponivel_pos_manifesto", info.status, info.body))
    }
  }

  // --- Download do XML completo ---
  const xmlResp = await focusBaixarXml(info.caminho, token)
  if (!xmlResp.xml) {
    return respond(502, erroEtapa("focus_download_xml", xmlResp.status, xmlResp.body_preview))
  }
  const xml = xmlResp.xml

  // --- Parse ---
  let dados: DadosParseados | null
  try {
    dados = parseXml(xml, tipoManif)
  } catch (e) {
    return respond(500, erroEtapa("parse_xml", undefined, e instanceof Error ? e.message : String(e)))
  }
  if (!dados) {
    return respond(500, erroEtapa("infNFe_nao_encontrado", undefined, xml.slice(0, 300)))
  }

  // --- Aplicar no banco ---
  const aplicar = await sbAdmin.rpc("fn_nfe_recebida_aplicar_xml", {
    p_id: nfe_id,
    p_xml: xml,
    p_dados: dados,
  })
  if (aplicar.error) {
    return respond(500, erroEtapa("rpc_aplicar_xml", undefined, aplicar.error.message))
  }
  const aplicarRes = aplicar.data as { ok: boolean; itens?: number; duplicatas?: number; erro?: string } | null
  if (!aplicarRes?.ok) {
    return respond(500, erroEtapa("rpc_aplicar_xml", undefined, aplicarRes?.erro ?? "sem retorno"))
  }

  // --- Gerar pagar ---
  let pagarCriadas = 0
  let fornecedorId: string | null = null
  let valorTotal: number | null = dados.totais.valor_total
  if (gerarPagar) {
    const gp = await sbAdmin.rpc("fn_nfe_recebida_gerar_pagar", { p_nfe_recebida_id: nfe_id })
    if (gp.error) {
      return respond(500, erroEtapa("rpc_gerar_pagar", undefined, gp.error.message))
    }
    const gpRes = gp.data as {
      ok: boolean
      fornecedor_id?: string
      pagar_criadas?: number
      valor_total?: number
      ja_lancado?: boolean
      erro?: string
    } | null
    if (!gpRes?.ok) {
      return respond(500, erroEtapa("rpc_gerar_pagar", undefined, gpRes?.erro ?? "sem retorno"))
    }
    pagarCriadas = gpRes.pagar_criadas ?? 0
    fornecedorId = gpRes.fornecedor_id ?? null
    if (typeof gpRes.valor_total === "number") valorTotal = gpRes.valor_total
  }

  return respond(200, {
    ok: true,
    status: "completo",
    itens: aplicarRes.itens ?? 0,
    duplicatas: aplicarRes.duplicatas ?? 0,
    fornecedor_id: fornecedorId,
    pagar_criadas: pagarCriadas,
    valor_total: valorTotal,
  })
})
