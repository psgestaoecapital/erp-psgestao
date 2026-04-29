// PS Gestão ERP — Compliance Worker
// POST /api/compliance/worker  (cron externo + bearer COMPLIANCE_WORKER_TOKEN)
//
// Processa até N consultas pendentes da fila. NUNCA derruba: erros viram
// status='erro' com erro_mensagem preenchido. Captura raw_html / raw_response
// e duracao_ms para auditoria.
//
// Provedores:
//   - cndt_tst: scrape do portal público do TST (sem captcha forte)
//   - negativa_federal: portal RFB usa reCAPTCHA → marca 'captcha_required'
//   - negativa_fgts: portal Caixa usa CAPTCHA imagem → marca 'captcha_required'
//
// Para os dois últimos, a integração futura passa por API licenciada
// (Serasa/SOC/SOLIN) ou portal gov.br com OAuth empresarial. Worker preserva
// idempotência: ao tentar de novo, fn_compliance_enfileirar_consulta evita
// duplicatas.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import * as cheerio from 'cheerio'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const BATCH = 5
const TIMEOUT_MS = 30_000
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

type Resultado = 'positiva' | 'negativa' | 'positiva_com_efeito_negativa' | 'inconclusivo' | 'sem_pendencias' | 'com_pendencias'

type SaidaProvedor = {
  status_final: 'sucesso' | 'erro'
  resultado: Resultado | null
  numero_certidao: string | null
  data_emissao: string | null   // YYYY-MM-DD
  data_validade: string | null  // YYYY-MM-DD
  arquivo_url: string | null
  raw_response: any | null
  raw_html: string | null
  erro_mensagem: string | null
}

function ok(payload: any) { return NextResponse.json(payload) }
function fail(status: number, msg: string) {
  return NextResponse.json({ ok: false, error: msg, mensagem_humana: msg }, { status })
}

// ── HTTP helper com timeout
async function httpGet(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
        ...(init.headers || {}),
      },
    })
  } finally {
    clearTimeout(t)
  }
}

// ── CNDT/TST: portal público, formulário JSF
async function consultarCndt(documento: string): Promise<SaidaProvedor> {
  // Documento pode ser CPF ou CNPJ (somente dígitos).
  const inicio = 'https://cndt-certidao.tst.jus.br/inicio.faces'
  try {
    const home = await httpGet(inicio)
    if (!home.ok) {
      return saidaErro(`HTTP ${home.status} no GET inicial CNDT`, null)
    }
    const html = await home.text()
    const $ = cheerio.load(html)
    const viewState = $('input[name="javax.faces.ViewState"]').val() as string | undefined
    const formId = $('form').first().attr('id') || 'gerarCertidaoForm'

    // Heurística: localiza inputs do formulário. Estrutura JSF do TST muda
    // com frequência; por isso, só consideramos sucesso quando conseguimos
    // identificar uma resposta de certidão. Em qualquer outro caso volta
    // como inconclusivo + raw_html para auditoria/debug.
    if (!viewState) {
      return {
        status_final: 'erro',
        resultado: 'inconclusivo',
        numero_certidao: null, data_emissao: null, data_validade: null,
        arquivo_url: null,
        raw_response: { stage: 'no_viewstate' },
        raw_html: html.slice(0, 64_000),
        erro_mensagem: 'Não foi possível extrair ViewState do formulário CNDT',
      }
    }

    // POST ao formulário com o documento.
    const body = new URLSearchParams()
    body.set(`${formId}:cpfCnpj`, documento)
    body.set(`${formId}`, formId)
    body.set('javax.faces.ViewState', viewState)
    body.set(`${formId}:btnEmitirCertidao`, '')

    const resp = await httpGet(inicio, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': inicio,
      },
      body: body.toString(),
    })
    const html2 = await resp.text()
    const $$ = cheerio.load(html2)

    // Heurística de resposta: TST devolve uma página com "Certidão Negativa"
    // ou "Certidão Positiva (com efeito de negativa)" no corpo.
    const texto = $$('body').text().toLowerCase()
    let resultado: Resultado | null = null
    if (texto.includes('certidão negativa de débitos')) resultado = 'negativa'
    else if (texto.includes('positiva com efeito de negativa')) resultado = 'positiva_com_efeito_negativa'
    else if (texto.includes('certidão positiva')) resultado = 'positiva'

    // Extrai número/datas via regex sobre o texto.
    const reNumero = /N[º°]\s*([0-9./-]+)/i
    const reEmissao = /emitida em\s*(\d{2}\/\d{2}\/\d{4})/i
    const reValidade = /v[áa]lida at[ée]\s*(\d{2}\/\d{2}\/\d{4})/i

    const mNum = texto.match(reNumero)
    const mEmi = texto.match(reEmissao)
    const mVal = texto.match(reValidade)

    if (!resultado) {
      // Página não corresponde ao formato esperado (mudança de layout, captcha,
      // ou bloqueio). Retorna inconclusivo para auditoria.
      return {
        status_final: 'erro',
        resultado: 'inconclusivo',
        numero_certidao: null, data_emissao: null, data_validade: null,
        arquivo_url: null,
        raw_response: { stage: 'unknown_layout' },
        raw_html: html2.slice(0, 64_000),
        erro_mensagem: 'Layout CNDT não reconhecido (provavelmente mudou)',
      }
    }

    return {
      status_final: 'sucesso',
      resultado,
      numero_certidao: mNum ? mNum[1] : null,
      data_emissao: mEmi ? brToIso(mEmi[1]) : null,
      data_validade: mVal ? brToIso(mVal[1]) : null,
      arquivo_url: null,
      raw_response: { stage: 'parsed', resultado, numero: mNum?.[1] || null },
      raw_html: html2.slice(0, 64_000),
      erro_mensagem: null,
    }
  } catch (e: any) {
    return saidaErro(`CNDT: ${e.message || 'falha de rede'}`, e.name === 'AbortError' ? 'timeout' : null)
  }
}

