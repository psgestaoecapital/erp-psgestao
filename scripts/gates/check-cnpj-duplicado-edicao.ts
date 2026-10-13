/**
 * Gate de build · #129/#130 (Jordana · KGF/Gean): a checagem de CNPJ/CPF duplicado no cadastro de clientes e
 * fornecedores (1) só considera cadastros ATIVOS e (2) na edição só roda se o documento mudou — editar o próprio
 * cadastro não pode disparar "criar um duplicado?" e perder a correção.
 *   tsx scripts/check-cnpj-duplicado-edicao.ts
 */
import { readFileSync } from 'node:fs'
import { deveConferirDuplicidade } from '../../src/lib/cadastros/duplicidadeDocumento'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

ok(deveConferirDuplicidade(null, '76.324.029/0001-90') === true, 'inclusão com CNPJ confere duplicidade')
ok(deveConferirDuplicidade(null, '') === false, 'inclusão sem documento não confere')
ok(deveConferirDuplicidade({ id: 'x', cnpj_cpf: '76324029000190' }, '76.324.029/0001-90') === false,
  'edição sem mudar o CNPJ (mesmo com máscara) não confere — caso do #130')
ok(deveConferirDuplicidade({ id: 'x', cnpj_cpf: '76324029000190' }, '11.222.333/0001-81') === true, 'edição que troca o CNPJ confere')
ok(deveConferirDuplicidade({ id: 'x', cnpj_cpf: null }, '76324029000190') === true, 'edição que informa CNPJ pela primeira vez confere')

const form = readFileSync('src/components/cadastros/PessoaForm.tsx', 'utf8')
const bloco = form.slice(form.indexOf('if (deveConferirDuplicidade('), form.indexOf('const faltando = enderecoIncompleto'))
ok(bloco.length > 0, 'o formulário usa deveConferirDuplicidade antes de consultar')
ok(/\.eq\('ativo', true\)/.test(bloco), 'a consulta de duplicidade ignora cadastros inativos')
ok(/\.neq\('id', /.test(bloco), 'a consulta exclui o próprio cadastro')

if (falhas > 0) { console.error(`\n[check-cnpj-duplicado-edicao] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-cnpj-duplicado-edicao] checagem de CNPJ duplicado conferida.')
