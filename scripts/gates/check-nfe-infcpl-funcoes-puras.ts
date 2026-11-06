/**
 * Gate (revisor 27/10, #2919): testa as funções puras das Informações Complementares da NF-e (infCpl) rodando-as,
 * nos casos vazio, 5000 e 5001 caracteres — e prova que o texto da PRÉVIA é exatamente o que o provedor (Focus)
 * manda em informacoes_adicionais_contribuinte (sanitizeTextoFiscal + corte em 5000 não mudam nada no que a tela viu).
 */
import { readFileSync } from 'node:fs'
import { observacoesComSimples, textoCreditoSN, TEXTO_SIMPLES } from '../../src/lib/fiscal/creditoIcmsSimples'
import { LIMITE_INF_CPL, excedeLimiteInfCpl, mensagemLimiteInfCpl, textoInformacoesComplementares } from '../../src/lib/fiscal/informacoesComplementares'
import { sanitizeTextoFiscal } from '../../src/lib/fiscal/providers/focusnfe'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

// O que o provedor Focus envia no campo (mesma expressão de focusnfe.ts).
const enviadoFocus = (obs: string | undefined) => (obs ? sanitizeTextoFiscal(obs).slice(0, 5000) : undefined)
const provider = readFileSync('src/lib/fiscal/providers/focusnfe.ts', 'utf8')
ok(provider.includes('informacoes_adicionais_contribuinte: sanitizeTextoFiscal(req.observacoes).slice(0, 5000)'), 'Focus: o campo sai de sanitizeTextoFiscal(observacoes) cortado em 5000 (a simulação abaixo usa a mesma regra)')

// ── textoInformacoesComplementares: vazio ──
ok(textoInformacoesComplementares(undefined, undefined) === undefined, 'vazio: sem composto e sem edição → nota sem texto')
ok(textoInformacoesComplementares('', undefined) === undefined && textoInformacoesComplementares('   ', null) === undefined, 'vazio: composto em branco → nota sem texto')
ok(textoInformacoesComplementares('composto', '') === undefined && textoInformacoesComplementares('composto', '  \n ') === undefined, 'vazio: texto apagado na tela → nota sem texto (não volta o composto)')
ok(textoInformacoesComplementares('composto', null) === 'composto' && textoInformacoesComplementares('composto', undefined) === 'composto', 'sem edição → vale o composto')
ok(textoInformacoesComplementares('composto', ' editado ') === 'editado', 'edição substitui o composto por inteiro')
ok(!excedeLimiteInfCpl(undefined) && !excedeLimiteInfCpl(null) && !excedeLimiteInfCpl(''), 'vazio não excede o limite')

// ── 5000 e 5001 caracteres ──
const t5000 = 'A'.repeat(5000)
const t5001 = 'A'.repeat(5001)
ok(LIMITE_INF_CPL === 5000, 'limite = 5000 (leiaute NF-e 4.00)')
ok(textoInformacoesComplementares(t5000)?.length === 5000 && !excedeLimiteInfCpl(textoInformacoesComplementares(t5000)), '5000 caracteres: passa inteiro')
ok(enviadoFocus(textoInformacoesComplementares(t5000)) === textoInformacoesComplementares(t5000), '5000 caracteres: o que a Focus recebe = a prévia')
ok(textoInformacoesComplementares(t5001)?.length === 5001 && excedeLimiteInfCpl(textoInformacoesComplementares(t5001)), '5001 caracteres: excede (a rota recusa a emissão em vez de cortar)')
ok(mensagemLimiteInfCpl(5001).includes('5001') && mensagemLimiteInfCpl(5001).includes('5000'), '5001 caracteres: a mensagem diz o tamanho e o limite')

// ── Texto que o provedor mudaria: a prévia já vem sanitizada, então nada muda entre prévia e nota ──
const sujo = 'Pedido nº 12 — OC 4567\nEntrega… “obra” · fundos'
const previa = textoInformacoesComplementares(sujo)!
ok(previa === 'Pedido nº 12 - OC 4567 Entrega... "obra" - fundos', 'prévia mostra o texto como sai (travessão, quebra de linha, reticências, aspas, ponto médio)')
ok(enviadoFocus(previa) === previa, 'texto com caracteres tipográficos: o que a Focus recebe = a prévia')
const quase = 'A'.repeat(4999) + '…' // 5000 na tela crua, 5002 depois de sanitizar
ok(excedeLimiteInfCpl(textoInformacoesComplementares(quase)), 'limite conta o texto sanitizado (reticências que viram "..." não são cortadas caladas)')

// ── observacoesComSimples (frases do Simples) ──
ok(observacoesComSimples(undefined, null, 0) === TEXTO_SIMPLES && observacoesComSimples('  ', null, 0) === TEXTO_SIMPLES, 'vazio: nota do Simples sai só com a frase do Simples')
ok(observacoesComSimples('OC 99', null, 0) === `OC 99 | ${TEXTO_SIMPLES}`, 'observação do pedido primeiro, depois a frase do Simples')
ok(observacoesComSimples('OC 99', 38, 3.8) === `OC 99 | ${TEXTO_SIMPLES} | ${textoCreditoSN(38, 3.8)}`, 'com crédito: pedido | Simples | crédito art. 23')
ok(!observacoesComSimples('OC 99', 0, 3.8).includes('APROVEITAMENTO'), 'crédito zero: sem a frase do crédito')
const jaTem = `X | ${TEXTO_SIMPLES}`
ok(observacoesComSimples(jaTem, null, 0) === jaTem, 'não duplica a frase do Simples')
const comp5000 = observacoesComSimples('B'.repeat(5000 - TEXTO_SIMPLES.length - 3), null, 0)
ok(comp5000.length === 5000 && !excedeLimiteInfCpl(textoInformacoesComplementares(comp5000)), 'pedido + Simples com 5000 caracteres: passa')
const comp5001 = observacoesComSimples('B'.repeat(5001 - TEXTO_SIMPLES.length - 3), null, 0)
ok(comp5001.length === 5001 && excedeLimiteInfCpl(textoInformacoesComplementares(comp5001)), 'pedido + Simples com 5001 caracteres: excede')
const simplesFocus = textoInformacoesComplementares(observacoesComSimples('OC 99', 38, 3.8))
ok(enviadoFocus(simplesFocus) === simplesFocus, 'frases do Simples: o que a Focus recebe = a prévia')

if (falhas) { console.error(`\n[check-nfe-infcpl-funcoes-puras] ${falhas} falha(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-nfe-infcpl-funcoes-puras] funções puras do infCpl testadas (vazio, 5000, 5001, prévia = nota).')
