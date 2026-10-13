// Gate (CEO 30/09 · trava do CFOP, parte B): o CFOP de venda vem do cadastro — dentro do estado (cfop_venda) e fora
// (cfop_venda_interestadual). Sem "5102 automático" e sem derivar 5→6 (5405 virava 6405, que não existe). Produto sem o
// CFOP do escopo da nota trava antes do envio dizendo o produto e o campo. Sem rede.
import { readFileSync } from 'node:fs'
import { validateNFeRequest } from '../../src/lib/fiscal/nfe-validator'
import type { NFeRequest } from '../../src/lib/fiscal/types'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// 1) o builder não supõe CFOP
const builder = readFileSync('src/lib/fiscal/nfe-builder.ts', 'utf8')
ok(!builder.includes("?? '5102'"), 'sem "5102 automático" na emissão')
ok(builder.includes('prod.cfop_venda_interestadual') && builder.includes("cfopFaltando = interestadual ? 'fora' : 'dentro'"), 'fora do estado usa o CFOP interestadual do cadastro')
ok(/if \(it\.cfopOverride\) \{\s*cfopItem = ajustarCfopEscopo\(it\.cfopOverride/.test(builder), 'só devolução/remessa (cfopOverride) derivam o escopo pela UF')
ok(/\.select\(\s*'[^']*\bcfop_venda_interestadual\b/.test(builder), 'o builder lê o CFOP fora do estado do produto')

// 2) o validator trava com produto + campo
const base = (item: Record<string, unknown>): NFeRequest => ({
  naturezaOperacao: 'Venda de mercadoria', finalidade: 'normal', consumidorFinal: true, serie: '1',
  emitente: { cnpj: '12345678000199', razaoSocial: 'Emitente', inscricaoEstadual: '123', simplesNacional: true },
  destinatario: { razaoSocial: 'Cliente', cnpj: '98765432000199',
    endereco: { logradouro: 'Rua', numero: '1', bairro: 'Centro', cidade: 'Curitiba', uf: 'PR', cep: '80000000' } },
  itens: [{ codigo: '660', descricao: 'ARGAMASSA AC3', ncm: '32145000', unidade: 'UN', quantidade: 1, valorUnitario: 10, valorTotal: 10,
    origem: '0', icms: { cst: '102' }, pis: { cst: '49', aliquota: 0 }, cofins: { cst: '49', aliquota: 0 }, ...item }],
} as unknown as NFeRequest)
const erroDe = (req: NFeRequest) => { try { validateNFeRequest(req); return '' } catch (e) { return e instanceof Error ? e.message : String(e) } }
const eDentro = erroDe(base({ cfop: '', cfopFaltando: 'dentro' }))
ok(eDentro.includes('(cód. 660) está sem CFOP de venda dentro do estado') && !eDentro.includes('CFOP invalido'), 'sem CFOP dentro do estado → produto + campo (não "CFOP inválido")')
ok(erroDe(base({ cfop: '', cfopFaltando: 'fora' })).includes('está sem CFOP de venda fora do estado'), 'sem CFOP fora do estado → produto + campo')
ok(!erroDe(base({ cfop: '6102' })).includes('CFOP'), 'com CFOP não trava por CFOP')
ok(erroDe(base({ cfop: '51' })).includes('CFOP invalido'), 'CFOP malformado segue recusado')

// 3) nenhum cadastro de produto nasce com 5102
const telaAntiga = readFileSync('src/app/dashboard/produtos/page.tsx', 'utf8')
ok(!telaAntiga.includes("cfop_venda:'5102'"), 'cadastro de produto não nasce com 5102')
const ficha = readFileSync('src/components/cadastros/ProdutoForm.tsx', 'utf8')
ok(!ficha.includes("cfop_venda ?? '5102'"), "ficha sem '5102' padrão")

if (falhas) { console.error(`\ncheck-cfop-trava-emissao: ${falhas} falha(s)`); process.exit(1) }
console.log('\nTrava do CFOP na emissão: ok')
