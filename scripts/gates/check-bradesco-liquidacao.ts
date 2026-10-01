// Gate (#297 Bradesco · CEO 01/10): consulta de liquidação na API Cobrança — corpo das chamadas igual ao da collection
// oficial (produção) e nenhuma credencial no código. Sem rede.
import { readFileSync } from 'node:fs'
import { identificacaoListagem, dataListagem } from '../../src/lib/banco/bradesco'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const id = identificacaoListagem({ cnpjBeneficiario: '11.438.390/0001-07', agencia: '2856', conta: '0230114-5', carteira: '09' })
ok(id.cpfCnpj.cpfCnpj === 11438390 && id.cpfCnpj.filial === 1 && id.cpfCnpj.controle === 7, 'cpfCnpj = raiz + filial + controle do CNPJ do beneficiário')
ok(id.negociacao === 28560230114, 'negociação = agência (4) + conta sem dígito (7)')
ok(id.produto === 9, 'produto = carteira')
ok(dataListagem('2026-09-25') === 25092026, 'datas das listagens em DDMMAAAA')

const src = readFileSync('src/lib/banco/bradesco/index.ts', 'utf8')
for (const p of ['/boleto/cobranca-lista/v1/listar', '/boleto/cobranca-consulta/v1/consultar', '/boleto/cobranca-baixado-consulta/v1/listar']) {
  ok(src.includes(`'${p}'`), `serviço ${p}`)
}
ok(/'authorization': token/.test(src) && !/Bearer/.test(src.slice(src.indexOf('consulta de liquidação'))), 'mesmo token do registro, no header Authorization (sem "Bearer")')
ok(!/client_secret\s*[:=]\s*['"][^'"]+['"]/.test(src) && !/senha\s*[:=]\s*['"][^'"]+['"]/i.test(src), 'nenhuma credencial escrita no código (vem do cofre)')

if (falhas) { console.error(`\ncheck-bradesco-liquidacao: ${falhas} falha(s)`); process.exit(1) }
console.log('\nBradesco · consulta de liquidação: ok')
