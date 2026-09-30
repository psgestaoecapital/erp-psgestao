// Acerto de viagem — versão planilha (CEO 30/09 · Diego/FC). Os dados do "Acerto de viagem" que a FC usa hoje
// (viagem, motorista, placa, período, origem/destino, km inicial/final, despesas diversas por tipo com fornecedor,
// nº do documento e "pago pelo motorista", abastecimentos com posto/hodômetro/litros/tanque cheio, totais à vista e a
// prazo, média km/l, custo por km, adiantamento e saldo da prestação, assinatura) em layout PS, e com o que o ERP
// precisa: obra e categoria pelo código gerencial (FC: 2.05, 2.06, 5.01).
// Contrato ÚNICO entre o .xlsx que o colaborador preenche e a importação da tela de viagem do administrativo:
//   aba "Acerto": coluna A (chave técnica, cinza) · B (rótulo) · C (valor) — a importação lê pela chave da coluna A;
//   abas "Despesas" e "Abastecimentos": linha 4 = chaves técnicas, dados a partir da linha 5.
// Um arquivo = uma viagem. Gera e lê com exceljs (roda no navegador e no gate do build).

import ExcelJS from 'exceljs'

export const ABA_ACERTO = 'Acerto'
export const ABA_DESPESAS = 'Despesas'
export const ABA_ABASTECIMENTOS = 'Abastecimentos'
export const ABA_INSTRUCOES = 'Instruções'
export const ABA_LISTAS = 'Listas'
export const LINHA_CHAVES = 4
export const PRIMEIRA_LINHA_DADOS = 5
export const LINHAS_DESPESAS = 200
export const LINHAS_ABASTECIMENTOS = 60

export interface Campo { chave: string; titulo: string; obrigatoria: boolean; largura: number; ajuda: string }

export const CAMPOS_CABECALHO: readonly Campo[] = [
  { chave: 'viagem_numero', titulo: 'Nº da viagem', obrigatoria: false, largura: 0, ajuda: 'Se a empresa numera as viagens' },
  { chave: 'colaborador', titulo: 'Colaborador (motorista)', obrigatoria: true, largura: 0, ajuda: 'Nome completo' },
  { chave: 'obra', titulo: 'Obra', obrigatoria: true, largura: 0, ajuda: 'Escolha na lista' },
  { chave: 'placa', titulo: 'Placa(s)', obrigatoria: false, largura: 0, ajuda: 'Ex.: RYF1G36' },
  { chave: 'periodo_inicio', titulo: 'Período — saída', obrigatoria: true, largura: 0, ajuda: 'dd/mm/aaaa' },
  { chave: 'periodo_fim', titulo: 'Período — volta', obrigatoria: true, largura: 0, ajuda: 'dd/mm/aaaa' },
  { chave: 'origem', titulo: 'Origem (cidade/UF)', obrigatoria: false, largura: 0, ajuda: 'Ex.: Iporã do Oeste/SC' },
  { chave: 'destino', titulo: 'Destino (cidade/UF)', obrigatoria: false, largura: 0, ajuda: 'Ex.: Promissão/SP' },
  { chave: 'km_inicial', titulo: 'Km inicial', obrigatoria: false, largura: 0, ajuda: 'Hodômetro na saída' },
  { chave: 'km_final', titulo: 'Km final', obrigatoria: false, largura: 0, ajuda: 'Hodômetro na volta' },
  { chave: 'adiantamento_recebido', titulo: 'Adiantamento recebido (R$)', obrigatoria: false, largura: 0, ajuda: 'O que recebeu antes da viagem' },
  { chave: 'observacao', titulo: 'Observação', obrigatoria: false, largura: 0, ajuda: 'Opcional' },
] as const

// Perfil transporte (CEO 30/09: "não agora" para a FC, mas pronto para um cliente de transporte, como opção por empresa).
// Os dados de transportadora do acerto (DotSE): peso da carga, km vazio/carregado, fretes, salário do motorista e o
// rendimento da viagem. Só entram no modelo quando o perfil da empresa é 'transporte'.
export type PerfilAcerto = 'padrao' | 'transporte'

export const CAMPOS_TRANSPORTE: readonly Campo[] = [
  { chave: 'peso_carga', titulo: 'Peso da carga (kg)', obrigatoria: false, largura: 0, ajuda: 'Peso líquido transportado' },
  { chave: 'km_vazio', titulo: 'Km vazio', obrigatoria: false, largura: 0, ajuda: 'Km rodados sem carga' },
  { chave: 'km_carregado', titulo: 'Km carregado', obrigatoria: false, largura: 0, ajuda: 'Km rodados com carga' },
  { chave: 'frete_total', titulo: 'Total de fretes (R$)', obrigatoria: false, largura: 0, ajuda: 'Receita de frete da viagem' },
  { chave: 'frete_a_vista', titulo: 'Fretes à vista (R$)', obrigatoria: false, largura: 0, ajuda: 'Parte do frete recebida pelo motorista' },
  { chave: 'salario_motorista', titulo: 'Salário do motorista (R$)', obrigatoria: false, largura: 0, ajuda: 'Comissão/salário da viagem' },
] as const

export const camposCabecalho = (perfil: PerfilAcerto = 'padrao'): readonly Campo[] =>
  perfil === 'transporte' ? [...CAMPOS_CABECALHO, ...CAMPOS_TRANSPORTE] : CAMPOS_CABECALHO

