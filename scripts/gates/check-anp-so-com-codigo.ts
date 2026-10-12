// Gate (#1755 Gean · CEO 07/10 "ANP só com código ANP"): o grupo comb (LA · NT 2016/002) do XML é obrigatório SÓ
// quando o produto tem código ANP (cProdANP) no cadastro. NCM 2710 sem código ANP (ex.: LIMPA BICO DIESEL, aditivo)
// emite sem o grupo — a SEFAZ autorizou a NF 394.102 da Black Prime assim. Produto com código ANP e sem a descANP
// continua barrado com mensagem que ensina. Sem rede.
import { readFileSync } from 'node:fs'
import { validateNFeRequest } from '../../src/lib/fiscal/nfe-validator'
import type { NFeRequest } from '../../src/lib/fiscal/types'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const base = (item: Record<string, unknown>): NFeRequest => ({
  naturezaOperacao: 'Venda de mercadoria', finalidade: 'normal', consumidorFinal: true, serie: '1',
  emitente: { cnpj: '12345678000199', razaoSocial: 'Emitente', inscricaoEstadual: '123', simplesNacional: true },
  destinatario: { razaoSocial: 'Cliente', cnpj: '98765432000199',
    endereco: { logradouro: 'Rua', numero: '1', bairro: 'Centro', cidade: 'Chapecó', uf: 'SC', cep: '89800000' } },
  itens: [{ codigo: '1234', descricao: 'LIMPA BICO DIESEL', ncm: '27101932', cfop: '5405', unidade: 'UN', quantidade: 1,
    valorUnitario: 10, valorTotal: 10, origem: '0', icms: { cst: '500' }, pis: { cst: '49', aliquota: 0 },
    cofins: { cst: '49', aliquota: 0 }, ...item }],
} as unknown as NFeRequest)
const erroDe = (req: NFeRequest) => { try { validateNFeRequest(req); return '' } catch (e) { return e instanceof Error ? e.message : String(e) } }

// 1) validator
ok(!erroDe(base({})).includes('ANP'), 'NCM 2710 sem código ANP (LIMPA BICO) não trava a nota')
ok(!erroDe(base({ comb: undefined, ncm: '27101259' })).includes('ANP'), 'outro NCM 2710 sem código ANP também não trava')
const semDesc = erroDe(base({ comb: { cProdANP: 320101001, ufCons: 'SC' } }))
ok(semDesc.includes('tem código ANP 320101001') && semDesc.includes('Descrição ANP (descANP)') && semDesc.includes('(cód. 1234)'),
  'produto com código ANP e sem descANP continua recusado, dizendo produto e campo')
ok(!erroDe(base({ comb: { cProdANP: 320101001, descANP: 'OLEO DIESEL B S10', ufCons: 'SC' } })).includes('ANP'),
  'produto com código ANP completo passa')
ok(erroDe(base({ ncm: '34031900', comb: { cProdANP: 0 } })).includes('tem código ANP 0'),
  'o gatilho é o código ANP, não o NCM (código 0 conta como informado)')

// 2) builder: só monta o grupo comb quando há código ANP (o NCM sozinho não obriga)
const builder = readFileSync('src/lib/fiscal/nfe-builder.ts', 'utf8')
ok(/const comb = prod\.combustivel_codigo_anp != null/.test(builder), 'builder monta o grupo comb só com código ANP')
ok(!/ehCombustivel = ncmDigits\.startsWith\('2710'\)/.test(builder), 'builder não dispara o grupo comb pelo NCM 2710')
const validator = readFileSync('src/lib/fiscal/nfe-validator.ts', 'utf8')
ok(validator.includes('NT 2016/002') && validator.includes('MOC'), 'validator cita a regra do MOC/NT (RD-72)')

// 3) pré-voo mostra NCM 2710 sem código ANP como aviso
const previo = readFileSync('src/components/fiscal/PreVooFiscalCard.tsx', 'utf8')
ok(previo.includes('NCM 2710 sem código ANP (aviso, não trava)'), 'pré-voo trata NCM 2710 sem código ANP como aviso')

if (falhas) { console.error(`\ncheck-anp-so-com-codigo: ${falhas} falha(s)`); process.exit(1) }
console.log('\nGrupo ANP só com código ANP: ok')
