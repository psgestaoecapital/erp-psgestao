/**
 * Gate (Jordana 20/10 · FCR): as "Observações" do pedido (OTC: orçamento → pedido → faturamento) vão para as
 * Informações Complementares da NF-e, na frente dos textos legais (Simples / crédito de ICMS #2876, Lei 12.741),
 * sem um apagar o outro. Prova do caso real: NF-e nº 2 da FCR (pedido PED-ORC-2026-0003 com Observações) saiu
 * sem informacoes_adicionais_contribuinte.
 */
import { readFileSync } from 'node:fs'
import { observacoesComSimples, TEXTO_SIMPLES } from '../../src/lib/fiscal/creditoIcmsSimples'

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

if (falhas) { console.error(`\n[check-nfe-observacoes-pedido] ${falhas} falha(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-nfe-observacoes-pedido] observações do pedido na NF-e conferidas.')
