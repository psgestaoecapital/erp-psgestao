// Gate (CEO 30/09): CFOP de venda vem do cadastro — dentro do estado (cfop_venda) e fora (cfop_venda_interestadual).
// Sem "5102 automático" e sem derivar 5→6 (5405 virava 6405, que não existe). Produto sem o CFOP do escopo da nota
// trava antes do envio dizendo o produto e o campo. Roda no build. Sem rede.
import { readFileSync } from 'node:fs'
import { validateNFeRequest } from '../src/lib/fiscal/nfe-validator'
import type { NFeRequest } from '../src/lib/fiscal/types'
import { erroDoValor, rotuloCampo, CAMPOS_FISCAIS } from '../src/lib/produtos/fiscalMassa'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// 1) o builder não supõe CFOP
const builder = readFileSync('src/lib/fiscal/nfe-builder.ts', 'utf8')
ok(!/cfop_venda \?\? '5102'/.test(builder) && !builder.includes("?? '5102'"), 'sem "5102 automático"')
ok(builder.includes('prod.cfop_venda_interestadual') && builder.includes("cfopFaltando = interestadual ? 'fora' : 'dentro'"), 'fora do estado usa o CFOP interestadual do cadastro')
ok(/if \(it\.cfopOverride\) \{\s*cfopItem = ajustarCfopEscopo\(it\.cfopOverride/.test(builder), 'só devolução/remessa (cfopOverride) derivam o escopo pela UF')
ok(builder.includes(".select('*')"), 'produto lido inteiro (código publicado antes da migration não derruba a emissão)')

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
const eFora = erroDe(base({ cfop: '', cfopFaltando: 'fora' }))
ok(eFora.includes('está sem CFOP de venda fora do estado'), 'sem CFOP fora do estado → produto + campo')
ok(!erroDe(base({ cfop: '6102' })).includes('CFOP'), 'com CFOP não trava por CFOP')

// 3) regras da edição em massa (iguais às da função do banco)
ok(CAMPOS_FISCAIS.includes('cfop_venda') && CAMPOS_FISCAIS.includes('cfop_venda_interestadual'), 'edição em massa tem os 2 CFOPs')
ok(erroDoValor('cfop_venda', '5405', true) === null && erroDoValor('cfop_venda', '6102', true) !== null, 'dentro do estado: 5xxx')
ok(erroDoValor('cfop_venda_interestadual', '6404', true) === null && erroDoValor('cfop_venda_interestadual', '5102', true) !== null, 'fora do estado: 6xxx')
ok(rotuloCampo('cfop_venda_interestadual', true) === 'CFOP de venda fora do estado', 'rótulo')
const mig = readFileSync('supabase/migrations/20260930120000_produtos_cfop_venda.sql', 'utf8')
ok(mig.includes("v_cfop !~ '^5\\d{3}$'") && mig.includes("v_cfop_fora !~ '^6\\d{3}$'"), 'banco valida 5xxx/6xxx igual à tela')
ok(mig.includes("ADD COLUMN IF NOT EXISTS cfop_venda_interestadual text"), 'coluna CFOP fora do estado')
ok(mig.includes("'cfop_venda','cfop_venda_interestadual'));"), 'registro de alteração aceita os CFOPs')
ok(mig.includes("v_icms_igual IS NULL OR btrim(COALESCE(p.cst_icms,'')) = v_icms_igual"), 'filtro por CSOSN/CST (ex.: 500 → 5405/6404)')
ok(mig.includes("jsonb_build_array('sem CFOP de venda dentro do estado')"), 'pré-voo aponta produto sem CFOP')
ok((mig.match(/UPDATE public\.erp_produtos/g) ?? []).length === 1, 'migration não altera produto fora da função')

// 4) a ficha não supõe CFOP
const form = readFileSync('src/components/cadastros/ProdutoForm.tsx', 'utf8')
ok(!form.includes("cfop_venda ?? '5102'") && form.includes('cfop_venda_interestadual'), "ficha sem '5102' padrão e com CFOP fora do estado")

if (falhas) { console.error(`\ncheck-cfop-venda: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-cfop-venda: ok')
