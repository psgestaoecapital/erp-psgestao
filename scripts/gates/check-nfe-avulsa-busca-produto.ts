/**
 * Gate (#3861, Gean): a busca de itens da NF-e avulsa acha QUALQUER produto ativo da empresa, não só os 500 primeiros.
 * A tela buscava 500 produtos em ordem alfabética e filtrava no navegador; "Turbina L200 2006" (1.760º da Gean) sumia.
 * Prova: palavras da busca (sem espaço duplo e sem caractere que quebra o filtro), todas no nome ou código, e a tela
 * consulta o banco com company_id + ativo a cada busca — nada de lista pré-carregada com limite.
 */
import { readFileSync } from 'node:fs'
import { termosBuscaProduto, filtroTermoProduto, filtroPrefixoProduto, juntarResultados, produtoCasaBusca } from '../../src/lib/fiscal/buscaProdutoAvulsa'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const turbina = { nome: 'Turbina  L200  2006', codigo: '714152001' }
const biela = { nome: 'BIELA DO MOTOR ONIX 1.0 12V ASP./TURBO / TRACKER 1.0 12V TURBO', codigo: 'DGBI01006' }

ok(produtoCasaBusca(turbina, 'Turb') && produtoCasaBusca(turbina, 'turb'), '"Turb"/"turb" acha a Turbina L200 2006')
ok(produtoCasaBusca(turbina, 'L200'), '"L200" acha a Turbina L200 2006')
ok(produtoCasaBusca(turbina, 'turbina l200'), '"turbina l200" acha mesmo com espaço duplo no cadastro')
ok(produtoCasaBusca(turbina, '714152'), 'busca pelo código acha')
ok(!produtoCasaBusca(turbina, 'turbina hilux'), 'todas as palavras precisam casar')
ok(produtoCasaBusca(biela, 'turb') && produtoCasaBusca(biela, 'dgbi01006'), 'biela (código DGBI01006, com I) continua achável')
ok(JSON.stringify(termosBuscaProduto('  a,(b)%  c_ ')) === JSON.stringify(['a', 'b', 'c']), 'termos sem vírgula, parênteses e curingas')
ok(termosBuscaProduto('   ').length === 0, 'busca vazia não consulta')
ok(filtroTermoProduto('L200') === 'nome.ilike.%L200%,codigo.ilike.%L200%', 'filtro: palavra no nome OU no código')
ok(filtroPrefixoProduto('Turb') === 'nome.ilike.Turb%,codigo.ilike.Turb%', 'prefixo: nome ou código começando com a palavra')
const ordem = juntarResultados([{ id: 't' }], [{ id: 'b' }, { id: 't' }])
ok(ordem.map((x) => x.id).join() === 't,b', '"começa com" vem antes de "contém", sem repetir')
ok(juntarResultados([], Array.from({ length: 60 }, (_, i) => ({ id: String(i) }))).length === 30, 'lista limitada a 30')

const tela = readFileSync('src/app/dashboard/fiscal/nfe/remessa/RemessaClient.tsx', 'utf8')
ok(!/\.limit\(500\)/.test(tela.split("from('erp_produtos')")[1]?.slice(0, 400) ?? ''), 'tela não pré-carrega 500 produtos')
const trecho = tela.slice(tela.indexOf("from('erp_produtos')"), tela.indexOf("from('erp_produtos')") + 400)
ok(trecho.includes(".eq('company_id', companyId)") && trecho.includes(".eq('ativo', true)"), 'consulta presa à empresa e a ativos')
ok(tela.includes('filtroPrefixoProduto(termos[0])') && tela.includes('juntarResultados('), 'tela põe "começa com" antes de "contém"')
ok(tela.includes('termosBuscaProduto(produtoBusca)') && tela.includes('filtroTermoProduto(t)'), 'tela busca no banco a cada digitação')
// #3861: além da busca, só o "Corrigir e reenviar" lê produtos — pelos códigos da nota recusada, nunca uma lista inteira
const consultasProduto = tela.split("from('erp_produtos')").slice(1)
ok(consultasProduto.length <= 2, 'no máximo 2 consultas de produtos (a busca e a do reenvio)')
ok(consultasProduto.every((c) => c.slice(0, 200).includes(".eq('company_id', companyId)") && c.slice(0, 200).includes(".eq('ativo', true)") && (c.slice(0, 200).includes(".in('codigo', codigos)") || !/\.in\(/.test(c.slice(0, 200)))),
  'toda consulta de produtos é presa à empresa e a ativos')

if (falhas) { console.error(`\n${falhas} falha(s) no gate da busca de produto da NF-e avulsa`); process.exit(1) }
console.log('\nGate busca de produto da NF-e avulsa: ok')
