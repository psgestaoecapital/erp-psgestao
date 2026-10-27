// Planilha de contagem do inventário (CEO 01/10 · Estoque › aba Inventário, que já existe — RD-26: nada recriado).
// Ida: "Baixar planilha de contagem" gera um .xlsx A4 com os itens em estoque (cabeçalho com empresa, data/hora do saldo,
// local, "contado por" / "conferido por"; colunas código, código de barras, descrição, unidade, local, saldo no sistema,
// QUANTIDADE CONTADA em branco, diferença em fórmula, observação). "Contagem cega" (padrão ligado) esconde o saldo do
// sistema — a coluna nem vai para o arquivo, e a diferença fica para a prévia na volta.
// Volta: a planilha preenchida é lida sem gravar nada (lerPlanilhaContagem) e montarPrevia compara com o saldo ATUAL
// do sistema. A tela mostra a prévia das diferenças; o inventário só é criado com as contagens depois de confirmar, e o
// estoque só é ajustado no "Fechar inventário" (outra confirmação), pelo caminho que já existe (fechar_inventario).
// Contrato: linha LINHA_CHAVES = chaves técnicas (cinza); dados a partir de PRIMEIRA_LINHA_DADOS. A chave é o CÓDIGO; a coluna 'id' (uuid do
// produto, oculta) só confere — id que não bate com o código recusa a linha (ordenar só as colunas visíveis desalinha o id).

import ExcelJS from 'exceljs'

export const ABA_CONTAGEM = 'Contagem'
export const LINHA_CHAVES = 8
export const PRIMEIRA_LINHA_DADOS = 9

export interface ColunaContagem { chave: string; titulo: string; largura: number }

const COL_SALDO: ColunaContagem = { chave: 'saldo_sistema', titulo: 'Saldo no sistema', largura: 11 }
const COL_DIFERENCA: ColunaContagem = { chave: 'diferenca', titulo: 'Diferença', largura: 10 }

/** Colunas na ordem do arquivo. Contagem cega tira o saldo do sistema e a diferença (que o revelaria). */
export function colunasContagem(cega: boolean): ColunaContagem[] {
  return [
    { chave: 'codigo', titulo: 'Código', largura: 16 },
    { chave: 'codigo_barras', titulo: 'Código de barras', largura: 15 },
    { chave: 'descricao', titulo: 'Descrição', largura: 40 },
    { chave: 'unidade', titulo: 'Un.', largura: 5 },
    { chave: 'local', titulo: 'Local', largura: 14 },
    ...(cega ? [] : [COL_SALDO]),
    { chave: 'quantidade_contada', titulo: 'QUANTIDADE CONTADA', largura: 13 },
    ...(cega ? [] : [COL_DIFERENCA]),
    { chave: 'observacao', titulo: 'Observação', largura: 24 },
    { chave: 'id', titulo: 'id', largura: 4 },
  ]
}

export interface ProdutoContagem {
  id: string
  codigo: string | null
  codigo_barras: string | null
  nome: string
  unidade: string | null
  localizacao: string | null
  estoque_atual: number | null
}

export interface DadosPlanilhaContagem {
  empresa: string
  cnpj?: string | null
  local: string
  /** momento do saldo (quando a lista foi lida do sistema) */
  saldoEm: Date
  filtros?: string
  cega: boolean
  produtos: ProdutoContagem[]
}

const MARROM = 'FF3D2314'
const DOURADO = 'FFC8941A'
const CREME = 'FFFAF7F2'
const CINZA = 'FF8A7A6E'
const AMARELO = 'FFFFF8E1'
const BORDA = { style: 'thin' as const, color: { argb: 'FFBFB3A3' } }
const BORDAS = { top: BORDA, left: BORDA, bottom: BORDA, right: BORDA }

function letra(n: number): string {
  let s = ''
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s
  return s
}

const dataHora = (d: Date) =>
  d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Gera o .xlsx de contagem (A4 retrato, cabeçalho repetido em toda página). */
