// Gate (HB3 fatia 11 · histograma de mão de obra e clima do cronograma). Sem rede. Prova o agrupamento por semana
// (segunda a domingo), a equipe média, a contagem de dias do diário (vários RDOs no mesmo dia = 1 dia) e confere que a
// tela mostra o quadro com os "?" semeados e lê apontamentos e RDO ignorando o excluído.
import { readFileSync } from 'node:fs'
import { histogramaObra, segunda } from '../../src/lib/hub/histogramaObra'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

ok(segunda('2026-10-12') === '2026-10-12' && segunda('2026-10-18') === '2026-10-12' && segunda('2026-10-19') === '2026-10-19', 'semana vai de segunda a domingo')
const apont = [
  { data: '2026-10-12', horas: 8 }, { data: '2026-10-13', horas: 16 }, { data: '2026-10-18', horas: 16 },
  { data: '2026-10-27', horas: 4.5 },
]
const rdos = [
  { data: '2026-10-13', clima: 'chuva', praticavel: true },
  { data: '2026-10-13', clima: 'sol', praticavel: false }, // outra OS no mesmo dia
  { data: '2026-10-14', clima: 'chuva_forte', praticavel: false },
  { data: '2026-10-15', clima: 'nublado', praticavel: true },
]
const h = histogramaObra(apont, rdos, { ini: '2026-10-12', fim: '2026-10-28' })
ok(!!h && h.semanas.map((s) => s.semana).join(',') === '2026-10-12,2026-10-19,2026-10-26', 'três semanas, inclusive a vazia do meio')
ok(h!.semanas[0].horas === 40 && h!.semanas[0].equipe === 1 && h!.semanas[1].horas === 0 && h!.semanas[2].horas === 4.5, 'horas por semana e equipe média (40 h = 1 pessoa)')
ok(h!.totalHoras === 44.5 && h!.picoHoras === 40, 'total 44,5 h e pico 40 h')
ok(h!.semanas[0].diasRdo === 3 && h!.diasChuva === 2 && h!.diasParados === 2, '3 dias de diário, 2 de chuva, 2 parados (dois RDOs no mesmo dia = 1 dia)')
ok(histogramaObra([], [], { ini: '2026-10-12', fim: '2026-10-28' }) === null, 'sem apontamento nem diário = quadro vazio')
const longo = histogramaObra([{ data: '2020-01-06', horas: 8 }, { data: '2026-10-12', horas: 8 }], [])
ok(!!longo && longo.semanas.length === 104 && longo.semanas[103].semana === '2026-10-12', 'data muito antiga não explode: fica com as 104 semanas mais recentes')

const tela = readFileSync('src/app/dashboard/projetos/obras/[id]/cronograma/page.tsx', 'utf8')
const mig = readFileSync('supabase/migrations/20261024220000_hb3_cronograma_fatia11_histograma_ajuda.sql', 'utf8')
ok(tela.includes("from '@/lib/hub/histogramaObra'") && tela.includes('histogramaObra('), 'a tela usa a lib do histograma')
ok(/projetos_obra_mao_obra_apontamento'\)\.select\('data,horas'\)\.eq\('obra_id', id\)\.is\('excluido_em', null\)/.test(tela), 'apontamentos da obra, sem os excluídos')
ok(/projetos_obra_rdo'\)\.select\('data,clima,praticavel'\)\.eq\('obra_id', id\)\.is\('excluido_em', null\)/.test(tela), 'diário (RDO) da obra, sem os excluídos')
for (const k of ['projetos.cronograma.histograma', 'projetos.cronograma.ind_horas', 'projetos.cronograma.ind_pico', 'projetos.cronograma.ind_chuva', 'projetos.cronograma.ind_parados']) {
  ok(tela.includes(`"${k}"`), `a tela mostra o "?" ${k}`)
  ok(mig.includes(`'${k}'`), `chave ${k} semeada na migration`)
}
ok(!/DELETE FROM|UPDATE public|DROP /i.test(mig), 'migration só aditiva')

if (falhas) { console.error(`\n${falhas} falha(s) no histograma`); process.exit(1) }
console.log('\nHistograma de mão de obra e clima: ok')