export const COLUNAS_DESPESAS: readonly Campo[] = [
  { chave: 'data', titulo: 'Data', obrigatoria: true, largura: 12, ajuda: 'Dentro do período' },
  { chave: 'fornecedor', titulo: 'Fornecedor', obrigatoria: true, largura: 34, ajuda: 'Restaurante, hotel, posto…' },
  { chave: 'documento', titulo: 'Nº documento', obrigatoria: false, largura: 13, ajuda: 'Nº da nota/cupom' },
  { chave: 'tipo', titulo: 'Tipo', obrigatoria: true, largura: 20, ajuda: 'Escolha na lista' },
  { chave: 'categoria', titulo: 'Categoria (código gerencial)', obrigatoria: true, largura: 36, ajuda: 'Escolha na lista' },
  { chave: 'descricao', titulo: 'Observação', obrigatoria: false, largura: 30, ajuda: 'Ex.: 3 dias de marmita' },
  { chave: 'forma_pagamento', titulo: 'Forma de pagamento', obrigatoria: true, largura: 20, ajuda: 'Escolha na lista' },
  { chave: 'pago_colaborador', titulo: 'Pago pelo colaborador?', obrigatoria: true, largura: 13, ajuda: 'Sim = saiu do adiantamento ou do bolso' },
  { chave: 'valor', titulo: 'Valor (R$)', obrigatoria: true, largura: 13, ajuda: 'Maior que zero' },
] as const

export const COLUNAS_ABASTECIMENTOS: readonly Campo[] = [
  { chave: 'data', titulo: 'Data', obrigatoria: true, largura: 12, ajuda: 'Dentro do período' },
  { chave: 'placa', titulo: 'Placa', obrigatoria: true, largura: 11, ajuda: 'Veículo abastecido' },
  { chave: 'posto', titulo: 'Posto de combustível', obrigatoria: true, largura: 34, ajuda: 'Nome do posto' },
  { chave: 'documento', titulo: 'Nº documento', obrigatoria: false, largura: 13, ajuda: 'Nº da nota/cupom' },
  { chave: 'hodometro', titulo: 'Hodômetro (km)', obrigatoria: true, largura: 13, ajuda: 'Km no painel ao abastecer' },
  { chave: 'litros', titulo: 'Litros', obrigatoria: true, largura: 10, ajuda: 'Ex.: 75,44' },
  { chave: 'valor', titulo: 'Valor total (R$)', obrigatoria: true, largura: 14, ajuda: 'Maior que zero' },
  { chave: 'valor_litro', titulo: 'R$/litro', obrigatoria: false, largura: 10, ajuda: 'Calculado' },
  { chave: 'tanque_cheio', titulo: 'Tanque cheio?', obrigatoria: true, largura: 11, ajuda: 'Sim/Não (a média só vale entre tanques cheios)' },
  { chave: 'forma_pagamento', titulo: 'Forma de pagamento', obrigatoria: true, largura: 20, ajuda: 'Escolha na lista' },
  { chave: 'pago_colaborador', titulo: 'Pago pelo colaborador?', obrigatoria: true, largura: 13, ajuda: 'Sim/Não' },
] as const

export const TIPOS_DESPESA = ['Alimentação', 'Hospedagem', 'Pedágio', 'Estacionamento', 'Manutenção do veículo', 'Passagem/transporte', 'Material de obra', 'Outras despesas'] as const

export const FORMAS_PAGAMENTO_VIAGEM = [
  { codigo: 'dinheiro', rotulo: 'Dinheiro', a_prazo: false },
  { codigo: 'cartao_empresa', rotulo: 'Cartão da empresa', a_prazo: false },
  { codigo: 'cartao_proprio', rotulo: 'Cartão próprio', a_prazo: false },
  { codigo: 'pix', rotulo: 'PIX', a_prazo: false },
  { codigo: 'a_prazo', rotulo: 'A prazo (faturado p/ empresa)', a_prazo: true },
] as const

export interface ObraLista { numero: string; nome: string }
export interface CategoriaLista { codigo: string; descricao: string }
export interface DadosModelo { empresa: string; cnpj?: string; obras: ObraLista[]; categorias: CategoriaLista[]; perfil?: PerfilAcerto }

export const rotuloObra = (o: ObraLista) => `${o.numero} · ${o.nome}`
export const rotuloCategoria = (c: CategoriaLista) => `${c.codigo} · ${c.descricao}`

const MARROM = 'FF3D2314'
const DOURADO = 'FFC8941A'
const CREME = 'FFFAF7F2'
const CINZA = 'FF8A7A6E'
const CINZA_CLARO = 'FFD9CFC2'
const BORDA = { style: 'thin' as const, color: { argb: 'FFE7DECF' } }

function letra(n: number): string {
  let s = ''
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s
  return s
}

type Validacoes = { add(range: string, dv: ExcelJS.DataValidation): void }
// exceljs 4.4 tem worksheet.dataValidations.add em runtime, mas o .d.ts não declara
const validacoes = (ws: ExcelJS.Worksheet) => (ws as unknown as { dataValidations: Validacoes }).dataValidations

