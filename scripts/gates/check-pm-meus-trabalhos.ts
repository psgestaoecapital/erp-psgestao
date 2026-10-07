// Gate: Meus Trabalhos (P&M) — indicadores, agrupamentos e agenda semanal.
import { readFileSync } from 'node:fs'
import { agendaSemana, agrupar, indicadores, type TrabalhoJob, type TrabalhoTarefa } from '../../src/lib/pm/meusTrabalhos'

const falhas: string[] = []
const ok = (c: boolean, m: string) => { if (!c) falhas.push(m) }
const j = (id: string, status: string, prazo: string | null, inicio: string | null, atrasado = false): TrabalhoJob => ({ id, codigo: id, titulo: id, cliente: null, status, data_prazo: prazo, data_inicio: inicio, atrasado })
const t = (id: string, status: string, prazo: string | null, inicio: string | null): TrabalhoTarefa => ({ id, job_id: 'a', titulo: id, status, data_prazo: prazo, data_inicio: inicio })
const hoje = '2026-10-05'
const jobs = [j('a', 'em_producao', '2026-10-05', '2026-10-05'), j('b', 'nao_iniciada', '2026-10-01', null, true), j('c', 'concluida', '2026-10-02', null), j('d', 'em_aprovacao', '2026-10-07', '2026-10-06'), j('e', 'em_producao', null, null)]
const tarefas = [t('t1', 'em_andamento', '2026-10-05', '2026-10-04'), t('t2', 'concluida', '2026-10-01', null), t('t3', 'pendente', '2026-09-30', null)]

const i = indicadores(jobs, tarefas, hoje)
ok(i.jobsAtivos === 4 && i.jobsAtrasados === 1, 'indicadores de job')
ok(i.tarefasAtivas === 2 && i.tarefasAtrasadas === 1, 'indicadores de tarefa')
ok(i.inicioHoje === 1 && i.prazoHoje === 2, `início/prazo hoje (${i.inicioHoje}/${i.prazoHoje})`)
const gp = agrupar(jobs, 'prazo', hoje)
ok(gp[0].grupo === 'Atrasados' && gp[gp.length - 1].grupo === 'Sem prazo', 'por prazo: Atrasados no topo, Sem prazo no fim')
ok(!gp.some((g) => g.itens.some((x) => x.id === 'c')), 'concluído fica fora')
const gs = agrupar(jobs, 'situacao', hoje)
ok(gs.map((g) => g.grupo).join('|') === 'Não iniciada|Em produção|Em aprovação', 'por situação na ordem do fluxo')
ok(agrupar(jobs, 'inicio', hoje).some((g) => g.grupo === 'Sem início'), 'por início: Sem início')
const ag = agendaSemana(jobs, tarefas, hoje)
ok(ag.length === 7 && ag[0].jobs.length === 1 && ag[0].tarefas.length === 1 && ag[2].jobs.length === 1, 'agenda semanal')
const mig = readFileSync('supabase/migrations/20261005230005_pm_meus_trabalhos_ajuda.sql', 'utf8')
ok(mig.includes("'pm.meus_trabalhos.tela'"), '"?" da tela no banco')

if (falhas.length) { console.error('✗ check-pm-meus-trabalhos:\n - ' + falhas.join('\n - ')); process.exit(1) }
console.log('✓ check-pm-meus-trabalhos')
