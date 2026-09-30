// Relatório de viagem — versão planilha (CEO 30/09 · Diego/FC). Contrato ÚNICO entre o modelo .xlsx que o
// colaborador preenche e a importação da tela de viagem do administrativo: a tela lê pela LINHA 4 (chaves técnicas)
// e não pela ordem nem pelo texto do cabeçalho, então reordenar/renomear colunas no Excel não quebra a importação.
// Uma linha = uma despesa. A viagem é (colaborador, obra, início, fim); o adiantamento recebido é da viagem —
// informe uma vez (pode repetir o mesmo valor; valores diferentes na mesma viagem são recusados).
// Categoria pelo código gerencial da empresa (FC: 2.05, 2.06, 5.01). Obra pelo número (OBR-AAAA-NNNN).
// Gera e lê com exceljs (roda no navegador e no gate do build).

import ExcelJS from 'exceljs'

export const ABA_LANCAMENTOS = 'Lançamentos'
export const ABA_INSTRUCOES = 'Instruções'
export const ABA_LISTAS = 'Listas'
export const LINHA_CHAVES = 4
export const PRIMEIRA_LINHA_DADOS = 5
export const LINHAS_MODELO = 300

export interface ColunaViagem {
  chave: string
  titulo: string
  obrigatoria: boolean
  largura: number
  ajuda: string
}

export const COLUNAS_VIAGEM: readonly ColunaViagem[] = [
  { chave: 'colaborador', titulo: 'Colaborador', obrigatoria: true, largura: 28, ajuda: 'Nome completo de quem viajou' },
  { chave: 'obra', titulo: 'Obra', obrigatoria: true, largura: 42, ajuda: 'Escolha na lista (aba Listas)' },
  { chave: 'periodo_inicio', titulo: 'Período — início', obrigatoria: true, largura: 15, ajuda: 'Data de saída (dd/mm/aaaa)' },
  { chave: 'periodo_fim', titulo: 'Período — fim', obrigatoria: true, largura: 15, ajuda: 'Data de volta (dd/mm/aaaa)' },
  { chave: 'data', titulo: 'Data da despesa', obrigatoria: true, largura: 15, ajuda: 'Dentro do período' },
  { chave: 'categoria', titulo: 'Categoria (código gerencial)', obrigatoria: true, largura: 40, ajuda: 'Escolha na lista' },
  { chave: 'descricao', titulo: 'Descrição', obrigatoria: true, largura: 36, ajuda: 'O que foi pago (ex.: hotel 2 diárias)' },
  { chave: 'valor', titulo: 'Valor (R$)', obrigatoria: true, largura: 13, ajuda: 'Maior que zero' },
  { chave: 'forma_pagamento', titulo: 'Forma de pagamento', obrigatoria: true, largura: 30, ajuda: 'Escolha na lista' },
  { chave: 'adiantamento_recebido', titulo: 'Adiantamento recebido (R$)', obrigatoria: false, largura: 17, ajuda: 'Da viagem inteira — uma vez' },
  { chave: 'observacao', titulo: 'Observação', obrigatoria: false, largura: 36, ajuda: 'Opcional (nº da nota, placa…)' },
] as const

export const CHAVES_VIAGEM = COLUNAS_VIAGEM.map((c) => c.chave)

export const FORMAS_PAGAMENTO_VIAGEM = [
  { codigo: 'adiantamento', rotulo: 'Dinheiro do adiantamento' },
  { codigo: 'cartao_empresa', rotulo: 'Cartão da empresa' },
  { codigo: 'pix_empresa', rotulo: 'PIX/transferência da empresa' },
  { codigo: 'faturado', rotulo: 'Faturado para a empresa (paga depois)' },
  { codigo: 'proprio_reembolso', rotulo: 'Dinheiro/cartão próprio (reembolsar)' },
] as const

export interface ObraLista { numero: string; nome: string }
export interface CategoriaLista { codigo: string; descricao: string }

export interface DadosModelo {
  empresa: string
  obras: ObraLista[]
  categorias: CategoriaLista[]
}

export const rotuloObra = (o: ObraLista) => `${o.numero} · ${o.nome}`
export const rotuloCategoria = (c: CategoriaLista) => `${c.codigo} · ${c.descricao}`

