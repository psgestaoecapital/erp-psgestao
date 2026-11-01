// Gate (CEO 23/10) — VIA EXPRESSA DO HUB. PR com a label 'hub': prioridade no topo, via rápida (sem revisor) e tratada
// como ADITIVA (batela até LOTE_MIG_MAX, não entra no teto de crítica LOTE_MIG_CRIT_MAX). "Sem trava nenhuma; reauditamos
// depois" — mas as travas ESTRUTURAIS ficam: deploy-migrations não-verde segura o hub também (nada aplica num deploy quebrado).
import { readFileSync } from 'node:fs'
import { SCRIPT_FILA, comFilaSimulada, merges, temFerramentas } from '../merge/fila-simulada'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── leitura do script ──
const sh = readFileSync(SCRIPT_FILA, 'utf8')
ok(/n_hub=0; jq -e '\.labels \| map\(\.name\) \| index\("hub"\)'/.test(sh), 'calcula n_hub pela label hub, cedo no loop')
ok(/_hub=''; for hn in \$fila; do jq -e[\s\S]*?index\("hub"\)/.test(sh) && /fila=\$\(echo \$_hub \$_prio \$_resto\)/.test(sh), 'hub vai na frente da fila (prioridade por label)')
ok(/\[ "\$n_hub" = 0 \] && jq -e --arg l "\$SENSIVEL"[^\n]*n_critica=1/.test(sh), 'hub NÃO conta como crítica (batela como aditivo)')
ok(/\[ "\$n_hub" = 0 \] && jq -e --arg l "\$SENSIVEL"[^\n]*via=revisada/.test(sh), 'hub é sempre via rápida (sem revisor)')
ok(/\[ "\$via" = rapida \] && \[ "\$n_hub" = 0 \] &&/.test(sh), 'o classificador de conteúdo não re-rotula hub como revisada')
ok(/deploy_travado" = 1 \][\s\S]*?espera \(todas as migrations\)/.test(sh), 'trava estrutural: deploy não-verde segura TODAS as migrations (inclusive hub)')

// ── fila simulada (roda o fila-merge.sh de verdade) ──
const A = 'create table public.t_a (id int);\n'
const B = 'create table public.t_b (id int);\n'
const C = 'create table public.t_c (id int);\n'
const hub = { labels: ['hub', 'revisao-eng-chefe'], migration: true, aceitacao: 'success' as const } // hub + crítica: a expressa vence
const crit = { labels: ['revisao-eng-chefe'], autorizada: true, aceitacao: 'success' as const, migration: true }
if (!temFerramentas()) console.log('… cenários da fila pulados: jq ou git ausente')
else comFilaSimulada((rodar) => {
  // hub com revisao-eng-chefe e SEM autorização publica mesmo assim (via rápida), e batela como aditivo
  let x = rodar([{ n: 1, ...hub, sqlMigration: A }, { n: 2, ...hub, sqlMigration: B }, { n: 3, ...hub, sqlMigration: C }])
  ok(merges(x.escritas).join() === '1,2,3', 'hub: 3 migrations batelam como aditivo, sem revisor (apesar de revisao-eng-chefe)')
  // prioridade: hub vai na frente de uma PR comum que entrou antes
  x = rodar([{ n: 1, labels: [], aceitacao: 'success' }, { n: 2, ...hub, sqlMigration: A }])
  ok(merges(x.escritas)[0] === 2, 'hub: vai na frente da fila (prioridade por label)')
  // trava estrutural mantida: deploy da main não-verde segura o hub também
  x = rodar([{ n: 1, ...hub, sqlMigration: A }], true)   // mainOcupada = deploy-migrations rodando
  ok(merges(x.escritas).length === 0, 'hub: deploy-migrations não-verde segura o hub (trava estrutural fica)')
  // a expressa do hub é exclusiva do hub: com LOTE_MIG_CRIT_MAX=1, uma crítica comum segue 1/rodada (o lote de críticas
  // da CEO 01/11 tem teto próprio, provado em check-fila-lote-criticas.ts; aqui fixamos 1 para isolar o contraste)
  x = rodar([{ n: 1, ...crit, sqlMigration: A }, { n: 2, ...crit, sqlMigration: B }], false, 5000, { LOTE_MIG_CRIT_MAX: '1' })
  ok(merges(x.escritas).join() === '1', 'crítica comum com teto 1 segue cautela (1/rodada); a expressa é exclusiva do hub')
})

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nFila — via expressa do Hub: ok')