export async function gerarPlanilhaContagem(d: DadosPlanilhaContagem): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'PS Gestão'
  const cols = colunasContagem(d.cega)
  const n = cols.length
  const col = (chave: string) => cols.findIndex((c) => c.chave === chave) + 1
  const ws = wb.addWorksheet(ABA_CONTAGEM, {
    pageSetup: {
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 },
      printTitlesRow: `${LINHA_CHAVES - 1}:${LINHA_CHAVES - 1}`,
    },
    headerFooter: { oddFooter: `&L${d.empresa} · contagem de inventário&RPágina &P de &N` },
  })
  ws.columns = cols.map((c) => ({ width: c.largura }))
  ws.getColumn(col('id')).hidden = true
  const ultimaVisivel = n - 1

  const faixa = (r: number, texto: string, fonte: Partial<ExcelJS.Font>) => {
    ws.mergeCells(r, 1, r, ultimaVisivel)
    const c = ws.getCell(r, 1)
    c.value = texto
    c.font = fonte
  }
  faixa(1, d.empresa + (d.cnpj ? ` · CNPJ ${d.cnpj}` : ''), { bold: true, size: 11, color: { argb: MARROM } })
  faixa(2, 'CONTAGEM DE INVENTÁRIO' + (d.cega ? ' · contagem cega' : ''), { bold: true, size: 15, color: { argb: DOURADO } })
  faixa(3, `Local: ${d.local}   ·   Saldo do sistema em: ${dataHora(d.saldoEm)}   ·   ${d.produtos.length} item(ns)` +
    (d.filtros ? `   ·   ${d.filtros}` : ''), { size: 10, color: { argb: MARROM } })
  // linhas para assinatura/nome à mão
  const meio = Math.max(2, Math.ceil(ultimaVisivel / 2))
  ws.mergeCells(4, 1, 4, meio)
  ws.getCell(4, 1).value = 'Contado por: ____________________________   Data: ___/___/______'
  ws.mergeCells(4, meio + 1, 4, ultimaVisivel)
  ws.getCell(4, meio + 1).value = 'Conferido por: ____________________________'
  ws.getRow(4).height = 22
  ws.getRow(4).font = { size: 10, color: { argb: MARROM } }
  faixa(5, d.cega
    ? 'Escreva só a quantidade encontrada na coluna QUANTIDADE CONTADA (deixe em branco o que não contou). Não altere as linhas 7 e 8.'
    : 'Escreva a quantidade encontrada na coluna QUANTIDADE CONTADA; a diferença calcula sozinha. Não altere as linhas 7 e 8.',
  { italic: true, size: 9, color: { argb: 'FF6B4B33' } })

  cols.forEach((c, i) => {
    const h = ws.getCell(LINHA_CHAVES - 1, i + 1)
    h.value = c.titulo
    h.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } }
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MARROM } }
    h.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    h.border = BORDAS
    const k = ws.getCell(LINHA_CHAVES, i + 1)
    k.value = c.chave
    k.font = { size: 6, color: { argb: CINZA } }
    k.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CREME } }
  })
  ws.getRow(LINHA_CHAVES - 1).height = 28
  ws.views = [{ state: 'frozen', ySplit: LINHA_CHAVES }]

  const cQtd = col('quantidade_contada'), cSaldo = col('saldo_sistema'), cDif = col('diferenca')
  d.produtos.forEach((p, i) => {
    const r = PRIMEIRA_LINHA_DADOS + i
    const row = ws.getRow(r)
    row.getCell(col('codigo')).value = p.codigo ?? ''
    row.getCell(col('codigo_barras')).value = p.codigo_barras ?? ''
    row.getCell(col('descricao')).value = p.nome
    row.getCell(col('unidade')).value = p.unidade ?? ''
    row.getCell(col('local')).value = p.localizacao || d.local
    if (cSaldo > 0) {
      row.getCell(cSaldo).value = Number(p.estoque_atual ?? 0)
      row.getCell(cSaldo).numFmt = '#,##0.###'
    }
    row.getCell(cQtd).numFmt = '#,##0.###'
    row.getCell(cQtd).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMARELO } }
    if (cDif > 0) {
      const q = `${letra(cQtd)}${r}`, s = `${letra(cSaldo)}${r}`
      row.getCell(cDif).value = { formula: `IF(${q}="","",${q}-${s})` }
      row.getCell(cDif).numFmt = '+#,##0.###;-#,##0.###;0'
    }
    row.getCell(col('id')).value = p.id
    for (let c = 1; c <= ultimaVisivel; c++) {
      const cel = row.getCell(c)
      cel.border = BORDAS
      cel.font = { size: 9 }
      cel.alignment = { vertical: 'middle', wrapText: c === col('descricao') }
    }
    row.getCell(cQtd).font = { size: 11, bold: true }
  })
  // só números >= 0 na quantidade contada
  const fim = PRIMEIRA_LINHA_DADOS + Math.max(d.produtos.length, 1) - 1
  ;(ws as unknown as { dataValidations: { add(r: string, v: ExcelJS.DataValidation): void } }).dataValidations.add(
    `${letra(cQtd)}${PRIMEIRA_LINHA_DADOS}:${letra(cQtd)}${fim}`,
    { type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: true, showErrorMessage: true,
      errorTitle: 'Quantidade', error: 'Informe um número maior ou igual a zero (ou deixe em branco).' },
  )
  ws.pageSetup.printArea = `A1:${letra(ultimaVisivel)}${fim}`

  const buf = await wb.xlsx.writeBuffer()
  return new Uint8Array(buf as ArrayBuffer)
}

