/**
 * Gate de build: fila de chamados (/dashboard/atendimento). Regra do CEO (28/09): resposta em rascunho → "Precisa de mim",
 * seja qual for o status; e a carga da fila nunca deixa um rascunho de fora.
 *   tsx scripts/check-fila-atendimento.ts
 */
import { estadoFila, juntarFila, carregarFila, contarPendentesAprovacao, contarPrecisaDeMim, rascunhoNaoEnviado, filtrarBusca, semDemos, carregarEmpresasDemo } from '../../src/lib/sugestoes/filaAtendimento'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }
const base = { resposta: 'texto', resposta_aprovada: false, confirmado_pelo_autor: false }

ok(estadoFila({ ...base, status: 'aguardando_confirmacao' }) === 'precisa_mim', 'caso #286: rascunho novo em chamado "aguardando confirmação" → Precisa de mim')
ok(estadoFila({ ...base, status: 'nova' }) === 'precisa_mim', 'rascunho em chamado novo → Precisa de mim')
ok(estadoFila({ ...base, status: 'concluida' }) === 'terminal' && rascunhoNaoEnviado({ ...base, status: 'concluida' }), 'rascunho em chamado concluído → fora da fila, marcado "rascunho não enviado"')
ok(estadoFila({ ...base, status: 'arquivada' }) === 'terminal' && rascunhoNaoEnviado({ ...base, status: 'arquivada' }), 'rascunho em chamado arquivado → fora da fila, marcado "rascunho não enviado"')
ok(estadoFila({ ...base, status: 'em_analise' }) === 'precisa_mim' && !rascunhoNaoEnviado({ ...base, status: 'em_analise' }), 'chamado reaberto: o mesmo rascunho volta para Precisa de mim')
ok(estadoFila({ ...base, status: 'recusada' }) === 'precisa_mim', 'rascunho em chamado recusado (aberto para o CEO: só concluído/arquivado encerram) → Precisa de mim')
ok(estadoFila({ ...base, resposta: '   ', status: 'nova' }) === 'em_curso', 'resposta em branco não é rascunho')
ok(estadoFila({ ...base, resposta_aprovada: true, status: 'aguardando_confirmacao' }) === 'sem_confirmacao', 'aprovada e não confirmada → Aguardando o autor')
ok(estadoFila({ ...base, resposta_aprovada: true, status: 'concluida' }) === 'terminal', 'aprovada e concluída → Concluídas')
ok(estadoFila({ ...base, resposta: null, status: 'em_analise' }) === 'em_curso', 'sem resposta → Em curso')

// ── busca exata por número (CEO 28/09): "286"/"#286" abre só o #286, não os que têm 286 no título ──
const chamados = [
  { numero: 286, titulo: 'NFS-e sem retenções', descricao: 'x' },
  { numero: 172, titulo: 'erro na nota 2860', descricao: 'x' },
  { numero: 174, titulo: 'y', descricao: 'pedido 286 travado' },
  { numero: 1286, titulo: 'z', descricao: 'x' },
]
ok(filtrarBusca(chamados, '286').map((c) => c.numero).join() === '286', 'busca "286" → só o #286 (não #172/#174/#1286)')
ok(filtrarBusca(chamados, '#286').map((c) => c.numero).join() === '286', 'busca "#286" → só o #286')
ok(filtrarBusca(chamados, ' # 286 ').map((c) => c.numero).join() === '286', 'busca " # 286 " (espaços) → só o #286')
ok(filtrarBusca(chamados, '999').length === 0, 'número inexistente → nada (não cai para busca por texto)')
ok(filtrarBusca(chamados, 'pedido 286').map((c) => c.numero).join() === '174', 'texto continua buscando título/descrição')
ok(filtrarBusca(chamados, '').length === 4, 'busca vazia → todos')

