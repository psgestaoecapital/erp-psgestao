/**
 * Gate (Jordana 20/10 · FCR): as "Observações" do pedido (OTC: orçamento → pedido → faturamento) vão para as
 * Informações Complementares da NF-e, na frente dos textos legais (Simples / crédito de ICMS #2876, Lei 12.741),
 * sem um apagar o outro. Prova do caso real: NF-e nº 2 da FCR (pedido PED-ORC-2026-0003 com Observações) saiu
 * sem informacoes_adicionais_contribuinte.
 */
import { readFileSync } from 'node:fs'
import { observacoesComSimples, TEXTO_SIMPLES } from '../../src/lib/fiscal/creditoIcmsSimples'
import { LIMITE_INF_CPL, excedeLimiteInfCpl, textoInformacoesComplementares } from '../../src/lib/fiscal/informacoesComplementares'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const builder = readFileSync('src/lib/fiscal/nfe-builder.ts', 'utf8')
const route = readFileSync('src/app/api/fiscal/nfe/emitir/route.ts', 'utf8')

const ramoPedido = builder.slice(builder.indexOf('if (input.pedidoId) {'), builder.indexOf('} else if (input.erpReceberId) {'))
ok(/\.from\('erp_pedidos'\)\s*\n\s*\.select\('observacoes'\)/.test(ramoPedido), 'pedido: lê o campo Observações do pedido')
ok(!/observacoes_internas/.test(ramoPedido), 'pedido: nunca as observações internas')
ok(/\.eq\('company_id', input\.companyId\)/.test(ramoPedido.slice(ramoPedido.indexOf("from('erp_pedidos')"))), 'pedido: lido só da própria empresa')
ok(/observacoesComSimples\(\s*\n?\s*input\.manual\?\.observacoes \?\? observacoesOrigem/.test(builder), 'Simples: observação do pedido entra antes das frases do Simples')
ok(/: \(input\.manual\?\.observacoes \?\? observacoesOrigem\)/.test(builder), 'fora do Simples: observação do pedido vai para a nota')
ok(!/\[bloco, nfeReq\.observacoes\]/.test(route) && (route.match(/\[nfeReq\.observacoes, bloco\]/g) ?? []).length === 2, 'Lei 12.741: o bloco entra DEPOIS das observações (Simples e regime normal)')

const obs = observacoesComSimples('Ordem de compra nº 123', 38, 3.8)
ok(obs.startsWith('Ordem de compra nº 123 | ') && obs.includes(TEXTO_SIMPLES) && obs.includes('APROVEITAMENTO DO CRÉDITO DE ICMS'), 'texto final: pedido | Simples | crédito')
const final = [obs, 'Valor aproximado dos tributos: R$ 1,14 (11,39%)'].map((s) => s.trim()).filter(Boolean).join(' | ')
ok(final.indexOf('Ordem de compra') < final.indexOf('OPTANTE') && final.indexOf('OPTANTE') < final.indexOf('Valor aproximado'), 'ordem: pedido → Simples → 12.741')

// Etapa 2: prévia editável + limite do campo (infCpl ≤ 5000), sem cortar calado.
ok(LIMITE_INF_CPL === 5000, 'limite do infCpl = 5000 caracteres (leiaute NF-e 4.00)')
ok(textoInformacoesComplementares('composto', undefined) === 'composto' && textoInformacoesComplementares('composto', ' editado ') === 'editado', 'texto editado na tela substitui o composto')
ok(textoInformacoesComplementares('composto', '') === undefined, 'texto apagado na tela = nota sem informações complementares')
ok(!excedeLimiteInfCpl('x'.repeat(5000)) && excedeLimiteInfCpl('x'.repeat(5001)), 'acima de 5000 caracteres excede')
const iPrevia = route.indexOf('if (body.apenasPrevia) {')
const iEmitir = route.indexOf('await svc.emitirNFe(nfeReq)')
ok(iPrevia > 0 && iPrevia < iEmitir && route.indexOf('excedeLimiteInfCpl(nfeReq.observacoes)') < iEmitir, 'rota: prévia volta antes de emitir e o limite trava a emissão')
ok(route.indexOf('textoInformacoesComplementares(nfeReq.observacoes, body.informacoesComplementares)') > route.lastIndexOf('[nfeReq.observacoes, bloco]'), 'rota: edição aplicada depois dos textos legais (o que a tela viu é o que sai)')
ok(/if \(!body\.apenasPrevia\) await registrarFalhaEmissaoNFe/.test(route), 'rota: prévia não registra tentativa de emissão')
const card = readFileSync('src/components/comum/NFeCard.tsx', 'utf8')
ok(/apenasPrevia: true/.test(card) && /payload\.informacoesComplementares = textoInfCpl/.test(card), 'card do pedido: carrega a prévia e envia o texto editado')
ok((card.match(/\{secaoInfCpl\}/g) ?? []).length === 2 && (card.match(/disabled=\{emitindo \|\| excedeInfCpl\}/g) ?? []).length === 2, 'card do pedido: texto antes de Emitir/Reemitir e botão travado acima do limite')

// Item 5: NF-e de peças da OS — Observações para o cliente da OS (nunca as internas), mesma prévia editável.
const iOs = builder.indexOf('if (input.osId && observacoesOrigem === undefined) {')
const ramoOs = builder.slice(iOs, builder.indexOf('}', builder.indexOf('observacoesOrigem = (', iOs)))
ok(iOs > 0 && /\.from\('erp_os'\)\s*\n\s*\.select\('observacoes_cliente'\)/.test(ramoOs) && /\.eq\('company_id', input\.companyId\)/.test(ramoOs), 'OS: lê as Observações para o cliente da própria empresa')
ok(!/observacoes_internas/.test(ramoOs), 'OS: nunca as observações internas')
ok(/osId: body\.osId,/.test(route), 'rota: passa a OS para o montador da nota')
const osBtn = readFileSync('src/components/comum/EmitirNFeOSButton.tsx', 'utf8')
ok(/apenasPrevia: true/.test(osBtn) && /body\.informacoesComplementares = textoInfCpl/.test(osBtn), 'NF-e da OS: carrega a prévia e envia o texto editado')
ok(/oficina\.os\.nfe_informacoes_complementares"/.test(osBtn) && /!\(!!previa && textoInfCpl\.trim\(\)\.length > previa\.limite\)/.test(osBtn), 'NF-e da OS: "?" no campo e emissão travada acima do limite')

if (falhas) { console.error(`\n[check-nfe-observacoes-pedido] ${falhas} falha(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-nfe-observacoes-pedido] observações do pedido na NF-e conferidas.')
