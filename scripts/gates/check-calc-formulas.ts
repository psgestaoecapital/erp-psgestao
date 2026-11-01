// Gate: as fórmulas da Calculadora de Obra (motor) têm de bater com a REFERÊNCIA travada (NBR 15758/14715) em cada caso
// canônico. Se alguém mudar uma fórmula/coeficiente de referência e o resultado divergir, o build quebra — a tela promete
// "fórmula validada contra a referência", então a referência não pode sair do lugar sem intenção. (desenvolvedor_4_g)
import { validarFormulas, CASOS_VALIDACAO } from '../../src/lib/calculadora/referencia-validacao'

const falhas = validarFormulas()
for (const c of CASOS_VALIDACAO) {
  const dele = falhas.filter((f) => f.caso === c.chave)
  if (dele.length === 0) console.log(`✓ ${c.rotulo} (${c.entrada}) — bate com a referência`)
  else for (const f of dele) console.log(`✗ ${c.rotulo}: ${f.detalhe}`)
}

if (falhas.length > 0) {
  console.error(`\n[check-calc-formulas] ${falhas.length} divergência(s) da referência — build bloqueado.`)
  console.error('Se a mudança de fórmula é intencional, atualize os valores esperados em src/lib/calculadora/referencia-validacao.ts.')
  process.exit(1)
}
console.log(`\n[check-calc-formulas] ${CASOS_VALIDACAO.length} caso(s) batem com a referência (NBR 15758/14715).`)
