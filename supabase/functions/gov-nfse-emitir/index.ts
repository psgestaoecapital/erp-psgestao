// FEAT-NFSE-FOCUS-v1 · gov-nfse-emitir v3 (Focus NFe gateway)
// Reescrita completa: o Focus NFe cuida de cert A1 + assinatura XAdES + mTLS.
// Removidos: node-forge, PFX parse, montagem/assinatura XML, Deno.createHttpClient,
// chamada direta ao gov.br ADN. Sai ~280 linhas · entra ~180.
//
// Pre-requisitos:
//   - Secret FOCUS_NFE_TOKEN_HOMOLOGACAO (e/ou _PRODUCAO) no projeto Supabase
//   - erp_fiscal_provider_config com gov_nfse_municipio_codigo (KGF: 4216701)
//   - companies.cnpj preenchido

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

type Ambiente = "homologacao" | "producao"

interface Payload {
  company_id: string
  teste_homologacao?: boolean
  nfse_emitida_id?: string
  servico: {
    descricao: string
    valor: number
    codigo_tributacao_nacional_iss: string
    codigo_nbs?: string
    aliquota_iss?: number
  }
  tomador?: {
    cpf_cnpj: string
    razao_social?: string
  }
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

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ISO 8601 com offset -03:00 fixo (gov.br espera horario local Brasilia)
function isoBrasilia(): string {
  const now = new Date()
  const sp = new Date(now.getTime() - 3 * 60 * 60 * 1000)
  const y = sp.getUTCFullYear()
  const m = String(sp.getUTCMonth() + 1).padStart(2, "0")
  const d = String(sp.getUTCDate()).padStart(2, "0")
  const hh = String(sp.getUTCHours()).padStart(2, "0")
  const mm = String(sp.getUTCMinutes()).padStart(2, "0")
  const ss = String(sp.getUTCSeconds()).padStart(2, "0")
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}-03:00`
}

function dataAtual(): string {
  return new Date().toISOString().split("T")[0]
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return respond(405, { erro: "Method not allowed" })
  let p: Payload
  try { p = await req.json() } catch { return respond(400, { erro: "JSON invalido" }) }

  if (!p.company_id || !p.servico?.descricao || !p.servico?.valor || !p.servico?.codigo_tributacao_nacional_iss) {
    return respond(400, {
      erro: "Obrigatorios: company_id + servico{descricao, valor, codigo_tributacao_nacional_iss}",
    })
  }

  try {
    // 1. Token Focus por ambiente
    const ambiente: Ambiente = p.teste_homologacao ? "homologacao" : "producao"
    const tokenEnv = ambiente === "producao"
      ? "FOCUS_NFE_TOKEN_PRODUCAO"
      : "FOCUS_NFE_TOKEN_HOMOLOGACAO"
    const token = Deno.env.get(tokenEnv)
    if (!token) {
      return respond(500, {
        ok: false,
        erro: `Secret ${tokenEnv} nao configurado no projeto Supabase`,
        sugestao: "Configure em https://supabase.com/dashboard/project/horsymhsinqcimflrtjo/functions/secrets",
      })
    }

    // 2. Config gov.br nacional + empresa
    const { data: cfg } = await sb
      .from("erp_fiscal_provider_config")
      .select("gov_nfse_municipio_codigo")
      .eq("company_id", p.company_id)
      .eq("provider", "gov_nfse_nacional")
      .eq("ativo", true)
      .single()
    if (!cfg) {
      return respond(404, { ok: false, erro: "Provider gov_nfse_nacional nao configurado pra esta empresa" })
    }
    const muniIbge = String(cfg.gov_nfse_municipio_codigo ?? "").replace(/\D/g, "")
    if (muniIbge.length !== 7) {
      return respond(400, { ok: false, erro: "gov_nfse_municipio_codigo invalido (7 digitos)" })
    }

    const { data: emp } = await sb
      .from("companies")
      .select("cnpj, razao_social, inscricao_municipal")
      .eq("id", p.company_id)
      .single()
    if (!emp?.cnpj) return respond(400, { ok: false, erro: "Empresa sem CNPJ" })
    const cnpjPrest = String(emp.cnpj).replace(/\D/g, "")
    if (cnpjPrest.length !== 14) return respond(400, { ok: false, erro: "CNPJ empresa invalido" })

    // 3. ref idempotente curto
    const ref = `${p.company_id.slice(0, 8)}-${Date.now()}`

    // 4. Cria erp_nfse_emitidas row (status=processando)
    let nfseId = p.nfse_emitida_id
    if (!nfseId) {
      const { data: row, error } = await sb.from("erp_nfse_emitidas").insert({
        company_id: p.company_id,
        provider: "focusnfe",
        provider_reference: ref,
        ambiente,
        status: "processando",
        valor_servicos: p.servico.valor,
        aliquota_iss: p.servico.aliquota_iss ?? 5,
        descricao_servico: p.servico.descricao,
        codigo_servico: p.servico.codigo_tributacao_nacional_iss,
        tomador_cnpj: (p.tomador?.cpf_cnpj?.length === 14) ? p.tomador.cpf_cnpj : null,
        tomador_cpf: (p.tomador?.cpf_cnpj?.length === 11) ? p.tomador.cpf_cnpj : null,
        tomador_razao_social: p.tomador?.razao_social,
        prestador_cnpj: cnpjPrest,
        prestador_razao_social: emp.razao_social,
        prestador_im: emp.inscricao_municipal,
        serie: "1",
      }).select("id").single()
      if (error || !row) {
        return respond(500, { ok: false, erro: "Falha criar erp_nfse_emitidas", detalhe: error?.message })
      }
      nfseId = row.id
    }

    // 5. Payload Focus NFe (NFS-e Nacional)
    const aliqIss = p.servico.aliquota_iss ?? 5
    const valorIss = round2(p.servico.valor * aliqIss / 100)
    const focusPayload: Record<string, unknown> = {
      data_emissao: isoBrasilia(),
      data_competencia: dataAtual(),
      codigo_municipio_emissora: Number(muniIbge),
      cnpj_prestador: cnpjPrest,
      codigo_opcao_simples_nacional: 1, // 1 = Simples Nacional
      regime_especial_tributacao: 0,    // 0 = Nenhum
      codigo_municipio_prestacao: Number(muniIbge),
      codigo_tributacao_nacional_iss: p.servico.codigo_tributacao_nacional_iss,
      descricao_servico: p.servico.descricao,
      valor_servico: p.servico.valor,
      valor_iss: valorIss,
      tributacao_iss: 1,
      tipo_retencao_iss: 1,
    }
    if (p.servico.codigo_nbs) focusPayload.codigo_nbs = p.servico.codigo_nbs

    // inscricao_municipal_prestador · so se cadastrada (ausencia evita rejeicao)
    if (emp.inscricao_municipal && String(emp.inscricao_municipal).trim()) {
      focusPayload.inscricao_municipal_prestador = String(emp.inscricao_municipal).trim()
    }

    if (p.tomador?.cpf_cnpj) {
      const doc = p.tomador.cpf_cnpj.replace(/\D/g, "")
      if (doc.length === 14) focusPayload.cnpj_tomador = doc
      else if (doc.length === 11) focusPayload.cpf_tomador = doc
      if (p.tomador.razao_social) focusPayload.razao_social_tomador = p.tomador.razao_social
    }

    // 6. POST /v2/nfsen?ref=...
    const base = focusBase(ambiente)
    const postUrl = `${base}/v2/nfsen?ref=${encodeURIComponent(ref)}`
    let postStatus = 0
    let postBody = ""
    let postErr: string | null = null
    try {
      const r = await fetch(postUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: basicAuth(token),
          "User-Agent": "PSGestao-ERP/3.0",
        },
        body: JSON.stringify(focusPayload),
      })
      postStatus = r.status
      postBody = await r.text()
    } catch (e) {
      postErr = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    }

    // 7. Consulta status (aguarda 2s)
    await new Promise((res) => setTimeout(res, 2000))
    let getStatus = 0
    let getBody = ""
    let getErr: string | null = null
    try {
      const r2 = await fetch(`${base}/v2/nfsen/${encodeURIComponent(ref)}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: basicAuth(token),
          "User-Agent": "PSGestao-ERP/3.0",
        },
      })
      getStatus = r2.status
      getBody = await r2.text()
    } catch (e) {
      getErr = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    }

    // 8. Parse resposta Focus
    let getJson: Record<string, unknown> | null = null
    try { getJson = getBody ? JSON.parse(getBody) : null } catch { getJson = null }
    let postJson: Record<string, unknown> | null = null
    try { postJson = postBody ? JSON.parse(postBody) : null } catch { postJson = null }

    const statusFocus = (getJson?.status as string) ?? (postJson?.status as string) ?? "desconhecido"
    const chaveAcesso = (getJson?.chave_nfse as string)
      ?? (getJson?.chave_acesso as string)
      ?? (postJson?.chave_nfse as string)
      ?? null
    const numero = (getJson?.numero as string)
      ?? (getJson?.numero_nfse as string)
      ?? null
    const erros = (getJson?.erros as unknown[]) ?? (postJson?.erros as unknown[]) ?? null
    const mensagem = (getJson?.mensagem_sefaz as string)
      ?? (getJson?.motivo_status as string)
      ?? (postJson?.mensagem as string)
      ?? (erros && erros.length > 0 ? JSON.stringify(erros) : null)

    // 9. Mapeia status Focus -> nosso enum
    const statusLocal =
      statusFocus === "autorizado" ? "autorizada" :
      statusFocus === "cancelado" ? "cancelada" :
      (statusFocus === "erro_autorizacao" || statusFocus === "denegado") ? "rejeitada" :
      "processando"

    // 10. Update erp_nfse_emitidas
    await sb.from("erp_nfse_emitidas").update({
      status: statusLocal,
      chave_acesso: chaveAcesso,
      numero,
      motivo_rejeicao: statusLocal === "rejeitada" ? mensagem : null,
      provider_raw: {
        post: { status: postStatus, body: postBody.slice(0, 4000), erro: postErr },
        get: { status: getStatus, body: getBody.slice(0, 4000), erro: getErr },
      },
    }).eq("id", nfseId)

    return respond(postStatus < 400 ? 200 : 502, {
      ok: statusLocal === "autorizada" || statusLocal === "processando",
      status_focus: statusFocus,
      status_local: statusLocal,
      ref,
      nfse_emitida_id: nfseId,
      chave_acesso: chaveAcesso,
      numero,
      mensagem,
      ambiente,
      cnpj_prestador: cnpjPrest,
      municipio_ibge: muniIbge,
      resposta_focus: {
        post: { status: postStatus, body: postBody.slice(0, 1500), erro: postErr },
        get: { status: getStatus, body: getBody.slice(0, 1500), erro: getErr },
      },
    })
  } catch (e) {
    return respond(500, {
      ok: false,
      erro: "Erro interno",
      detalhe: e instanceof Error ? `${e.name}: ${e.message}\n${e.stack}` : String(e),
    })
  }
})
