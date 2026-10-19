// #3188 (Jordana · Gean) · "Histórico de pagamentos" do título: uma linha por baixa (erp_receber_baixa /
// erp_pagar_baixa), com data, valor, forma, conta, quem registrou e se já está conciliada; rodapé com o valor do título,
// o total pago e o saldo em aberto. Função pura (sem rede) — a tela busca os dados sob RLS e monta aqui; o gate
// scripts/gates/check-historico-pagamentos.ts prova o caso do chamado ("Motor ducato").

export type TipoTitulo = 'receber' | 'pagar'

export type BaixaBruta = {
  id: string
  valor: number | string | null
  data: string | null
  forma: string | null
  origem: string | null
  movimento_banco_id: string | null
  criado_por: string | null
  criado_em: string | null
}

export type LinhaPagamento = {
  id: string
  data: string | null
  valor: number
  forma: string
  conta: string
  usuario: string
  registradoEm: string | null
  status: 'Recebido' | 'Pago' | 'Conciliado'
}

export type HistoricoPagamentos = {
  linhas: LinhaPagamento[]
  valorTitulo: number
  totalPago: number
  saldoAberto: number
}

// Rótulo legível da forma (nunca o código cru). Forma vazia: a origem diz como entrou.
const FORMA_LABEL: Record<string, string> = {
  conciliacao_bancaria: 'Conciliação bancária',
  pix: 'PIX', boleto: 'Boleto', ted: 'TED', doc: 'DOC', dinheiro: 'Dinheiro', cartao: 'Cartão',
  cartao_credito: 'Cartão de crédito', cartao_debito: 'Cartão de débito', transferencia: 'Transferência',
  cheque: 'Cheque', deposito: 'Depósito', debito_automatico: 'Débito automático',
}
const ORIGEM_LABEL: Record<string, string> = {
  conciliacao: 'Conciliação bancária', manual: 'Baixa manual', trigger_guarda: 'Baixa manual',
}

export function rotuloForma(forma: string | null, origem: string | null): string {
  const f = (forma ?? '').trim()
  if (f) return FORMA_LABEL[f.toLowerCase()] ?? f
  const o = (origem ?? '').trim()
  if (o) return ORIGEM_LABEL[o] ?? o
  return 'Não informada'
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function montarHistoricoPagamentos(args: {
  tipo: TipoTitulo
  valorTitulo: number | string | null
  contaTitulo: string | null
  baixas: BaixaBruta[]
  contaPorMovimento?: Record<string, string>
  nomePorUsuario?: Record<string, string>
}): HistoricoPagamentos {
  const { tipo, contaTitulo, baixas } = args
  const contaPorMovimento = args.contaPorMovimento ?? {}
  const nomePorUsuario = args.nomePorUsuario ?? {}
  const quitado: LinhaPagamento['status'] = tipo === 'receber' ? 'Recebido' : 'Pago'

  const linhas = baixas
    .map((b): LinhaPagamento => {
      const conciliada = !!b.movimento_banco_id
      const contaMov = b.movimento_banco_id ? contaPorMovimento[b.movimento_banco_id] : undefined
      return {
        id: b.id,
        data: b.data,
        valor: r2(Number(b.valor) || 0),
        forma: rotuloForma(b.forma, b.origem),
        conta: contaMov || (contaTitulo ?? '').trim() || 'Sem conta',
        usuario: (b.criado_por && nomePorUsuario[b.criado_por]) || (b.criado_por ? 'Usuário' : 'Sistema'),
        registradoEm: b.criado_em,
        status: conciliada ? 'Conciliado' : quitado,
      }
    })
    // ordem do dinheiro: data do pagamento; empate → quem foi registrado primeiro
    .sort((a, b) => (a.data ?? '').localeCompare(b.data ?? '') || (a.registradoEm ?? '').localeCompare(b.registradoEm ?? ''))

  const valorTitulo = r2(Number(args.valorTitulo) || 0)
  const totalPago = r2(linhas.reduce((s, l) => s + l.valor, 0))
  return { linhas, valorTitulo, totalPago, saldoAberto: r2(Math.max(valorTitulo - totalPago, 0)) }
}
