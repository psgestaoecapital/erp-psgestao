// DF-e Onda 2.2 · edge nfe-distribuicao (paginacao NSU + auto-ciencia)
//
// Modos:
//   modo='manual' + company_id  -> JWT do usuario, RLS valida acesso
//   modo='auto'                  -> JWT service_role, itera todas as
//                                   empresas com habilitado=true
//
// Mudancas Onda 2.2:
//   - Loop NSU real (max 20 iter por empresa, throttle 2s) ate
//     ultimo_nsu == max_nsu informado pelo Focus.
//   - Auto-ciencia: se controle.auto_ciencia=true, manifesta cada
//     nota nova (POST .../manifesto {tipo:'ciencia'}) com throttle
//     2s, tolerando "ja manifestada", e marca status='aguardando_xml'.
//   - Salva controle.ultimo_ciclo_em=now() ao fim de cada ciclo.
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
type Modo = "manual" | "auto"

const LOOP_CAP = 20            // cap defensivo
const PAGE_SIZE_SEFAZ = 50     // hard cap SEFAZ por chamada
const THROTTLE_MS = 2000       // 2s entre chamadas (limite SEFAZ)

interface Payload {
  company_id?: string
  modo?: Modo
  gerar_pagar?: boolean
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

function basicAuth(token: string): string { return "Basic " + btoa(token + ":") }
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }

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
  nsu: number | null
  raw: Record<string, unknown>
}

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

  const rawMan = String(o.manifestacao ?? o.status_manifestacao ?? "").toLowerCase()
  let man = "pendente"
  if (rawMan.includes("ciencia")) man = "ciencia"
  else if (rawMan.includes("confir")) man = "confirmada"
  else if (rawMan.includes("descon")) man = "desconhecida"
  else if (rawMan.includes("nao_real") || rawMan.includes("nao realiz")) man = "nao_realizada"

  const rawNsu = o.nsu ?? o.NSU ?? o.numero_nsu ?? null
  const nsuNum = typeof rawNsu === "number" ? rawNsu :
    (typeof rawNsu === "string" && /^\d+$/.test(rawNsu)) ? Number(rawNsu) : null

  return {
    chave, numero, serie,
    emitente_cnpj: cnpjEmit || null,
    emitente_razao: razaoEmit || null,
    emitente_ie: ieEmit || null,
    data_emissao: dataEmissao,
    valor_total: valor, natureza,
    status_manifestacao: man, nsu: nsuNum, raw: o,
  }
}

// Tenta extrair "max NSU disponivel" do envelope da resposta Focus.
// Formato varia · tentamos varias chaves comuns. Quando ausente,
// inferimos pela cardinalidade (se < PAGE_SIZE_SEFAZ, eh fim de pool).
function extrairMaxNsuEnvelope(env: unknown): number | null {
  if (!env || typeof env !== "object" || Array.isArray(env)) return null
  const o = env as Record<string, unknown>
  const candidatos = [
    o.ultimo_nsu, o.ultimoNSU, o.ultNSU, o.ult_nsu,
    o.max_nsu, o.maxNSU, o.maxnsu, o.maximo_nsu,
    o.proximo_nsu, o.proximoNSU,
  ]
  for (const c of candidatos) {
    if (typeof c === "number" && c > 0) return c
    if (typeof c === "string" && /^\d+$/.test(c)) return Number(c)
  }
  return null
}

function extrairLista(env: unknown): Record<string, unknown>[] {
  if (Array.isArray(env)) return env as Record<string, unknown>[]
  if (env && typeof env === "object") {
    const o = env as Record<string, unknown>
    for (const k of ["resumos", "nfes", "documentos", "items", "data"]) {
      const v = o[k]
      if (Array.isArray(v)) return v as Record<string, unknown>[]
    }
  }
  return []
}

interface EmpresaJob {
  company_id: string
  cnpj: string | null
  ambiente: Ambiente
  ultimo_nsu: number
  auto_ciencia: boolean
  gerar_pagar: boolean
}

interface ResultadoEmpresa {
  company_id: string
  ok: boolean
  recebidas?: number
  novas?: number
  atualizadas?: number
  manifestadas?: number
  geradas_pagar?: number
  novo_ultimo_nsu?: number
  novo_max_nsu?: number | null
  iteracoes?: number
  erro?: string
  focus_status?: number
  focus_body?: string
}

