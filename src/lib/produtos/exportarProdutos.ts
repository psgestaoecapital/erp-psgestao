import ExcelJS from 'exceljs'

// Exportar produtos (.xlsx) — CEO 13/10 (urgente FCR/FC Pisos). RD-26: o arquivo RE-IMPORTA pela tela
// "Importar estoque (planilha)" porque a LINHA DE CHAVES da aba "Produtos" usa as MESMAS chaves técnicas da planilha
// padrão (src/lib/estoque/colunasImportacao.ts). O importador lê a 1ª aba cujo nome começa com "estoque" OU, não
// achando, a 1ª aba — por isso a aba principal é "Produtos" (1ª) e a de saldo NÃO começa com "estoque".
// Os dados são SERVIDOS pela RPC fn_produtos_exportar (Pilar 2: custo/valor só vêm para quem pode ver; auditoria no banco).

type Cell = string | number | boolean | null | undefined

export interface ExportProdutosResult {
  ok?: boolean
  empresa?: { razao_social?: string | null; nome_fantasia?: string | null; cnpj?: string | null } | null
  gerado_em?: string
  pode_ver_custo?: boolean
  total_itens?: number
  valor_estoque?: number | null
  produtos?: Record<string, Cell>[]
  estoque_por_local?: Record<string, Cell>[]
}

// Aba "Produtos", em ordem. `custo` = coluna só exportada para quem pode ver custo (a RPC já não manda esses campos).
const COLS_PRODUTOS: { key: string; custo?: boolean }[] = [
  { key: 'codigo' }, { key: 'codigo_barras' }, { key: 'nome' }, { key: 'tipo' },
  { key: 'categoria' }, { key: 'subcategoria' }, { key: 'marca' }, { key: 'grupo' },
  { key: 'unidade' }, { key: 'unidade_compra' }, { key: 'fator_conversao' }, { key: 'ativo' },
  { key: 'preco_venda' },
  { key: 'custo_medio', custo: true }, { key: 'preco_custo', custo: true }, { key: 'comissao_percentual', custo: true },
  { key: 'estoque_atual' }, { key: 'estoque_minimo' }, { key: 'estoque_maximo' }, { key: 'localizacao' },
  { key: 'valor_estoque', custo: true },
  { key: 'ncm' }, { key: 'cest' }, { key: 'origem' },
  { key: 'cfop_venda' }, { key: 'cfop_venda_interestadual' }, { key: 'cfop_compra' },
  { key: 'cst_icms' }, { key: 'cst_pis' }, { key: 'cst_cofins' },
  { key: 'aliquota_icms' }, { key: 'aliquota_ipi' }, { key: 'aliquota_pis' }, { key: 'aliquota_cofins' },
  { key: 'tipo_item_sped' }, { key: 'fornecedor_padrao_nome' }, { key: 'prazo_entrega_dias' },
  { key: 'peso_bruto' }, { key: 'peso_liquido' }, { key: 'largura_cm' }, { key: 'altura_cm' }, { key: 'profundidade_cm' },
  { key: 'controla_lote' }, { key: 'controla_validade' }, { key: 'id' },
]

// Numéricos: vírgula decimal, SEM separador de milhar e SEM arredondar → reimporta igual (parseNum do importador).
const NUM = new Set([
  'fator_conversao', 'preco_venda', 'custo_medio', 'preco_custo', 'comissao_percentual',
  'estoque_atual', 'estoque_minimo', 'estoque_maximo', 'valor_estoque',
  'aliquota_icms', 'aliquota_ipi', 'aliquota_pis', 'aliquota_cofins',
  'peso_bruto', 'peso_liquido', 'largura_cm', 'altura_cm', 'profundidade_cm',
  'saldo', 'valor',
])

// Toda célula é TEXTO: preserva zeros à esquerda do código e mostra número com vírgula decimal.
const cel = (key: string, v: Cell): string => {
  if (v === null || v === undefined || v === '') return ''
  if (NUM.has(key)) return String(v).replace('.', ',')
  return String(v)
}

const brMoeda = (n: number | null | undefined): string =>
  n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function baixar(wb: ExcelJS.Workbook, nome: string): Promise<void> {
  return wb.xlsx.writeBuffer().then((buf) => {
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = nome
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  })
}

const douradoHeader = (row: ExcelJS.Row) => {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8941A' } } })
}

export async function exportarProdutosXlsx(res: ExportProdutosResult): Promise<{ nomeArquivo: string; linhas: number }> {
  const custo = res.pode_ver_custo !== false
  const cols = COLS_PRODUTOS.filter((c) => custo || !c.custo)
  const empresa = res.empresa ?? {}
  const nomeEmp = String(empresa.nome_fantasia || empresa.razao_social || 'empresa')
  const d = new Date()
  const p2 = (n: number) => String(n).padStart(2, '0')
  const ts = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`
  const slug = nomeEmp.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'empresa'
  const nomeArquivo = `produtos_${slug}_${ts}.xlsx`

  const wb = new ExcelJS.Workbook()

  // ── Aba 1 "Produtos" (re-importável; é a 1ª aba) ──
  const ws = wb.addWorksheet('Produtos')
  const larg = Math.max(1, cols.length)
  const titulo = (txt: string, bold = false, size = 11) => {
    const r = ws.addRow([txt])
    ws.mergeCells(r.number, 1, r.number, larg)
    r.getCell(1).font = { bold, size, color: { argb: 'FF3D2314' } }
  }
  titulo('PS Gestão · Produtos', true, 14)
  titulo(`${empresa.razao_social ?? nomeEmp}${empresa.cnpj ? '  ·  CNPJ ' + empresa.cnpj : ''}`)
  titulo(`Gerado em ${d.toLocaleString('pt-BR')}  ·  ${res.total_itens ?? (res.produtos?.length ?? 0)} itens`
    + (custo ? `  ·  valor em estoque ${brMoeda(res.valor_estoque ?? 0)}` : '  ·  valores ocultos (sem permissão de ver custo)'))
  ws.addRow([])
  // LINHA DE CHAVES técnicas (o importador procura a linha com 'codigo' e 'nome')
  douradoHeader(ws.addRow(cols.map((c) => c.key)))
  for (const prod of res.produtos ?? []) {
    const r = ws.addRow(cols.map((c) => cel(c.key, prod[c.key])))
    r.eachCell((c) => { c.alignment = { horizontal: 'left' } })
  }
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = Math.min(Math.max(c.key.length + 2, 12), 44) })

  // ── Aba 2 "Saldo por local" (NÃO começa com "estoque", para não confundir o importador) ──
  const ws2 = wb.addWorksheet('Saldo por local')
  const cols2 = ['codigo', 'nome', 'local', 'saldo', ...(custo ? ['custo_medio', 'valor'] : [])]
  douradoHeader(ws2.addRow(cols2))
  for (const e of res.estoque_por_local ?? []) ws2.addRow(cols2.map((k) => cel(k, e[k])))
  cols2.forEach((k, i) => { ws2.getColumn(i + 1).width = Math.min(Math.max(k.length + 2, 12), 44) })

  await baixar(wb, nomeArquivo)
  return { nomeArquivo, linhas: res.produtos?.length ?? 0 }
}
