/**
 * aiModel.ts — FONTE ÚNICA do id do modelo Claude (Next.js) + ALARME de falha de IA.
 *
 * Lição (handoff #121): modelo fixo em código é alvo móvel. Quando a Anthropic aposenta
 * um modelo, a chamada passa a devolver 404 e a IA para EM SILÊNCIO — foi assim que o
 * insight-auditor ficou 89 dias morto e o gold acumulou 1.100 "Claude falhou" sem
 * ninguém perceber. Duas defesas, as duas aqui:
 *
 *   1. modeloPara(finalidade): o id vem de env por FINALIDADE (troca sem deploy), com
 *      DEFAULT VIVO no código — se a env não existir, cai em claude-sonnet-5 e funciona.
 *      Nomes de env IDÊNTICOS aos do edge (supabase/functions/_shared/aiModel.ts); se
 *      divergirem, viram duas fontes de novo — que é o que estamos consertando.
 *
 *   2. registrarFalhaIA(...): toda falha de chamada Claude (404, modelo inválido,
 *      rate-limit, timeout, rede) é GRAVADA em erp_ia_falha — nunca só logada, porque
 *      log ninguém lê. A gravação nunca lança: o alarme não pode derrubar a rota.
 */

import { createClient } from '@supabase/supabase-js'

/** Default vivo — provado no ar em 2026-09-02 (analisou a foto do ensaio, US$0,0064). */
export const MODELO_DEFAULT_VIVO = 'claude-sonnet-5'

/**
 * Finalidades conhecidas — servem de documentação e de chave de env. Qualquer string
 * funciona; começam TODAS apontando para o mesmo modelo (via ANTHROPIC_MODEL_DEFAULT ou
 * o default de código), mas ficam separáveis: se amanhã a auditoria de tela rodar em
 * volume e o custo pesar, troca-se só ANTHROPIC_MODEL_AUDITORIA_TELA, sem tocar no resto.
 */
export type FinalidadeIA =
  | 'analise_imagem'    // leitura de foto do usuário (precisa ler imagem bem)
  | 'auditoria_tela'    // insight-auditor (volume)
  | 'auditoria_jornada' // gold camada 2/3 (volume)
  | 'consultor'         // consultor/assessor/agente/análise de cliente
  | 'relatorio'         // geradores de relatório
  | 'classificacao'     // bpo classify
  | 'ajuda_chat'        // ajuda conversacional
  | 'ajuda_cura'        // curadoria de base de ajuda
  | 'previsao'          // previsão de fluxo
  | 'industrial'        // análise industrial
  | 'dev'               // ferramenta interna de dev
  | 'geral'

/**
 * Resolve o modelo para uma finalidade:
 *   ANTHROPIC_MODEL_<FINALIDADE>  →  ANTHROPIC_MODEL_DEFAULT  →  MODELO_DEFAULT_VIVO
 */
export function modeloPara(finalidade: FinalidadeIA | string): string {
  const chave = 'ANTHROPIC_MODEL_' + String(finalidade).toUpperCase()
  return process.env[chave] || process.env.ANTHROPIC_MODEL_DEFAULT || MODELO_DEFAULT_VIVO
}

/** Cliente service-role preguiçoso e tolerante — nunca lança (o alarme não derruba a rota). */
function clienteAlarme() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return null
    return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  } catch {
    return null
  }
}

export interface FalhaIA {
  endpoint: string                 // ex.: '/api/gold/auditar-rota'
  finalidade: FinalidadeIA | string
  modelo: string
  status?: number | null           // status HTTP se houve resposta (404, 429, 400, 529...)
  erro: string                     // mensagem crua
  companyId?: string | null
}

/**
 * Grava uma falha de chamada Claude. Chamar sempre que a chamada NÃO responder:
 * resposta !ok, exceção de rede, timeout ou JSON inesperado. Silencioso por dentro.
 */
export async function registrarFalhaIA(f: FalhaIA): Promise<void> {
  try {
    const sb = clienteAlarme()
    if (!sb) return
    await sb.rpc('fn_ia_falha_registrar', {
      p_runtime: 'next',
      p_endpoint: f.endpoint,
      p_finalidade: String(f.finalidade),
      p_modelo: f.modelo,
      p_status: f.status ?? null,
      p_erro: (f.erro || '').slice(0, 500),
      p_company_id: f.companyId ?? null,
    })
  } catch {
    /* o alarme jamais pode quebrar a rota que o chamou */
  }
}

/**
 * Conveniência: faz a chamada à Messages API já com o modelo da finalidade e, em caso de
 * falha (resposta !ok, rede/timeout), REGISTRA o alarme e relança. Devolve o JSON parseado
 * em caso de sucesso. Rotas com fluxo próprio podem usar só modeloPara + registrarFalhaIA.
 */
export async function chamarClaude(opts: {
  finalidade: FinalidadeIA | string
  endpoint: string
  payload: Record<string, unknown>   // corpo sem "model" — o model é injetado daqui
  companyId?: string | null
  timeoutMs?: number
}): Promise<any> {
  const modelo = modeloPara(opts.finalidade)
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    await registrarFalhaIA({ endpoint: opts.endpoint, finalidade: opts.finalidade, modelo, status: null, erro: 'ANTHROPIC_API_KEY ausente', companyId: opts.companyId })
    throw new Error('ANTHROPIC_API_KEY ausente')
  }
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: modelo, ...opts.payload }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 45000),
    })
  } catch (err: any) {
    await registrarFalhaIA({ endpoint: opts.endpoint, finalidade: opts.finalidade, modelo, status: null, erro: 'rede/timeout: ' + String(err?.message ?? err), companyId: opts.companyId })
    throw err
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    await registrarFalhaIA({ endpoint: opts.endpoint, finalidade: opts.finalidade, modelo, status: res.status, erro: txt.slice(0, 300), companyId: opts.companyId })
    throw new Error('Anthropic ' + res.status + ': ' + txt.slice(0, 200))
  }
  return res.json()
}