async function resolverToken(company_id: string, ambiente: Ambiente): Promise<string> {
  const { data: tokenVault } = await sbAdmin.rpc("fn_fiscal_obter_token", {
    p_company_id: company_id,
    p_ambiente: ambiente,
  })
  let token = typeof tokenVault === "string" ? tokenVault.trim() : ""
  if (!token) {
    const envName = ambiente === "producao"
      ? "FOCUS_NFE_TOKEN_PRODUCAO"
      : "FOCUS_NFE_TOKEN_HOMOLOGACAO"
    token = Deno.env.get(envName) ?? ""
  }
  return token
}

async function manifestarCiencia(
  ambiente: Ambiente,
  chave: string,
  token: string,
): Promise<{ ok: boolean; status: number; bodyPreview: string }> {
  const url = `${focusBase(ambiente)}/v2/nfes_recebidas/${chave}/manifesto`
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: basicAuth(token),
      "User-Agent": "PSGestao-ERP/3.0",
    },
    body: JSON.stringify({ tipo: "ciencia" }),
  })
  const body = await r.text()
  if (r.ok) return { ok: true, status: r.status, bodyPreview: body.slice(0, 200) }
  const lower = body.toLowerCase()
  const jaManif =
    lower.includes("duplicidade") ||
    lower.includes("duplicada") ||
    lower.includes("ja registrad") ||
    lower.includes("já registrad") ||
    lower.includes("ja manifest") ||
    lower.includes("já manifest")
  return { ok: jaManif, status: r.status, bodyPreview: body.slice(0, 300) }
}

