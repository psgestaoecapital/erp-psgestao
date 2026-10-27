// Gate (Hub, RD-38): alerta de duplicata/outlier das Oportunidades. Prova o caso real da auditoria FC
// (Tryo R$ 3,5 mi com mediana ~R$ 40 mil) e os limites (poucas amostras não acusa; negócio só 2× maior não acusa).
import { avisoOportunidade, flagsPorCard, mediana, FATOR_OUTLIER, MIN_AMOSTRAS_OUTLIER } from '../../src/lib/crm/oportunidadeAlerta'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

// mediana
ok(mediana([10, 20, 30]) === 20, 'mediana ímpar = do meio')
ok(mediana([10, 20, 30, 40]) === 25, 'mediana par = média dos dois do meio')
ok(mediana([]) === null && mediana([0, 0]) === null, 'sem valor positivo → null')

// outlier do caso Tryo: 5 abertas ~40k + uma de 3,5 mi
const base = [40000, 38000, 42000, 45000, 41000]
const cards = [
  ...base.map((v, i) => ({ id: `n${i}`, cliente: `Cliente ${i}`, titulo: `Forro ${i}`, valor_estimado: v })),
  { id: 'tryo', cliente: 'Tryo', titulo: 'Obra grande', valor_estimado: 3_500_000 },
]
const flags = flagsPorCard(cards)
ok(flags['tryo']?.outlier === true, `Tryo R$ 3,5 mi é outlier (> ${FATOR_OUTLIER}× mediana ~R$ 41 mil)`)
ok(!flags['n0'], 'oportunidade dentro do padrão não recebe flag')

// duplicata: mesmo cliente + mesmo título (sem diferenciar acento/caixa)
const dup = flagsPorCard([
  { id: 'a', cliente: 'Tryo', titulo: 'Forro de Gesso', valor_estimado: 40000 },
  { id: 'b', cliente: 'TRYO', titulo: 'forro de gesso', valor_estimado: 50000 },
  { id: 'c', cliente: 'Outro', titulo: 'Parede', valor_estimado: 30000 },
])
ok(dup['a']?.duplicata === true && dup['b']?.duplicata === true, 'duplicata: mesmo cliente+título marca os dois')
ok(!dup['c'], 'cliente/título únicos não marcam duplicata')

// poucas amostras → sem outlier (mediana instável)
const poucas = flagsPorCard([
  { id: 'x', cliente: 'A', titulo: 'T1', valor_estimado: 1000 },
  { id: 'y', cliente: 'B', titulo: 'T2', valor_estimado: 2_000_000 },
])
ok(!poucas['y']?.outlier, `menos de ${MIN_AMOSTRAS_OUTLIER} amostras não acusa outlier`)

// negócio só ~3× maior não é outlier
const tresX = flagsPorCard(base.concat(130000).map((v, i) => ({ id: `t${i}`, cliente: `C${i}`, titulo: `X${i}`, valor_estimado: v })))
ok(Object.values(tresX).every((f) => !f.outlier), 'negócio ~3× a mediana não é outlier (evita falso alarme)')

// aviso do formulário
const abertas = base.map((v, i) => ({ id: `o${i}`, cliente_id: `cli${i}`, titulo: `T${i}`, valor_estimado: v }))
const avisoDup = avisoOportunidade({ id: 'novo', clienteId: 'cli0', titulo: 'T0', valor: 40000 }, abertas)
ok(!!avisoDup && avisoDup.includes('duplicata'), 'form: mesmo cliente+título aberto → aviso de duplicata')
const avisoOut = avisoOportunidade({ id: 'novo', clienteId: 'cliZ', titulo: 'Única', valor: 5_000_000 }, abertas)
ok(!!avisoOut && avisoOut.includes('fora do padrão'), 'form: valor muito acima da mediana → aviso de outlier')
const semAviso = avisoOportunidade({ id: 'novo', clienteId: 'cliZ', titulo: 'Única', valor: 45000 }, abertas)
ok(semAviso === null, 'form: oportunidade normal → sem aviso')
// não acusa duplicata contra ela mesma (edição)
const edit = avisoOportunidade({ id: 'o0', clienteId: 'cli0', titulo: 'T0', valor: 40000 }, abertas)
ok(edit === null, 'form: editar a própria oportunidade não dispara duplicata')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\n✓ alerta de duplicata/outlier das Oportunidades ok')