// ─────────────────────────── leitura (volta) ───────────────────────────

export interface LinhaLida {
  linha: number
  id: string | null
  codigo: string
  descricao: string
  quantidade: number
  observacao: string
}
export interface ErroContagem { linha: number; mensagem: string }
export interface LeituraContagem { linhas: LinhaLida[]; erros: ErroContagem[]; emBranco: number }

function valorCelula(v: unknown): unknown {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string }
    if (o.richText) return o.richText.map((t) => t.text).join('')
    if ('result' in o) return o.result
    if (typeof o.text === 'string') return o.text
  }
  return v
}
const texto = (v: unknown) => { const x = valorCelula(v); return x == null || x instanceof Date ? '' : String(x).trim() }

/** "12", "12,5", "1.234,5", 12.5 → número; vazio → null; inválido → NaN. */
export function lerQuantidade(v: unknown): number | null {
  const x = valorCelula(v)
  if (x == null) return null
  if (typeof x === 'number') return isFinite(x) ? Math.round(x * 1000) / 1000 : NaN
  let s = String(x).replace(/\s/g, '')
  if (!s) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  return isFinite(n) ? Math.round(n * 1000) / 1000 : NaN
}

/** Lê a planilha preenchida. Não grava nada. Linhas com a quantidade em branco = não contadas (ficam de fora). */
export async function lerPlanilhaContagem(bytes: ArrayBuffer | Uint8Array): Promise<LeituraContagem> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(bytes instanceof Uint8Array
    ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) : bytes)
  const erros: ErroContagem[] = []
  const ws = wb.getWorksheet(ABA_CONTAGEM)
  if (!ws) return { linhas: [], erros: [{ linha: 0, mensagem: 'Aba "Contagem" não encontrada — use a planilha baixada em Estoque › Inventário.' }], emBranco: 0 }
  const idx: Record<string, number> = {}
  ws.getRow(LINHA_CHAVES).eachCell((c, i) => { const k = texto(c.value); if (k) idx[k] = i })
  if (!idx.quantidade_contada || (!idx.id && !idx.codigo)) {
    return { linhas: [], erros: [{ linha: LINHA_CHAVES, mensagem: `Linha ${LINHA_CHAVES} alterada: faltam as colunas "quantidade_contada" e "id"/"codigo". Baixe a planilha de novo.` }], emBranco: 0 }
  }
  const linhas: LinhaLida[] = []
  let emBranco = 0
  const vistos = new Map<string, number>()
  for (let r = PRIMEIRA_LINHA_DADOS; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const g = (k: string) => (idx[k] ? row.getCell(idx[k]).value : null)
    const id = texto(g('id')) || null
    const codigo = texto(g('codigo'))
    const descricao = texto(g('descricao'))
    if (!id && !codigo && !descricao) continue
    const q = lerQuantidade(g('quantidade_contada'))
    if (q == null) { emBranco++; continue }
    if (Number.isNaN(q) || q < 0) { erros.push({ linha: r, mensagem: `Quantidade inválida em "${descricao || codigo}": use um número maior ou igual a zero.` }); continue }
    const chave = codigo ? `cod:${codigo}` : `id:${id}`
    if (vistos.has(chave)) { erros.push({ linha: r, mensagem: `"${descricao || codigo}" aparece de novo (já na linha ${vistos.get(chave)}). Some as quantidades numa linha só.` }); continue }
    vistos.set(chave, r)
    linhas.push({ linha: r, id, codigo, descricao, quantidade: q, observacao: texto(g('observacao')) })
  }
  return { linhas, erros, emBranco }
}

