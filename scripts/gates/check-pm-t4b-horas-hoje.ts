// Gate · PM-T (4b) — barra "horas de hoje" no Meu dia. Sem rede.
import { readFileSync } from 'node:fs'
import { horasDeHoje, percentualDoDia } from '../../src/lib/pm/horasHoje'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const agora = new Date('2026-10-07T15:00:00Z')
ok(horasDeHoje([], agora) === 0, 'sem linhas → 0 h')
ok(horasDeHoje([{ horas: 1.5, inicio_em: null, fim_em: 'x' }, { horas: 2, inicio_em: null, fim_em: 'x' }], agora) === 3.5, 'soma das linhas fechadas')
ok(horasDeHoje([{ horas: 0, inicio_em: '2026-10-07T14:00:00Z', fim_em: null }], agora) === 1, 'cronômetro aberto conta o tempo corrido')
ok(horasDeHoje([{ horas: null, inicio_em: null, fim_em: 'x' }], agora) === 0, 'horas nulas contam 0')
ok(percentualDoDia(4) === 50 && percentualDoDia(20) === 100, 'percentual da meta, teto 100')
const pg = readFileSync('src/app/dashboard/pm/meu-dia/page.tsx', 'utf8')
ok(/<BarraHorasHoje /.test(pg), 'Meu dia mostra a barra')
const c = readFileSync('src/components/pm/BarraHorasHoje.tsx', 'utf8')
ok(/horas-hoje/.test(c) && /EVENTO_CRONOMETRO/.test(c), 'barra atualiza com o cronômetro')
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
