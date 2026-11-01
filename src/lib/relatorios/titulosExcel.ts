// #3281 etapa 4 — monta o Excel de "Contas a pagar" e "Contas a receber" gerado em segundo plano (Meus relatórios).
// Mesmo recorte da tela de listagem (fn_ge_listagem_v2): títulos não excluídos com VENCIMENTO no período.
// Em aberto = valor − pago, só para o que ainda não foi quitado; cancelado e renegociado não somam em aberto.
import ExcelJS from 'exceljs'

export type LinhaTitulo = {
  id: string
  pessoa: string | null
  descricao: string | null
  categoria: string | null
  documento: string | null
  numero_nf: string | null
  parcela: string | null
  data_emissao: string | null
  data_vencimento: string // AAAA-MM-DD
  data_pagamento: string | null
  status: string
  forma_pagamento: string | null
  valor: number | null
  valor_pago: number | null
}

export type ResumoTitulosMes = { mes: string; titulos: number; valor: number; pago: number; em_aberto: number; vencido: number }

const cent = (v: number | null | undefined) => Math.round(Number(v ?? 0) * 100)

const QUITADO = new Set(['pago', 'recebido'])
const FORA_DO_ABERTO = new Set(['cancelado', 'renegociado'])

// Situação mostrada na planilha. "Vencido" = ainda em aberto com vencimento antes de hoje.
export function situacao(l: LinhaTitulo, hoje: string): string {
  const s = String(l.status ?? '').toLowerCase()
  if (QUITADO.has(s)) return 'Quitado'
  if (s === 'cancelado') return 'Cancelado'
  if (s === 'renegociado') return 'Renegociado'
  const venc = String(l.data_vencimento).slice(0, 10) < hoje
  if (s === 'parcial') return venc ? 'Parcial (vencido)' : 'Parcial'
  return venc ? 'Vencido' : 'Em aberto'
}

// Em centavos: valor ainda devido no título (0 quando quitado, cancelado ou renegociado).
function abertoCent(l: LinhaTitulo): number {
  const s = String(l.status ?? '').toLowerCase()
  if (QUITADO.has(s) || FORA_DO_ABERTO.has(s)) return 0
  return Math.max(0, cent(l.valor) - cent(l.valor_pago))
}

export function emAberto(l: LinhaTitulo): number {
  return abertoCent(l) / 100
}

// Resumo por mês de vencimento (AAAA-MM), em ordem; somas em centavos.
export function resumoTitulos(linhas: LinhaTitulo[], hoje: string): ResumoTitulosMes[] {
  const meses = new Map<string, { n: number; v: number; p: number; a: number; venc: number }>()
  for (const l of linhas) {
    const mes = String(l.data_vencimento).slice(0, 7)
    const m = meses.get(mes) ?? { n: 0, v: 0, p: 0, a: 0, venc: 0 }
    const a = abertoCent(l)
    m.n += 1
    m.v += FORA_DO_ABERTO.has(String(l.status ?? '').toLowerCase()) ? 0 : cent(l.valor)
    m.p += cent(l.valor_pago)
    m.a += a
    if (a > 0 && String(l.data_vencimento).slice(0, 10) < hoje) m.venc += a
    meses.set(mes, m)
  }
  return [...meses.entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([mes, m]) => ({ mes, titulos: m.n, valor: m.v / 100, pago: m.p / 100, em_aberto: m.a / 100, vencido: m.venc / 100 }))
}

