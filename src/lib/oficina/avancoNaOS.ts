// #135 (Triches) · ajuste 21/10: no atendimento centralizado a OS anda na própria ficha — Iniciar serviço → Finalizar →
// Entregar —, sem obrigar Diagnóstico técnico nem Aprovação do cliente. Regra única usada pela ficha (OrdemServicoCard)
// e conferida pelo gate check-os-avanco-centralizado. O status grava pela fn_os_salvar (a mesma do seletor de status),
// que registra quem mudou e quando em audit_log_global. No modo com tablet nada muda (botões não aparecem).
import type { ModeloAtendimento } from './modelo'

export type PassoOS = { para: 'em_execucao' | 'pronta' | 'entregue'; rotulo: string; testid: string }

const INICIAR: PassoOS = { para: 'em_execucao', rotulo: 'Iniciar serviço', testid: 'os-iniciar' }
const FINALIZAR: PassoOS = { para: 'pronta', rotulo: 'Finalizar', testid: 'os-finalizar' }
const ENTREGAR: PassoOS = { para: 'entregue', rotulo: 'Entregar', testid: 'os-entregar' }

export function proximoPassoOS(modelo: ModeloAtendimento, status: string): PassoOS | null {
  if (modelo !== 'centralizado') return null
  if (['orcamento', 'aberta', 'aguardando_aprovacao', 'aprovada', 'aguardando_peca'].includes(status)) return INICIAR
  if (status === 'em_execucao') return FINALIZAR
  if (status === 'pronta') return ENTREGAR
  return null   // entregue / cancelada / desconhecido
}

// Ao iniciar, os itens ainda sem decisão são aprovados junto (o total da OS só soma item aprovado — sem isso a OS
// andaria com R$ 0,00). Item recusado continua recusado (RD-55). Só quem pode lançar valor aprova (mesma trava do
// banco); mecânico/operador avança o status e os itens pendentes ficam para quem pode aprovar.
export function aprovaPendentesAoAvancar(passo: PassoOS | null, podePreco: boolean, pendentes: number): boolean {
  return !!passo && podePreco && pendentes > 0
}
