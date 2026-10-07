// Gate (CEO 07/10): DRE consolidado e divisional mostram moeda completa pt-BR, nunca abreviada ("50k", "1,0 mi"),
// negativo com "-" na frente e em vermelho. Sem rede.
import { readFileSync } from 'node:fs'
import { fmtMoedaDre, valorComSinalDre, ehNegativoDre } from '../../src/lib/formatoMoedaDre'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

ok(fmtMoedaDre(50000) === 'R$ 50.000,00', '50000 → R$ 50.000,00')
ok(fmtMoedaDre(1000000) === 'R$ 1.000.000,00', '1.000.000 → R$ 1.000.000,00 (sem "1,0 mi")')
ok(fmtMoedaDre(-1234.56) === '-R$ 1.234,56', 'negativo → -R$ 1.234,56')
ok(fmtMoedaDre(0) === 'R$ 0,00' && fmtMoedaDre(-0.001) === 'R$ 0,00', 'zero sem sinal')
ok(valorComSinalDre(55689, '-') === -55689 && valorComSinalDre(-55689, '-') === -55689, 'despesa sai negativa venha positiva ou negativa')
ok(valorComSinalDre(100, '+') === 100 && ehNegativoDre(-1) && !ehNegativoDre(5), 'receita sem sinal; negativo detectado')

const dre = readFileSync('src/components/financeiro/DREHorizontal.tsx', 'utf8')
ok(!/\bmil?\b`|' mi'| mi`/.test(dre) && !/function abrev/.test(dre), 'DREHorizontal não tem mais abreviação')
ok(/fmtMoedaDre\(valorComSinalDre\(v, l\.sinal\)\)/.test(dre) && /COR_VALOR_NEGATIVO/.test(dre), 'célula usa moeda completa e cor de negativo')
ok(/overflowX: 'auto'/.test(dre) && /position: 'sticky', left: 0/.test(dre) && /whiteSpace: 'nowrap'/.test(dre), 'rolagem horizontal, 1ª coluna fixa, número sem quebra')
const div = readFileSync('src/app/dashboard/dre-divisional/_components/index.tsx', 'utf8')
ok(/fmtBRL = fmtMoedaDre/.test(div), 'DRE divisional usa o mesmo formato')

if (falhas) { console.error(`\ncheck-dre-formato-moeda: ${falhas} falha(s)`); process.exit(1) }
console.log('\nDRE · formato de moeda: ok')
