// Helper GENÉRICO de export de lista → Excel (.xlsx via SheetJS) e PDF (via pdf-lib).
// Recebe colunas + linhas + metadados (empresa, título, filtros, KPIs) e baixa o arquivo no browser.
// Reutilizável: Despesas a Pagar, Receitas a Receber e, depois, extrato/inadimplentes/estoque de graça.
import * as XLSX from 'xlsx'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

export type ColTipo = 'texto' | 'numero' | 'moeda' | 'data'
export interface Coluna<T> {
  header: string
  get: (row: T) => string | number | null
  tipo?: ColTipo        // default 'texto'
  peso?: number         // largura relativa no PDF (default 1)
  align?: 'left' | 'right'
  total?: boolean       // soma no rodapé (colunas numéricas/moeda)
}
export interface KpiItem { label: string; valor: number; qtd?: number }
export interface RelatorioMeta {
  titulo: string
  empresa: string
  filtros: string
  emitidoPor?: string
  emitidoEmISO: string  // data de emissão (ISO) — passada de fora (sem Date.now interno)
  kpis?: KpiItem[]
}

const brl = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })
const dataBR = (iso: string) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}` }
// pdf-lib usa WinAnsi: troca chars fora do Latin-1 (traços longos, etc.) por equivalentes seguros.
// pdf-lib (Helvetica/WinAnsi) só desenha Latin-1: normaliza os comuns e troca o resto por '?' (não quebra).
const ansi = (s: string) => (s ?? '')
  .replace(/[‒–—―]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/•/g, '·').replace(/…/g, '...')
  .replace(/[^\x00-\xFF]/g, '?')

function cell<T>(col: Coluna<T>, row: T): string | number | Date | null {
  const raw = col.get(row)
  if (raw == null || raw === '') return col.tipo === 'texto' || !col.tipo ? '' : null
  if (col.tipo === 'data') { const iso = String(raw).slice(0, 10); const [y, m, d] = iso.split('-'); return new Date(Number(y), Number(m) - 1, Number(d)) }
  if (col.tipo === 'moeda' || col.tipo === 'numero') return Number(raw)
  return String(raw)
}

function nomeArquivo(base: string, empresa: string, iso: string, ext: string): string {
  const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
  return `${slug(base)}_${slug(empresa) || 'empresa'}_${iso.slice(0, 10)}.${ext}`
}

function baixar(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nome
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// ---------- EXCEL ----------
export function exportarExcel<T>(meta: RelatorioMeta, colunas: Coluna<T>[], linhas: T[]): string {
  const aoa: (string | number | Date | null)[][] = []
  aoa.push([meta.empresa])
  aoa.push([meta.titulo])
  aoa.push([`Filtros: ${meta.filtros}`])
  aoa.push([`Emitido em ${dataBR(meta.emitidoEmISO)}${meta.emitidoPor ? ` por ${meta.emitidoPor}` : ''}`])
  aoa.push([])
  if (meta.kpis?.length) {
    aoa.push(['Resumo', 'Valor', 'Lançamentos'])
    for (const k of meta.kpis) aoa.push([k.label, k.valor, k.qtd ?? null])
    aoa.push([])
  }
  const headerRowIdx = aoa.length
  aoa.push(colunas.map((c) => c.header))
  for (const row of linhas) aoa.push(colunas.map((c) => cell(c, row)))
  // rodapé de totais
  const totalRow: (string | number | Date | null)[] = colunas.map((c, i) => {
    if (i === 0) return 'TOTAL'
    if (c.total) return linhas.reduce((s, r) => s + (Number(c.get(r)) || 0), 0)
    return null
  })
  aoa.push(totalRow)

  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true })
  ws['!cols'] = colunas.map((c) => ({ wch: c.tipo === 'texto' || !c.tipo ? 26 : 14 }))
  // formata moeda e data por célula (números continuam número; datas, data)
  const nData = linhas.length
  for (let r = 0; r < nData + 1; r++) { // +1 = linha de total
    for (let ci = 0; ci < colunas.length; ci++) {
      const addr = XLSX.utils.encode_cell({ r: headerRowIdx + 1 + r, c: ci })
      const cObj = ws[addr]; if (!cObj) continue
      if (colunas[ci].tipo === 'moeda' && typeof cObj.v === 'number') cObj.z = 'R$ #,##0.00'
      else if (colunas[ci].tipo === 'data' && cObj.v instanceof Date) cObj.z = 'dd/mm/yyyy'
    }
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, meta.titulo.slice(0, 28) || 'Relatório')
  const nome = nomeArquivo(meta.titulo, meta.empresa, meta.emitidoEmISO, 'xlsx')
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  baixar(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nome)
  return nome
}

// ---------- PDF ----------
const ESP = rgb(0.24, 0.14, 0.08), GOLD = rgb(0.78, 0.58, 0.10), MUT = rgb(0.45, 0.40, 0.34), LINE = rgb(0.86, 0.83, 0.77)

function txtCortado(s: string, font: PDFFont, size: number, maxW: number): string {
  s = ansi(s)
  if (font.widthOfTextAtSize(s, size) <= maxW) return s
  let out = s
  while (out.length > 1 && font.widthOfTextAtSize(out + '…', size) > maxW) out = out.slice(0, -1)
  return out + '…'
}

export async function exportarPDF<T>(meta: RelatorioMeta, colunas: Coluna<T>[], linhas: T[]): Promise<string> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const W = 841.89, H = 595.28, M = 36
  const contentW = W - M * 2
  const pesoTotal = colunas.reduce((s, c) => s + (c.peso ?? 1), 0)
  const larguras = colunas.map((c) => (contentW * (c.peso ?? 1)) / pesoTotal)
  const xs: number[] = []; let acc = M; for (const w of larguras) { xs.push(acc); acc += w }

  let page: PDFPage = doc.addPage([W, H])
  let y = H - M
  let pagina = 1

  const fmtValor = (c: Coluna<T>, row: T): string => {
    const v = c.get(row)
    if (v == null || v === '') return ''
    if (c.tipo === 'moeda') return brl(Number(v))
    if (c.tipo === 'numero') return Number(v).toLocaleString('pt-BR')
    if (c.tipo === 'data') return dataBR(String(v))
    return String(v)
  }

  const rodape = () => {
    page.drawText(ansi(`${meta.empresa} · emitido em ${dataBR(meta.emitidoEmISO)}${meta.emitidoPor ? ` por ${meta.emitidoPor}` : ''}`), { x: M, y: M - 14, size: 7, font, color: MUT })
    page.drawText(`pág. ${pagina}`, { x: W - M - 40, y: M - 14, size: 7, font, color: MUT })
  }
  const cabecalhoTabela = () => {
    page.drawRectangle({ x: M, y: y - 3, width: contentW, height: 16, color: rgb(0.98, 0.97, 0.95) })
    colunas.forEach((c, i) => {
      const tw = c.align === 'right' ? larguras[i] - 6 - bold.widthOfTextAtSize(c.header, 8) : 4
      page.drawText(txtCortado(c.header, bold, 8, larguras[i] - 8), { x: xs[i] + tw, y: y + 1, size: 8, font: bold, color: ESP })
    })
    y -= 18
  }
  const novaPagina = () => { rodape(); page = doc.addPage([W, H]); y = H - M; pagina += 1; cabecalhoTabela() }

  // Cabeçalho do relatório
  page.drawText(ansi(meta.empresa), { x: M, y: y - 12, size: 13, font: bold, color: ESP }); y -= 18
  page.drawText(ansi(meta.titulo), { x: M, y: y - 12, size: 11, font: bold, color: GOLD }); y -= 16
  page.drawText(txtCortado(`Filtros: ${meta.filtros}`, font, 9, contentW), { x: M, y: y - 10, size: 9, font, color: MUT }); y -= 14
  if (meta.kpis?.length) {
    const linha = meta.kpis.map((k) => `${k.label}: ${brl(k.valor)}${k.qtd != null ? ` (${k.qtd})` : ''}`).join('   ·   ')
    page.drawText(txtCortado(linha, font, 8.5, contentW), { x: M, y: y - 10, size: 8.5, font, color: ESP }); y -= 16
  }
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LINE }); y -= 6
  cabecalhoTabela()

  // Linhas
  for (const row of linhas) {
    if (y < M + 24) novaPagina()
    colunas.forEach((c, i) => {
      const s = fmtValor(c, row)
      const tw = c.align === 'right' ? larguras[i] - 6 - font.widthOfTextAtSize(txtCortado(s, font, 8, larguras[i] - 8), 8) : 4
      page.drawText(txtCortado(s, font, 8, larguras[i] - 8), { x: xs[i] + Math.max(4, tw), y: y + 1, size: 8, font, color: ESP })
    })
    y -= 14
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.25, color: LINE })
  }

  // Totais
  if (y < M + 24) novaPagina()
  y -= 2
  colunas.forEach((c, i) => {
    let s = ''
    if (i === 0) s = 'TOTAL'
    else if (c.total) s = brl(linhas.reduce((sm, r) => sm + (Number(c.get(r)) || 0), 0))
    if (!s) return
    const tw = c.align === 'right' ? larguras[i] - 6 - bold.widthOfTextAtSize(s, 8.5) : 4
    page.drawText(ansi(s), { x: xs[i] + Math.max(4, tw), y: y - 4, size: 8.5, font: bold, color: ESP })
  })
  rodape()

  const bytes = await doc.save()
  const nome = nomeArquivo(meta.titulo, meta.empresa, meta.emitidoEmISO, 'pdf')
  baixar(new Blob([bytes as BlobPart], { type: 'application/pdf' }), nome)
  return nome
}
