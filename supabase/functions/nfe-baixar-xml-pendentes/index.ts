// DF-e Onda 2.1 · Worker nfe-baixar-xml-pendentes
//
// Disparado pelo cron (fn_dfe_baixar_xml_pendentes_dispatch a cada 30min)
// ou manualmente via UI (futuro). Seleciona ate 30 notas em
// status='aguardando_xml' (priorizando as menos tentadas), e para cada
// uma faz:
//   1) GET /v2/nfes_recebidas/{chave}.xml com o token da empresa dona
//   2) Se 200 + XML -> fn_nfe_recebida_aplicar_xml + (se
//      lancar_ao_completar) fn_nfe_recebida_gerar_pagar
//   3) Caso contrario -> xml_tentativas+1, ultima_tentativa_xml=now()
// Throttle de 2s entre chamadas (limite SEFAZ recomendado).
// Service role only.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { XMLParser } from "https://esm.sh/fast-xml-parser@4.4.1"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const FOCUS_BASE = "https://api.focusnfe.com.br"
const BATCH_LIMIT = 30
const THROTTLE_MS = 2000

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  })
}

function basicAuth(token: string): string { return "Basic " + btoa(token + ":") }
function digitsOnly(s: string | null | undefined): string { return (s ?? "").replace(/\D/g, "") }
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }

async function focusBaixarXml(
  chave: string,
  token: string,
): Promise<{ xml: string | null; status: number; body_preview: string }> {
  const r = await fetch(`${FOCUS_BASE}/v2/nfes_recebidas/${chave}.xml`, {
    headers: {
      Authorization: basicAuth(token),
      "User-Agent": "PSGestao-ERP/3.0",
      Accept: "application/xml, text/xml, */*",
    },
  })
  if (!r.ok) {
    const txt = await r.text()
    return { xml: null, status: r.status, body_preview: txt.slice(0, 300) }
  }
  const ce = (r.headers.get("Content-Encoding") ?? "").toLowerCase()
  const text = ce === "gzip"
    ? await new Response(r.body!.pipeThrough(new DecompressionStream("gzip"))).text()
    : await r.text()
  const trimmed = text.trimStart()
  const ehXml = trimmed.startsWith("<?xml") || trimmed.startsWith("<nfeProc") || trimmed.startsWith("<NFe")
  if (!ehXml) return { xml: null, status: r.status, body_preview: text.slice(0, 300) }
  return { xml: text, status: r.status, body_preview: text.slice(0, 200) }
}

interface DadosParseados {
  emitente: { cnpj: string | null; razao: string | null; ie: string | null }
  ide: { numero: string | null; serie: string | null; modelo: string | null; natureza_operacao: string | null }
  totais: { valor_total: number | null; valor_produtos: number | null }
  itens: Array<Record<string, unknown>>
  duplicatas: Array<Record<string, unknown>>
  manifestacao: string
}

interface InfNFe {
  emit?: Record<string, unknown>
  ide?: Record<string, unknown>
  total?: { ICMSTot?: Record<string, unknown> }
  det?: Array<Record<string, unknown>> | Record<string, unknown>
  cobr?: { dup?: Array<Record<string, unknown>> | Record<string, unknown> }
}

function s(v: unknown): string | null {
  if (v === null || v === undefined) return null
  return String(v).trim() || null
}
function n(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const x = Number(v); return Number.isFinite(x) ? x : null
}
function intOf(v: unknown): number | null {
  const x = n(v); return x === null ? null : Math.trunc(x)
}

function parseProcNFe(xml: string, manifestacao: string): DadosParseados | null {
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
  const dupRaw = infNFe.cobr?.dup
  const dupArr = Array.isArray(dupRaw) ? dupRaw : (dupRaw ? [dupRaw] : [])

  return {
    emitente: { cnpj: digitsOnly(s(emit.CNPJ)) || null, razao: s(emit.xNome), ie: s(emit.IE) },
    ide: {
      numero: s(ide.nNF), serie: s(ide.serie), modelo: s(ide.mod),
      natureza_operacao: s(ide.natOp),
    },
    totais: { valor_total: n(tot.vNF), valor_produtos: n(tot.vProd) },
    itens: detArr.map((det) => {
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
    }),
    duplicatas: dupArr.map((dup) => ({
      numero_dup: s((dup as Record<string, unknown>).nDup),
      data_vencimento: s((dup as Record<string, unknown>).dVenc),
      valor: n((dup as Record<string, unknown>).vDup),
    })),
    manifestacao,
  }
}

interface NotaPendente {
  id: string
  company_id: string
  chave_acesso: string
  status_manifestacao: string
  lancar_ao_completar: boolean
  xml_tentativas: number
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST") return respond(405, { ok: false, erro: "metodo_nao_permitido" })

