// Gate (CEO 29/09): NF-e não sai com tributação suposta — sem "102 automático" nem PIS/COFINS 04 inventado.
// Produto sem CSOSN/CST do ICMS, CST do PIS ou CST da COFINS trava ANTES do envio, dizendo o produto e o campo.
// Roda no build. Sem rede.
import { readFileSync } from 'node:fs'
import { validateNFeRequest } from '../src/lib/fiscal/nfe-validator'
import type { NFeRequest } from '../src/lib/fiscal/types'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// 1) o builder não inventa mais tributação
const builder = readFileSync('src/lib/fiscal/nfe-builder.ts', 'utf8')
ok(!/cst_icms \?\? \(ehSimples \? '102'/.test(builder), 'sem "102 automático" no ICMS')
ok(!/cst_(pis|cofins) \?\? \(ehSimples \? '04'/.test(builder), 'sem PIS/COFINS 04 automático')

// 2) o validator trava com produto + campo (chokepoint único de NF-e, NFC-e, devolução e remessa)
const base = (itens: NFeRequest['itens'], simples = true): NFeRequest => ({
  naturezaOperacao: 'Venda de mercadoria', finalidade: 'normal', consumidorFinal: true, serie: '1',
  emitente: { cnpj: '12345678000199', razaoSocial: 'Emitente', inscricaoEstadual: '123', simplesNacional: simples },
  destinatario: { razaoSocial: 'Cliente', cnpj: '98765432000199',
    endereco: { logradouro: 'Rua', numero: '1', bairro: 'Centro', cidade: 'Chapecó', uf: 'SC', cep: '89800000' } },
  itens,
} as unknown as NFeRequest)
const item = (icms?: string, pis?: string, cofins?: string) => ({
  codigo: '660', descricao: 'ARGAMASSA AC3', ncm: '32145000', cfop: '5102', unidade: 'UN', quantidade: 1, valorUnitario: 10, valorTotal: 10,
  origem: '0', icms: { cst: icms }, pis: { cst: pis, aliquota: 0 }, cofins: { cst: cofins, aliquota: 0 },
}) as unknown as NFeRequest['itens'][number]
const erroDe = (req: NFeRequest) => { try { validateNFeRequest(req); return '' } catch (e) { return e instanceof Error ? e.message : String(e) } }

const e1 = erroDe(base([item(undefined, undefined, undefined)]))
ok(e1.includes('ARGAMASSA AC3 (cód. 660) está sem CSOSN do ICMS, CST do PIS e CST da COFINS'), 'Simples sem nada → produto + 3 campos (CSOSN)')
const e2 = erroDe(base([item(undefined, '01', '01')], false))
ok(e2.includes('está sem CST do ICMS no cadastro') && !e2.includes('CSOSN'), 'regime normal sem ICMS → "CST do ICMS"')
const e3 = erroDe(base([item('102', '49', '49')]))
ok(!e3.includes('está sem'), 'produto completo não trava por tributação')

if (falhas) { console.error(`\ncheck-nfe-sem-tributacao-suposta: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-nfe-sem-tributacao-suposta: ok')
