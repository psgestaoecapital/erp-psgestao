// Modelo padrão (xlsx) da Mão de obra: gera no navegador e lê o arquivo preenchido. Regras de validação: importarMaoObra.ts.
import ExcelJS from 'exceljs'
import { CAMPOS_ENC, COLUNAS_FUNC, type Celula, type Linha } from '@/lib/hub/importarMaoObra'

const ABA_LEIA = 'Leia-me', ABA_ENC = '1_Encargos_empresa', ABA_FUNC = '2_Funcionarios', ABA_LISTAS = 'Listas'
const LISTAS = { vinculo: ['CLT', 'CLT intermitente', 'RPA', 'PJ', 'Diarista'], forma: ['Mensal', 'Hora', 'Produção', 'Diária', 'm²'], sn: ['Sim', 'Não'], regime: ['Simples', 'Lucro Presumido', 'Lucro Real'] }

export async function gerarModeloMaoObra(): Promise<Blob> {
  const wb = new ExcelJS.Workbook()
  const leia = wb.addWorksheet(ABA_LEIA)
  leia.getColumn(1).width = 110
  ;['Modelo de importação — Mão de obra (PS Gestão)', '',
    '1) Aba 1_Encargos_empresa: preencha UMA vez por empresa (campo → valor). Se deixar vazia, os encargos atuais da empresa não mudam. Entram como PROVISÓRIOS até o contador confirmar.',
    '2) Aba 2_Funcionarios: uma linha por pessoa. Colunas com * são obrigatórias. Apague a linha de exemplo antes de enviar.',
    '3) Datas no formato dd/mm/aaaa. Valores em reais com vírgula (1234,56). Insalubridade/Periculosidade/Outros adicionais: R$ por mês.',
    '4) Mensal: Salário base é o mensal. Hora/Diária/Produção/m²: informe o valor da hora, da diária ou da unidade em "Valor por unidade".',
    '5) Quem já está cadastrado (mesmo CPF) é atualizado com nova vigência — nunca duplicado. As fichas entram "não conferidas" até você conferir na tela.',
    '6) Não inclua RG, CTPS, data de nascimento nem dados de sócios/pró-labore: essas colunas são ignoradas.',
  ].forEach((t, i) => { const c = leia.getCell(i + 1, 1); c.value = t; c.alignment = { wrapText: true, vertical: 'top' }; if (i === 0) c.font = { bold: true, size: 14 } })

  const enc = wb.addWorksheet(ABA_ENC)
  enc.columns = [{ header: 'Campo', width: 46 }, { header: 'Valor', width: 24 }]
  enc.getRow(1).font = { bold: true }
  CAMPOS_ENC.forEach((c) => enc.addRow([c, null]))
  const exEnc: Record<string, string | number> = { 'Regime tributário*': 'Lucro Presumido', 'INSS patronal %': 20, 'RAT %': 3, 'FAP': 1, 'Terceiros %': 5.8, 'FGTS %': 8, 'Provisão 13º %': 8.33, 'Provisão férias + 1/3 %': 11.11, 'Provisão rescisão %': 4, 'Desoneração da folha (Sim/Não)': 'Não', 'Horas produtivas padrão': 176, 'Salário mínimo de referência (R$)': 1518 }
  enc.eachRow((r, i) => { if (i > 1) { const v = exEnc[String(r.getCell(1).value)]; if (v !== undefined) r.getCell(2).value = v } })

  const listas = wb.addWorksheet(ABA_LISTAS, { state: 'hidden' })
  ;(Object.values(LISTAS)).forEach((arr, i) => arr.forEach((v, j) => { listas.getCell(j + 1, i + 1).value = v }))
  const rng = (col: string, n: number) => `${ABA_LISTAS}!$${col}$1:$${col}$${n}`
  enc.getCell('B2').dataValidation = { type: 'list', allowBlank: true, formulae: [rng('D', LISTAS.regime.length)] }
  const linDes = CAMPOS_ENC.indexOf('Desoneração da folha (Sim/Não)') + 2
  enc.getCell(`B${linDes}`).dataValidation = { type: 'list', allowBlank: true, formulae: [rng('C', 2)] }

  const f = wb.addWorksheet(ABA_FUNC)
  f.columns = COLUNAS_FUNC.map((h) => ({ header: h, width: Math.max(14, h.length + 2) }))
  f.getRow(1).font = { bold: true }; f.views = [{ state: 'frozen', ySplit: 1 }]
  f.addRow(['1001', 'Maria Exemplo da Silva', '529.982.247-25', '15/03/2022', 'Ajudante', '7170-20', 'Obra', 'CLT', 'Mensal', 2200, null, 0, 0, 0, 220, 600, 0, 0, 80, 176, 22, '01/10/2026', 'Não', 'Linha de exemplo — apague'])
  for (let r = 2; r <= 500; r++) {
    f.getCell(r, COLUNAS_FUNC.indexOf('Vínculo*') + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [rng('A', LISTAS.vinculo.length)] }
    f.getCell(r, COLUNAS_FUNC.indexOf('Forma de pagamento*') + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [rng('B', LISTAS.forma.length)] }
    f.getCell(r, COLUNAS_FUNC.indexOf('MEI de obra (Sim/Não)') + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [rng('C', 2)] }
  }
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

const valorCelula = (v: ExcelJS.CellValue): Celula => {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>
    if ('result' in o) return valorCelula(o.result as ExcelJS.CellValue)
    if ('richText' in o) return (o.richText as { text: string }[]).map((t) => t.text).join('')
    if ('text' in o) return String(o.text)
    return null
  }
  return v as Celula
}

export interface PlanilhaLida { encargos: [Celula, Celula][]; funcionarios: Linha[]; faltaAba: string | null }

export async function lerPlanilhaMaoObra(arq: ArrayBuffer): Promise<PlanilhaLida> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(arq)
  const f = wb.getWorksheet(ABA_FUNC)
  if (!f) return { encargos: [], funcionarios: [], faltaAba: ABA_FUNC }
  const cab: string[] = []
  f.getRow(1).eachCell({ includeEmpty: false }, (c, i) => { cab[i] = String(valorCelula(c.value) ?? '').trim() })
  const funcionarios: Linha[] = []
  for (let n = 2; n <= f.rowCount; n++) {   // inclui linhas vazias para o nº da linha da prévia bater com o do Excel
    const row = f.getRow(n), o: Linha = {}
    cab.forEach((h, i) => { if (h) o[h] = valorCelula(row.getCell(i).value) })
    funcionarios.push(o)
  }
  const encargos: [Celula, Celula][] = []
  wb.getWorksheet(ABA_ENC)?.eachRow((row, n) => { if (n > 1) encargos.push([valorCelula(row.getCell(1).value), valorCelula(row.getCell(2).value)]) })
  return { encargos, funcionarios, faltaAba: null }
}
