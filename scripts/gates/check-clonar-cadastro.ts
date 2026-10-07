// Gate (Rodrigo · botão "Clonar" em Produtos e Serviços). Travas do código, sem rede — roda no build.
// Garante o contrato do clone: abre em modo NOVO pré-preenchido (nunca duplica silencioso), NÃO copia o código
// (serviço gera novo SRV; produto abre vazio pro usuário informar) e marca a descrição clonada com "(cópia)".
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const servForm = readFileSync('src/components/cadastros/ServicoForm.tsx', 'utf8')
const prodForm = readFileSync('src/components/cadastros/ProdutoForm.tsx', 'utf8')
const servPage = readFileSync('src/app/dashboard/cadastros/servicos/page.tsx', 'utf8')
const prodPage = readFileSync('src/app/dashboard/cadastros/produtos/page.tsx', 'utf8')

// 1) ServicoForm aceita clonar e trata o clone como NOVO (insert), não edição (update)
ok(servForm.includes('clonarDe?: Servico | null'), 'ServicoForm recebe clonarDe')
ok(servForm.includes('const ehClone = !servico && !!clonarDe'), 'ServicoForm: clone só quando servico é null')
ok(servForm.includes('const base = servico ?? clonarDe ?? null'), 'ServicoForm: valores iniciais vêm de base (servico|clonarDe)')
// o save continua decidindo insert/update por `servico` (não por base) — clone cai no insert
ok(/servico\s*\n?\s*\?\s*await supabase\.from\('erp_servicos'\)\.update/.test(servForm), 'ServicoForm: update só quando é edição (servico), clone faz insert')

// 2) ServicoForm NÃO copia o código no clone (fica vazio → efeito gera o próximo SRV)
ok(servForm.includes("const [codigo, setCodigo] = useState(servico?.codigo ?? '')"), 'ServicoForm: código do clone fica vazio (não copia de base)')
ok(servForm.includes("if (servico || codigo) return") && servForm.includes("fn_next_servico_codigo"), 'ServicoForm: em modo criar/clone gera o próximo SRV')

// 3) ServicoForm marca a descrição clonada com "(cópia)" e avisa o usuário
ok(servForm.includes('ehClone ? comCopia(base?.descricao_resumida)'), 'ServicoForm: descrição clonada recebe sufixo (cópia)')
ok(servForm.includes("`${(s ?? '').trim()} (cópia)`"), 'ServicoForm: comCopia aplica o sufixo (cópia)')
ok(servForm.includes('data-testid="servico-clone-aviso"'), 'ServicoForm: aviso de clone (nunca duplica silencioso)')
ok(servForm.includes('data-testid="servico-clonar-ficha"'), 'ServicoForm: botão Clonar na ficha (modo edição)')

// 4) ProdutoForm aceita clonar e trata o clone como NOVO (POST), não edição (PATCH)
ok(prodForm.includes('clonarDe?: Produto | null'), 'ProdutoForm recebe clonarDe')
ok(prodForm.includes('const ehClone = !produto && !!clonarDe'), 'ProdutoForm: clone só quando produto é null')
ok(prodForm.includes('const base = produto ?? clonarDe ?? null'), 'ProdutoForm: valores iniciais vêm de base (produto|clonarDe)')
ok(prodForm.includes("method: produto ? 'PATCH' : 'POST'"), 'ProdutoForm: clone faz POST (insert), não PATCH')

// 5) ProdutoForm NÃO copia o código (produto não tem gerador → abre vazio) e marca o nome com "(cópia)"
ok(prodForm.includes("const [codigo, setCodigo] = useState(produto?.codigo ?? '')"), 'ProdutoForm: código do clone fica vazio (usuário informa)')
ok(prodForm.includes('ehClone ? comCopia(base?.nome)'), 'ProdutoForm: nome clonado recebe sufixo (cópia)')
ok(prodForm.includes('data-testid="produto-clone-aviso"'), 'ProdutoForm: aviso de clone')
ok(prodForm.includes('data-testid="produto-clonar-ficha"'), 'ProdutoForm: botão Clonar na ficha (modo edição)')
// não reintroduz tributação suposta ao trocar produto?. por base?. (a mesma trava do gate fiscal)
ok(!/cst_icms \?\? '00'|cst_pis \?\? '01'|cst_cofins \?\? '01'/.test(prodForm), 'ProdutoForm: clone não supõe CST (00/01)')

// 6) Telas: botão Clonar na listagem + passam clonarDe/onClonar pro form
ok(servPage.includes('data-testid="servico-clonar"'), 'Serviços: botão Clonar na listagem')
ok(servPage.includes('clonarDe={clonando}') && servPage.includes('onClonar={'), 'Serviços: form recebe clonarDe e onClonar')
ok(prodPage.includes('data-testid="produto-clonar"'), 'Produtos: botão Clonar na listagem')
ok(prodPage.includes('clonarDe={clonando}') && prodPage.includes('onClonar={'), 'Produtos: form recebe clonarDe e onClonar')
// produto clona buscando a linha INTEIRA (select '*'), senão perderia os campos fiscais da view
ok(/async function clonarProduto\(id: string\)[\s\S]*?\.select\('\*'\)/.test(prodPage), 'Produtos: clone busca a linha completa (select *), não a parcial da lista')

if (falhas) { console.error(`\ncheck-clonar-cadastro: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-clonar-cadastro: ok')
