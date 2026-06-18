// nfe-recebidas-f1-distribuicao-dfe · edge nfe-distribuicao (v3 auto)
// Modos:
//   modo='manual' + company_id  -> JWT do usuario, RLS valida acesso
//   modo='auto'                  -> JWT service_role, itera todas as
//                                   empresas com habilitado=true
//
// Sem ramificar por provider · principio Focus registrado:
// elegibilidade = cert A1 + token no cofre (RPC fn_nfe_distribuicao_habilitar).
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

interface Payload {
  company_id?: string
  modo?: Modo
  // default false · permite importacao "so resumo" sem disparar F2
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
  nsu: number | null
  raw: Record<string, unknown>
}

// Normaliza payload da Focus. Aceita variacoes entre /v2/nfes_recebidas
// (resumo do MDe) e shapes auxiliares. NSU eh capturado quando presente
// (any de: nsu, NSU, numero_nsu) pra controle incremental.
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
    nsu: nsuNum,
    raw: o,
  }
}

interface EmpresaJob {
  company_id: string
  cnpj: string | null
  ambiente: Ambiente
  ultimo_nsu: number
  gerar_pagar: boolean
}

interface ResultadoEmpresa {
  company_id: string
  ok: boolean
  recebidas?: number
  novas?: number
  atualizadas?: number
  geradas_pagar?: number
  novo_ultimo_nsu?: number
  erro?: string
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

async function processarEmpresa(job: EmpresaJob): Promise<ResultadoEmpresa> {
  const { company_id, ambiente, ultimo_nsu, gerar_pagar } = job
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

    // Focus DF-e: /v2/nfes_recebidas?ultimo_nsu=N
    // Param `ultimo_nsu` retoma incremental do ultimo processado.
    const qs = new URLSearchParams()
    if (ultimo_nsu > 0) qs.set("ultimo_nsu", String(ultimo_nsu))
    const url = `${focusBase(ambiente)}/v2/nfes_recebidas${qs.toString() ? "?" + qs.toString() : ""}`

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
      const motivo = r.status === 401 || r.status === 403
        ? "token invalido ou conta sem permissao 'Recebimento de NFes'"
        : `HTTP ${r.status}`
      await sbAdmin.from("erp_nfe_distribuicao_controle")
        .update({
          ultima_consulta_em: new Date().toISOString(),
          ultima_consulta_status: `erro_focus:${r.status}`,
          updated_at: new Date().toISOString(),
        })
        .eq("company_id", company_id)
      return { company_id, ok: false, erro: "Focus rejeitou listagem · " + motivo }
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
      return { company_id, ok: false, erro: "Focus retornou JSON invalido" }
    }

    let novas = 0
    let atualizadas = 0
    let geradas_pagar = 0
    let maxNsu = ultimo_nsu

    for (const item of lista) {
      const n = normalizar(item)
      if (!n.chave || n.chave.length !== 44) continue
      if (n.nsu !== null && n.nsu > maxNsu) maxNsu = n.nsu

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
        .select("id, lancado_pagar")
        .eq("company_id", company_id)
        .eq("chave_acesso", n.chave)
        .maybeSingle()

      let nfeId: string | null = null
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
          .select("id")
          .maybeSingle()
        if (!error && inserted) {
          novas++
          nfeId = inserted.id
        }
      }

      // F2 trigger (opt-in): gera fornecedor + contas a pagar idempotente
      if (gerar_pagar && nfeId && !jaPagar) {
        const { data: gerado } = await sbAdmin.rpc("fn_nfe_recebida_gerar_pagar", {
          p_nfe_recebida_id: nfeId,
        })
        if (gerado && typeof gerado === "object" && (gerado as { ok?: boolean }).ok) {
          geradas_pagar++
        }
      }
    }

    await sbAdmin.from("erp_nfe_distribuicao_controle")
      .update({
        ultimo_nsu: maxNsu,
        max_nsu: maxNsu,
        ultima_consulta_em: new Date().toISOString(),
        ultima_consulta_status: "ok",
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", company_id)

    return {
      company_id,
      ok: true,
      recebidas: lista.length,
      novas,
      atualizadas,
      geradas_pagar,
      novo_ultimo_nsu: maxNsu,
    }
  } catch (e) {
    return {
      company_id,
      ok: false,
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
  try {
    payload = await req.json()
  } catch {
    return respond(400, { ok: false, erro: "JSON invalido" })
  }

  const modo: Modo = payload.modo === "auto" ? "auto" : "manual"
  // gerar_pagar default false · modo auto pode forcar true via payload
  const gerar_pagar = payload.gerar_pagar === true

  // ============== MODO AUTO (cron / service-role) ==============
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
      const job: EmpresaJob = {
        company_id: e.company_id,
        cnpj: e.cnpj,
        ambiente: e.ambiente === "producao" ? "producao" : "homologacao",
        ultimo_nsu: Number(e.ultimo_nsu ?? 0),
        gerar_pagar,
      }
      resultados.push(await processarEmpresa(job))
    }
    return respond(200, { ok: true, modo: "auto", empresas: resultados.length, resultados })
  }

  // ============== MODO MANUAL (usuario) ==============
  if (!payload.company_id) {
    return respond(400, { ok: false, erro: "company_id obrigatorio em modo=manual" })
  }

  // Aceita service_role como autorizacao plena (uso interno via pg_net).
  // Caso contrario, valida acesso do usuario pela RLS.
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

  const { data: cfg } = await sbAdmin
    .from("erp_fiscal_provider_config")
    .select("ambiente")
    .eq("company_id", payload.company_id)
    .eq("ativo", true)
    .maybeSingle()
  const ambiente: Ambiente = cfg?.ambiente === "producao" ? "producao" : "homologacao"

  const { data: ctrl } = await sbAdmin
    .from("erp_nfe_distribuicao_controle")
    .select("ultimo_nsu")
    .eq("company_id", payload.company_id)
    .maybeSingle()
  const ultimo_nsu = Number(ctrl?.ultimo_nsu ?? 0)

  const result = await processarEmpresa({
    company_id: payload.company_id,
    cnpj: String(empresa.cnpj ?? "").replace(/\D/g, "") || null,
    ambiente,
    ultimo_nsu,
    gerar_pagar,
  })

  if (!result.ok) {
    return respond(502, { ok: false, ...result })
  }
  return respond(200, { ok: true, modo: "manual", ambiente, ...result })
})
