// Regras puras da tela de viagem (as mesmas do banco, para avisar antes de enviar; o banco continua sendo o juiz).
export type LancamentoForm = {
  tipo: 'despesa' | 'abastecimento'; data: string; fornecedor_nome: string; categoria: string; forma_pagamento: string
  valor: string; obra_id: string; pago_colaborador: boolean; litros: string; hodometro: string
}

export function validarLancamento(f: LancamentoForm, ini: string, fim: string): string[] {
  const e: string[] = []
  if (!f.data || f.data < ini || f.data > fim) e.push('data fora do período da viagem')
  if (!f.fornecedor_nome.trim()) e.push('fornecedor obrigatório')
  if (!(Number(f.valor) > 0)) e.push('valor maior que zero')
  if (f.tipo === 'despesa' && !f.categoria) e.push('escolha a categoria')
  if (f.tipo === 'abastecimento') {
    if (!(Number(f.litros) > 0)) e.push('litros maior que zero')
    if (f.hodometro.trim() === '' || Number.isNaN(Number(f.hodometro))) e.push('hodômetro obrigatório')
  }
  return e
}

// saldo = adiantamento − pago pelo colaborador (mesma conta do fn_viagem_resumo)
export function resumoTexto(saldo: number): string {
  if (saldo > 0) return 'Colaborador devolve à empresa'
  if (saldo < 0) return 'Empresa reembolsa o colaborador'
  return 'Acertado'
}
