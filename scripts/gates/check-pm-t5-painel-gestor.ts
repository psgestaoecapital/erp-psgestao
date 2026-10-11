// Gate · PM-T 5 — painel do gestor (cobertura, jobs sem horas, alerta 80%). Sem rede.
import { readFileSync } from 'node:fs'
import { alertasEstimado, cobertura, jobsSemHoras, janelaDias } from '../../src/lib/pm/painelGestor'
import type { JobPainel } from '../../src/lib/pm/painel'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const H = '2026-10-07'
const mk = (o: Partial<JobPainel>): JobPainel => ({
  id: 'x', numero: '1', titulo: 't', status: 'em_producao', prioridade: 'alta', cliente_id: 'c1', campanha_id: null, responsavel_id: 'u1', servico_id: null, tipo: null,
  data_inicio: '2026-09-01', data_prazo: '2026-10-20', data_entrega: null, created_at: '2026-09-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z',
  rodada_ajuste: 0, horas_estimadas: 10, horas_realizadas: 0, ...o,
})

const jobs = [
  mk({ id: 'a' }),
  mk({ id: 'b', horas_realizadas: 8 }),
  mk({ id: 'c', horas_realizadas: 12 }),
  mk({ id: 'd', status: 'concluida' }),
  mk({ id: 'e', updated_at: '2025-01-01T00:00:00Z' }),
  mk({ id: 'f', horas_estimadas: 0, horas_realizadas: 5 }),
]
ok(jobsSemHoras(jobs, H).map((j) => j.id).join() === 'a', 'sem horas = aberto, fora do legado, realizado 0')
const al = alertasEstimado(jobs, H)
ok(al.map((x) => x.job.id).join() === 'c,b' && al[0].estourou && !al[1].estourou && al[1].pct === 80, 'alerta a partir de 80%, estourou a partir de 100%, ordenado')
const hs = [{ user_id: 'u1', data: '2026-10-07', horas: 2 }, { user_id: 'u1', data: '2026-10-06', horas: 1.5 }, { user_id: 'u2', data: '2026-09-01', horas: 4 }]
const cob = cobertura([{ id: 'u1', nome: 'Ana' }, { id: 'u2', nome: 'Beto' }], hs, '2026-10-01', H)
ok(cob[0].id === 'u2' && cob[0].semApontar && cob[1].horas === 3.5 && cob[1].dias === 2, 'cobertura: sem apontamento primeiro; soma horas e dias na janela')
ok(janelaDias(7, H).de === '2026-10-01' && janelaDias(1, H).de === H, 'janela de dias')
const tela = readFileSync('src/app/dashboard/pm/painel-gestor/page.tsx', 'utf8')
ok(!/custo/i.test(tela.replace(/nunca custo/, '')) && !/\.(insert|update|delete)\(/.test(tela), 'tela só lê e não toca em custo')
if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }
