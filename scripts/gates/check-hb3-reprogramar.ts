// Gate (HB3 fatia 13 · reprogramar o cronograma pelas dependências). Sem rede. Prova a conta (cadeia em cascata,
// defasagem, duração mantida, tarefa iniciada não anda, nunca puxa para antes, ciclo não trava) e confere que a tela
// mostra o quadro com "?" semeado e grava só pela função com guarda.
import { readFileSync, readdirSync } from 'node:fs'
import { reprogramar } from '../../src/lib/hub/reprogramar'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const t = (id: string, inicio: string, fim: string, percentual = 0) => ({ id, nome: id, inicio, fim, percentual })
const d = (tarefa_id: string, predecessora_id: string, defasagem_dias = 0) => ({ tarefa_id, predecessora_id, defasagem_dias })

// A (1–20) → B (15–25, 11 dias) → C (26–30): B anda para 21–31 e C, em cascata, para 01/02–05/02
const m1 = reprogramar([t('A', '2026-01-01', '2026-01-20', 50), t('B', '2026-01-15', '2026-01-25'), t('C', '2026-01-26', '2026-01-30')], [d('B', 'A'), d('C', 'B')])
const b = m1.find((m) => m.id === 'B'), c = m1.find((m) => m.id === 'C')
ok(m1.length === 2 && !m1.some((m) => m.id === 'A'), 'só as sucessoras mudam (A fica)')
ok(b?.para.inicio === '2026-01-21' && b?.para.fim === '2026-01-31' && b?.dias === 6, 'B começa no dia seguinte ao fim de A, mesma duração')
ok(c?.para.inicio === '2026-02-01' && c?.para.fim === '2026-02-05', 'C anda em cascata atrás de B')

// defasagem de 2 dias (cura): começa 3 dias após o fim
const m2 = reprogramar([t('A', '2026-01-01', '2026-01-20'), t('B', '2026-01-10', '2026-01-12')], [d('B', 'A', 2)])
ok(m2[0]?.para.inicio === '2026-01-23' && m2[0]?.para.fim === '2026-01-25', 'defasagem entra na conta')

// tarefa já iniciada não anda (história não se reescreve)
ok(reprogramar([t('A', '2026-01-01', '2026-01-20'), t('B', '2026-01-10', '2026-01-25', 10)], [d('B', 'A')]).length === 0, 'tarefa com avanço > 0 não é reprogramada')

// nunca puxa para antes: sucessora já depois da predecessora fica onde está
ok(reprogramar([t('A', '2026-01-01', '2026-01-10'), t('B', '2026-01-20', '2026-01-25')], [d('B', 'A')]).length === 0, 'folga sobrando não puxa a tarefa para antes')

// várias predecessoras: vale a que termina mais tarde
const m3 = reprogramar([t('A', '2026-01-01', '2026-01-10'), t('X', '2026-01-01', '2026-01-15'), t('B', '2026-01-05', '2026-01-06')], [d('B', 'A'), d('B', 'X')])
ok(m3[0]?.para.inicio === '2026-01-16', 'com duas predecessoras, espera a que termina por último')

// ciclo e dependência para tarefa excluída não travam
ok(Array.isArray(reprogramar([t('A', '2026-01-01', '2026-01-02'), t('B', '2026-01-01', '2026-01-02')], [d('A', 'B'), d('B', 'A')])), 'ciclo não trava a conta')
ok(reprogramar([t('A', '2026-01-01', '2026-01-02')], [d('A', 'Z')]).length === 0, 'dependência para tarefa excluída é ignorada')
ok(reprogramar([], []).length === 0, 'sem tarefas = nada a reprogramar')

const tela = readFileSync('src/app/dashboard/projetos/obras/[id]/cronograma/page.tsx', 'utf8')
const arq = readdirSync('supabase/migrations').find((f) => f.endsWith('_hb3_cronograma_fatia13_reprogramar_ajuda.sql'))
ok(!!arq, 'migration do "?" existe')
const mig = arq ? readFileSync(`supabase/migrations/${arq}`, 'utf8') : ''
ok(tela.includes("from '@/lib/hub/reprogramar'") && tela.includes('reprogramar(tarefas, deps)'), 'a tela usa a lib de reprogramação')
ok(tela.includes('"projetos.cronograma.reprogramar"') && mig.includes("'projetos.cronograma.reprogramar'"), '"?" do quadro na tela e semeado na migration')
ok(/aplicarReprogramacao[\s\S]*window\.confirm[\s\S]*rpc\('fn_obra_tarefa_salvar'/.test(tela), 'grava com confirmação e só pela função com guarda')
ok(tela.indexOf('>Reprogramar pelas dependências') < tela.indexOf('>Tarefas no tempo (Gantt)'), 'quadro aparece antes do Gantt')
ok(!/DELETE FROM|UPDATE public|DROP /i.test(mig), 'migration só aditiva')

if (falhas) { console.error(`\n${falhas} falha(s) na reprogramação`); process.exit(1) }
console.log('\nReprogramação do cronograma: ok')
