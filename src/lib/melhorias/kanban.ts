// Quadro de chamados (Fase 2 do #7050, CEO 09/11) — regra PURA de colunas. Sem rede, sem React: a tela e o gate usam
// a mesma função. Decisões do CEO:
//  1. Arquivados NÃO entram no quadro; só aparecem na busca (com a etiqueta ARQUIVADA).
//  2. "Minha carteira" = responsavel_id do chamado (o que a caixa usa), não erp_carteira_responsavel.
//  3. Sem dono (sem responsável e sem agente) fica em Pendentes com o selo "Sem dono".
//  4. "Aguardando usuário" só quando a resposta já foi APROVADA e enviada (resposta_aprovada) e o autor ainda não confirmou.
//  5. Retorno do usuário (reprova/inclui info) volta para "Em andamento" — o alerta visível é da Fase 3.

export type ColunaKanban = 'pendentes' | 'andamento' | 'aguardando' | 'finalizados'
export type FiltroKanban = 'gerais' | 'minha'

// Status que encerram o chamado (o trabalho acabou).
export const STATUS_FINALIZADO = ['concluida', 'concluido', 'resolvida', 'recusada', 'duplicada', 'implementado'] as const
export const STATUS_ARQUIVADO = 'arquivada'

export type ChamadoKanban = {
  status: string
  responsavel_id: string | null
  agente: string | null
  resposta_aprovada: boolean
  confirmado_pelo_autor: boolean
}

export const ehArquivado = (c: Pick<ChamadoKanban, 'status'>): boolean => c.status === STATUS_ARQUIVADO

export const semDono = (c: Pick<ChamadoKanban, 'responsavel_id' | 'agente'>): boolean =>
  !c.responsavel_id && !(c.agente && c.agente.trim())

// Coluna de um chamado. Arquivado não tem coluna (retorna null): fica só na busca.
export function colunaDoChamado(c: ChamadoKanban): ColunaKanban | null {
  if (ehArquivado(c)) return null
  if ((STATUS_FINALIZADO as readonly string[]).includes(c.status)) return 'finalizados'
  if (c.resposta_aprovada && !c.confirmado_pelo_autor) return 'aguardando'
  if (c.status === 'nova') return 'pendentes'
  if (c.status === 'em_analise') return semDono(c) ? 'pendentes' : 'andamento'
  // aceita, em_desenvolvimento, aguardando_confirmacao (sem resposta aprovada ainda) = trabalho em curso
  return 'andamento'
}

// Filtro "Minha carteira" / "Gerais". Minha carteira = responsável é a pessoa logada (decisão 2).
export function passaFiltro(c: ChamadoKanban, filtro: FiltroKanban, meuId: string | null): boolean {
  if (filtro === 'gerais') return true
  return !!meuId && c.responsavel_id === meuId
}

// Busca fixa do topo: número (com ou sem #), título, descrição, empresa, quem abriu e o nome do status.
// Vazia = não filtra. Acha finalizados e arquivados (a busca não olha a coluna).
export function casaBusca(
  q: { numero: number; titulo: string | null; descricao: string; empresa: string | null; user_name: string | null; status: string },
  termo: string,
  rotuloStatus: (s: string) => string,
): boolean {
  const t = termo.trim().toLowerCase().replace(/^#/, '')
  if (!t) return true
  if (/^\d+$/.test(t) && String(q.numero) === t) return true
  const campos = [q.titulo, q.descricao, q.empresa, q.user_name, rotuloStatus(q.status), q.status]
  return campos.some((v) => (v ?? '').toLowerCase().includes(t))
}

export const ROTULO_COLUNA: Record<ColunaKanban, string> = {
  pendentes: 'Pendentes',
  andamento: 'Em andamento',
  aguardando: 'Aguardando usuário',
  finalizados: 'Finalizados',
}
