// Gate (chamado #2254): juros de mora (% ao mês ÷ 30 × dias) e multa (uma vez) do título vencido na renegociação,
// carência por dias_juros/dias_multa e taxa nula = 0 sem inventar taxa. Sem rede.
import { diasDeAtraso, encargosDoTitulo, semTaxaCadastrada } from '../../src/lib/financeiro/jurosMultaAtraso'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const taxa = { juros_pct: 3, multa_pct: 2, dias_juros: null, dias_multa: null }
ok(diasDeAtraso('2026-09-09', '2026-10-09') === 30, '30 dias entre 09/09 e 09/10')
ok(diasDeAtraso('2026-10-20', '2026-10-09') === 0, 'a vencer: 0 dia de atraso')
let e = encargosDoTitulo(1000, '2026-09-09', '2026-10-09', taxa)
ok(e.dias === 30 && e.multa === 20 && e.juros === 30, `R$ 1.000, 30 dias, 2% + 3% a.m.: multa 20 e juros 30 (veio ${e.multa}/${e.juros})`)
e = encargosDoTitulo(1000, '2026-09-24', '2026-10-09', taxa)
ok(e.juros === 15, 'juros proporcionais: 15 dias = metade do mês = 15,00')
e = encargosDoTitulo(1000, '2026-10-20', '2026-10-09', taxa)
ok(e.juros === 0 && e.multa === 0, 'título a vencer não tem encargo')
e = encargosDoTitulo(1000, '2026-10-08', '2026-10-09', { ...taxa, dias_juros: 5, dias_multa: 3 })
ok(e.juros === 0 && e.multa === 0, 'dentro da carência (1 dia < 3/5): sem encargo')
e = encargosDoTitulo(1000, '2026-10-03', '2026-10-09', { ...taxa, dias_juros: 5, dias_multa: 3 })
ok(e.multa === 20 && e.juros === 6, `6 dias, carência 3/5: multa 20 e juros 6,00 (veio ${e.multa}/${e.juros})`)
e = encargosDoTitulo(333.33, '2026-09-29', '2026-10-09', taxa)
ok(e.multa === 6.67 && e.juros === 3.33, `arredonda em centavos (veio ${e.multa}/${e.juros})`)
e = encargosDoTitulo(1000, '2026-09-09', '2026-10-09', { juros_pct: null, multa_pct: null, dias_juros: null, dias_multa: null })
ok(e.juros === 0 && e.multa === 0, 'sem taxa: 0, nunca taxa padrão')
ok(semTaxaCadastrada(null) && semTaxaCadastrada({ juros_pct: null, multa_pct: null, dias_juros: null, dias_multa: null }) && !semTaxaCadastrada(taxa), 'semTaxaCadastrada avisa só quando as duas faltam')
e = encargosDoTitulo(1000, '2026-09-09', '2026-10-09', { juros_pct: 0, multa_pct: 0, dias_juros: null, dias_multa: null })
ok(e.juros === 0 && e.multa === 0 && !semTaxaCadastrada({ juros_pct: 0, multa_pct: 0, dias_juros: null, dias_multa: null }), 'taxa 0 cadastrada é taxa (não é "sem taxa")')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('✓ juros/multa da renegociação')
