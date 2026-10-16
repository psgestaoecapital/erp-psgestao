// Gate (#3255 Gean, pedido do CEO): na tela Cadastros › Produtos o "Novo produto" tem de estar à vista — antes era o
// último de 7 botões numa barra sem quebra de linha (flex-shrink-0) e ficava fora da tela. O produto novo nasce com
// código sugerido, NCM de 8 números e preço de venda; código repetido vira mensagem clara. Sem rede.
import { readFileSync } from 'node:fs'
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

const mig = readFileSync('supabase/migrations/20261017012020_ajuda_produto_novo.sql', 'utf8')
ok(/'cadastros\.produtos\.novo'/.test(mig) && /'cadastros\.produtos\.salvar_outro'/.test(mig) && /ON CONFLICT \(chave\) DO NOTHING/.test(mig), 'chaves do "?" cadastradas (aditivo)')

if (falhas) { console.error(`check-produto-novo: ${falhas} falha(s)`); process.exit(1) }
console.log('check-produto-novo: ok')
