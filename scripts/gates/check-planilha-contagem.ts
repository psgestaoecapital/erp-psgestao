// Gate (CEO 01/10 · Estoque › Inventário · planilha de contagem). Roda no build, sem rede:
//  - ida: a planilha sai A4, com cabeçalho (empresa, data/hora do saldo, local, contado/conferido por) e as colunas do
//    pedido; na contagem cega o saldo do sistema NÃO vai para o arquivo (nem oculto) e a diferença some junto;
//  - volta: lê o que foi preenchido (vírgula decimal, zero vale, branco = não contado), recusa quantidade inválida,
//    linha repetida e produto de fora; a prévia compara com o saldo ATUAL (não o do arquivo);
//  - nada ajusta sem confirmação: o modal de subida só cria o inventário (erp_inventarios + RPC da contagem) — não chama
//    fechar_inventario nem movimenta estoque; a tela tem os dois botões na aba Inventário que já existe (RD-26).
import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
import {
  gerarPlanilhaContagem, lerPlanilhaContagem, montarPrevia, colunasContagem,
  ABA_CONTAGEM, LINHA_CHAVES, PRIMEIRA_LINHA_DADOS, type ProdutoContagem,
} from '../../src/lib/estoque/planilhaContagem'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const P: (ProdutoContagem & { preco_custo_medio: number })[] = [
  { id: '00000000-0000-4000-a000-000000000001', codigo: 'A-100', codigo_barras: '7891234567895', nome: 'Argamassa AC-III 20kg', unidade: 'SC', localizacao: 'Prateleira 3', estoque_atual: 7331, preco_custo_medio: 10 },
  { id: '00000000-0000-4000-a000-000000000002', codigo: 'B-200', codigo_barras: null, nome: 'Rejunte epóxi cinza 1kg', unidade: 'UN', localizacao: null, estoque_atual: 12.5, preco_custo_medio: 4 },
  { id: '00000000-0000-4000-a000-000000000003', codigo: 'C-300', codigo_barras: null, nome: 'Primer PU bicomponente', unidade: 'KG', localizacao: null, estoque_atual: 3, preco_custo_medio: 50 },
]
const base = { empresa: 'EMPRESA TESTE LTDA', cnpj: '00.000.000/0001-00', local: 'Depósito Central', saldoEm: new Date(2026, 9, 1, 14, 30) }

async function abrir(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  return wb.getWorksheet(ABA_CONTAGEM)!
}
const chaves = (ws: ExcelJS.Worksheet) => { const k: string[] = []; ws.getRow(LINHA_CHAVES).eachCell((c) => k.push(String(c.value))); return k }
const todoTexto = (ws: ExcelJS.Worksheet) => { const t: string[] = []; ws.eachRow((r) => r.eachCell((c) => t.push(String((c.value as { formula?: string })?.formula ?? c.value)))); return t.join(' | ') }

