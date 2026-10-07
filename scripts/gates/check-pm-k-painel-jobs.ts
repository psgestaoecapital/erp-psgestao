// Gate · PM-K — Painel de Jobs (blueprint P&M v8, tela 15). Sem rede.
// 1) regras puras: legado (>180 d, não concluído) fora dos números, atraso, 6 indicadores, 8 gráficos, filtro de 13 campos;
// 2) tela/API/migration: opções salvas só do dono (RLS), exclusão lógica, nada gravado no financeiro, IA sem nomes de pessoas.
import { readFileSync } from 'node:fs'
import { CAMPOS_FILTRO, atrasado, codigoPainel, filtrarJobs, graficos, indicadores, legado, linhasFluxo, resumoParaIA, contarFiltroPainel, type JobPainel } from '../../src/lib/pm/painel'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const H = '2026-10-05'
const mk = (o: Partial<JobPainel>): JobPainel => ({
  id: 'x', numero: '100', titulo: 't', status: 'em_producao', prioridade: 'alta', cliente_id: 'c1', campanha_id: null, responsavel_id: 'u1', servico_id: 's1', tipo: null,
  data_inicio: '2026-09-01', data_prazo: '2026-10-10', data_entrega: null, created_at: '2026-09-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z',
  rodada_ajuste: 0, horas_estimadas: 10, horas_realizadas: 5, ...o,
})
const nomes = { clientes: { c1: 'Aurora', c2: 'Pulso' }, responsaveis: { u1: 'Ana', u2: 'Beto' }, servicos: { s1: 'Banner' }, grupoDoCliente: { c1: 'g1', c2: null } }

ok(CAMPOS_FILTRO.length === 13, 'filtro com 13 campos')
ok(atrasado(mk({ data_prazo: '2026-10-01' }), H) && !atrasado(mk({ data_prazo: '2026-10-01', status: 'concluida' }), H) && !atrasado(mk({ data_prazo: '2026-10-05' }), H), 'atrasado = aberto e prazo antes de hoje')
ok(legado(mk({ updated_at: '2026-03-01T00:00:00Z' }), H) && !legado(mk({ updated_at: '2026-03-01T00:00:00Z', status: 'concluida' }), H) && !legado(mk({ updated_at: '2026-09-20T00:00:00Z' }), H), 'legado = parado >180 dias e não concluído')

const jobs = [
  mk({ id: 'a', numero: '1', rodada_ajuste: 2 }),
  mk({ id: 'b', numero: '2', cliente_id: 'c2', responsavel_id: 'u2', data_prazo: '2026-09-25', horas_estimadas: 10, horas_realizadas: 15 }),
  mk({ id: 'c', numero: '3', status: 'concluida', data_inicio: '2026-09-01', data_entrega: '2026-09-11', data_prazo: '2026-09-12' }),
  mk({ id: 'd', numero: '4', updated_at: '2025-12-01T00:00:00Z', data_prazo: '2026-01-01' }),
]
const rod = [{ job_id: 'a', motivo: 'Texto' }, { job_id: 'a', motivo: 'Cor' }, { job_id: 'b', motivo: 'Texto' }, { job_id: 'd', motivo: 'Texto' }]
const hs = [{ user_id: 'u1', cliente_id: 'c1', horas: 3 }, { user_id: 'u2', cliente_id: 'c2', horas: 2 }]

