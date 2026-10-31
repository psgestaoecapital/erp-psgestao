// Gate (#3255 Gean, pedido do CEO): na tela Cadastros › Produtos o "Novo produto" tem de estar à vista — antes era o
// último de 7 botões numa barra sem quebra de linha (flex-shrink-0) e ficava fora da tela. O produto novo nasce com
// código sugerido, NCM de 8 números e preço de venda; código repetido vira mensagem clara. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'
import { sugerirProximoCodigo, validarProdutoNovo } from '../../src/lib/produtos/proximoCodigo'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

ok(sugerirProximoCodigo(['PROD-041', 'PROD-009', 'X-7']) === 'PROD-042', 'sugere o próximo do prefixo do último cadastrado')
ok(sugerirProximoCodigo(['1557015', '1557020', '33']) === '1557021', 'código só numérico: maior + 1')
ok(sugerirProximoCodigo(['A-009']) === 'A-010', 'mantém os zeros à esquerda')
ok(sugerirProximoCodigo(['SEMNUMERO']) === '' && sugerirProximoCodigo([]) === '', 'sem número → sem sugestão')
ok(sugerirProximoCodigo(['99999999999999999999']) === '100000000000000000000', 'número grande não perde precisão')

const base = { codigo: 'PROD-1', nome: 'Filtro de óleo', ncm: '87089990', precoVenda: '89.90' }
ok(validarProdutoNovo(base) === null, 'produto completo passa')
ok(/preço de venda/.test(validarProdutoNovo({ ...base, precoVenda: '0' }) ?? ''), 'sem preço de venda não grava')
ok(/NCM/.test(validarProdutoNovo({ ...base, ncm: '8708' }) ?? ''), 'NCM incompleto não grava')
ok(validarProdutoNovo({ ...base, ncm: '' }) === null, 'NCM vazio continua permitido (pendência fiscal fica na lista)')
ok(validarProdutoNovo({ ...base, precoVenda: '12,5' }) === null, 'aceita vírgula no preço')

const page = readFileSync('src/app/dashboard/cadastros/produtos/page.tsx', 'utf8')
const barra = page.slice(page.indexOf('<header'), page.indexOf('</header>'))
ok(!/flex-shrink-0 flex-wrap/.test(barra) && /flex-wrap lg:justify-end min-w-0/.test(barra), 'a barra de ações quebra linha (não empurra botão para fora da tela)')
const iNovo = barra.indexOf('data-testid="produto-novo"')
ok(iNovo > 0 && iNovo < barra.indexOf('data-testid="etiquetas-abrir"'), '"Novo produto" é o primeiro botão da barra')
ok(/chave="cadastros\.produtos\.novo"/.test(barra), '"Novo produto" tem o "?"')

const form = readFileSync('src/components/cadastros/ProdutoForm.tsx', 'utf8')
ok(/data-testid="produto-salvar-outro"/.test(form) && /onSalvo\(cadastrarOutro\)/.test(form), 'formulário tem "Salvar e cadastrar outro"')
ok(/validarProdutoNovo\(/.test(form) && /sugerirProximoCodigo\(/.test(form), 'formulário valida o produto novo e sugere o código')

const api = readFileSync('src/app/api/cadastros/produtos/route.ts', 'utf8')
ok((api.match(/mensagemErro\(error, body\.codigo\)/g) ?? []).length === 2 && /'23505'/.test(api), 'código repetido vira mensagem clara no incluir e no editar')

// acha a migration pelo nome (sem fixar a versão): a fila de merge pode renumerá-la sozinha
const migArq = readdirSync('supabase/migrations').find((f) => f.endsWith('_ajuda_produto_novo.sql'))
ok(!!migArq, 'migration das chaves do "?" presente')
const mig = migArq ? readFileSync(`supabase/migrations/${migArq}`, 'utf8') : ''
ok(/'cadastros\.produtos\.novo'/.test(mig) && /'cadastros\.produtos\.salvar_outro'/.test(mig) && /ON CONFLICT \(chave\) DO NOTHING/.test(mig), 'chaves do "?" cadastradas (aditivo)')

console.log('check-produto-novo: ok')

// #3255 (etapa estoque): o formulário tem mínimo/máximo, unidade de compra, fator, prazo, lote e validade, cada um com "?".
const formEst = readFileSync('src/components/cadastros/ProdutoForm.tsx', 'utf8')
for (const c of ['estoque_minimo','estoque_maximo','unidade_compra','fator_conversao','prazo_entrega','fornecedor_padrao','controla_lote','controla_validade']) {
  ok(formEst.includes(`chave="cadastros.produtos.${c}"`), `campo ${c} tem o "?"`)
  const mig = readdirSync('supabase/migrations').filter((f) => (f.endsWith('_produto_estoque_ajuda.sql') || f.endsWith('_produto_fornecedor_padrao_ajuda.sql'))).map((f) => readFileSync('supabase/migrations/' + f, 'utf8')).join('')
  ok(mig.includes(`'cadastros.produtos.${c}'`), `chave ${c} existe na migration de ajuda`)
}
ok(/estoque máximo não pode ser menor/.test(formEst), 'máximo menor que o mínimo não grava')
if (falhas) { console.error(`check-produto-novo: ${falhas} falha(s)`); process.exit(1) }