async function main() {
  // ── ida, contagem aberta
  const aberta = await abrir(await gerarPlanilhaContagem({ ...base, cega: false, produtos: P }))
  ok(aberta.pageSetup.paperSize === 9 && aberta.pageSetup.orientation === 'portrait' && aberta.pageSetup.fitToWidth === 1, 'A4 retrato, cabe na largura')
  const txtA = todoTexto(aberta)
  ok(txtA.includes('EMPRESA TESTE LTDA') && txtA.includes('Depósito Central') && txtA.includes('01/10/2026') && txtA.includes('14:30'), 'cabeçalho com empresa, local e data/hora do saldo')
  ok(/Contado por:/.test(txtA) && /Conferido por:/.test(txtA), 'espaço para "contado por" e "conferido por"')
  ok(JSON.stringify(chaves(aberta)) === JSON.stringify(['codigo', 'codigo_barras', 'descricao', 'unidade', 'local', 'saldo_sistema', 'quantidade_contada', 'diferenca', 'observacao', 'id']),
    'colunas: código, código de barras, descrição, unidade, local, saldo, QUANTIDADE CONTADA, diferença, observação (+ id oculto)')
  const cQ = colunasContagem(false).findIndex((c) => c.chave === 'quantidade_contada') + 1
  const cD = colunasContagem(false).findIndex((c) => c.chave === 'diferenca') + 1
  const cId = colunasContagem(false).findIndex((c) => c.chave === 'id') + 1
  const l1 = aberta.getRow(PRIMEIRA_LINHA_DADOS)
  ok(l1.getCell(cQ).value == null, 'QUANTIDADE CONTADA sai em branco')
  ok(/IF\(G9="","",G9-F9\)/.test(String((l1.getCell(cD).value as { formula?: string })?.formula)), 'diferença é fórmula (contada − saldo), vazia enquanto não contar')
  ok(aberta.getColumn(cId).hidden === true, 'coluna id oculta')
  ok(String(aberta.getRow(PRIMEIRA_LINHA_DADOS + 1).getCell(5).value) === 'Depósito Central' && String(l1.getCell(5).value) === 'Prateleira 3', 'local = posição do produto, ou o local escolhido')

  // ── ida, contagem cega (padrão da tela)
  const cegaBytes = await gerarPlanilhaContagem({ ...base, cega: true, produtos: P })
  const cega = await abrir(cegaBytes)
  const kC = chaves(cega)
  ok(!kC.includes('saldo_sistema') && !kC.includes('diferenca'), 'contagem cega: sem coluna de saldo e sem diferença')
  const txtC = todoTexto(cega)
  ok(!txtC.includes('7331') && !/\b12\.5\b/.test(txtC), 'contagem cega: o saldo do sistema não está em lugar nenhum do arquivo')

  // ── volta: preenche como o estoquista (cega)
  const cQc = kC.indexOf('quantidade_contada') + 1, cObs = kC.indexOf('observacao') + 1
  const r = (i: number) => cega.getRow(PRIMEIRA_LINHA_DADOS + i)
  r(0).getCell(cQc).value = 7330            // falta 1
  r(0).getCell(cObs).value = '1 saco rasgado'
  r(1).getCell(cQc).value = '13,5'           // sobra 1 (vírgula)
  // r(2) em branco = não contado
  const extra = PRIMEIRA_LINHA_DADOS + 3
  cega.getRow(extra).getCell(1).value = 'C-300'            // linha digitada à mão (sem id) casando pelo código
  cega.getRow(extra).getCell(3).value = 'Primer PU bicomponente'
  cega.getRow(extra).getCell(cQc).value = 0                // zero vale
  cega.getRow(extra + 1).getCell(1).value = 'ZZ-999'        // produto que não existe
  cega.getRow(extra + 1).getCell(cQc).value = 2
  cega.getRow(extra + 2).getCell(1).value = 'B-200'         // inválida
  cega.getRow(extra + 2).getCell(cQc).value = '-3'
  const wb = cega.workbook
  const cheio = new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer)
  const lida = await lerPlanilhaContagem(cheio)
  ok(lida.linhas.length === 4 && lida.emBranco === 1, `lê 4 contagens e ignora 1 linha em branco (lidas ${lida.linhas.length}, branco ${lida.emBranco})`)
  ok(lida.erros.length === 1 && /inválida/.test(lida.erros[0].mensagem), 'quantidade negativa vira erro de linha')
  ok(lida.linhas[1].quantidade === 13.5, 'vírgula decimal lida (13,5)')

  // saldo mudou entre a ida e a volta: a prévia usa o ATUAL
  const atuais = P.map((p) => ({ ...p, estoque_atual: p.codigo === 'A-100' ? 7329 : p.estoque_atual }))
  const pv = montarPrevia(lida, atuais)
  const d = (cod: string) => pv.itens.find((i) => i.codigo === cod)
  ok(d('A-100')?.sistema === 7329 && d('A-100')?.diferenca === 1, 'prévia compara com o saldo atual do sistema (7329 → contado 7330 = +1)')
  ok(d('B-200')?.diferenca === 1 && d('C-300')?.diferenca === -3 && d('C-300')?.valor_diferenca === -150, 'sobra, falta e valor pela diferença × custo médio')
  ok(d('A-100')?.observacao === '1 saco rasgado', 'observação da linha segue para o item')
  ok(pv.erros.some((e) => /ZZ-999/.test(e.mensagem)), 'produto de fora da empresa não entra (erro na prévia)')
  ok(pv.totais.contados === 3 && pv.totais.sobras === 2 && pv.totais.faltas === 1, 'totais da prévia (3 contados: 2 sobras, 1 falta)')
  const dup = montarPrevia({ linhas: [lida.linhas[0], { ...lida.linhas[0], linha: 99, id: null, codigo: 'A-100' }], erros: [], emBranco: 0 }, atuais)
  ok(dup.itens.length === 1 && dup.erros.length === 1, 'mesmo produto em duas linhas: entra uma, a outra vira erro')
  const outro = new ExcelJS.Workbook(); outro.addWorksheet('Planilha1').getCell('A1').value = 'x'
  const semAba = await lerPlanilhaContagem(new Uint8Array(await outro.xlsx.writeBuffer() as ArrayBuffer))
  ok(semAba.linhas.length === 0 && semAba.erros.length === 1 && /Contagem/.test(semAba.erros[0].mensagem), 'arquivo sem a aba Contagem é recusado com mensagem')

  // ── id desalinhado (ordenar só as colunas visíveis): chave = código, divergência recusa a linha
  const lin = (linha: number, id: string | null, codigo: string, q: number) => ({ linha, id, codigo, descricao: codigo, quantidade: q, observacao: '' })
  const desal = montarPrevia({ linhas: [lin(9, P[1].id, 'A-100', 5), lin(10, P[0].id, 'B-200', 6), lin(11, P[2].id, 'C-300', 7), lin(12, null, 'B-200', 8)], erros: [], emBranco: 0 }, atuais)
  ok(desal.itens.length === 2 && desal.itens.some((i) => i.codigo === 'C-300') && desal.itens.some((i) => i.codigo === 'B-200' && i.contado === 8), 'id que não bate com o código: linha recusada; sem id casa pelo código')
  ok(desal.erros.length === 2 && desal.erros.every((e) => /recusada/.test(e.mensagem)), 'divergência listada no relatório (nunca ajusta)')

  // ── tela: nada ajusta sem confirmação
  const modal = readFileSync('src/components/estoque/PlanilhaContagemInventario.tsx', 'utf8')
  ok(!/fechar_inventario|fn_movimentar_estoque|registrar_movimento_estoque|erp_estoque_movimentacoes/.test(modal), 'subida da planilha não ajusta estoque (sem fechar_inventario / movimentação)')
  ok(/fn_inventario_registrar_contagem/.test(modal) && /from\('erp_inventarios'\)\.insert/.test(modal), 'contagens pelo caminho oficial (inventário + RPC da contagem)')
  ok(/data-testid="contagem-previa"/.test(modal) && /Nada foi gravado ainda/.test(modal), 'prévia das diferenças antes de gravar')
  ok(/useMemo\(\(\) => \(leitura && produtos \? montarPrevia\(leitura, produtos\) : null\)/.test(modal) && !/if \(!produtos\) return/.test(modal),
    'arquivo escolhido antes da lista de produtos carregar não se perde (a prévia sai quando os dois chegam)')
  const pagina = readFileSync('src/app/dashboard/commerce/estoque/page.tsx', 'utf8')
  ok(/inventario-baixar-planilha/.test(pagina) && /inventario-subir-planilha/.test(pagina) && /estoque-inventario-btn/.test(pagina), 'botões na aba Inventário existente, ao lado de Iniciar inventário')
  ok(/useState\(true\)[^\n]*\n[^\n]*const \[cega, setCega\] = useState\(true\)/.test(modal), 'padrões: só com saldo = sim, contagem cega = sim')
  ok(/const ultimo = \(itens as[^\n]*\.at\(-1\)[\s\S]{0,300}fn_inventario_registrar_contagem/.test(modal),
    'depois das gravações em paralelo, uma última sozinha refaz os totais (contados/divergências não saem a menor)')

  if (falhas) { console.error(`\n${falhas} falha(s) na planilha de contagem`); process.exit(1) }
  console.log('\nPlanilha de contagem do inventário: ok')
}
void main().catch((e) => { console.error(e); process.exit(1) })
