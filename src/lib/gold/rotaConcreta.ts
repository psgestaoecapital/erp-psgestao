// Rota dinâmica → rota concreta para o robô do auditor (Hub PDCA 24/10).
// O system_screens guarda a rota-modelo ("/dashboard/projetos/obras/[id]/cronograma"); o robô visitava o literal
// "[id]" e a tela respondia "invalid input syntax for type uuid: %5Bid%5D" — reprovação falsa de toda tela [id].
// Aqui o "[id]" vira o id de um registro REAL da própria empresa DEMO do pedido (nunca de outra empresa).
// Rota-modelo sem resolvedor conhecido segue como antes (sem mudança de comportamento fora desta lista).
import type { SupabaseClient } from '@supabase/supabase-js'

export type Resolvedor = {
  prefixo: string            // rota-modelo até o segmento dinâmico, inclusive
  tabela: string             // tabela do registro (tem id + company_id)
  filtroNulo?: string        // coluna de exclusão lógica: só registro com ela nula
  filtroAtivo?: string       // coluna booleana: só registro ativo
  preferir?: { tabela: string; coluna: string; filtroNulo?: string } // prefere registro que tem filhos (ex.: obra com tarefas)
}

export const RESOLVEDORES: Resolvedor[] = [
  { prefixo: '/dashboard/projetos/obras/[id]', tabela: 'projetos_obras',
    preferir: { tabela: 'projetos_obra_tarefa', coluna: 'obra_id', filtroNulo: 'excluido_em' } },
  { prefixo: '/dashboard/projetos/catalogo/[id]', tabela: 'projetos_servicos', filtroAtivo: 'ativo' },
  { prefixo: '/dashboard/projetos/oportunidades/[id]', tabela: 'erp_crm_oportunidade', filtroNulo: 'deleted_at' },
]

export const temSegmentoDinamico = (rota: string) => /\/\[[^\]/]+\]/.test(rota)

export function resolvedorDa(rota: string): Resolvedor | null {
  return RESOLVEDORES.find((r) => rota === r.prefixo || rota.startsWith(r.prefixo + '/')) ?? null
}

// Troca o segmento dinâmico do prefixo pelo id; o resto da rota (e a query) fica igual.
export function aplicarId(rota: string, r: Resolvedor, id: string): string {
  const concreto = r.prefixo.replace(/\[[^\]/]+\]$/, encodeURIComponent(id))
  return concreto + rota.slice(r.prefixo.length)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type RotaConcreta =
  | { tipo: 'estatica'; rota: string }
  | { tipo: 'resolvida'; rota: string; id: string }
  | { tipo: 'sem_registro'; rota: string; motivo: string }
  | { tipo: 'sem_resolvedor'; rota: string }

// rotaCompleta pode trazer ?query/#hash: resolve só o caminho.
export async function rotaConcreta(supabase: SupabaseClient, rotaCompleta: string, empresaId: string): Promise<RotaConcreta> {
  const corte = rotaCompleta.search(/[?#]/)
  const caminho = corte >= 0 ? rotaCompleta.slice(0, corte) : rotaCompleta
  const sufixo = corte >= 0 ? rotaCompleta.slice(corte) : ''
  if (!temSegmentoDinamico(caminho)) return { tipo: 'estatica', rota: rotaCompleta }
  const r = resolvedorDa(caminho)
  if (!r) return { tipo: 'sem_resolvedor', rota: rotaCompleta }

  let id: string | null = null
  if (r.preferir) {
    let q = supabase.from(r.preferir.tabela).select(r.preferir.coluna).eq('company_id', empresaId)
    if (r.preferir.filtroNulo) q = q.is(r.preferir.filtroNulo, null)
    const { data } = await q.limit(1)
    const v = (data?.[0] as Record<string, unknown> | undefined)?.[r.preferir.coluna]
    if (typeof v === 'string') id = v
  }
  if (!id) {
    let q = supabase.from(r.tabela).select('id').eq('company_id', empresaId)
    if (r.filtroNulo) q = q.is(r.filtroNulo, null)
    if (r.filtroAtivo) q = q.eq(r.filtroAtivo, true)
    const { data } = await q.limit(1)
    const v = (data?.[0] as { id?: unknown } | undefined)?.id
    if (typeof v === 'string') id = v
  }
  if (!id || !UUID.test(id)) {
    return { tipo: 'sem_registro', rota: rotaCompleta, motivo: `sem registro em ${r.tabela} na empresa do robô para ${r.prefixo}` }
  }
  return { tipo: 'resolvida', rota: aplicarId(caminho, r, id) + sufixo, id }
}
