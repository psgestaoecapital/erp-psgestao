// Gate (HB3 fatia 12 · Gantt no topo e curva S base × atual). Sem rede. Prova a conta do planejado pelas datas atuais
// (ignora a linha de base) e confere que a tela mostra o Gantt antes dos quadros de apoio, com legenda, hoje e "?".
import { readFileSync } from 'node:fs'
import { curvaS, planejadoAtualEm, planejadoEm } from '../../src/lib/hub/curvaS'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const perto = (a: number, b: number) => Math.abs(a - b) < 0.01

const escorregou = [{ inicio: '2026-01-11', fim: '2026-01-20', percentual: 0, inicio_base: '2026-01-01', fim_base: '2026-01-10' }]
ok(perto(planejadoEm(escorregou, '2026-01-10'), 100), 'pela base: 100% no fim da base')
ok(perto(planejadoAtualEm(escorregou, '2026-01-10'), 0), 'pelas datas atuais: 0% (a tarefa foi reprogramada para depois)')
const c = curvaS(escorregou, '2026-01-10')!
ok(c.temBase, 'curva sabe que há linha de base')
const ultimo = c.pontos[c.pontos.length - 1]
ok(ultimo.data === '2026-01-20' && perto(ultimo.planejado, 100) && perto(ultimo.atual, 100), 'as duas curvas terminam em 100% no último fim')
ok(c.pontos.some((p) => p.planejado - p.atual > 50), 'no meio a curva atual fica abaixo da base (escorregou)')
const semBase = curvaS([{ inicio: '2026-01-01', fim: '2026-01-10', percentual: 0 }], '2026-01-05')!
ok(!semBase.temBase && semBase.pontos.every((p) => perto(p.planejado, p.atual)), 'sem base: as duas contas coincidem')

const tela = readFileSync('src/app/dashboard/projetos/obras/[id]/cronograma/page.tsx', 'utf8')
const mig = readFileSync('supabase/migrations/20261025010000_hb3_cronograma_fatia12_gantt_ajuda.sql', 'utf8')
const iGantt = tela.indexOf('>Tarefas no tempo (Gantt)')
ok(iGantt > 0, 'a tela tem o quadro do Gantt')
for (const q of ['>Próximas semanas', '>Compras do período', '>Curva S — planejado', '>Mão de obra e clima']) ok(iGantt < tela.indexOf(q), `Gantt aparece antes de "${q}"`)
ok(tela.includes('<LegendaGantt />') && tela.includes('hojeX'), 'Gantt tem legenda e marca de hoje')
ok(tela.includes('curva.temBase && <path d={atual}'), 'curva S desenha o planejado atual quando há base')
ok(tela.includes('"projetos.cronograma.gantt"') && mig.includes("'projetos.cronograma.gantt'"), '"?" do Gantt na tela e semeado na migration')
ok(!/DELETE FROM|UPDATE public|DROP /i.test(mig), 'migration só aditiva')

if (falhas) { console.error(`\n${falhas} falha(s) no Gantt`); process.exit(1) }
console.log('\nGantt do cronograma: ok')
