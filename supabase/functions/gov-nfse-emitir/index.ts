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

// FIX-NFSE-EMITIR-CORS-v1 · mesmo padrao do gov-nfse-consultar (PR #248)
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

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

// FIX-NFSE-EMITIR-GRAVAR-RETORNO-v1 · extrai motivo de rejeicao da Focus
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
  // CORS preflight (FIX-NFSE-EMITIR-CORS-v1)
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== "POST") return respond(405, { erro: "Method not allowed" })
  let p: Payload
  try { p = await req.json() } catch { return respond(400, { erro: "JSON invalido" }) }

  if (!p.company_id || !p.servico?.descricao || !p.servico?.valor || !p.servico?.codigo_tributacao_nacional_iss) {
    return respond(400, {
      erro: "Obrigatorios: company_id + servico{descricao, valor, codigo_tributacao_nacional_iss}",
    })
  }

  try {
    // 1. Config gov.br nacional + empresa (inclui nomes de secrets Focus por empresa)
    const ambiente: Ambiente = p.teste_homologacao ? "homologacao" : "producao"
    const { data: cfg } = await sb
      .from("erp_fiscal_provider_config")
      .select("gov_nfse_municipio_codigo, focus_token_secret_homolog, focus_token_secret_prod, opcao_simples_nacional")
      .eq("company_id", p.company_id)
      .eq("provider", "gov_nfse_nacional")
      .eq("ativo", true)
      .single()
    if (!cfg) {
      return respond(404, { ok: false, erro: "Provider gov_nfse_nacional nao configurado pra esta empresa" })
    }

    // 2. Token Focus · resolve nome do secret pela config (fallback nomes legados)
    const secretLegacyFallback = ambiente === "producao"
      ? "FOCUS_NFE_TOKEN_PRODUCAO"
      : "FOCUS_NFE_TOKEN_HOMOLOGACAO"
    const secretConfig = ambiente === "producao"
      ? (cfg as { focus_token_secret_prod?: string | null }).focus_token_secret_prod
      : (cfg as { focus_token_secret_homolog?: string | null }).focus_token_secret_homolog
    const tokenEnv = (secretConfig && secretConfig.trim()) || secretLegacyFallback
    const token = Deno.env.get(tokenEnv)
    if (!token) {
      return respond(500, {
        ok: false,
        erro: ambiente === "producao"
          ? `Token de producao nao configurado para esta empresa (secret ${tokenEnv} ausente).`
          : `Token de homologacao nao configurado para esta empresa (secret ${tokenEnv} ausente).`,
        sugestao: "Configure em https://supabase.com/dashboard/project/horsymhsinqcimflrtjo/functions/secrets",
      })
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

    // FEAT-NFSE-NUMERACAO-v1 · numero/serie atomicos da DPS pelo RPC.
    //   Sempre consome um numero (mesmo se Focus rejeitar) · nunca repete.
    const { data: numRows, error: numErr } = await sb
      .rpc("fn_proximo_numero_nfse", { p_company_id: p.company_id })
    const numRow = Array.isArray(numRows) ? numRows[0] : numRows
    if (numErr || !numRow || numRow.serie == null || numRow.numero == null) {
      return respond(500, {
        ok: false,
        erro: "Falha obter proximo numero NFS-e (RPC fn_proximo_numero_nfse)",
        detalhe: numErr?.message,
      })
    }
    const nfseSerie: string = String(numRow.serie)
    const nfseNumero: number = Number(numRow.numero)
    console.log("emitir.numero_consumido", { ref, serie: nfseSerie, numero: nfseNumero })

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
        serie: nfseSerie,
        numero: String(nfseNumero),
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
      // FEAT-NFSE-NUMERACAO-v1 · serie/numero atomicos (antes era hardcoded 1/1)
      serie_rps: nfseSerie,
      numero_rps: nfseNumero,
      data_emissao: isoBrasilia(),
      data_competencia: dataAtual(),
      codigo_municipio_emissora: Number(muniIbge),
      cnpj_prestador: cnpjPrest,
      // FIX-NFSE-OPCAO-SIMPLES-v1: 1=Nao optante, 2=Optante MEI, 3=Optante ME/EPP
      // (fonte: erp_fiscal_provider_config.opcao_simples_nacional · KGF=3)
      codigo_opcao_simples_nacional: (cfg as { opcao_simples_nacional?: number | null }).opcao_simples_nacional ?? 3,
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
    // FIX-NFSE-EMITIR-UPDATE-FINALLY-v1 · log diagnostico (sem token)
    console.log("emitir.focus_post", {
      ref,
      ambiente,
      postStatus,
      postErr,
      bodyPreview: postBody.slice(0, 500),
    })

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
    console.log("emitir.focus_get", {
      ref,
      getStatus,
      getErr,
      bodyPreview: getBody.slice(0, 500),
    })

    // 8. Parse resposta Focus
    let getJson: Record<string, unknown> | null = null
    try { getJson = getBody ? JSON.parse(getBody) : null } catch { getJson = null }
    let postJson: Record<string, unknown> | null = null
    try { postJson = postBody ? JSON.parse(postBody) : null } catch { postJson = null }

    const statusFocus = (getJson?.status as string) ?? (postJson?.status as string) ?? "desconhecido"
    const codigoVerif = (getJson?.codigo_verificacao as string)
      ?? (postJson?.codigo_verificacao as string)
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
    // FIX-NFSE-EMITIR-GRAVAR-RETORNO-v1:
    //   - POST nao-2xx (ou erro de rede) -> rejeitada SEMPRE, motivo extraido da Focus.
    //   - POST 2xx -> usa status do GET pra fechar (caso ja deu tempo) ou processando.
    const postFalhou = !!postErr || postStatus === 0 || postStatus >= 400
    let statusLocal: "autorizada" | "rejeitada" | "processando" | "cancelada"
    let motivoFinal: string | null = null

    if (postFalhou) {
      statusLocal = "rejeitada"
      motivoFinal = montarMotivoRejeicao(postJson)
        ?? postErr
        ?? (postBody && postBody.length > 0 ? postBody.slice(0, 500) : `Focus retornou HTTP ${postStatus}`)
    } else {
      statusLocal =
        statusFocus === "autorizado" ? "autorizada" :
        statusFocus === "cancelado" ? "cancelada" :
        (statusFocus === "erro_autorizacao" || statusFocus === "denegado") ? "rejeitada" :
        "processando"
      if (statusLocal === "rejeitada") {
        motivoFinal = montarMotivoRejeicao(getJson) ?? mensagem
      }
    }

    // 10. Update erp_nfse_emitidas
    // FIX-NFSE-EMITIR-UPDATE-FINALLY-v1:
    //   - .select("id") pra confirmar rows_affected
    //   - log erro do update (causa #253 nao funcionou: coluna 'chave_acesso'
    //     nao existe na tabela -> PostgREST 400 silenciado).
    //     Corrigido: usar codigo_verificacao (que existe) e remover chave_acesso.
    const updatePayload: Record<string, unknown> = {
      status: statusLocal,
      numero,
      motivo_rejeicao: statusLocal === "rejeitada" ? motivoFinal : null,
      provider_raw: {
        post: { status: postStatus, body: postBody.slice(0, 4000), erro: postErr },
        get: { status: getStatus, body: getBody.slice(0, 4000), erro: getErr },
      },
    }
    if (codigoVerif) updatePayload.codigo_verificacao = codigoVerif

    const { data: upRows, error: upErr } = await sb
      .from("erp_nfse_emitidas")
      .update(updatePayload)
      .eq("id", nfseId)
      .select("id")
    console.log("emitir.update_result", {
      nfseId,
      statusLocal,
      rows_affected: upRows?.length ?? 0,
      upErr: upErr?.message,
    })
    if (upErr || !upRows || upRows.length === 0) {
      return respond(500, {
        ok: false,
        erro: "Falha persistir resposta Focus em erp_nfse_emitidas",
        detalhe: upErr?.message ?? "Update afetou 0 linhas",
        status_focus: statusFocus,
        status_local: statusLocal,
        mensagem: motivoFinal ?? mensagem,
        resposta_focus: {
          post: { status: postStatus, body: postBody.slice(0, 1500), erro: postErr },
          get: { status: getStatus, body: getBody.slice(0, 1500), erro: getErr },
        },
      })
    }

    return respond(postFalhou ? 502 : 200, {
      ok: statusLocal === "autorizada" || statusLocal === "processando",
      status_focus: statusFocus,
      status_local: statusLocal,
      ref,
      nfse_emitida_id: nfseId,
      codigo_verificacao: codigoVerif,
      numero,
      mensagem: motivoFinal ?? mensagem,
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
