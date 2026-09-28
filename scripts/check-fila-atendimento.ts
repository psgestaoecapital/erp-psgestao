/**
 * Gate de build: fila de chamados (/dashboard/atendimento). Regra do CEO (28/09): resposta em rascunho → "Precisa de mim",
 * seja qual for o status; e a carga da fila nunca deixa um rascunho de fora.
 *   tsx scripts/check-fila-atendimento.ts
 */
import { estadoFila, juntarFila } from '../src/lib/sugestoes/filaAtendimento'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }
const base = { resposta: 'texto', resposta_aprovada: false, confirmado_pelo_autor: false }

ok(estadoFila({ ...base, status: 'aguardando_confirmacao' }) === 'precisa_mim', 'caso #286: rascunho novo em chamado "aguardando confirmação" → Precisa de mim')
ok(estadoFila({ ...base, status: 'nova' }) === 'precisa_mim', 'rascunho em chamado novo → Precisa de mim')
ok(estadoFila({ ...base, status: 'concluida' }) === 'precisa_mim', 'rascunho em chamado concluído → Precisa de mim (qualquer status)')
ok(estadoFila({ ...base, status: 'arquivada' }) === 'precisa_mim', 'rascunho em chamado arquivado → Precisa de mim (qualquer status)')
ok(estadoFila({ ...base, resposta: '   ', status: 'nova' }) === 'em_curso', 'resposta em branco não é rascunho')
ok(estadoFila({ ...base, resposta_aprovada: true, status: 'aguardando_confirmacao' }) === 'sem_confirmacao', 'aprovada e não confirmada → Aguardando o autor')
ok(estadoFila({ ...base, resposta_aprovada: true, status: 'concluida' }) === 'terminal', 'aprovada e concluída → Concluídas')
ok(estadoFila({ ...base, resposta: null, status: 'em_analise' }) === 'em_curso', 'sem resposta → Em curso')

const j = juntarFila([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }])
ok(j.length === 3 && j.map((x) => x.id).sort().join() === 'a,b,c', 'carga: recentes + todos os rascunhos, sem repetir')

if (falhas > 0) { console.error(`\n[check-fila-atendimento] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-fila-atendimento] fila de chamados conferida.')