function tabela(ws: ExcelJS.Worksheet, titulo: string, colunas: readonly Campo[], linhas: number) {
  const n = colunas.length
  ws.columns = colunas.map((c) => ({ width: c.largura }))
  ws.views = [{ state: 'frozen', ySplit: LINHA_CHAVES }]
  ws.mergeCells(1, 1, 1, n)
  ws.getCell(1, 1).value = titulo
  ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: MARROM } }
  ws.mergeCells(2, 1, 2, n)
  ws.getCell(2, 1).value = 'Uma linha por comprovante. Não apague nem altere a linha 4 (é o que o sistema lê na importação).'
  ws.getCell(2, 1).font = { italic: true, size: 10, color: { argb: 'FF6B4B33' } }
  colunas.forEach((c, i) => {
    const h = ws.getCell(3, i + 1)
    h.value = c.obrigatoria ? `${c.titulo} *` : c.titulo
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MARROM } }
    h.alignment = { vertical: 'middle', wrapText: true }
    h.note = c.ajuda
    const k = ws.getCell(LINHA_CHAVES, i + 1)
    k.value = c.chave
    k.font = { size: 8, color: { argb: CINZA } }
    k.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CREME } }
  })
  ws.getRow(3).height = 32
  const fim = PRIMEIRA_LINHA_DADOS + linhas - 1
  const col = (chave: string) => colunas.findIndex((c) => c.chave === chave) + 1
  const faixa = (chave: string) => `${letra(col(chave))}${PRIMEIRA_LINHA_DADOS}:${letra(col(chave))}${fim}`
  return { fim, col, faixa, letra: (chave: string) => letra(col(chave)) }
}

const A4 = (orientation: 'portrait' | 'landscape') => ({ pageSetup: { paperSize: 9 as const, orientation, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } })

export async function gerarModeloViagem(d: DadosModelo): Promise<Uint8Array> {
  if (d.obras.length === 0) throw new Error('Cadastre ao menos uma obra antes de gerar o modelo.')
  if (d.categorias.length === 0) throw new Error('Informe ao menos uma categoria gerencial.')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'PS Gestão'
  wb.created = new Date()

  const wa = wb.addWorksheet(ABA_ACERTO, A4('portrait'))
  const wd = wb.addWorksheet(ABA_DESPESAS, A4('landscape'))
  const wab = wb.addWorksheet(ABA_ABASTECIMENTOS, A4('landscape'))
  const wi = wb.addWorksheet(ABA_INSTRUCOES)
  const wl = wb.addWorksheet(ABA_LISTAS)

  // ── Listas ──────────────────────────────────────────────────────────────────
  wl.columns = [{ width: 58 }, { width: 46 }, { width: 30 }, { width: 24 }, { width: 8 }]
  const listas: [string, string[]][] = [
    ['Obras', d.obras.map(rotuloObra)],
    ['Categorias (código gerencial)', d.categorias.map(rotuloCategoria)],
    ['Formas de pagamento', FORMAS_PAGAMENTO_VIAGEM.map((f) => f.rotulo)],
    ['Tipos de despesa', [...TIPOS_DESPESA]],
    ['Sim/Não', ['Sim', 'Não']],
  ]
  listas.forEach(([titulo, valores], i) => {
    const c = wl.getCell(1, i + 1)
    c.value = titulo
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MARROM } }
    valores.forEach((v, j) => { wl.getCell(j + 2, i + 1).value = v })
  })
  const faixaLista = (i: number) => `'${ABA_LISTAS}'!$${letra(i + 1)}$2:$${letra(i + 1)}$${listas[i][1].length + 1}`
  const lista = (ws: ExcelJS.Worksheet, ref: string, i: number, estrito: boolean, msg: string) =>
    validacoes(ws).add(ref, {
      type: 'list', allowBlank: true, formulae: [faixaLista(i)], showErrorMessage: true,
      errorStyle: estrito ? 'stop' : 'warning', errorTitle: 'Valor fora da lista', error: msg,
    })
  const dataVal = (ws: ExcelJS.Worksheet, ref: string) => validacoes(ws).add(ref, {
    type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(2020, 0, 1)],
    showErrorMessage: true, errorTitle: 'Data inválida', error: 'Digite a data como dd/mm/aaaa.',
  })
  const numVal = (ws: ExcelJS.Worksheet, ref: string) => validacoes(ws).add(ref, {
    type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0],
    showErrorMessage: true, errorTitle: 'Número inválido', error: 'Digite só o número (ex.: 150,90).',
  })

  // ── Despesas ────────────────────────────────────────────────────────────────
  const D = tabela(wd, 'Despesas diversas da viagem', COLUNAS_DESPESAS, LINHAS_DESPESAS)
  dataVal(wd, D.faixa('data'))
  lista(wd, D.faixa('tipo'), 3, false, 'Tipo fora da lista — use "Outras despesas" e explique na observação.')
  lista(wd, D.faixa('categoria'), 1, true, 'Escolha uma categoria da lista (código gerencial).')
  lista(wd, D.faixa('forma_pagamento'), 2, true, 'Escolha uma forma de pagamento da lista.')
  lista(wd, D.faixa('pago_colaborador'), 4, true, 'Sim ou Não.')
  numVal(wd, D.faixa('valor'))
  for (let r = PRIMEIRA_LINHA_DADOS; r <= D.fim; r++) {
    wd.getCell(r, D.col('data')).numFmt = 'dd/mm/yyyy'
    wd.getCell(r, D.col('valor')).numFmt = '#,##0.00'
  }

  // ── Abastecimentos ──────────────────────────────────────────────────────────
  const A = tabela(wab, 'Despesas com abastecimento', COLUNAS_ABASTECIMENTOS, LINHAS_ABASTECIMENTOS)
  dataVal(wab, A.faixa('data'))
  lista(wab, A.faixa('forma_pagamento'), 2, true, 'Escolha uma forma de pagamento da lista.')
  lista(wab, A.faixa('tanque_cheio'), 4, true, 'Sim ou Não.')
  lista(wab, A.faixa('pago_colaborador'), 4, true, 'Sim ou Não.')
  for (const k of ['hodometro', 'litros', 'valor']) numVal(wab, A.faixa(k))
  for (let r = PRIMEIRA_LINHA_DADOS; r <= A.fim; r++) {
    wab.getCell(r, A.col('data')).numFmt = 'dd/mm/yyyy'
    wab.getCell(r, A.col('hodometro')).numFmt = '0'
    wab.getCell(r, A.col('litros')).numFmt = '#,##0.00'
    wab.getCell(r, A.col('valor')).numFmt = '#,##0.00'
    const L = A.letra('litros'), V = A.letra('valor')
    const c = wab.getCell(r, A.col('valor_litro'))
    c.value = { formula: `IF(AND(N(${L}${r})>0,N(${V}${r})>0),ROUND(${V}${r}/${L}${r},3),"")` }
    c.numFmt = '#,##0.000'
    c.font = { color: { argb: CINZA } }
  }

  // ── Acerto (dados da viagem + resumo + assinatura) ──────────────────────────
  wa.columns = [{ width: 3 }, { width: 30 }, { width: 42 }, { width: 3 }, { width: 34 }, { width: 18 }]
  wa.mergeCells('B1:F1')
  wa.getCell('B1').value = d.empresa + (d.cnpj ? ` · CNPJ ${d.cnpj}` : '')
  wa.getCell('B1').font = { bold: true, size: 11, color: { argb: MARROM } }
  wa.mergeCells('B2:F2')
  wa.getCell('B2').value = 'ACERTO DE VIAGEM'
  wa.getCell('B2').font = { bold: true, size: 16, color: { argb: DOURADO } }
  wa.mergeCells('B3:F3')
  wa.getCell('B3').value = 'Preencha a coluna C e as abas "Despesas" e "Abastecimentos". O resumo à direita calcula sozinho.'
  wa.getCell('B3').font = { italic: true, size: 9, color: { argb: 'FF6B4B33' } }
  wa.getCell('B4').value = 'DADOS DA VIAGEM'
  wa.getCell('B4').font = { bold: true, color: { argb: DOURADO } }

  const perfil: PerfilAcerto = d.perfil ?? 'padrao'
  const campos = camposCabecalho(perfil)
  const linhaCab: Record<string, number> = {}
  campos.forEach((c, i) => {
    const r = 5 + i
    linhaCab[c.chave] = r
    wa.getCell(r, 1).value = c.chave
    wa.getCell(r, 1).font = { size: 6, color: { argb: CINZA_CLARO } }
    wa.getCell(r, 2).value = c.obrigatoria ? `${c.titulo} *` : c.titulo
    wa.getCell(r, 2).font = { bold: true, color: { argb: MARROM } }
    const v = wa.getCell(r, 3)
    v.border = { top: BORDA, left: BORDA, bottom: BORDA, right: BORDA }
    v.note = c.ajuda
    if (c.chave.startsWith('periodo')) { v.numFmt = 'dd/mm/yyyy'; dataVal(wa, `C${r}`) }
    if (c.chave.startsWith('km_')) { v.numFmt = '0'; numVal(wa, `C${r}`) }
    if (c.chave === 'adiantamento_recebido' || ['frete_total', 'frete_a_vista', 'salario_motorista'].includes(c.chave)) { v.numFmt = '#,##0.00'; numVal(wa, `C${r}`) }
    if (c.chave === 'peso_carga') { v.numFmt = '#,##0.00'; numVal(wa, `C${r}`) }
  })
  lista(wa, `C${linhaCab.obra}`, 0, false, 'Obra fora da lista: a importação vai pedir para cadastrar a obra antes.')

  // resumo (colunas E:F) — fórmulas sobre as abas; linhas fixas a partir da 5
  const dR = (k: string) => `'${ABA_DESPESAS}'!$${D.letra(k)}$${PRIMEIRA_LINHA_DADOS}:$${D.letra(k)}$${D.fim}`
  const aR = (k: string) => `'${ABA_ABASTECIMENTOS}'!$${A.letra(k)}$${PRIMEIRA_LINHA_DADOS}:$${A.letra(k)}$${A.fim}`
  const aPrazo = FORMAS_PAGAMENTO_VIAGEM.find((f) => f.a_prazo)!.rotulo
  const C = (k: string) => `$C$${linhaCab[k]}`
  const R0 = 5
  const resumo: [string, string, (l: Record<string, string>) => string, string][] = [
    ['res_despesas', 'Despesas diversas', () => `SUM(${dR('valor')})`, '#,##0.00'],
    ['res_abastecimentos', 'Abastecimentos', () => `SUM(${aR('valor')})`, '#,##0.00'],
    ['res_total', 'TOTAL DAS DESPESAS', (l) => `${l.res_despesas}+${l.res_abastecimentos}`, '#,##0.00'],
    ['res_a_prazo', 'a prazo (faturado p/ empresa)', () => `SUMIF(${dR('forma_pagamento')},"${aPrazo}",${dR('valor')})+SUMIF(${aR('forma_pagamento')},"${aPrazo}",${aR('valor')})`, '#,##0.00'],
    ['res_a_vista', 'à vista', (l) => `${l.res_total}-${l.res_a_prazo}`, '#,##0.00'],
    ['res_pago_colaborador', 'Pago pelo colaborador', () => `SUMIF(${dR('pago_colaborador')},"Sim",${dR('valor')})+SUMIF(${aR('pago_colaborador')},"Sim",${aR('valor')})`, '#,##0.00'],
    ['res_adiantamento', 'Adiantamento recebido', () => `N(${C('adiantamento_recebido')})`, '#,##0.00'],
    ['res_saldo', 'SALDO DA PRESTAÇÃO', (l) => `${l.res_adiantamento}-${l.res_pago_colaborador}`, '#,##0.00'],
    ['res_saldo_texto', '', (l) => `IF(${l.res_saldo}>0,"colaborador devolve à empresa",IF(${l.res_saldo}<0,"empresa reembolsa o colaborador","acertado"))`, '@'],
    ['res_km', 'Km rodado', () => `IF(AND(N(${C('km_final')})>0,N(${C('km_final')})>=N(${C('km_inicial')})),${C('km_final')}-${C('km_inicial')},"")`, '0'],
    ['res_litros', 'Litros abastecidos', () => `SUM(${aR('litros')})`, '#,##0.00'],
    ['res_media', 'Média (km/l)', (l) => `IF(AND(N(${l.res_km})>0,N(${l.res_litros})>0),ROUND(${l.res_km}/${l.res_litros},2),"")`, '#,##0.00'],
    ['res_custo_km', 'Custo por km (R$)', (l) => `IF(N(${l.res_km})>0,ROUND(${l.res_total}/${l.res_km},2),"")`, '#,##0.00'],
    ...(perfil === 'transporte' ? ([
      ['res_frete', 'TOTAL DE FRETES', () => `N(${C('frete_total')})`, '#,##0.00'],
      ['res_salario', 'Salário do motorista', () => `N(${C('salario_motorista')})`, '#,##0.00'],
      ['res_rendimento', 'RENDIMENTO DA VIAGEM', (l) => `${l.res_frete}-${l.res_total}-${l.res_salario}`, '#,##0.00'],
      ['res_rendimento_km', 'Rendimento por km (R$)', (l) => `IF(N(${l.res_km})>0,ROUND(${l.res_rendimento}/${l.res_km},2),"")`, '#,##0.00'],
    ] as [string, string, (l: Record<string, string>) => string, string][]) : []),
  ]
  const ref: Record<string, string> = {}
  resumo.forEach(([chave], i) => { ref[chave] = `F${R0 + i}` })
  wa.getCell('E4').value = 'RESUMO'
  wa.getCell('E4').font = { bold: true, color: { argb: DOURADO } }
  resumo.forEach(([chave, rotulo, formula, fmt], i) => {
    const r = R0 + i
    const forte = rotulo !== '' && rotulo === rotulo.toUpperCase()
    wa.getCell(r, 4).value = chave
    wa.getCell(r, 4).font = { size: 6, color: { argb: CINZA_CLARO } }
    wa.getCell(r, 5).value = rotulo
    wa.getCell(r, 5).font = { bold: forte, color: { argb: MARROM } }
    const v = wa.getCell(r, 6)
    v.value = { formula: formula(ref) }
    v.numFmt = fmt
    v.font = { bold: forte, color: { argb: MARROM } }
    v.alignment = { horizontal: 'right' }
    if (forte) v.border = { top: BORDA }
  })
  const rCat = R0 + resumo.length + 1
  wa.getCell(rCat, 5).value = 'POR CATEGORIA GERENCIAL'
  wa.getCell(rCat, 5).font = { bold: true, color: { argb: DOURADO } }
  d.categorias.forEach((c, i) => {
    const r = rCat + 1 + i
    wa.getCell(r, 5).value = rotuloCategoria(c)
    wa.getCell(r, 6).value = { formula: `SUMIF(${dR('categoria')},"${rotuloCategoria(c)}",${dR('valor')})` + (c.codigo === '2.06' ? `+SUM(${aR('valor')})` : '') }
    wa.getCell(r, 6).numFmt = '#,##0.00'
  })
  const rAss = Math.max(rCat + d.categorias.length + 4, 5 + campos.length + 4)
  wa.getCell(rAss, 2).value = '________________________________'
  wa.getCell(rAss + 1, 2).value = 'Assinatura do colaborador'
  wa.getCell(rAss, 5).value = '________________________________'
  wa.getCell(rAss + 1, 5).value = 'Conferido por (administrativo)'
  for (const c of [wa.getCell(rAss + 1, 2), wa.getCell(rAss + 1, 5)]) c.font = { bold: true, color: { argb: MARROM } }

  // ── Instruções ──────────────────────────────────────────────────────────────
  wi.columns = [{ width: 28 }, { width: 100 }]
  const instr: [string, string][] = [
    ['Acerto de viagem', `${d.empresa} — um arquivo por viagem. Preencha no computador ou no celular (Excel/Planilhas Google).`],
    ['1. Aba "Acerto"', 'Dados da viagem (coluna C): colaborador, obra, placa, período, origem/destino, km inicial e final, adiantamento recebido. O RESUMO ao lado calcula sozinho.'],
    ['2. Aba "Despesas"', 'Uma linha por comprovante (refeição, hotel, pedágio…): data, fornecedor, nº do documento, tipo, categoria gerencial, forma de pagamento, se foi pago pelo colaborador e o valor.'],
    ['3. Aba "Abastecimentos"', 'Uma linha por abastecimento: data, placa, posto, hodômetro, litros, valor, se encheu o tanque, forma de pagamento e se foi pago pelo colaborador. O R$/litro é calculado.'],
    ['Pago pelo colaborador?', '"Sim" quando saiu do adiantamento ou do bolso do colaborador. "Não" quando foi no cartão da empresa ou faturado para a empresa.'],
    ['Saldo da prestação', 'Adiantamento recebido − o que o colaborador pagou. Positivo: o colaborador devolve. Negativo: a empresa reembolsa.'],
    ['À vista × a prazo', '"A prazo (faturado p/ empresa)" = o fornecedor cobra a empresa depois (vira conta a pagar). O resto é à vista.'],
    ['Categoria', 'Pelo código gerencial da empresa (aba "Listas"). Abastecimento entra em 2.06 (veículos e equipamentos de obra).'],
    ['Datas e números', 'Datas dd/mm/aaaa, dentro do período da viagem. Valores só com número (ex.: 150,90), sem R$.'],
    ['Importação', 'O administrativo importa este arquivo na tela de viagem, sem redigitar. Não apague a coluna A da aba "Acerto" nem a linha 4 das abas de lançamentos.'],
    ...(perfil === 'transporte' ? [['Transporte', 'Peso da carga, km vazio/carregado, fretes (total e à vista) e salário do motorista entram no resumo: rendimento da viagem = fretes − despesas − salário.'] as [string, string]] : []),
    ['', ''],
    ['Categorias desta empresa', ''],
    ...d.categorias.map((c): [string, string] => [c.codigo, c.descricao]),
  ]
  instr.forEach(([a, b], i) => {
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

export interface CabecalhoViagem {
  viagem_numero: string | null
  colaborador: string
  obra_numero: string
  placa: string | null
  periodo_inicio: string // yyyy-mm-dd
  periodo_fim: string
  origem: string | null
  destino: string | null
  km_inicial: number | null
  km_final: number | null
  adiantamento_recebido: number
  observacao: string | null
  transporte: DadosTransporte | null // só no perfil transporte (campos presentes na aba Acerto)
}

export interface DadosTransporte {
  peso_carga: number | null; km_vazio: number | null; km_carregado: number | null
  frete_total: number; frete_a_vista: number; salario_motorista: number
}

export interface DespesaViagem {
  linha: number; data: string; fornecedor: string; documento: string | null; tipo: string; categoria_codigo: string
  descricao: string | null; forma_pagamento: string; pago_colaborador: boolean; valor: number
}

export interface AbastecimentoViagem {
  linha: number; data: string; placa: string; posto: string; documento: string | null; hodometro: number; litros: number
  valor: number; tanque_cheio: boolean; forma_pagamento: string; pago_colaborador: boolean; categoria_codigo: string
}

export interface ResumoViagem {
  total_despesas: number; total_abastecimentos: number; total: number; a_prazo: number; a_vista: number
  pago_colaborador: number; adiantamento: number; saldo: number; km_rodado: number | null; litros: number
  media_km_l: number | null; custo_km: number | null; por_categoria: Record<string, number>
  transporte: { frete_total: number; salario_motorista: number; rendimento: number; rendimento_km: number | null } | null
}

export interface ErroLinha { aba: string; linha: number; campo: string; mensagem: string }

export interface ResultadoLeitura {
  cabecalho: CabecalhoViagem | null
  despesas: DespesaViagem[]
  abastecimentos: AbastecimentoViagem[]
  resumo: ResumoViagem | null
  erros: ErroLinha[]
}

const iso = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
const r2 = (n: number) => Math.round(n * 100) / 100

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
  if (typeof v === 'number' && isFinite(v)) return Math.round(v * 1000) / 1000
  if (typeof v === 'string') {
    let s = v.replace(/R\$|\s/g, '')
    if (!s) return null
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
    const n = Number(s)
    return isFinite(n) ? Math.round(n * 1000) / 1000 : null
  }
  return null
}

function valorCelula(v: unknown): unknown {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string }
    if (o.richText) return o.richText.map((t) => t.text).join('')
    if ('result' in o) return o.result
    if (typeof o.text === 'string') return o.text
  }
  return v
}
function texto(v: unknown): string {
  const x = valorCelula(v)
  if (x == null || x instanceof Date) return ''
  return String(x).trim()
}
const vazio = (v: unknown) => { const x = valorCelula(v); return x == null || (typeof x === 'string' && x.trim() === '') }
function simNao(v: unknown): boolean | null {
  const t = texto(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return t === 'sim' || t === 's' ? true : t === 'nao' || t === 'n' ? false : null
}

export interface OpcoesLeitura { categoriasValidas: string[]; obrasValidas: string[] }

/** Lê o acerto preenchido. Não grava nada: devolve cabeçalho, despesas, abastecimentos, resumo e erros por linha. */
export async function lerPlanilhaViagem(bytes: ArrayBuffer | Uint8Array, op: OpcoesLeitura): Promise<ResultadoLeitura> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(bytes instanceof Uint8Array ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) : bytes)
  const erros: ErroLinha[] = []
  const semNada: ResultadoLeitura = { cabecalho: null, despesas: [], abastecimentos: [], resumo: null, erros }
  const wa = wb.getWorksheet(ABA_ACERTO), wd = wb.getWorksheet(ABA_DESPESAS), wab = wb.getWorksheet(ABA_ABASTECIMENTOS)
  if (!wa || !wd || !wab) {
    erros.push({ aba: 'arquivo', linha: 0, campo: 'arquivo', mensagem: 'Abas "Acerto", "Despesas" e "Abastecimentos" não encontradas — use o modelo de acerto de viagem.' })
    return semNada
  }
  const cats = new Set(op.categoriasValidas)
  const obras = new Set(op.obrasValidas)
  const formaPorRotulo = new Map<string, string>()
  for (const f of FORMAS_PAGAMENTO_VIAGEM) { formaPorRotulo.set(f.rotulo.toLowerCase(), f.codigo); formaPorRotulo.set(f.codigo, f.codigo) }
  const catDe = (t: string) => t.match(/^\s*(\d+(?:\.\d+)*)/)?.[1] ?? ''

  // cabeçalho: chave na coluna A, valor na C
  const cab: Record<string, unknown> = {}
  const linhaDe: Record<string, number> = {}
  wa.eachRow((row, n) => { const k = texto(row.getCell(1).value); if (k) { cab[k] = valorCelula(row.getCell(3).value); linhaDe[k] = n } })
  const faltamChaves = CAMPOS_CABECALHO.filter((c) => c.obrigatoria && !(c.chave in linhaDe)).map((c) => c.chave)
  if (faltamChaves.length) {
    erros.push({ aba: ABA_ACERTO, linha: 0, campo: 'cabecalho', mensagem: `Aba "Acerto" sem os campos: ${faltamChaves.join(', ')}. Não apague a coluna A.` })
    return semNada
  }
  const eC = (campo: string, mensagem: string) => erros.push({ aba: ABA_ACERTO, linha: linhaDe[campo] ?? 0, campo, mensagem })
  const colaborador = texto(cab.colaborador)
  if (!colaborador) eC('colaborador', 'Informe o colaborador.')
  const obraTxt = texto(cab.obra)
  const obra_numero = (obraTxt.match(/^\s*([A-Z]{2,4}-\d{4}-\d{3,})/i)?.[1] ?? obraTxt).toUpperCase()
  if (!obraTxt) eC('obra', 'Informe a obra.')
  else if (!obras.has(obra_numero)) eC('obra', `Obra "${obraTxt}" não cadastrada — cadastre a obra antes de importar.`)
  const ini = lerData(cab.periodo_inicio), fim = lerData(cab.periodo_fim)
  if (!ini) eC('periodo_inicio', 'Data de saída inválida (dd/mm/aaaa).')
  if (!fim) eC('periodo_fim', 'Data de volta inválida (dd/mm/aaaa).')
  if (ini && fim && fim < ini) eC('periodo_fim', 'Volta antes da saída.')
  const kmIni = vazio(cab.km_inicial) ? null : lerValor(cab.km_inicial)
  const kmFim = vazio(cab.km_final) ? null : lerValor(cab.km_final)
  if (kmIni != null && kmFim != null && kmFim < kmIni) eC('km_final', 'Km final menor que o inicial.')
  const adiant = vazio(cab.adiantamento_recebido) ? 0 : lerValor(cab.adiantamento_recebido)
  if (adiant == null || adiant < 0) eC('adiantamento_recebido', 'Adiantamento inválido.')
  const cabecalho: CabecalhoViagem = {
    viagem_numero: texto(cab.viagem_numero) || null, colaborador, obra_numero, placa: texto(cab.placa) || null,
    periodo_inicio: ini ?? '', periodo_fim: fim ?? '', origem: texto(cab.origem) || null, destino: texto(cab.destino) || null,
    km_inicial: kmIni, km_final: kmFim, adiantamento_recebido: r2(adiant ?? 0), observacao: texto(cab.observacao) || null,
    transporte: null,
  }
  if (CAMPOS_TRANSPORTE.some((c) => c.chave in linhaDe)) {
    const num = (k: string, obrigatorioZero: boolean) => {
      if (vazio(cab[k])) return obrigatorioZero ? 0 : null
      const n = lerValor(cab[k])
      if (n == null || n < 0) { eC(k, 'Número inválido.'); return obrigatorioZero ? 0 : null }
      return n
    }
    cabecalho.transporte = {
      peso_carga: num('peso_carga', false), km_vazio: num('km_vazio', false), km_carregado: num('km_carregado', false),
      frete_total: r2(num('frete_total', true)!), frete_a_vista: r2(num('frete_a_vista', true)!), salario_motorista: r2(num('salario_motorista', true)!),
    }
  }

  const lerTabela = (ws: ExcelJS.Worksheet, aba: string, colunas: readonly Campo[]) => {
    const idx: Record<string, number> = {}
    ws.getRow(LINHA_CHAVES).eachCell((c, n) => { const k = texto(c.value); if (k) idx[k] = n })
    const faltam = colunas.filter((c) => c.obrigatoria && !idx[c.chave]).map((c) => c.chave)
    if (faltam.length) { erros.push({ aba, linha: LINHA_CHAVES, campo: 'cabecalho', mensagem: `Linha 4 sem as colunas: ${faltam.join(', ')}. Não apague a linha 4.` }); return [] }
    const linhas: { r: number; v: (k: string) => unknown }[] = []
    for (let r = PRIMEIRA_LINHA_DADOS; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const v = (k: string) => (idx[k] ? valorCelula(row.getCell(idx[k]).value) : null)
      if (colunas.filter((c) => c.chave !== 'valor_litro').every((c) => vazio(v(c.chave)))) continue
      linhas.push({ r, v })
    }
    return linhas
  }
  const dentro = (d: string) => !ini || !fim || (d >= ini && d <= fim)

  const despesas: DespesaViagem[] = []
  for (const { r, v } of lerTabela(wd, ABA_DESPESAS, COLUNAS_DESPESAS)) {
    const antes = erros.length
    const e = (campo: string, mensagem: string) => erros.push({ aba: ABA_DESPESAS, linha: r, campo, mensagem })
    const data = lerData(v('data'))
    if (!data) e('data', 'Data inválida (dd/mm/aaaa).'); else if (!dentro(data)) e('data', 'Data fora do período da viagem.')
    const fornecedor = texto(v('fornecedor')); if (!fornecedor) e('fornecedor', 'Informe o fornecedor.')
    const tipo = texto(v('tipo')); if (!tipo) e('tipo', 'Informe o tipo.')
    const catTxt = texto(v('categoria')); const cat = catDe(catTxt)
    if (!catTxt) e('categoria', 'Informe a categoria.')
    else if (!cats.has(cat)) e('categoria', `Categoria "${catTxt}" não é da empresa (${[...cats].join(', ')}).`)
    const forma = formaPorRotulo.get(texto(v('forma_pagamento')).toLowerCase()); if (!forma) e('forma_pagamento', 'Escolha a forma de pagamento da lista.')
    const pago = simNao(v('pago_colaborador')); if (pago == null) e('pago_colaborador', 'Pago pelo colaborador: Sim ou Não.')
    const valor = lerValor(v('valor')); if (valor == null || valor <= 0) e('valor', 'Valor tem de ser maior que zero.')
    if (erros.length === antes) despesas.push({
      linha: r, data: data!, fornecedor, documento: texto(v('documento')) || null, tipo, categoria_codigo: cat,
      descricao: texto(v('descricao')) || null, forma_pagamento: forma!, pago_colaborador: pago!, valor: r2(valor!),
    })
  }

  const catAbast = cats.has('2.06') ? '2.06' : ([...cats][0] ?? '')
  const abastecimentos: AbastecimentoViagem[] = []
  for (const { r, v } of lerTabela(wab, ABA_ABASTECIMENTOS, COLUNAS_ABASTECIMENTOS)) {
    const antes = erros.length
    const e = (campo: string, mensagem: string) => erros.push({ aba: ABA_ABASTECIMENTOS, linha: r, campo, mensagem })
    const data = lerData(v('data'))
    if (!data) e('data', 'Data inválida (dd/mm/aaaa).'); else if (!dentro(data)) e('data', 'Data fora do período da viagem.')
    const placa = texto(v('placa')).toUpperCase(); if (!placa) e('placa', 'Informe a placa.')
    const posto = texto(v('posto')); if (!posto) e('posto', 'Informe o posto.')
    const hod = lerValor(v('hodometro'))
    if (hod == null || hod <= 0) e('hodometro', 'Informe o hodômetro.')
    else if ((kmIni != null && hod < kmIni) || (kmFim != null && hod > kmFim)) e('hodometro', 'Hodômetro fora do km inicial/final da viagem.')
    const litros = lerValor(v('litros')); if (litros == null || litros <= 0) e('litros', 'Litros tem de ser maior que zero.')
    const valor = lerValor(v('valor')); if (valor == null || valor <= 0) e('valor', 'Valor tem de ser maior que zero.')
    const cheio = simNao(v('tanque_cheio')); if (cheio == null) e('tanque_cheio', 'Tanque cheio: Sim ou Não.')
    const forma = formaPorRotulo.get(texto(v('forma_pagamento')).toLowerCase()); if (!forma) e('forma_pagamento', 'Escolha a forma de pagamento da lista.')
    const pago = simNao(v('pago_colaborador')); if (pago == null) e('pago_colaborador', 'Pago pelo colaborador: Sim ou Não.')
    if (erros.length === antes) abastecimentos.push({
      linha: r, data: data!, placa, posto, documento: texto(v('documento')) || null, hodometro: hod!, litros: litros!,
      valor: r2(valor!), tanque_cheio: cheio!, forma_pagamento: forma!, pago_colaborador: pago!, categoria_codigo: catAbast,
    })
  }

  const soma = (xs: number[]) => r2(xs.reduce((s, x) => s + x, 0))
  const todos = [...despesas, ...abastecimentos]
  const total_despesas = soma(despesas.map((x) => x.valor))
  const total_abastecimentos = soma(abastecimentos.map((x) => x.valor))
  const total = r2(total_despesas + total_abastecimentos)
  const a_prazo = soma(todos.filter((x) => x.forma_pagamento === 'a_prazo').map((x) => x.valor))
  const pago_colaborador = soma(todos.filter((x) => x.pago_colaborador).map((x) => x.valor))
  const km_rodado = kmIni != null && kmFim != null && kmFim >= kmIni ? kmFim - kmIni : null
  const litros = Math.round(abastecimentos.reduce((s, x) => s + x.litros, 0) * 1000) / 1000
  const por_categoria: Record<string, number> = {}
  for (const x of [...despesas, ...abastecimentos]) por_categoria[x.categoria_codigo] = r2((por_categoria[x.categoria_codigo] ?? 0) + x.valor)
  const resumo: ResumoViagem = {
    total_despesas, total_abastecimentos, total, a_prazo, a_vista: r2(total - a_prazo), pago_colaborador,
    adiantamento: cabecalho.adiantamento_recebido, saldo: r2(cabecalho.adiantamento_recebido - pago_colaborador),
    km_rodado, litros, media_km_l: km_rodado && litros > 0 ? r2(km_rodado / litros) : null,
    custo_km: km_rodado ? r2(total / km_rodado) : null, por_categoria, transporte: null,
  }
  if (cabecalho.transporte) {
    const t = cabecalho.transporte
    const rendimento = r2(t.frete_total - total - t.salario_motorista)
    resumo.transporte = { frete_total: t.frete_total, salario_motorista: t.salario_motorista, rendimento, rendimento_km: km_rodado ? r2(rendimento / km_rodado) : null }
  }
  return { cabecalho, despesas, abastecimentos, resumo, erros }
}
