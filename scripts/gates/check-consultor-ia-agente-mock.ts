/**
 * Gate de build (CEO 25/11, pedido do Eng. Chefe 26/11) — PROVA AUTOMÁTICA do agente Consultor IA com a Messages API
 * MOCKADA (fixture de respostas tool_use → tool_result → texto). Roda offline (sem chave de IA, sem rede, sem banco):
 * substitui globalThis.fetch por um script de respostas e injeta um Supabase falso. Cobre o que o Eng. Chefe pediu:
 *   1) loop de ferramenta até o teto (12 rodadas) e CORTE (limiteRodadas);
 *   2) company_id FORÇADO pelo servidor (a ferramenta nunca recebe/usa o company_id do modelo);
 *   3) teto fn_ia_*_pode_gastar → bloqueia com mensagem honesta + atalhos grátis (avaliarTeto);
 *   4) trava de número: valor citado fora dos resultados → REFAZ 1x → persiste como "a conferir";
 *   5) streaming dos PASSOS em linguagem do usuário durante o loop.
 *   npm run gates -- consultor-ia-agente-mock
 */
import {
  rodarAgente, analisarComTrava, avaliarTeto, FERRAMENTAS,
  type ResultadoAgente,
} from '../../src/lib/consultor/agente'
import { fazerExecutarTool, type SbLike } from '../../src/lib/consultor/tools'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

// ── Messages API MOCKADA: a fila `respostas` é consumida a cada POST /v1/messages ─────────────────────────────────
type Bloco = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
function toolUse(name: string, input: Record<string, unknown> = {}): Bloco { return { type: 'tool_use', id: 'tu_' + Math.random().toString(36).slice(2, 8), name, input } }
function texto(t: string): Bloco { return { type: 'text', text: t } }

function instalarFetch(respostas: Array<{ content: Bloco[]; stop_reason: string }>) {
  let i = 0
  const original = globalThis.fetch
  const chamadas: Array<{ url: string; body: Record<string, unknown> }> = []
  globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : {}
    chamadas.push({ url: String(url), body })
    // se a fila acabar, repete a última (para provar o CORTE por teto de rodadas)
    const r = respostas[Math.min(i, respostas.length - 1)]
    i++
    return {
      ok: true, status: 200,
      json: async () => ({ ...r, usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 10 } }),
      text: async () => '',
    } as unknown as Response
  }) as typeof fetch
  return { restaurar: () => { globalThis.fetch = original }, chamadas }
}

const execNoop = async () => ({ dados: [] })

