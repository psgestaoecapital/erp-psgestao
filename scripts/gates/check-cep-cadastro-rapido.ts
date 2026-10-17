// Gate (#2982 Proplay): o cadastro rápido de cliente (ClienteForm, atalho da receita e da visita) grava o CEP só com
// dígitos, igual à tela de Cadastros. A ReceitaWS devolve "89.900-000" e a coluna erp_clientes.cep é varchar(9):
// gravar o texto formatado falhava com "value too long" e nada era salvo (nem IBGE nem número). Sem rede.
import { readFileSync } from 'node:fs'
import { normalizarCep } from '../../src/lib/cadastro/cep'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

ok(normalizarCep('89.900-000') === '89900000', 'CEP com ponto e hífen (ReceitaWS) vira 8 dígitos')
ok(normalizarCep('89900-000') === '89900000', 'CEP com hífen vira 8 dígitos')
ok(normalizarCep('89900000') === '89900000', 'CEP só com dígitos fica igual')
ok(normalizarCep(undefined) === '' && normalizarCep(null) === '', 'CEP vazio grava vazio')
ok(normalizarCep('89.900-000').length <= 9, 'cabe na coluna varchar(9)')

const form = readFileSync('src/components/clientes/ClienteForm.tsx', 'utf8')
ok(/cep: cepDigits,/.test(form), 'ClienteForm grava o CEP normalizado (cepDigits)')
ok(!/cep: form\.cep \?\? ''/.test(form), 'ClienteForm não grava mais o CEP como digitado')

if (falhas) { console.error(`check-cep-cadastro-rapido: ${falhas} falha(s)`); process.exit(1) }
console.log('check-cep-cadastro-rapido: ok')
