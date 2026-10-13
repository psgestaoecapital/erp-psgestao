// Gate (CEO 13/10 · Estoque › Inventário aberto · reduzir trabalho manual). Roda no build, sem rede:
//  - montarPreviaInventarioAberto casa por id, com fallback por código; recusa id que diverge do código; separa
//    "não encontrada", "fora do inventário" e "divergência"; marca o que sobrescreve contagem anterior;
//  - a tela traz subir planilha, filtros (divergência · não contados · busca nome/código/EAN · ordem por diferença),
//    adicionar produto e o "incluir itens zerados" ligado por padrão; nada chama fechar_inventario no modal de subida.
import { readFileSync } from 'node:fs'
import { montarPreviaInventarioAberto, type ItemInventarioAberto, type LeituraContagem } from '../../src/lib/estoque/planilhaContagem'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const prod = (n: number, codigo: string | null, estoque = 10) => ({ id: `00000000-0000-4000-a000-00000000000${n}`, codigo, nome: `Produto ${n}`, unidade: 'UN', estoque_atual: estoque })
const P = [prod(1, 'A1'), prod(2, 'B2'), prod(3, 'C3', 0), prod(4, 'D4'), prod(5, 'D4')]
const it = (n: number, contada: number | null = null): ItemInventarioAberto => ({
  item_id: `item-${n}`, produto_id: P[n - 1].id, codigo: P[n - 1].codigo, nome: P[n - 1].nome, quantidade_sistema: P[n - 1].estoque_atual, quantidade_contada: contada, custo_unitario: 2,
})
const itens = [it(1), it(2, 5), it(3)]
const l = (linha: number, id: string | null, codigo: string, quantidade: number) => ({ linha, id, codigo, descricao: `L${linha}`, quantidade, observacao: '' })
const leitura: LeituraContagem = {
  emBranco: 0, erros: [{ linha: 99, mensagem: 'inválida' }],
  linhas: [
    l(9, P[0].id, 'A1', 8),          // casa por id (diferença -2, valor -4)
    l(10, null, 'B2', 5),            // fallback por código; igual à contagem anterior → não sobrescreve
    l(11, P[2].id, 'C3', 3000),      // saldo 0 contado 3000 (caso Polipex)
    l(12, P[0].id, 'B2', 1),         // id de um, código de outro → divergência
    l(13, P[3].id, 'D4', 4),         // existe na empresa, fora do inventário
    l(14, '99999999-0000-4000-a000-000000000009', '', 1), // id desconhecido
    l(15, null, 'ZZZ', 1),           // código desconhecido
    l(16, null, 'D4', 1),            // código repetido no cadastro
  ],
}
const r = montarPreviaInventarioAberto(leitura, itens, P)
ok(r.linhas.length === 3, 'casa 3 linhas (id, código e saldo zero)')
const a = r.linhas.find((x) => x.produto_id === P[0].id)!
ok(a.diferenca === -2 && a.valor_diferenca === -4, 'diferença e valor contra o saldo do inventário')
ok(r.linhas.find((x) => x.produto_id === P[2].id)?.diferenca === 3000, 'item com saldo 0 contado 3000 entra')
ok(r.linhas.filter((x) => x.sobrescreve).length === 0, 'contagem igual à gravada não conta como sobrescrita')
ok(r.divergencias.length === 2 && r.divergencias.some((d) => d.linha === 12) && r.divergencias.some((d) => d.linha === 16), 'id×código divergente e código repetido viram divergência')
ok(r.foraDoInventario.length === 1 && r.foraDoInventario[0].linha === 13, 'produto da empresa fora do inventário é separado')
ok(r.naoEncontradas.length === 2, 'id/código desconhecidos = não encontradas')
ok(r.invalidas.length === 1, 'erros da leitura seguem para a prévia')

const pagina = readFileSync('src/app/dashboard/commerce/estoque/page.tsx', 'utf8')
const tools = readFileSync('src/components/estoque/InventarioAbertoTools.tsx', 'utf8')
ok(/inv-filtro/.test(pagina) && /inv-busca/.test(pagina) && /inv-ordem/.test(pagina) && /nao_contados/.test(pagina) && /codigo_barras/.test(pagina), 'filtros: divergência, não contados, busca nome/código/EAN, ordem por diferença')
ok(/inv-subir-planilha/.test(pagina) && /inv-adicionar-item/.test(pagina) && /inv-baixar-planilha/.test(pagina), 'drawer tem subir, baixar e adicionar')
ok(/useState\(true\)/.test(pagina.slice(pagina.indexOf('incluirZerados'), pagina.indexOf('incluirZerados') + 200)) && !/gt\('estoque_atual', 0\)\s*\n\s*\.order\('nome'\)\.order\('id'\)\.range\(de, ate\)\)\n\s*if \(cancelado\)/.test(pagina), 'iniciar inventário: itens zerados incluídos por padrão')
ok(!/fechar_inventario|movimentacao/i.test(tools), 'modais de subida/adição não ajustam estoque (só o Fechar inventário)')
ok(/estoque\.inventario\.subir_planilha/.test(tools) && /estoque\.inventario\.incluir_zerados/.test(pagina), '"?" nos campos novos (RD-95)')
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-inventario-aberto-planilha OK')