const vis = filtrarJobs(jobs, {}, nomes, H)
ok(vis.length === 3 && !vis.some((j) => j.id === 'd'), 'job legado fica fora do painel por padrão')
ok(filtrarJobs(jobs, { incluir_legado: true }, nomes, H).length === 4, '"incluir legado" traz de volta')
const idsV = new Set(vis.map((j) => j.id))
const ind = indicadores(vis, rod.filter((r) => idsV.has(r.job_id)), H)
ok(ind.total === 3 && ind.alteracoes === 3 && ind.mediaAlteracoes === 1, 'total, alterações e média (só dos jobs do filtro)')
ok(ind.realizado === 25 && ind.estimado === 30 && ind.realizadoSobreEstimado === 83.3, 'realizado/estimado em %')
ok(ind.diasConclusao === 10 && ind.diasAtraso === 10, 'dias da conclusão e dias de atraso (média)')
ok(indicadores([], [], H).diasAtraso === null && indicadores([], [], H).realizadoSobreEstimado === null, 'sem dados = vazio, não zero enganoso')
ok(filtrarJobs(jobs, { clientes: ['c2'] }, nomes, H).length === 1 && filtrarJobs(jobs, { grupos: ['g1'] }, nomes, H).length === 2, 'filtro por cliente e por grupo')
ok(filtrarJobs(jobs, { atrasados: 'sim' }, nomes, H).length === 1 && filtrarJobs(jobs, { codigo: '1B' }, nomes, H).length === 1 && codigoPainel(jobs[0]) === '1B', 'filtro de atrasados e por código com letra da rodada')
ok(filtrarJobs(jobs, { data_de: '2026-10-01' }, nomes, H).length === 1 && contarFiltroPainel({ clientes: ['c1'], data_tipo: 'prazo', incluir_legado: true }) === 1, 'filtro por data e contador de filtros')

const g = graficos(vis, rod.filter((r) => idsV.has(r.job_id)), hs, nomes)
ok(Object.keys(g).length === 8, '8 gráficos')
ok(g.motivos[0].nome === 'Texto' && g.motivos[0].valor === 2 && g.clientesAlteracoes[0].nome === 'Aurora', 'motivos e clientes com mais alterações')
ok(g.horasColaborador.length === 2 && g.horasCliente[0].valor === 3 && g.dispersao.length === 2, 'horas por colaborador/cliente e dispersão')
const lin = linhasFluxo(vis, rod, nomes, H)
ok(lin[0].codigo === '3' && lin[1].codigo === '2' && lin[1].atraso === 10, 'fluxo ordenado por prazo, com dias de atraso')
const ia = JSON.stringify(resumoParaIA(ind, g))
ok(!ia.includes('Ana') && !ia.includes('Beto'), 'resumo para a IA não leva nome de pessoa')

const mig = readFileSync('supabase/migrations/20261005233005_pm_k_painel_jobs.sql', 'utf8')
ok(/ENABLE ROW LEVEL SECURITY/.test(mig) && /REVOKE ALL ON public\.agency_painel_opcao FROM PUBLIC, anon/.test(mig) && /dono_id = auth\.uid\(\)/.test(mig), 'migration: RLS, REVOKE anon e só o dono')
ok(!/\bDELETE\b|\bTRUNCATE\b|DROP\s+(TABLE|COLUMN|CONSTRAINT)/i.test(mig.replace(/--.*$/gm, '').replace(/ON DELETE CASCADE/g, '')) && /GRANT UPDATE \(nome, filtros, excluido_em\)/.test(mig), 'migration aditiva, sem DELETE/DROP, exclusão lógica')
const tela = readFileSync('src/app/dashboard/pm/painel-jobs/page.tsx', 'utf8')
ok(!/\.insert\(|\.update\(|\.delete\(/.test(tela.replace(/agency_painel_opcao"\)\.(insert|update)/g, '')), 'tela só grava as opções salvas (nada de financeiro nem de job)')
ok(/excluido_em: new Date\(\)\.toISOString\(\)/.test(tela) && /window\.print\(\)/.test(tela) && /xlsx/.test(tela), 'apagar opção é lógico; PDF e Excel')
const api = readFileSync('src/app/api/pm/painel/insights/route.ts', 'utf8')
ok(/aiGuardedCall/.test(api) && /Bearer /.test(api) && /ia_painel_insights/.test(api), 'insights: autenticado e dentro do teto de IA')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-pm-k-painel-jobs: OK')