  // Aceita {company_id?} opcional pra dry-run / repique manual
  let payloadCompanyId: string | undefined
  try {
    const body = await req.json().catch(() => ({}))
    payloadCompanyId = typeof body?.company_id === "string" ? body.company_id : undefined
  } catch { /* ok · sem body */ }

  // Seleciona pendentes priorizando as nunca tentadas / mais antigas
  let q = sbAdmin
    .from("erp_nfe_recebidas")
    .select("id, company_id, chave_acesso, status_manifestacao, lancar_ao_completar, xml_tentativas")
    .eq("status", "aguardando_xml")
    .order("ultima_tentativa_xml", { ascending: true, nullsFirst: true })
    .limit(BATCH_LIMIT)
  if (payloadCompanyId) q = q.eq("company_id", payloadCompanyId)

  const { data: pendentes, error: qErr } = await q
  if (qErr) {
    return respond(500, { ok: false, etapa: "select_pendentes", body_preview: qErr.message })
  }
  const fila = (pendentes ?? []) as NotaPendente[]
  if (fila.length === 0) {
    return respond(200, { ok: true, processadas: 0, completadas: 0, ainda_pendentes: 0 })
  }

  // Cache de token por company (evita re-chamar a RPC pra cada nota)
  const tokenPorCompany = new Map<string, string>()
  async function tokenDe(company_id: string): Promise<string> {
    const cached = tokenPorCompany.get(company_id)
    if (cached !== undefined) return cached
    const { data } = await sbAdmin.rpc("fn_fiscal_obter_token", {
      p_company_id: company_id, p_ambiente: "producao",
    })
    const tok = typeof data === "string" ? data.trim() : ""
    tokenPorCompany.set(company_id, tok)
    return tok
  }

  let completadas = 0
  let semToken = 0
  const erros: Array<{ id: string; etapa: string; status?: number }> = []

  for (let i = 0; i < fila.length; i++) {
    const nota = fila[i]
    const chave = digitsOnly(nota.chave_acesso)
    if (!chave || chave.length !== 44) {
      erros.push({ id: nota.id, etapa: "chave_invalida" })
      continue
    }

    const token = await tokenDe(nota.company_id)
    if (!token) {
      semToken++
      erros.push({ id: nota.id, etapa: "token_ausente" })
      // marca tentativa pra nao bloquear fila com mesma empresa
      await sbAdmin.from("erp_nfe_recebidas")
        .update({
          xml_tentativas: nota.xml_tentativas + 1,
          ultima_tentativa_xml: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", nota.id)
      if (i < fila.length - 1) await sleep(THROTTLE_MS)
      continue
    }

    const xmlResp = await focusBaixarXml(chave, token)
    if (!xmlResp.xml) {
      // Ainda nao liberado pela SEFAZ -> incrementa tentativa
      await sbAdmin.from("erp_nfe_recebidas")
        .update({
          xml_tentativas: nota.xml_tentativas + 1,
          ultima_tentativa_xml: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", nota.id)
      erros.push({ id: nota.id, etapa: "xml_ainda_indisponivel", status: xmlResp.status })
      if (i < fila.length - 1) await sleep(THROTTLE_MS)
      continue
    }

    const dados = parseProcNFe(xmlResp.xml, nota.status_manifestacao || "ciencia")
    if (!dados) {
      await sbAdmin.from("erp_nfe_recebidas")
        .update({
          xml_tentativas: nota.xml_tentativas + 1,
          ultima_tentativa_xml: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", nota.id)
      erros.push({ id: nota.id, etapa: "infNFe_nao_encontrado" })
      if (i < fila.length - 1) await sleep(THROTTLE_MS)
      continue
    }

    const aplicar = await sbAdmin.rpc("fn_nfe_recebida_aplicar_xml", {
      p_id: nota.id, p_xml: xmlResp.xml, p_dados: dados,
    })
    if (aplicar.error) {
      erros.push({ id: nota.id, etapa: "rpc_aplicar_xml" })
      if (i < fila.length - 1) await sleep(THROTTLE_MS)
      continue
    }

    if (nota.lancar_ao_completar) {
      const gp = await sbAdmin.rpc("fn_nfe_recebida_gerar_pagar", { p_nfe_recebida_id: nota.id })
      if (gp.error) {
        erros.push({ id: nota.id, etapa: "rpc_gerar_pagar" })
        if (i < fila.length - 1) await sleep(THROTTLE_MS)
        continue
      }
    }

    completadas++
    if (i < fila.length - 1) await sleep(THROTTLE_MS)
  }

  const { count: aindaPendentesCount } = await sbAdmin
    .from("erp_nfe_recebidas")
    .select("id", { count: "exact", head: true })
    .eq("status", "aguardando_xml")

  return respond(200, {
    ok: true,
    processadas: fila.length,
    completadas,
    ainda_pendentes: aindaPendentesCount ?? null,
    sem_token: semToken,
    erros: erros.slice(0, 20),
  })
})