async function main() {
  // ── 1) LOOP até 12 rodadas e CORTE ──────────────────────────────────────────────────────────────────────────
  {
    const m = instalarFetch([{ content: [toolUse('raio_x')], stop_reason: 'tool_use' }]) // sempre pede ferramenta → nunca para sozinho
    const passos: string[] = []
    const r = await rodarAgente({
      apiKey: 'test', modelo: 'claude-sonnet-x', empresaNome: 'ACME', empresaCnpj: '', dicionario: 'd',
      pergunta: 'q', historico: [], executarTool: execNoop, onPasso: (t) => passos.push(t),
    })
    m.restaurar()
    ok(r.rounds === 12 && r.limiteRodadas === true, `loop corta no teto de 12 rodadas (rounds=${r.rounds}, limiteRodadas=${r.limiteRodadas})`)
    // CEO 26/11, item 1: ao estourar as rodadas sem resposta, é feita UMA chamada final (guard "nunca vazio") →
    // 13ª chamada à API (12 rodadas + 1 final), resposta NÃO vazia e motivoFim='fallback'.
    ok(r.tokens.output === 13 * 50 && r.custoUsd > 0, `custo medido pelos tokens REAIS da API (output=${r.tokens.output}, inclui a chamada final)`)
    ok(r.resposta.trim().length > 0 && r.motivoFim === 'fallback', `nunca termina vazio: estouro de rodadas cai no fallback (motivoFim=${r.motivoFim})`)
    ok(passos.length === 13, `5) streaming: um passo por rodada + o passo da redação final (passos=${passos.length})`)
  }

  // ── loop normal: tool_use → tool_result → texto final ─────────────────────────────────────────────────────────
  {
    const m = instalarFetch([
      { content: [texto('Deixa eu olhar…'), toolUse('listagem', { tipo: 'receber' })], stop_reason: 'tool_use' },
      { content: [texto('A empresa tem R$ 143,52 a receber hoje.')], stop_reason: 'end_turn' },
    ])
    const passos: string[] = []
    const execDados = async () => ({ dados: [{ total: 143.52 }] })
    const r = await rodarAgente({
      apiKey: 'test', modelo: 'claude-sonnet-x', empresaNome: 'ACME', empresaCnpj: '', dicionario: 'd',
      pergunta: 'quanto tenho a receber hoje', historico: [], executarTool: execDados, onPasso: (t) => passos.push(t),
    })
    m.restaurar()
    ok(r.rounds === 2 && /143,52/.test(r.resposta), `loop encerra no texto final após a ferramenta (rounds=${r.rounds})`)
    ok(r.toolResults.length === 1 && r.toolResults[0].nome === 'listagem', 'o resultado da ferramenta é capturado (tool_result)')
    ok(passos.length >= 1, '5) streaming: passo emitido antes de executar a ferramenta')
  }

  // ── 2) company_id FORÇADO pelo servidor (a ferramenta nunca usa o do modelo) ──────────────────────────────────
  {
    const FORCADO = '11111111-1111-4111-8111-111111111111'
    const capturado: Array<{ fn: string; params: Record<string, unknown> }> = []
    const sbFalso: SbLike = { rpc: async (fn, params) => { capturado.push({ fn, params: params ?? {} }); return { data: { ok: true }, error: null } } }
    const exec = fazerExecutarTool(sbFalso, FORCADO)
    // o modelo TENTA injetar outra empresa no input — tem de ser ignorado
    await exec('situacao_parceiro', { termo: 'Fulano', company_id: 'HACKER', p_company_id: 'HACKER', empresa: 'HACKER' })
    const chamada = capturado.find((c) => c.fn === 'fn_consultor_situacao_parceiro')
    ok(!!chamada && chamada.params.p_company_id === FORCADO, `ferramenta usa o company_id FORÇADO (${String(chamada?.params.p_company_id).slice(0, 8)}…), não o do modelo`)
    // nenhuma ferramenta expõe campo de empresa ao modelo (ele não consegue nem pedir outra empresa)
    const temCampoEmpresa = FERRAMENTAS.some((f) => {
      const props = (f.input_schema as { properties?: Record<string, unknown> }).properties ?? {}
      return Object.keys(props).some((k) => /company|empresa|tenant/i.test(k))
    })
    ok(!temCampoEmpresa, 'nenhuma ferramenta tem campo de empresa no input_schema (o modelo não pode escolher a empresa)')
  }

  // ── 3) teto de custo → bloqueia com mensagem honesta + atalhos grátis ─────────────────────────────────────────
  {
    ok(avaliarTeto(true, true) === null, 'teto: empresa e sistema OK → não bloqueia')
    const be = avaliarTeto(false, true)
    ok(!!be && /limite diário/.test(be.mensagem) && /não têm custo/.test(be.mensagem), 'teto da EMPRESA → bloqueia com mensagem honesta + atalhos grátis')
    const bg = avaliarTeto(true, false)
    ok(!!bg && /sistema/.test(bg.mensagem), 'teto GLOBAL (fn_ia_global_pode_gastar) → bloqueia com mensagem do sistema')
    ok(avaliarTeto(undefined, undefined) !== null, 'teto indefinido (falha de leitura) → fail-closed (bloqueia)')
  }

  // ── 4) trava de número: valor inventado → REFAZ 1x; persiste → aparece em `inventados` ─────────────────────────
  {
    // 1ª passada cita um valor que NÃO está nos dados; a revisão (2ª passada) corrige usando só o dado.
    let passada = 0
    const rodarMock = async (p: { pergunta: string; maxRounds?: number }): Promise<ResultadoAgente> => {
      passada++
      const base = { toolResults: [{ nome: 'listagem', input: {}, saida: { dados: [{ total: 143.52 }] } }], custoUsd: 0.01, rounds: 1, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, limiteTempo: false, limiteRodadas: false, motivoFim: 'texto' as const }
      if (passada === 1) return { ...base, resposta: 'A empresa tem R$ 999,00 a receber.' } // 999,00 não existe nos dados
      return { ...base, resposta: 'A empresa tem R$ 143,52 a receber.' }                     // revisão: usa só o dado
    }
    const passos: string[] = []
    const r = await analisarComTrava({ pergunta: 'quanto a receber', historico: [], onPasso: (t) => passos.push(t), rodar: rodarMock })
    ok(r.refez === true && passada === 2, 'valor fora dos dados → REFAZ exatamente 1 vez')
    ok(r.inventados.length === 0 && /143,52/.test(r.resposta), 'após refazer, a resposta usa só valores dos dados (0 a conferir)')
    ok(passos.some((p) => /conferindo os números/i.test(p)), 'streaming: avisa "Conferindo os números citados…" na revisão')

    // valor inventado que PERSISTE mesmo após refazer → entra em `inventados` (tela mostra "confira estes valores")
    const rodarTeimoso = async (): Promise<ResultadoAgente> => ({
      resposta: 'O saldo é R$ 777,00.', toolResults: [{ nome: 'raio_x', input: {}, saida: { dados: [{ x: 1 }] } }],
      custoUsd: 0.01, rounds: 1, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, limiteTempo: false, limiteRodadas: false, motivoFim: 'texto',
    })
    const r2 = await analisarComTrava({ pergunta: 'q', historico: [], rodar: rodarTeimoso })
    ok(r2.refez === true && r2.inventados.includes('777.00'), 'número que persiste após refazer é devolvido como "a conferir"')
  }

  if (falhas > 0) { console.error(`\n[check-consultor-ia-agente-mock] ${falhas} caso(s) falharam`); process.exit(1) }
  console.log('\n[check-consultor-ia-agente-mock] OK — agente provado com a Messages API mockada (loop/corte, empresa forçada, teto, trava de número, streaming)')
}

main().catch((e) => { console.error('[check-consultor-ia-agente-mock] erro inesperado:', e); process.exit(1) })