const MARROM = 'FF3D2314'
const DOURADO = 'FFC8941A'
const CREME = 'FFFAF7F2'

function letra(n: number): string {
  let s = ''
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s
  return s
}

export async function gerarModeloViagem(d: DadosModelo): Promise<Uint8Array> {
  if (d.obras.length === 0) throw new Error('Cadastre ao menos uma obra antes de gerar o modelo.')
  if (d.categorias.length === 0) throw new Error('Informe ao menos uma categoria gerencial.')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'PS Gestão'
  wb.created = new Date()

  // ── Lançamentos ────────────────────────────────────────────────────────────
  const ws = wb.addWorksheet(ABA_LANCAMENTOS, { views: [{ state: 'frozen', ySplit: LINHA_CHAVES }] })
  const wi = wb.addWorksheet(ABA_INSTRUCOES) // ordem das abas: Lançamentos, Instruções, Listas
  const n = COLUNAS_VIAGEM.length
  ws.columns = COLUNAS_VIAGEM.map((c) => ({ width: c.largura }))
  ws.mergeCells(1, 1, 1, n)
  ws.getCell(1, 1).value = `Relatório de viagem — ${d.empresa}`
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: MARROM } }
  ws.mergeCells(2, 1, 2, n)
  ws.getCell(2, 1).value =
    'Uma linha por despesa. Leia a aba "Instruções". Não apague nem altere a linha 4 (é o que o sistema lê na importação).'
  ws.getCell(2, 1).font = { italic: true, size: 10, color: { argb: 'FF6B4B33' } }
  COLUNAS_VIAGEM.forEach((c, i) => {
    const h = ws.getCell(3, i + 1)
    h.value = c.obrigatoria ? `${c.titulo} *` : c.titulo
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MARROM } }
    h.alignment = { vertical: 'middle', wrapText: true }
    h.note = c.ajuda
    const k = ws.getCell(LINHA_CHAVES, i + 1)
    k.value = c.chave
    k.font = { size: 8, color: { argb: 'FF8A7A6E' } }
    k.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CREME } }
  })
  ws.getRow(3).height = 32

  // listas (aba Listas) para as validações
  const wl = wb.addWorksheet(ABA_LISTAS)
  wl.columns = [{ width: 60 }, { width: 50 }, { width: 42 }]
  wl.getCell('A1').value = 'Obras'
  wl.getCell('B1').value = 'Categorias (código gerencial)'
  wl.getCell('C1').value = 'Formas de pagamento'
  for (const c of ['A1', 'B1', 'C1']) {
    wl.getCell(c).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    wl.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MARROM } }
  }
  d.obras.forEach((o, i) => { wl.getCell(i + 2, 1).value = rotuloObra(o) })
  d.categorias.forEach((c, i) => { wl.getCell(i + 2, 2).value = rotuloCategoria(c) })
  FORMAS_PAGAMENTO_VIAGEM.forEach((f, i) => { wl.getCell(i + 2, 3).value = f.rotulo })
  // exceljs 4.4 tem worksheet.dataValidations.add em runtime, mas o .d.ts não declara
  const validacoes = (ws as unknown as { dataValidations: { add(range: string, dv: ExcelJS.DataValidation): void } }).dataValidations
  const faixa = (col: string, qtd: number) => `'${ABA_LISTAS}'!$${col}$2:$${col}$${qtd + 1}`

  const col = (chave: string) => CHAVES_VIAGEM.indexOf(chave) + 1
  const fim = PRIMEIRA_LINHA_DADOS + LINHAS_MODELO - 1
  const intervalo = (chave: string) => `${letra(col(chave))}${PRIMEIRA_LINHA_DADOS}:${letra(col(chave))}${fim}`
  const lista = (chave: string, formula: string, estrito: boolean, msg: string) =>
    validacoes.add(intervalo(chave), {
      type: 'list', allowBlank: true, formulae: [formula], showErrorMessage: true,
      errorStyle: estrito ? 'stop' : 'warning', errorTitle: 'Valor fora da lista', error: msg,
    })
  lista('obra', faixa('A', d.obras.length), false,
    'Obra fora da lista: a importação vai pedir para cadastrar a obra antes. Confirme só se for uma obra nova.')
  lista('categoria', faixa('B', d.categorias.length), true, 'Escolha uma categoria da lista (código gerencial).')
  lista('forma_pagamento', faixa('C', FORMAS_PAGAMENTO_VIAGEM.length), true, 'Escolha uma forma de pagamento da lista.')
  for (const chave of ['periodo_inicio', 'periodo_fim', 'data']) {
    validacoes.add(intervalo(chave), {
      type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(2020, 0, 1)],
      showErrorMessage: true, errorTitle: 'Data inválida', error: 'Digite a data como dd/mm/aaaa.',
    })
  }
  for (const chave of ['valor', 'adiantamento_recebido']) {
    validacoes.add(intervalo(chave), {
      type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0],
      showErrorMessage: true, errorTitle: 'Valor inválido', error: 'Digite só o número (ex.: 150,90).',
    })
  }
  for (let r = PRIMEIRA_LINHA_DADOS; r <= fim; r++) {
    for (const chave of ['periodo_inicio', 'periodo_fim', 'data']) ws.getCell(r, col(chave)).numFmt = 'dd/mm/yyyy'
    for (const chave of ['valor', 'adiantamento_recebido']) ws.getCell(r, col(chave)).numFmt = '#,##0.00'
  }

  // ── Instruções ─────────────────────────────────────────────────────────────
  wi.columns = [{ width: 30 }, { width: 100 }]
  const linhasInstr: [string, string][] = [
    ['Relatório de viagem', `${d.empresa} — modelo para preencher no computador ou no celular (Excel/Planilhas Google).`],
    ['Como preencher', 'Uma linha por despesa (hotel, refeição, combustível, pedágio…). Preencha a partir da linha 5 da aba "Lançamentos".'],
    ['Viagem', 'Colaborador + Obra + Período (início e fim) identificam a viagem. Repita os mesmos dados em todas as linhas da mesma viagem.'],
    ['Obra', 'Escolha na lista. Se a obra não estiver na lista, peça ao administrativo para cadastrar antes da importação.'],
    ['Datas', 'dd/mm/aaaa. A data da despesa tem de estar dentro do período da viagem.'],
    ['Categoria', 'Escolha pelo código gerencial (lista na aba "Listas"). Em dúvida, deixe a observação e o administrativo ajusta.'],
    ['Valor', 'Só o número, sem R$ (ex.: 150,90). Maior que zero.'],
    ['Forma de pagamento', 'Como a despesa foi paga. "Dinheiro/cartão próprio" = a empresa reembolsa o colaborador.'],
    ['Adiantamento recebido', 'Valor que o colaborador recebeu ANTES da viagem. É da viagem inteira: informe uma vez (na 1ª linha) ou repita o MESMO valor.'],
    ['Comprovantes', 'Guarde as notas/cupons; o nº pode ir na Observação. As fotos são anexadas na tela de viagem.'],
    ['Importação', 'O administrativo importa este arquivo na tela de viagem, sem redigitar. Não apague a linha 4 da aba "Lançamentos".'],
    ['', ''],
    ['Categorias desta empresa', ''],
    ...d.categorias.map((c): [string, string] => [c.codigo, c.descricao]),
    ['', ''],
    ['Formas de pagamento', ''],
    ...FORMAS_PAGAMENTO_VIAGEM.map((f): [string, string] => ['', f.rotulo]),
  ]
  linhasInstr.forEach(([a, b], i) => {
    wi.getCell(i + 1, 1).value = a
    wi.getCell(i + 1, 2).value = b
    wi.getCell(i + 1, 1).font = { bold: true, color: { argb: MARROM } }
    wi.getCell(i + 1, 2).alignment = { wrapText: true, vertical: 'top' }
  })
  wi.getCell(1, 1).font = { bold: true, size: 14, color: { argb: DOURADO } }

  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 0, visibility: 'visible' }]
  const buf = await wb.xlsx.writeBuffer()
  return new Uint8Array(buf as ArrayBuffer)
}