async function processarEmpresa(job: EmpresaJob): Promise<ResultadoEmpresa> {
  const { company_id, ambiente } = job
  try {
    const token = await resolverToken(company_id, ambiente)
    if (!token) {
      await sbAdmin.from("erp_nfe_distribuicao_controle")
        .update({
          ultima_consulta_em: new Date().toISOString(),
          ultima_consulta_status: "sem_token",
          updated_at: new Date().toISOString(),
        })
        .eq("company_id", company_id)
      return { company_id, ok: false, erro: "token_focus_ausente" }
    }
    const cnpjLimpo = (job.cnpj ?? "").replace(/\D/g, "")
    if (!cnpjLimpo) {
      await sbAdmin.from("erp_nfe_distribuicao_controle")
        .update({
          ultima_consulta_em: new Date().toISOString(),
          ultima_consulta_status: "sem_cnpj",
          updated_at: new Date().toISOString(),
        })
        .eq("company_id", company_id)
      return { company_id, ok: false, erro: "cnpj_empresa_ausente" }
    }

    let cursorNsu = job.ultimo_nsu
    let maxNsuEnvelope: number | null = null
    let totalRecebidas = 0
    let novas = 0
    let atualizadas = 0
    let geradas_pagar = 0
    const novasParaManifestar: { id: string; chave: string }[] = []
    let lastStatus = 0
    let lastBodyPreview = ""

    for (let iter = 0; iter < LOOP_CAP; iter++) {
      const qs = new URLSearchParams()
      qs.set("cnpj", cnpjLimpo)
      if (cursorNsu > 0) qs.set("ultimo_nsu", String(cursorNsu))
      const url = `${focusBase(ambiente)}/v2/nfes_recebidas?${qs.toString()}`

      const r = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: basicAuth(token),
          "User-Agent": "PSGestao-ERP/3.0",
        },
      })
      const body = await r.text()
      lastStatus = r.status
      lastBodyPreview = body.slice(0, 500)

      if (!r.ok) {
        await sbAdmin.from("erp_nfe_distribuicao_controle")
          .update({
            ultima_consulta_em: new Date().toISOString(),
            ultima_consulta_status: `erro_focus:${r.status} · ${body.slice(0, 400)}`,
            updated_at: new Date().toISOString(),
          })
          .eq("company_id", company_id)
        return {
          company_id, ok: false,
          erro: `Focus rejeitou listagem · HTTP ${r.status}`,
          focus_status: r.status,
          focus_body: body.slice(0, 500),
          iteracoes: iter,
        }
      }

      let envelope: unknown
      try { envelope = JSON.parse(body) }
      catch { return { company_id, ok: false, erro: "Focus retornou JSON invalido" } }

      // Log defensivo da 1a resposta da empresa (sem token) pra travarmos
      // o formato do envelope NSU. Pilar 2: sem segredos.
      if (iter === 0) {
        const env = envelope && typeof envelope === "object" && !Array.isArray(envelope)
          ? Object.keys(envelope as Record<string, unknown>).slice(0, 12)
          : "array"
        console.log("[nfe-distribuicao][nsu-debug]", JSON.stringify({
          company_id, ambiente, iter, status: r.status, envelope_keys: env,
          body_preview: body.slice(0, 300),
        }))
      }

      const lista = extrairLista(envelope)
      const maxEnv = extrairMaxNsuEnvelope(envelope)
      if (maxEnv !== null) maxNsuEnvelope = maxEnv
      totalRecebidas += lista.length

      let maxLote = cursorNsu
      for (const item of lista) {
        const n = normalizar(item)
        if (!n.chave || n.chave.length !== 44) continue
        if (n.nsu !== null && n.nsu > maxLote) maxLote = n.nsu

        const baseRow = {
          company_id,
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
          .select("id, status, lancado_pagar")
          .eq("company_id", company_id)
          .eq("chave_acesso", n.chave)
          .maybeSingle()

        let nfeId: string | null = null
        let isNew = false
        let jaPagar = false

        if (existing) {
          jaPagar = !!existing.lancado_pagar
          nfeId = existing.id
          const { error } = await sbAdmin
            .from("erp_nfe_recebidas")
            .update({
              status_manifestacao: baseRow.status_manifestacao,
              updated_at: baseRow.updated_at,
              resumo_raw: baseRow.resumo_raw,
            })
            .eq("id", existing.id)
          if (!error) atualizadas++
        } else {
          const { data: inserted, error } = await sbAdmin
            .from("erp_nfe_recebidas")
            .insert(baseRow)
            .select("id, status")
            .maybeSingle()
          if (!error && inserted) {
            novas++
            nfeId = inserted.id
            isNew = true
          }
        }

        // Coleta novas em 'resumo' pra auto-ciencia depois (1-a-1 com throttle).
        if (isNew && nfeId && job.auto_ciencia) {
          novasParaManifestar.push({ id: nfeId, chave: n.chave })
        }

        // gerar_pagar opt-in (legado · Onda 2.1 manda lancar via outro fluxo)
        if (job.gerar_pagar && nfeId && !jaPagar) {
          const { data: gerado } = await sbAdmin.rpc("fn_nfe_recebida_gerar_pagar", {
            p_nfe_recebida_id: nfeId,
          })
          if (gerado && typeof gerado === "object" && (gerado as { ok?: boolean }).ok) {
            geradas_pagar++
          }
        }
      }

      if (maxLote > cursorNsu) cursorNsu = maxLote

      // Condicoes de parada do loop:
      //   1. envelope explicito disse maxNsu e ja batemos
      //   2. lista veio menor que PAGE_SIZE_SEFAZ (fim de pool)
      //   3. cap LOOP_CAP atingido
      const fimPorEnvelope = maxNsuEnvelope !== null && cursorNsu >= maxNsuEnvelope
      const fimPorTamanho = lista.length < PAGE_SIZE_SEFAZ
      if (fimPorEnvelope || fimPorTamanho) break

      // Throttle 2s entre chamadas (limite SEFAZ)
      await sleep(THROTTLE_MS)
    }

    // ---- Auto-ciencia · 1 chamada por nota nova, throttle 2s ----
    let manifestadas = 0
    if (job.auto_ciencia && novasParaManifestar.length > 0) {
      for (let i = 0; i < novasParaManifestar.length; i++) {
        const { id, chave } = novasParaManifestar[i]
        const m = await manifestarCiencia(ambiente, chave, token)
        if (m.ok) {
          await sbAdmin
            .from("erp_nfe_recebidas")
            .update({
              status: "aguardando_xml",
              status_manifestacao: "ciencia",
              manifestado_em: new Date().toISOString(),
              lancar_ao_completar: false,
              updated_at: new Date().toISOString(),
            })
            .eq("id", id)
          manifestadas++
        } else {
          console.log("[nfe-distribuicao][manif-fail]", JSON.stringify({
            company_id, chave: chave.slice(0, 12) + "…",
            status: m.status, body: m.bodyPreview.slice(0, 150),
          }))
        }
        if (i < novasParaManifestar.length - 1) await sleep(THROTTLE_MS)
      }
    }

    await sbAdmin.from("erp_nfe_distribuicao_controle")
      .update({
        ultimo_nsu: cursorNsu,
        max_nsu: maxNsuEnvelope ?? cursorNsu,
        ultima_consulta_em: new Date().toISOString(),
        ultima_consulta_status: lastStatus === 200 ? "ok" : `http_${lastStatus}`,
        ultimo_ciclo_em: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", company_id)

    return {
      company_id, ok: true,
      recebidas: totalRecebidas,
      novas, atualizadas, manifestadas, geradas_pagar,
      novo_ultimo_nsu: cursorNsu,
      novo_max_nsu: maxNsuEnvelope,
    }
  } catch (e) {
    return {
      company_id, ok: false,
      erro: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== "POST") {
    return respond(405, { ok: false, erro: "Method not allowed" })
  }

  const auth = req.headers.get("authorization") ?? ""
  const jwt = auth.replace(/^Bearer\s+/i, "").trim()
  if (!jwt) return respond(401, { ok: false, erro: "sem token" })

  let payload: Payload
  try { payload = await req.json() }
  catch { return respond(400, { ok: false, erro: "JSON invalido" }) }

  const modo: Modo = payload.modo === "auto" ? "auto" : "manual"
  const gerar_pagar = payload.gerar_pagar === true

  // ============== MODO AUTO ==============
  if (modo === "auto") {
    if (jwt !== SUPABASE_SERVICE_KEY) {
      return respond(403, { ok: false, erro: "modo=auto exige service_role" })
    }
    const { data: empresas, error: listErr } = await sbAdmin.rpc(
      "fn_nfe_distribuicao_listar_habilitadas"
    )
    if (listErr) {
      return respond(500, { ok: false, erro: "erro ao listar habilitadas", detalhe: listErr.message })
    }
    const lista = (empresas ?? []) as Array<{
      company_id: string
      cnpj: string | null
      ambiente: string
      ultimo_nsu: number
    }>

    const resultados: ResultadoEmpresa[] = []
    for (const e of lista) {
      // Carrega auto_ciencia do controle (default true)
      const { data: ctrl } = await sbAdmin
        .from("erp_nfe_distribuicao_controle")
        .select("auto_ciencia")
        .eq("company_id", e.company_id)
        .maybeSingle()
      const job: EmpresaJob = {
        company_id: e.company_id,
        cnpj: e.cnpj,
        ambiente: e.ambiente === "producao" ? "producao" : "homologacao",
        ultimo_nsu: Number(e.ultimo_nsu ?? 0),
        auto_ciencia: ctrl?.auto_ciencia !== false,
        gerar_pagar,
      }
      resultados.push(await processarEmpresa(job))
    }
    return respond(200, { ok: true, modo: "auto", empresas: resultados.length, resultados })
  }

  // ============== MODO MANUAL ==============
  if (!payload.company_id) {
    return respond(400, { ok: false, erro: "company_id obrigatorio em modo=manual" })
  }

  if (jwt !== SUPABASE_SERVICE_KEY) {
    const sbUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    })
    const { data: empresaCheck, error: empCheckErr } = await sbUser
      .from("companies")
      .select("id")
      .eq("id", payload.company_id)
      .maybeSingle()
    if (empCheckErr || !empresaCheck) {
      return respond(403, { ok: false, erro: "sem acesso a empresa" })
    }
  }

  const { data: empresa } = await sbAdmin
    .from("companies")
    .select("id, cnpj")
    .eq("id", payload.company_id)
    .maybeSingle()
  if (!empresa) {
    return respond(404, { ok: false, erro: "empresa nao encontrada" })
  }

  const { data: cfgs } = await sbAdmin
    .from("erp_fiscal_provider_config")
    .select("ambiente, atualizado_em, criado_em, id")
    .eq("company_id", payload.company_id)
    .eq("ativo", true)
    .order("atualizado_em", { ascending: false, nullsFirst: false })
    .order("criado_em", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(1)
  const cfg = cfgs?.[0] ?? null
  const ambiente: Ambiente = cfg?.ambiente === "producao" ? "producao" : "homologacao"

  const { data: ctrl } = await sbAdmin
    .from("erp_nfe_distribuicao_controle")
    .select("ultimo_nsu, auto_ciencia")
    .eq("company_id", payload.company_id)
    .maybeSingle()
  const ultimo_nsu = Number(ctrl?.ultimo_nsu ?? 0)
  const auto_ciencia = ctrl?.auto_ciencia !== false

  const result = await processarEmpresa({
    company_id: payload.company_id,
    cnpj: String(empresa.cnpj ?? "").replace(/\D/g, "") || null,
    ambiente,
    ultimo_nsu,
    auto_ciencia,
    gerar_pagar,
  })

  if (!result.ok) return respond(502, { ok: false, ...result })
  return respond(200, { ok: true, modo: "manual", ambiente, ...result })
})