function saidaErro(mensagem: string, marker: string | null): SaidaProvedor {
  return {
    status_final: 'erro',
    resultado: 'inconclusivo',
    numero_certidao: null, data_emissao: null, data_validade: null,
    arquivo_url: null,
    raw_response: marker ? { marker } : null,
    raw_html: null,
    erro_mensagem: mensagem,
  }
}

function brToIso(d: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

// ── RFB CND Federal — bloqueado por reCAPTCHA. Marca como captcha_required.
async function consultarRfb(_documento: string): Promise<SaidaProvedor> {
  return {
    status_final: 'erro',
    resultado: 'inconclusivo',
    numero_certidao: null, data_emissao: null, data_validade: null,
    arquivo_url: null,
    raw_response: { reason: 'recaptcha_required', portal: 'solucoes.receita.fazenda.gov.br' },
    raw_html: null,
    erro_mensagem: 'captcha_required',
  }
}

// ── CRF FGTS — bloqueado por captcha imagem. Marca como captcha_required.
async function consultarFgts(_documento: string): Promise<SaidaProvedor> {
  return {
    status_final: 'erro',
    resultado: 'inconclusivo',
    numero_certidao: null, data_emissao: null, data_validade: null,
    arquivo_url: null,
    raw_response: { reason: 'image_captcha_required', portal: 'consulta-crf.caixa.gov.br' },
    raw_html: null,
    erro_mensagem: 'captcha_required',
  }
}

async function processarUma(consulta: any): Promise<{ id: string; status_final: string; erro_mensagem: string | null }> {
  const t0 = Date.now()
  let saida: SaidaProvedor
  try {
    if (consulta.provedor_codigo === 'cndt_tst') {
      saida = await consultarCndt(consulta.alvo_documento)
    } else if (consulta.provedor_codigo === 'negativa_federal') {
      saida = await consultarRfb(consulta.alvo_documento)
    } else if (consulta.provedor_codigo === 'negativa_fgts') {
      saida = await consultarFgts(consulta.alvo_documento)
    } else {
      saida = saidaErro(`provedor desconhecido: ${consulta.provedor_codigo}`, null)
    }
  } catch (e: any) {
    saida = saidaErro(e.message || 'falha desconhecida', null)
  }

  const duracao_ms = Date.now() - t0
  await supabaseAdmin
    .from('compliance_consultas')
    .update({
      status: saida.status_final === 'sucesso' ? 'sucesso' : 'erro',
      resultado: saida.resultado,
      numero_certidao: saida.numero_certidao,
      data_emissao: saida.data_emissao,
      data_validade: saida.data_validade,
      arquivo_url: saida.arquivo_url,
      raw_response: saida.raw_response,
      raw_html: saida.raw_html,
      erro_mensagem: saida.erro_mensagem,
      duracao_ms,
      consultada_em: new Date().toISOString(),
    })
    .eq('id', consulta.id)

  return { id: consulta.id, status_final: saida.status_final, erro_mensagem: saida.erro_mensagem }
}

export const POST = async (req: NextRequest) => {
  // Auth simples por bearer token (chamado por cron externo, não por usuário)
  const expected = process.env.COMPLIANCE_WORKER_TOKEN
  const auth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!expected) {
    return fail(500, 'COMPLIANCE_WORKER_TOKEN não configurado.')
  }
  if (auth !== expected) {
    return fail(401, 'Token de worker inválido.')
  }

  // Marca consultas como 'processando' para evitar concorrência. O update
  // retorna apenas as linhas que conseguimos transitar; outros workers que
  // chegarem simultaneamente pegam outro lote.
  const { data: pendentes, error: pickErr } = await supabaseAdmin
    .from('compliance_consultas')
    .select('id, company_id, provedor_codigo, alvo_documento, alvo_tipo, fila_prioridade, created_at')
    .eq('status', 'pendente')
    .order('fila_prioridade', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(BATCH)

  if (pickErr) return fail(500, `Falha ao buscar fila: ${pickErr.message}`)

  const resultados: any[] = []
  for (const c of (pendentes as any[]) || []) {
    // Marca como processando (best-effort lock). Se outro worker pegou,
    // o update afeta 0 linhas e a gente pula.
    const { data: locked } = await supabaseAdmin
      .from('compliance_consultas')
      .update({ status: 'processando' })
      .eq('id', c.id)
      .eq('status', 'pendente')
      .select('id')
      .maybeSingle()
    if (!locked) continue

    const r = await processarUma(c)
    resultados.push(r)

    // Delay 1s entre consultas do mesmo provedor para evitar rate-limit.
    await new Promise((r) => setTimeout(r, 1000))
  }

  return ok({ ok: true, processados: resultados.length, resultados })
}
