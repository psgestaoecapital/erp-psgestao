// #3281 etapa 2 — monta o Excel da "Movimentação financeira" gerada em segundo plano (Meus relatórios).
// As linhas vêm de fn_relatorio_movimentacao_linhas (mesma regra do saldo por conta: cada baixa ativa é um lançamento,
// quitado legado sem baixa entra pelo valor pago; excluídos ficam fora). Transferência entre contas aparece na lista,
// mas não soma em entrada/saída (não é receita nem despesa).
import ExcelJS from 'exceljs'

export type LinhaMovimentacao = {
  chave: string
  data: string // AAAA-MM-DD
  tipo: 'Recebimento' | 'Pagamento' | 'Transferência' | string
  pessoa: string | null
  descricao: string | null
  categoria: string | null
  documento: string | null
  conta: string | null
  forma: string | null
  entrada: number | null
  saida: number | null
  transferido: number | null
  origem: string | null
}

export type ResumoMes = { mes: string; entradas: number; saidas: number; resultado: number; lancamentos: number }

const cent = (v: number | null | undefined) => Math.round(Number(v ?? 0) * 100)

// Resumo por mês (AAAA-MM), em ordem; soma em centavos para não acumular erro de ponto flutuante.
export function resumoMensal(linhas: LinhaMovimentacao[]): ResumoMes[] {
  const meses = new Map<string, { e: number; s: number; n: number }>()
  for (const l of linhas) {
    const mes = String(l.data).slice(0, 7)
    const m = meses.get(mes) ?? { e: 0, s: 0, n: 0 }
    m.e += cent(l.entrada)
    m.s += cent(l.saida)
    m.n += 1
    meses.set(mes, m)
  }
  return [...meses.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, m]) => ({ mes, entradas: m.e / 100, saidas: m.s / 100, resultado: (m.e - m.s) / 100, lancamentos: m.n }))
}

function dataBR(iso: string): string {
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

export async function montarPlanilhaMovimentacao(
  linhas: LinhaMovimentacao[],
  meta: { empresa: string; titulo: string; dataInicio: string; dataFim: string; geradoEm: Date },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'PS Gestão'
  wb.created = meta.geradoEm

  // Aba 1 — Resumo por mês
  const resumo = resumoMensal(linhas)
  const wr = wb.addWorksheet('Resumo')
  wr.columns = [
    { header: 'Mês', key: 'mes', width: 12 },
    { header: 'Entradas (recebido)', key: 'entradas', width: 20, style: { numFmt: MOEDA } },
    { header: 'Saídas (pago)', key: 'saidas', width: 20, style: { numFmt: MOEDA } },
    { header: 'Resultado do mês', key: 'resultado', width: 20, style: { numFmt: MOEDA } },
    { header: 'Lançamentos', key: 'lancamentos', width: 14 },
  ]
  cabecalho(wr)
  for (const m of resumo) wr.addRow({ ...m, mes: mesBR(m.mes) })
  const tot = resumo.reduce((t, m) => ({ e: t.e + cent(m.entradas), s: t.s + cent(m.saidas), n: t.n + m.lancamentos }), { e: 0, s: 0, n: 0 })
  const rt = wr.addRow({ mes: 'Total', entradas: tot.e / 100, saidas: tot.s / 100, resultado: (tot.e - tot.s) / 100, lancamentos: tot.n })
  rt.font = { bold: true }
  wr.addRow({})
  wr.addRow({ mes: `${meta.empresa} — ${meta.titulo}` })
  wr.addRow({ mes: `Período: ${dataBR(meta.dataInicio)} a ${dataBR(meta.dataFim)} · gerado em ${meta.geradoEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` })
  wr.addRow({ mes: 'Recebido/pago = cada pagamento registrado (baixa). Transferências entre contas não entram no resultado.' })

  // Aba 2 — Movimentação (uma linha por pagamento/recebimento/transferência)
  const wm = wb.addWorksheet('Movimentação')
  wm.columns = [
    { header: 'Data', key: 'data', width: 12 },
    { header: 'Tipo', key: 'tipo', width: 15 },
    { header: 'Cliente / Fornecedor', key: 'pessoa', width: 34 },
    { header: 'Descrição', key: 'descricao', width: 40 },
    { header: 'Categoria', key: 'categoria', width: 24 },
    { header: 'Documento / NF', key: 'documento', width: 16 },
    { header: 'Conta', key: 'conta', width: 28 },
    { header: 'Forma', key: 'forma', width: 14 },
    { header: 'Entrada', key: 'entrada', width: 15, style: { numFmt: MOEDA } },
    { header: 'Saída', key: 'saida', width: 15, style: { numFmt: MOEDA } },
    { header: 'Transferido', key: 'transferido', width: 15, style: { numFmt: MOEDA } },
    { header: 'Origem', key: 'origem', width: 16 },
  ]
  cabecalho(wm)
  const ordenadas = [...linhas].sort((a, b) => a.data.localeCompare(b.data) || a.tipo.localeCompare(b.tipo) || a.chave.localeCompare(b.chave))
  for (const l of ordenadas) {
    wm.addRow({
      data: dataBR(l.data), tipo: l.tipo, pessoa: l.pessoa ?? '', descricao: l.descricao ?? '', categoria: l.categoria ?? '',
      documento: l.documento ?? '', conta: l.conta ?? '', forma: l.forma ?? '',
      entrada: l.entrada ?? null, saida: l.saida ?? null, transferido: l.transferido ?? null, origem: l.origem ?? '',
    })
  }
  if (ordenadas.length) wm.autoFilter = { from: 'A1', to: 'L1' }

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}
