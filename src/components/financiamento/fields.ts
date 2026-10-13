export type FieldType = 'text' | 'number' | 'money' | 'percent' | 'date' | 'bool' | 'select'

export type Field = {
  key: string
  label: string
  type: FieldType
  opts?: string[]
  readOnly?: boolean
}

export type Section = {
  id: string
  label: string
  soConsorcio?: boolean
  fields: Field[]
}

export const SECTIONS: Section[] = [
  {
    id: 'identificacao',
    label: 'Identificação',
    fields: [
      { key: 'banco', label: 'Instituição / Banco', type: 'text' },
      { key: 'agencia', label: 'Agência', type: 'text' },
      { key: 'conta', label: 'Conta', type: 'text' },
      { key: 'contrato', label: 'Nº do contrato', type: 'text' },
      { key: 'modalidade', label: 'Modalidade', type: 'text' },
      { key: 'tipo_operacao', label: 'Tipo de operação', type: 'select',
        opts: ['financiamento', 'emprestimo', 'consorcio', 'leasing', 'ccb', 'repasse', 'antecipacao'] },
      { key: 'linha_produto', label: 'Linha / produto', type: 'text' },
      { key: 'finalidade', label: 'Finalidade', type: 'text' },
      { key: 'sistema_amortizacao', label: 'Sistema de amortização', type: 'select',
        opts: ['SAC', 'PRICE', 'SACRE', 'CONSORCIO'] },
      { key: 'status', label: 'Status', type: 'select',
        opts: ['ativo', 'em_carencia', 'quitado', 'encerrado', 'inadimplente', 'renegociado'] },
      { key: 'situacao', label: 'Situação', type: 'text' },
    ],
  },
  {
    id: 'valores',
    label: 'Valores',
    fields: [
      { key: 'valor_original', label: 'Valor de origem', type: 'money' },
      { key: 'valor_liquido', label: 'Valor líquido', type: 'money' },
      { key: 'iof', label: 'IOF', type: 'money' },
      { key: 'tarifas_abertura', label: 'Tarifas de abertura', type: 'money' },
      { key: 'cet', label: 'CET (% a.a.)', type: 'percent' },
      { key: 'saldo_devedor', label: 'Saldo de quitação', type: 'money' },
      { key: 'saldo_total_parcelas', label: 'Saldo total em parcelas', type: 'money' },
      { key: 'valor_amortizado', label: 'Já amortizado', type: 'money', readOnly: true },
      { key: 'juros_pagos', label: 'Juros já pagos', type: 'money', readOnly: true },
    ],
  },
  {
    id: 'taxas',
    label: 'Taxas',
    fields: [
      { key: 'taxa_mensal', label: 'Taxa a.m. (%)', type: 'percent' },
      { key: 'taxa_anual', label: 'Taxa a.a. (%)', type: 'percent' },
      { key: 'indexador', label: 'Indexador', type: 'select', opts: ['pre', 'cdi', 'ipca', 'tr', 'selic'] },
      { key: 'percentual_indexador', label: '% do indexador', type: 'percent' },
      { key: 'spread', label: 'Spread (%)', type: 'percent' },
    ],
  },
  {
    id: 'parcelas',
    label: 'Parcelas e prazo',
    fields: [
      { key: 'parcelas', label: 'Parcelas totais', type: 'number' },
      { key: 'parcelas_restantes', label: 'Restantes', type: 'number' },
      { key: 'parcelas_pagas', label: 'Pagas', type: 'number', readOnly: true },
      { key: 'valor_parcela', label: 'Parcela atual', type: 'money' },
      { key: 'parcela_futura', label: 'Parcela pós-carência', type: 'money' },
      { key: 'periodicidade', label: 'Periodicidade', type: 'select',
        opts: ['mensal', 'trimestral', 'semestral', 'anual'] },
      { key: 'dia_vencimento', label: 'Dia de vencimento', type: 'number' },
      { key: 'data_primeira_parcela', label: '1ª parcela', type: 'date' },
      { key: 'vencimento', label: 'Vencimento final', type: 'text' },
      { key: 'em_carencia', label: 'Em carência', type: 'bool' },
      { key: 'carencia_meses', label: 'Carência (meses)', type: 'number' },
      { key: 'carencia_fim', label: 'Fim da carência', type: 'date' },
      { key: 'carencia_tipo', label: 'Tipo de carência', type: 'select', opts: ['total', 'so_juros'] },
    ],
  },
  {
    id: 'datas',
    label: 'Datas',
    fields: [
      { key: 'data_origem', label: 'Contratação', type: 'date' },
      { key: 'data_liberacao', label: 'Liberação', type: 'date' },
      { key: 'data_posicao', label: 'Data da posição', type: 'date' },
    ],
  },
  {
    id: 'consorcio',
    label: 'Consórcio',
    soConsorcio: true,
    fields: [
      { key: 'administradora', label: 'Administradora', type: 'text' },
      { key: 'grupo', label: 'Grupo', type: 'text' },
      { key: 'cota', label: 'Cota', type: 'text' },
      { key: 'valor_carta_credito', label: 'Carta de crédito', type: 'money' },
      { key: 'taxa_administracao', label: 'Taxa adm (%)', type: 'percent' },
      { key: 'fundo_reserva', label: 'Fundo reserva (%)', type: 'percent' },
      { key: 'seguro', label: 'Seguro (%)', type: 'percent' },
      { key: 'fundo_comum', label: 'Fundo comum (%)', type: 'percent' },
      { key: 'prazo_grupo', label: 'Prazo do grupo', type: 'number' },
      { key: 'contemplado', label: 'Contemplado', type: 'bool' },
      { key: 'data_contemplacao', label: 'Data contemplação', type: 'date' },
      { key: 'forma_contemplacao', label: 'Forma', type: 'select', opts: ['lance', 'sorteio'] },
      { key: 'valor_lance', label: 'Valor do lance', type: 'money' },
    ],
  },
  {
    id: 'auditoria',
    label: 'Auditoria',
    fields: [
      { key: 'fonte_verificacao', label: 'Fonte / verificação', type: 'text' },
      { key: 'observacao', label: 'Observação', type: 'text' },
    ],
  },
]

export const brl = (n: unknown) =>
  (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export const fmt = (f: Field, v: unknown) => {
  if (v === null || v === undefined || v === '') return '—'
  if (f.type === 'money') return brl(v)
  if (f.type === 'percent')
    return (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + '%'
  if (f.type === 'bool') return v ? 'Sim' : 'Não'
  return String(v)
}