function dataBR(iso: string | null): string {
  if (!iso) return ''
  const [a, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

function mesBR(mes: string): string {
  const [a, m] = mes.split('-')
  return `${m}/${a}`
}

const MOEDA = '#,##0.00;[Red]-#,##0.00'

function cabecalho(ws: ExcelJS.Worksheet) {
  const r = ws.getRow(1)
  r.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3D2314' } }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

export async function montarPlanilhaTitulos(
  linhas: LinhaTitulo[],
  meta: { tipo: 'pagar' | 'receber'; empresa: string; titulo: string; dataInicio: string; dataFim: string; geradoEm: Date; hoje: string },
): Promise<Buffer> {
  const pagar = meta.tipo === 'pagar'
  const wb = new ExcelJS.Workbook()
  wb.creator = 'PS Gestão'
  wb.created = meta.geradoEm

  // Aba 1 — Resumo por mês de vencimento
  const resumo = resumoTitulos(linhas, meta.hoje)
  const wr = wb.addWorksheet('Resumo')
  wr.columns = [
    { header: 'Mês do vencimento', key: 'mes', width: 18 },
    { header: 'Títulos', key: 'titulos', width: 10 },
    { header: 'Valor', key: 'valor', width: 18, style: { numFmt: MOEDA } },
    { header: pagar ? 'Pago' : 'Recebido', key: 'pago', width: 18, style: { numFmt: MOEDA } },
    { header: 'Em aberto', key: 'em_aberto', width: 18, style: { numFmt: MOEDA } },
    { header: 'Dos quais vencido', key: 'vencido', width: 18, style: { numFmt: MOEDA } },
  ]
  cabecalho(wr)
  for (const m of resumo) wr.addRow({ ...m, mes: mesBR(m.mes) })
  const tot = resumo.reduce(
    (t, m) => ({ n: t.n + m.titulos, v: t.v + cent(m.valor), p: t.p + cent(m.pago), a: t.a + cent(m.em_aberto), x: t.x + cent(m.vencido) }),
    { n: 0, v: 0, p: 0, a: 0, x: 0 },
  )
  const rt = wr.addRow({ mes: 'Total', titulos: tot.n, valor: tot.v / 100, pago: tot.p / 100, em_aberto: tot.a / 100, vencido: tot.x / 100 })
  rt.font = { bold: true }
  wr.addRow({})
  wr.addRow({ mes: `${meta.empresa} — ${meta.titulo}` })
  wr.addRow({ mes: `Vencimento de ${dataBR(meta.dataInicio)} a ${dataBR(meta.dataFim)} · gerado em ${meta.geradoEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` })
  wr.addRow({ mes: 'Em aberto = valor − pago dos títulos não quitados. Cancelados e renegociados não somam no valor nem no aberto. Excluídos ficam fora.' })

  // Aba 2 — um título por linha
  const wt = wb.addWorksheet('Títulos')
  wt.columns = [
    { header: 'Vencimento', key: 'vencimento', width: 12 },
    { header: pagar ? 'Fornecedor' : 'Cliente', key: 'pessoa', width: 34 },
    { header: 'Descrição', key: 'descricao', width: 40 },
    { header: 'Categoria', key: 'categoria', width: 24 },
    { header: 'Documento', key: 'documento', width: 16 },
    { header: 'NF', key: 'nf', width: 12 },
    { header: 'Parcela', key: 'parcela', width: 9 },
    { header: 'Emissão', key: 'emissao', width: 12 },
    { header: pagar ? 'Pagamento' : 'Recebimento', key: 'pagamento', width: 13 },
    { header: 'Situação', key: 'situacao', width: 17 },
    { header: 'Forma', key: 'forma', width: 14 },
    { header: 'Valor', key: 'valor', width: 15, style: { numFmt: MOEDA } },
    { header: pagar ? 'Pago' : 'Recebido', key: 'pago', width: 15, style: { numFmt: MOEDA } },
    { header: 'Em aberto', key: 'aberto', width: 15, style: { numFmt: MOEDA } },
  ]
  cabecalho(wt)
  const ordenadas = [...linhas].sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento) || a.id.localeCompare(b.id))
  for (const l of ordenadas) {
    wt.addRow({
      vencimento: dataBR(l.data_vencimento), pessoa: l.pessoa ?? '', descricao: l.descricao ?? '', categoria: l.categoria ?? '',
      documento: l.documento ?? '', nf: l.numero_nf ?? '', parcela: l.parcela ?? '', emissao: dataBR(l.data_emissao),
      pagamento: dataBR(l.data_pagamento), situacao: situacao(l, meta.hoje), forma: l.forma_pagamento ?? '',
      valor: l.valor ?? null, pago: l.valor_pago ?? null, aberto: emAberto(l),
    })
  }
  if (ordenadas.length) wt.autoFilter = { from: 'A1', to: 'N1' }

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}
