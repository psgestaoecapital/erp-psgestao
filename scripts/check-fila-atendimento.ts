/**
 * Gate de build: fila de chamados (/dashboard/atendimento). Regra do CEO (28/09): resposta em rascunho → "Precisa de mim",
 * seja qual for o status; e a carga da fila nunca deixa um rascunho de fora.
 *   tsx scripts/check-fila-atendimento.ts
 */
import { estadoFila, juntarFila, carregarFila, contarPendentesAprovacao, contarPrecisaDeMim } from '../src/lib/sugestoes/filaAtendimento'

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

// ── cabeçalho "N p/ aprovar" == aba "Precisa de mim" (CEO 28/09: #286 aguardando + #135 nova, cabeçalho 2 × aba 0) ──
// banco simulado: 400 chamados; os dois rascunhos estão FORA dos mais recentes (o corte antigo os escondia)
type Row = { id: string; numero: number; status: string; resposta: string | null; resposta_aprovada: boolean; confirmado_pelo_autor: boolean; created_at: string }
const banco: Row[] = Array.from({ length: 400 }, (_, i) => ({ id: `s${i}`, numero: i + 1, status: 'em_analise', resposta: null, resposta_aprovada: false, confirmado_pelo_autor: false, created_at: new Date(2026, 0, 1 + i).toISOString() }))
banco[0] = { ...banco[0], numero: 286, status: 'aguardando_confirmacao', resposta: 'rascunho', resposta_aprovada: false }
banco[1] = { ...banco[1], numero: 135, status: 'nova', resposta: 'rascunho', resposta_aprovada: false }
banco[2] = { ...banco[2], numero: 1, status: 'concluida', resposta: 'rascunho', resposta_aprovada: false }
banco[3] = { ...banco[3], numero: 50, status: 'aguardando_confirmacao', resposta: 'aprovada', resposta_aprovada: true }
function fake(limite: number) {
  return { from: () => {
    let rows = [...banco]
    const q = {
      select: () => q,
      eq: (c: keyof Row, v: unknown) => { rows = rows.filter((r) => r[c] === v); return q },
      not: (c: keyof Row, _op: string, v: unknown) => { rows = rows.filter((r) => r[c] !== v); return q },
      order: () => { rows.sort((a, b) => b.created_at.localeCompare(a.created_at)); return q },
      limit: (n: number) => Promise.resolve({ data: rows.slice(0, Math.min(n, limite)), error: null }),
      then: (res: (v: { data: Row[]; error: null }) => unknown) => res({ data: rows, error: null }),
    }
    return q
  } }
}
;(async () => {
  const sb = fake(300)   // mesmo com a carga dos recentes cortada em 300, os rascunhos vêm à parte
  const cab = await contarPendentesAprovacao(sb)
  const fila = await carregarFila<Row>(sb)
  const aba = contarPrecisaDeMim(fila.data)
  ok(cab === 3 && aba === 3, `cabeçalho (${cab}) = aba "Precisa de mim" (${aba}) = 3 rascunhos (#286 aguardando, #135 nova, #1 concluída)`)
  ok(fila.data.some((r) => r.numero === 286) && fila.data.some((r) => r.numero === 135), '#286 e #135 estão na carga da fila mesmo fora dos recentes')
  if (falhas > 0) { console.error(`\n[check-fila-atendimento] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-fila-atendimento] fila de chamados conferida.')
})()