// ─────────────────────────── prévia (antes de qualquer gravação) ───────────────────────────

export interface ItemPrevia {
  produto_id: string
  codigo: string
  descricao: string
  unidade: string
  sistema: number
  contado: number
  diferenca: number
  custo: number
  valor_diferenca: number
  observacao: string
}
export interface Previa {
  itens: ItemPrevia[]
  erros: ErroContagem[]
  totais: { contados: number; iguais: number; sobras: number; faltas: number; valor_sobras: number; valor_faltas: number }
}

export interface ProdutoAtual { id: string; codigo: string | null; nome: string; unidade: string | null; estoque_atual: number | null; preco_custo_medio?: number | null; preco_custo?: number | null }

const r3 = (n: number) => Math.round(n * 1000) / 1000
const r2 = (n: number) => Math.round(n * 100) / 100

/** Compara as contagens lidas com o saldo ATUAL do sistema. Produto que não é mais da empresa/ativo vira erro. */
export function montarPrevia(leitura: LeituraContagem, produtos: ProdutoAtual[]): Previa {
  const porId = new Map(produtos.map((p) => [p.id, p]))
  const porCodigo = new Map<string, ProdutoAtual | null>()
  for (const p of produtos) {
    const c = (p.codigo ?? '').trim()
    if (!c) continue
    porCodigo.set(c, porCodigo.has(c) ? null : p) // código repetido no cadastro = ambíguo
  }
  const erros: ErroContagem[] = [...leitura.erros]
  const itens: ItemPrevia[] = []
  const usados = new Set<string>()
  for (const l of leitura.linhas) {
    // chave = CÓDIGO; o id (oculto) só confere. Divergência = recusa a linha (nunca ajusta o produto errado).
    let p: ProdutoAtual | undefined
    if (l.codigo) {
      const c = porCodigo.get(l.codigo)
      if (c === null) {
        // código repetido no cadastro: só o id, e só se o produto dele tiver mesmo esse código
        const doId = l.id ? porId.get(l.id) : undefined
        if (!doId || (doId.codigo ?? '').trim() !== l.codigo) {
          erros.push({ linha: l.linha, mensagem: `Código "${l.codigo}" repetido no cadastro — baixe a planilha de novo.` }); continue
        }
        p = doId
      } else p = c
      if (p && l.id && p.id !== l.id) {
        erros.push({ linha: l.linha, mensagem: `Linha recusada: o id da linha não é o do código "${l.codigo}" (planilha reordenada ou editada). Baixe a planilha de novo.` }); continue
      }
    } else if (l.id) p = porId.get(l.id)
    if (!p) { erros.push({ linha: l.linha, mensagem: `"${l.descricao || l.codigo}" não é um produto ativo desta empresa.` }); continue }
    if (usados.has(p.id)) { erros.push({ linha: l.linha, mensagem: `"${p.nome}" aparece em mais de uma linha.` }); continue }
    usados.add(p.id)
    const sistema = r3(Number(p.estoque_atual ?? 0))
    const diferenca = r3(l.quantidade - sistema)
    const custo = Number(p.preco_custo_medio ?? p.preco_custo ?? 0) || 0
    itens.push({
      produto_id: p.id, codigo: p.codigo ?? '', descricao: p.nome, unidade: p.unidade ?? '',
      sistema, contado: l.quantidade, diferenca, custo, valor_diferenca: r2(diferenca * custo), observacao: l.observacao,
    })
  }
  itens.sort((a, b) => Math.abs(b.valor_diferenca) - Math.abs(a.valor_diferenca) || Math.abs(b.diferenca) - Math.abs(a.diferenca))
  const sobras = itens.filter((i) => i.diferenca > 0), faltas = itens.filter((i) => i.diferenca < 0)
  return {
    itens, erros,
    totais: {
      contados: itens.length,
      iguais: itens.length - sobras.length - faltas.length,
      sobras: sobras.length,
      faltas: faltas.length,
      valor_sobras: r2(sobras.reduce((s, i) => s + i.valor_diferenca, 0)),
      valor_faltas: r2(faltas.reduce((s, i) => s + i.valor_diferenca, 0)),
    },
  }
}
