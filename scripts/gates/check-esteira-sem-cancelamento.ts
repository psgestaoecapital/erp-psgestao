// Gate (CEO 12/10): a esteira não cancela run por concorrência. Workflows da drenagem (fila, gates, aceitações,
// montagem do banco) têm cancel-in-progress: false e `queue: max` (sem a fila o GitHub descarta a rodada pendente).
// Exceções deliberadas: acionar-revisor (debounce de 120 s, só acorda o revisor; não é check da PR) e build-pr.yml
// (CEO 10/11: compilação por PR; cancelar o build de um head SUPERADO é economia — o head vigente sempre tem o seu run).
// (preview-pronta.yml foi removido em 10/11: sem preview de PR, não há commit vazio a forçar.)
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const wf = (f: string) => readFileSync(`.github/workflows/${f}`, 'utf8')

for (const f of ['gates.yml', 'aceitacao-main.yml', 'aceitacao-pos-migration.yml', 'montar-banco-testes.yml']) {
  const s = wf(f)
  const b = s.match(/concurrency:\s*\n(?:\s+#[^\n]*\n)*\s+group:[^\n]*\n\s+cancel-in-progress: (\w+)\n(\s+queue: max)?/)
  ok(!!b && b[1] === 'false' && !!b[2], `${f}: concurrency com cancel-in-progress: false + queue: max`)
}
// Exceção deliberada (CEO 12/10, deadlock): a fila de merge varre tudo a cada rodada (idempotente) → só 1 pendente
// (sem `queue: max`), sem cancelar a rodada em andamento, e com timeout no job e no passo para a cabeça travada cair.
{
  const s = wf('fila-merge.yml')
  ok(/concurrency:\s*\n(?:\s+#[^\n]*\n)*\s+group: fila-merge\n\s+cancel-in-progress: false\n/.test(s), 'fila-merge.yml: group fila-merge, cancel-in-progress: false')
  ok(!/queue:\s*max/.test(s.replace(/#[^\n]*/g, '')), 'fila-merge.yml: sem queue: max (no máximo 1 rodada pendente)')
  ok(/timeout-minutes: 10/.test(s) && /name: Processar a fila[^\n]*\n\s+timeout-minutes: 8/.test(s), 'fila-merge.yml: timeout no job (10) e no passo (8)')
}
ok(/group: gates-[^\n]*head\.sha/.test(wf('gates.yml')), 'gates.yml: grupo por PR + SHA do head')
for (const f of ['fila-merge.yml', 'gates.yml', 'aceitacao-main.yml', 'aceitacao-pos-migration.yml', 'aceitacao-pr.yml', 'montar-banco-testes.yml']) {
  ok(!/cancel-in-progress: true/.test(wf(f)), `${f}: nenhum cancel-in-progress: true`)
}
// build-pr.yml é a exceção deliberada (CEO 10/11): cancela o build de head superado (economia). Não entra na lista acima.
if (falhas) process.exit(1)