// ── Leitura (importação) ─────────────────────────────────────────────────────

export interface DespesaViagem {
  linha: number
  colaborador: string
  obra_numero: string
  periodo_inicio: string // yyyy-mm-dd
  periodo_fim: string
  data: string
  categoria_codigo: string
  descricao: string
  valor: number
  forma_pagamento: string // código de FORMAS_PAGAMENTO_VIAGEM
  adiantamento_recebido: number | null
  observacao: string | null
}

export interface ViagemAgrupada {
  chave: string
  colaborador: string
  obra_numero: string
  periodo_inicio: string
  periodo_fim: string
  adiantamento_recebido: number | null
  total_despesas: number
  despesas: DespesaViagem[]
}

export interface ErroLinha { linha: number; campo: string; mensagem: string }

export interface ResultadoLeitura {
  despesas: DespesaViagem[]
  viagens: ViagemAgrupada[]
  erros: ErroLinha[]
}

const iso = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`

export function lerData(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return iso(v)
  if (typeof v === 'number' && v > 20000 && v < 80000) return iso(new Date(Date.UTC(1899, 11, 30) + v * 86400000))
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
    if (m) {
      const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
      const d = new Date(Date.UTC(ano, Number(m[2]) - 1, Number(m[1])))
      if (d.getUTCDate() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1) return iso(d)
    }
    const i = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (i) return `${i[1]}-${i[2]}-${i[3]}`
  }
  return null
}

export function lerValor(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return Math.round(v * 100) / 100
  if (typeof v === 'string') {
    let s = v.replace(/R\$|\s/g, '')
    if (!s) return null
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
    const n = Number(s)
    return isFinite(n) ? Math.round(n * 100) / 100 : null
  }
  return null
}

function textoCelula(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] }
    if (o.richText) return o.richText.map((t) => t.text).join('').trim()
    if (typeof o.text === 'string') return o.text.trim()
    if ('result' in o) return textoCelula(o.result)
    if (v instanceof Date) return ''
  }
  return String(v).trim()
}

function valorCelula(v: unknown): unknown {
  if (v && typeof v === 'object' && !(v instanceof Date) && 'result' in (v as object)) return (v as { result: unknown }).result
  return v
}

export interface OpcoesLeitura {
  categoriasValidas: string[]
  obrasValidas: string[]
}

/** Lê o .xlsx preenchido. Não grava nada: devolve despesas, viagens agrupadas e erros por linha. */
export async function lerPlanilhaViagem(bytes: ArrayBuffer | Uint8Array, op: OpcoesLeitura): Promise<ResultadoLeitura> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(bytes instanceof Uint8Array ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) : bytes)
  const ws = wb.getWorksheet(ABA_LANCAMENTOS)
  const erros: ErroLinha[] = []
  if (!ws) return { despesas: [], viagens: [], erros: [{ linha: 0, campo: 'arquivo', mensagem: `Aba "${ABA_LANCAMENTOS}" não encontrada — use o modelo de viagem.` }] }

  const idx: Record<string, number> = {}
  ws.getRow(LINHA_CHAVES).eachCell((c, n) => { const k = textoCelula(c.value); if (k) idx[k] = n })
  const faltam = COLUNAS_VIAGEM.filter((c) => c.obrigatoria && !idx[c.chave]).map((c) => c.chave)
  if (faltam.length) return { despesas: [], viagens: [], erros: [{ linha: LINHA_CHAVES, campo: 'cabecalho', mensagem: `Linha 4 sem as colunas: ${faltam.join(', ')}. Use o modelo sem apagar a linha 4.` }] }

  const cats = new Set(op.categoriasValidas)
  const obras = new Set(op.obrasValidas)
  const formaPorRotulo = new Map<string, string>()
  for (const f of FORMAS_PAGAMENTO_VIAGEM) { formaPorRotulo.set(f.rotulo.toLowerCase(), f.codigo); formaPorRotulo.set(f.codigo, f.codigo) }

  const despesas: DespesaViagem[] = []
  for (let r = PRIMEIRA_LINHA_DADOS; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const bruto = (k: string) => (idx[k] ? valorCelula(row.getCell(idx[k]).value) : null)
    const txt = (k: string) => textoCelula(bruto(k))
    if (CHAVES_VIAGEM.every((k) => txt(k) === '' && !(bruto(k) instanceof Date) && typeof bruto(k) !== 'number')) continue
    const erro = (campo: string, mensagem: string) => erros.push({ linha: r, campo, mensagem })
    const antes = erros.length

    const colaborador = txt('colaborador')
    if (!colaborador) erro('colaborador', 'Informe o colaborador.')
    const obraTxt = txt('obra')
    const obra_numero = (obraTxt.match(/^\s*([A-Z]{2,4}-\d{4}-\d{3,})/i)?.[1] ?? obraTxt).toUpperCase()
    if (!obraTxt) erro('obra', 'Informe a obra.')
    else if (!obras.has(obra_numero)) erro('obra', `Obra "${obraTxt}" não cadastrada — cadastre a obra antes de importar.`)
    const ini = lerData(bruto('periodo_inicio'))
    const fimP = lerData(bruto('periodo_fim'))
    const data = lerData(bruto('data'))
    if (!ini) erro('periodo_inicio', 'Data de início inválida (dd/mm/aaaa).')
    if (!fimP) erro('periodo_fim', 'Data de fim inválida (dd/mm/aaaa).')
    if (ini && fimP && fimP < ini) erro('periodo_fim', 'Fim antes do início.')
    if (!data) erro('data', 'Data da despesa inválida (dd/mm/aaaa).')
    else if (ini && fimP && (data < ini || data > fimP)) erro('data', 'Data da despesa fora do período da viagem.')
    const catTxt = txt('categoria')
    const categoria_codigo = catTxt.match(/^\s*(\d+(?:\.\d+)*)/)?.[1] ?? ''
    if (!catTxt) erro('categoria', 'Informe a categoria.')
    else if (!cats.has(categoria_codigo)) erro('categoria', `Categoria "${catTxt}" não é uma das categorias da empresa (${[...cats].join(', ')}).`)
    const descricao = txt('descricao')
    if (!descricao) erro('descricao', 'Informe a descrição.')
    const valor = lerValor(bruto('valor'))
    if (valor == null || valor <= 0) erro('valor', 'Valor tem de ser um número maior que zero.')
    const forma = formaPorRotulo.get(txt('forma_pagamento').toLowerCase())
    if (!forma) erro('forma_pagamento', 'Escolha a forma de pagamento da lista.')
    const adTxt = txt('adiantamento_recebido')
    const adiantamento = adTxt === '' && typeof bruto('adiantamento_recebido') !== 'number' ? null : lerValor(bruto('adiantamento_recebido'))
    if ((adTxt !== '' || typeof bruto('adiantamento_recebido') === 'number') && (adiantamento == null || adiantamento < 0)) erro('adiantamento_recebido', 'Adiantamento inválido.')

    if (erros.length === antes) {
      despesas.push({
        linha: r, colaborador, obra_numero, periodo_inicio: ini!, periodo_fim: fimP!, data: data!, categoria_codigo,
        descricao, valor: valor!, forma_pagamento: forma!, adiantamento_recebido: adiantamento, observacao: txt('observacao') || null,
      })
    }
  }

  // agrupa por viagem; o adiantamento é da viagem (uma vez, ou o mesmo valor repetido)
  const mapa = new Map<string, ViagemAgrupada>()
  for (const d of despesas) {
    const chave = [d.colaborador.toLowerCase().replace(/\s+/g, ' '), d.obra_numero, d.periodo_inicio, d.periodo_fim].join('|')
    let v = mapa.get(chave)
    if (!v) {
      v = { chave, colaborador: d.colaborador, obra_numero: d.obra_numero, periodo_inicio: d.periodo_inicio, periodo_fim: d.periodo_fim, adiantamento_recebido: null, total_despesas: 0, despesas: [] }
      mapa.set(chave, v)
    }
    if (d.adiantamento_recebido != null) {
      if (v.adiantamento_recebido != null && v.adiantamento_recebido !== d.adiantamento_recebido) {
        erros.push({ linha: d.linha, campo: 'adiantamento_recebido', mensagem: `Adiantamento diferente na mesma viagem (${v.adiantamento_recebido} × ${d.adiantamento_recebido}). Informe uma vez só.` })
      } else v.adiantamento_recebido = d.adiantamento_recebido
    }
    v.despesas.push(d)
    v.total_despesas = Math.round((v.total_despesas + d.valor) * 100) / 100
  }
  return { despesas, viagens: [...mapa.values()], erros }
}
