// Gate (HB3 fatia 12 · linha realizada da curva S). Sem rede. Prova a conta do realizado ao longo do tempo (último %
// de cada tarefa até o dia, peso = duração, tarefa ainda não começada = 0, começada sem registro = linha não começa) e
// confere que a migration é aditiva (tabela nova com RLS só leitura, REVOKE anon, gatilho novo, FKs em cascata para a
// limpeza da semente da demo) e que a tela lê o histórico e mostra o "?" da linha.
import { readFileSync } from 'node:fs'
import { curvaS, curvaRealizada } from '../../src/lib/hub/curvaS'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const perto = (a: number, b: number) => Math.abs(a - b) < 0.01

// A: 10 dias (01..10/10), 60% hoje · B: 10 dias (15..24/10), 20% hoje. Pesos iguais.
const tarefas = [
  { id: 'A', inicio: '2026-10-01', fim: '2026-10-10', percentual: 60 },
  { id: 'B', inicio: '2026-10-15', fim: '2026-10-24', percentual: 20 },
]
const hist = [
  { tarefa_id: 'A', data: '2026-10-01', percentual: 10 },
  { tarefa_id: 'A', data: '2026-10-08', percentual: 40 },
  { tarefa_id: 'B', data: '2026-10-15', percentual: 5 },
  { tarefa_id: 'A', data: '2026-10-20', percentual: 60 },
  { tarefa_id: 'B', data: '2026-10-20', percentual: 20 },
]
const hoje = '2026-10-21'
const c = curvaS(tarefas, hoje)!
ok(c.pontos.map((p) => p.data).join(',') === '2026-10-01,2026-10-08,2026-10-15,2026-10-22,2026-10-24', 'semanas da curva planejada')
const r = curvaRealizada(tarefas, hist, c.pontos, hoje)
ok(r.map((p) => p.data).join(',') === '2026-10-01,2026-10-08,2026-10-15,2026-10-21', 'linha realizada: semanas até hoje + o ponto de hoje')
ok(perto(r[0].realizado, 5), '01/10: A 10%, B não começou (0) → 5%')
ok(perto(r[1].realizado, 20), '08/10: A 40%, B 0 → 20%')
ok(perto(r[2].realizado, 22.5), '15/10: A 40, B 5 → 22,5%')
ok(perto(r[3].realizado, 40) && perto(r[3].realizado, c.realizado), 'hoje = avanço geral da tela (A 60, B 20 → 40%)')

// tarefa já começada sem nenhum registro antes do dia: a linha não chuta zero, começa quando todas são conhecidas
const semA = curvaRealizada(tarefas, hist.filter((h) => !(h.tarefa_id === 'A' && h.data < '2026-10-08')), c.pontos, hoje)
ok(semA[0].data === '2026-10-08' && semA.length === 3, 'sem registro de A em 01/10 → a linha começa em 08/10')
// sem histórico (obra antiga): só o ponto de hoje, igual ao comportamento anterior
const so = curvaRealizada(tarefas, [], c.pontos, hoje)
ok(so.length === 1 && so[0].data === hoje, 'sem histórico: só o ponto de hoje')
ok(curvaRealizada([], hist, c.pontos, hoje).length === 0, 'sem tarefas: nada')

const tela = readFileSync('src/app/dashboard/projetos/obras/[id]/cronograma/page.tsx', 'utf8')
const mig = readFileSync('supabase/migrations/20261025000000_hb3_cronograma_fatia12_avanco_historico.sql', 'utf8')
ok(/projetos_obra_tarefa_avanco'\)\.select\('tarefa_id,data,percentual'\)\.eq\('obra_id', id\)/.test(tela), 'a tela lê o histórico da obra (RLS)')
ok(tela.includes('curvaRealizada(') && tela.includes('linhaReal'), 'a tela desenha a linha realizada')
ok(tela.includes('"projetos.cronograma.curva_realizada"') && mig.includes("'projetos.cronograma.curva_realizada'"), '"?" da linha realizada na tela e semeado')
ok(/ENABLE ROW LEVEL SECURITY/.test(mig) && /REVOKE ALL ON public\.projetos_obra_tarefa_avanco FROM PUBLIC, anon/.test(mig), 'tabela nova com RLS e sem anon')
ok(/FOR SELECT TO authenticated/.test(mig) && !/FOR (INSERT|UPDATE|DELETE|ALL)/.test(mig), 'policy só de leitura (grava só o gatilho)')
ok((mig.replace(/^--.*$/gm, '').match(/ON DELETE CASCADE/g) ?? []).length === 3, 'FKs em cascata: a limpeza da semente da demo não quebra')
ok(/c\.is_demo IS TRUE/.test(mig), 'rampa sintética só na empresa de demonstração')
ok(!/DELETE FROM|UPDATE public\.|DROP TABLE|DROP FUNCTION|ALTER TABLE public\.projetos_obra_tarefa /i.test(mig.replace(/^--.*$/gm, '')), 'migration só aditiva (não muda tarefa nem função existente)')
ok(!/fn_obra_tarefa_salvar|fn_demo_seed_construtora|fn_demo_reset/.test(mig.replace(/^--.*$/gm, '')), 'não reescreve função existente')

if (falhas) { console.error(`\n${falhas} falha(s) na curva realizada`); process.exit(1) }
console.log('\nCurva S realizada: ok')
