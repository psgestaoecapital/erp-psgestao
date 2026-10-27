// Gate (Hub HB2, RD-38): a TABELA DE REFERÊNCIA (src/lib/calculadora/referencia.ts) tem de bater com o MOTOR.
// É o que sustenta o selo "fórmula validada" da tela da Calculadora: se o selo diz validada, o cálculo tem de
// devolver exatamente a quantidade conferida à mão. Este gate roda a conferência e exige que TODOS os sistemas
// batam — assim o selo nunca mente (um "validada" que o motor não sustenta reprova o build).
import { conferirTudo, REFERENCIA } from '../../src/lib/calculadora/referencia'
import type { SistemaCalc } from '../../src/lib/calculadora/regras-empresa'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const SISTEMAS: SistemaCalc[] = ['parede', 'parede_separativa', 'parede_corta_fogo', 'forro_f530', 'forro_aramado', 'revestimento_colado', 'revestimento_estruturado']

// todo sistema tem ao menos um caso de referência (senão o selo "validada" seria vazio/sem sentido)
for (const s of SISTEMAS) ok((REFERENCIA[s]?.length ?? 0) >= 1, `${s}: tem ao menos um caso de referência`)

const conf = conferirTudo()
for (const c of conf) {
  ok(c.validada, `${c.sistema}: fórmula bate com a referência (selo "validada")`)
  for (const caso of c.casos) {
    for (const i of caso.itens) {
      if (!i.bate) console.error(`    · ${c.sistema} / ${caso.titulo}: ${i.chave} esperado ${i.esperado}, veio ${i.obtido}`)
    }
    if (!caso.area.bate) console.error(`    · ${c.sistema} / ${caso.titulo}: área esperada ${caso.area.esperado}, veio ${caso.area.obtido}`)
  }
}
ok(conf.length === SISTEMAS.length, `conferência cobre os ${SISTEMAS.length} sistemas (veio ${conf.length})`)
ok(conf.every((c) => c.validada), 'todos os sistemas validados contra a referência')

if (falhas) { console.error(`\n${falhas} falha(s) — o selo "fórmula validada" não pode ser mostrado enquanto o motor não bater com a referência`); process.exit(1) }
console.log('\n✓ referência da Calculadora bate com o motor em todos os sistemas')
