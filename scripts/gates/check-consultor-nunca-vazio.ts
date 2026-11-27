// Gate (CEO 26/11) — Consultor IA NUNCA termina vazio.
// Produção (26/11, cliente Pdois): a pergunta "por que a conta não bate com o Banco?" devolveu a tela
// "Não consegui formular uma resposta." + custo US$ 0,055, porque o laço do agente (rodarAgente) só capturava texto
// quando stop_reason != 'tool_use'; com max_tokens no meio de um tool_use, `resposta` ficava vazia.
// Este gate mocka a Messages API (SEM custo, via opts.chamarApi) e PROVA:
//   A) stop_reason='max_tokens' com tool_use pendente → resposta final NÃO vazia (chamada final SEM ferramentas);
//   B) 2 rodadas de ferramenta + texto final vazio → é feita UMA chamada final SEM ferramentas;
//   C) se a chamada final também vier vazia → resposta mínima a partir dos toolResults (divergência por conta);
//   D) caminho normal (texto) → sem chamada final extra e motivoFim='texto';
//   E) erroLegivel: timeout do Postgres vira texto acionável.
import { rodarAgente, respostaMinima, erroLegivel, type ToolResult, type RespostaApi } from '../../src/lib/consultor/agente'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// mock da Messages API: devolve as respostas roteirizadas em ordem e guarda cada body enviado (p/ checar `tools`).
function mock(respostas: RespostaApi[]) {
  const chamadas: Record<string, unknown>[] = []
  let i = 0
  const chamarApi = async (body: Record<string, unknown>): Promise<RespostaApi> => {
    chamadas.push(body)
    const r = respostas[Math.min(i, respostas.length - 1)]
    i++
    return r
  }
  return { chamarApi, chamadas }
}

const uso = (name: string): RespostaApi['content'][number] => ({ type: 'tool_use', id: 't' + Math.random().toString(36).slice(2, 7), name, input: { objetivo: 'conferir divergência' } })
const txt = (t: string): RespostaApi['content'][number] => ({ type: 'text', text: t })

const base = {
  apiKey: 'x', modelo: 'claude-sonnet-teste', empresaNome: 'Pdois', empresaCnpj: '', dicionario: '',
  historico: [] as { role: 'user' | 'assistant'; content: string }[],
  // executor simulado: divergencia_saldo devolve a conta SICREDI com diferença R$ 293,10 (caso Pdois).
  executarTool: async (nome: string) => nome === 'divergencia_saldo'
    ? { dados: [{ conta: 'SICREDI', saldo_sistema: 1000, saldo_banco: 706.90, diferenca: 293.10 }] }
    : { ok: true },
}
const temTools = (c: Record<string, unknown>) => Array.isArray(c.tools) && (c.tools as unknown[]).length > 0

async function main() {
  // A) max_tokens com tool_use pendente → resposta NÃO vazia; a chamada final é SEM ferramentas.
  {
    const m = mock([
      { content: [uso('divergencia_saldo')], stop_reason: 'tool_use' },
      { content: [uso('divergencia_saldo')], stop_reason: 'max_tokens' }, // cortado no meio, sem texto
      { content: [txt('Resposta direta: a conta não bate por R$ 293,10 na SICREDI. Por quê: lançamentos sem conciliar. O que fazer: concilie.')], stop_reason: 'end_turn' },
    ])
    const r = await rodarAgente({ ...base, pergunta: 'por que a conta não bate com o Banco?', chamarApi: m.chamarApi })
    ok(r.resposta.trim().length > 0, 'A) max_tokens com tool_use pendente → resposta final NÃO vazia')
    ok(r.motivoFim === 'fallback', 'A) motivoFim = fallback (resposta composta pela chamada final)')
    ok(!temTools(m.chamadas[m.chamadas.length - 1]), 'A) a chamada final é feita SEM ferramentas')
    ok(m.chamadas.slice(0, -1).every(temTools), 'A) as rodadas de investigação usam ferramentas; só a final não')
  }

  // B) 2 rodadas de ferramenta + texto final vazio → é feita UMA chamada final SEM ferramentas.
  {
    const m = mock([
      { content: [uso('divergencia_saldo')], stop_reason: 'tool_use' },
      { content: [uso('lancamentos_detalhe')], stop_reason: 'tool_use' },
      { content: [], stop_reason: 'end_turn' },                       // texto final vazio
      { content: [txt('Resposta direta: segue a conclusão com os dados consultados.')], stop_reason: 'end_turn' },
    ])
    const r = await rodarAgente({ ...base, pergunta: 'detalhe a divergência', chamarApi: m.chamarApi })
    ok(m.chamadas.length === 4, 'B) 2 rodadas + rodada vazia + 1 chamada final = 4 chamadas')
    ok(!temTools(m.chamadas[3]), 'B) a 4ª (final) é SEM ferramentas')
    ok(r.resposta.trim().length > 0 && r.motivoFim === 'fallback', 'B) resposta NÃO vazia via chamada final sem ferramentas')
  }

  // C) chamada final TAMBÉM vazia → resposta mínima a partir dos toolResults (divergência por conta).
  {
    const m = mock([
      { content: [uso('divergencia_saldo')], stop_reason: 'tool_use' },
      { content: [], stop_reason: 'end_turn' },                       // texto final vazio
      { content: [], stop_reason: 'end_turn' },                       // chamada final também vazia
    ])
    const r = await rodarAgente({ ...base, pergunta: 'por que não bate?', chamarApi: m.chamarApi })
    ok(r.resposta.trim().length > 0, 'C) resposta mínima NÃO vazia quando até a chamada final falha')
    ok(/SICREDI/.test(r.resposta) && /293/.test(r.resposta), 'C) a resposta mínima traz a divergência por conta (SICREDI R$ 293,10)')
    ok(r.motivoFim === 'fallback', 'C) motivoFim = fallback')
  }

  // D) caminho normal (o modelo responde em texto na 1ª rodada) → sem chamada final extra, motivoFim='texto'.
  {
    const m = mock([{ content: [txt('Resposta direta: está tudo conciliado.')], stop_reason: 'end_turn' }])
    const r = await rodarAgente({ ...base, pergunta: 'está tudo certo?', chamarApi: m.chamarApi })
    ok(m.chamadas.length === 1, 'D) resposta de primeira → nenhuma chamada final extra')
    ok(r.motivoFim === 'texto' && r.resposta.includes('conciliado'), 'D) motivoFim = texto no fluxo normal')
  }

  // E) erroLegivel: timeout do Postgres → texto acionável (item 3).
  ok(/demorou demais/.test(erroLegivel('canceling statement due to statement timeout')), 'E) timeout → "a consulta demorou demais; tente de outro jeito"')
  ok(erroLegivel('relação X não existe') === 'relação X não existe', 'E) erro comum é preservado')

  // respostaMinima direta (sem divergência) → genérico honesto, não vazio.
  const generico = respostaMinima([{ nome: 'listagem', input: { tipo: 'receber' }, saida: { ok: true } } as ToolResult])
  ok(generico.trim().length > 0 && /atalho/i.test(generico), 'respostaMinima genérica aponta os atalhos grátis')
  ok(respostaMinima([]).trim().length > 0, 'respostaMinima sem dados ainda devolve texto (nunca vazio)')
}

main().then(() => {
  if (falhas) { console.error(`\ncheck-consultor-nunca-vazio: ${falhas} falha(s)`); process.exit(1) }
  console.log('\nConsultor IA — nunca termina vazio: ok')
}, (e) => { console.error('erro no gate:', e); process.exit(1) })
