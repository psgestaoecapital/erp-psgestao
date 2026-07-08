import ExcelJS from 'exceljs'

type Cell = string | number | null | undefined
type Row = Record<string, Cell>

// exportToExcel — gera e baixa um .xlsx formatado (titulo opcional, cabecalho
// dourado em negrito, larguras auto) a partir de uma lista de objetos. Reusa a
// lib exceljs (ja no projeto). As chaves do 1o objeto viram os cabecalhos, na
// ordem, salvo se `columns` for passado explicitamente.
export async function exportToExcel(
  rows: Row[],
  opts: { filename: string; sheetName?: string; title?: string; columns?: { key: string; header: string }[] },
): Promise<void> {
  const cols = opts.columns ?? Object.keys(rows[0] ?? {}).map((k) => ({ key: k, header: k }))
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(opts.sheetName ?? 'Dados')

  if (opts.title) {
    const tr = ws.addRow([opts.title])
    ws.mergeCells(1, 1, 1, Math.max(1, cols.length))
    tr.font = { bold: true, size: 13, color: { argb: 'FF3D2314' } }
    tr.height = 22
  }

  const header = ws.addRow(cols.map((c) => c.header))
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8941A' } }
    cell.alignment = { vertical: 'middle' }
  })

  for (const r of rows) {
    ws.addRow(cols.map((c) => { const v = r[c.key]; return v == null ? '' : v }))
  }

  // larguras: max(header, maior valor) por coluna, com piso 10 e teto 40
  cols.forEach((c, i) => {
    let w = c.header.length
    for (const r of rows) { const v = r[c.key]; const l = v == null ? 0 : String(v).length; if (l > w) w = l }
    ws.getColumn(i + 1).width = Math.min(Math.max(w + 2, 10), 40)
  })

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = opts.filename.endsWith('.xlsx') ? opts.filename : `${opts.filename}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