// ── demos fora por padrão (CEO 28/09) ──
const demoSet = new Set(['demo1'])
const comEmpresa = [{ id: 'a', company_id: 'demo1' }, { id: 'b', company_id: 'real' }, { id: 'c', company_id: null }]
ok(semDemos(comEmpresa, demoSet).map((r) => r.id).join() === 'b,c', 'semDemos tira só os chamados de empresa DEMO (sem empresa fica)')

const j = juntarFila([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }])
ok(j.length === 3 && j.map((x) => x.id).sort().join() === 'a,b,c', 'carga: recentes + todos os rascunhos, sem repetir')

// ── cabeçalho "N p/ aprovar" == aba "Precisa de mim" (CEO 28/09: #286 aguardando + #135 nova, cabeçalho 2 × aba 0) ──
// banco simulado: 400 chamados; os dois rascunhos estão FORA dos mais recentes (o corte antigo os escondia)
type Row = { id: string; numero: number; company_id: string | null; status: string; resposta: string | null; resposta_aprovada: boolean; confirmado_pelo_autor: boolean; created_at: string }
const banco: Row[] = Array.from({ length: 400 }, (_, i) => ({ id: `s${i}`, numero: i + 1, company_id: 'real', status: 'em_analise', resposta: null, resposta_aprovada: false, confirmado_pelo_autor: false, created_at: new Date(2026, 0, 1 + i).toISOString() }))
banco[0] = { ...banco[0], numero: 286, status: 'aguardando_confirmacao', resposta: 'rascunho', resposta_aprovada: false }
banco[1] = { ...banco[1], numero: 135, status: 'nova', resposta: 'rascunho', resposta_aprovada: false }
banco[2] = { ...banco[2], numero: 1, status: 'concluida', resposta: 'rascunho', resposta_aprovada: false }
banco[3] = { ...banco[3], numero: 50, status: 'aguardando_confirmacao', resposta: 'aprovada', resposta_aprovada: true }
banco[4] = { ...banco[4], numero: 900, company_id: 'demo1', status: 'nova', resposta: 'rascunho do robô', resposta_aprovada: false }   // DEMO
const empresas = [{ id: 'demo1', is_demo: true }, { id: 'real', is_demo: false }]
function fake(limite: number) {
  return { from: (tabela: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rows: any[] = tabela === 'companies' ? [...empresas] : [...banco]
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return q },
      not: (c: string, _op: string, v: unknown) => { rows = rows.filter((r) => r[c] !== v); return q },
      order: () => { rows.sort((a, b) => b.created_at.localeCompare(a.created_at)); return q },
      limit: (n: number) => Promise.resolve({ data: rows.slice(0, Math.min(n, limite)), error: null }),
      then: (res: (v: { data: unknown[]; error: null }) => unknown) => res({ data: rows, error: null }),
    }
    return q
  } }
}
;(async () => {
  const sb = fake(300)   // mesmo com a carga dos recentes cortada em 300, os rascunhos vêm à parte
  const cab = await contarPendentesAprovacao(sb)
  const fila = await carregarFila<Row>(sb)
  const demos = await carregarEmpresasDemo(sb)
  const aba = contarPrecisaDeMim(semDemos(fila.data, demos))   // a tela no padrão (sem "mostrar demos")
  ok(cab === 2 && aba === 2, `cabeçalho (${cab}) = aba "Precisa de mim" (${aba}) = 2 rascunhos em chamados abertos (#286 aguardando, #135 nova; #1 concluída e #900 DEMO ficam fora)`)
  ok(contarPrecisaDeMim(fila.data) === 3, 'com "mostrar demos" o rascunho do robô (#900) aparece na aba')
  ok(fila.data.some((r) => r.numero === 1 && rascunhoNaoEnviado(r)), '#1 (concluída) continua carregado, marcado "rascunho não enviado"')
  ok(fila.data.some((r) => r.numero === 286) && fila.data.some((r) => r.numero === 135), '#286 e #135 estão na carga da fila mesmo fora dos recentes')
  if (falhas > 0) { console.error(`\n[check-fila-atendimento] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-fila-atendimento] fila de chamados conferida.')
})()
