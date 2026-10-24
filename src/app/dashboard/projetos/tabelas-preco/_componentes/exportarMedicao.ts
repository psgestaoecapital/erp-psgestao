// HB2 · Medição ao cliente: baixa a medição aberta em Excel (xlsx) ou PDF (janela de impressão do navegador, sem biblioteca nova).
import * as XLSX from 'xlsx'

export type LinhaExport = { servico: string; quantidade: number; condicao: string; codigo: string; unitario: number; total: number }
const fmtR = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

export function exportarMedicao(formato: 'xlsx' | 'pdf', descricao: string, total: number, linhas: LinhaExport[]) {
  const arquivo = descricao.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'medicao'
  if (formato === 'xlsx') {
    const cab = ['Serviço', 'Quantidade', 'Regime', 'Código do cliente', 'Unitário', 'Total']
    const ws = XLSX.utils.aoa_to_sheet([cab, ...linhas.map(l => [l.servico, l.quantidade, l.condicao, l.codigo, l.unitario, l.total]), [], ['Total da medição', '', '', '', '', total]])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Medição')
    XLSX.writeFile(wb, `medicao-${arquivo}.xlsx`)
    return
  }
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(descricao)}</title><style>body{font-family:Arial,sans-serif;color:#3D2314;padding:24px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left}td.n,th.n{text-align:right}</style></head><body><h1 style="font-size:20px">Medição: ${esc(descricao)}</h1><table><thead><tr><th>Serviço</th><th>Qtd</th><th>Regime</th><th>Código</th><th class="n">Unitário</th><th class="n">Total</th></tr></thead><tbody>${linhas.map(l => `<tr><td>${esc(l.servico)}</td><td>${l.quantidade}</td><td>${esc(l.condicao)}</td><td>${esc(l.codigo)}</td><td class="n">${fmtR(l.unitario)}</td><td class="n">${fmtR(l.total)}</td></tr>`).join('')}</tbody></table><p style="text-align:right;font-size:16px">Total da medição: <b>${fmtR(total)}</b></p></body></html>`)
  w.document.close(); w.focus(); w.print()
}
