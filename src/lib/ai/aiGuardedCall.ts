// Onda IA-1 · guarda de custo padrão de TODA chamada de IA (RD-42/RD-57). Amarra o budget guard que já
// existe (fn_budget_pode_executar → fn_budget_registrar_gasto) num único helper, pra nenhuma feature de
// IA re-decidir isso: antes de chamar o modelo pergunta se pode; se pode, chama e registra o gasto real.
import type { SupabaseClient } from '@supabase/supabase-js'

export type GuardaResultado<T> = { pausado: boolean; motivo?: string; result?: T }

// sb = client autenticado (JWT do usuário) — as RPCs de budget são SECURITY INVOKER e resolvem tenant
// por auth.uid(). `run` faz a chamada ao modelo e devolve { result, custoReal } (custo real em US$).
export async function aiGuardedCall<T>(
  sb: SupabaseClient,
  opts: { origem: string; custoEstimado: number; run: () => Promise<{ result: T; custoReal?: number }> },
): Promise<GuardaResultado<T>> {
  // 1) pode gastar hoje? (só BLOQUEIA em 'false' explícito — se a guarda em si falhar, não trava a feature)
  const { data } = await sb.rpc('fn_budget_pode_executar', { p_custo_estimado_usd: opts.custoEstimado })
  const g = data as { pode_executar?: boolean; motivo?: string } | null
  if (g && g.pode_executar === false) return { pausado: true, motivo: g.motivo }

  // 2) chama o modelo
  const { result, custoReal } = await opts.run()

  // 3) registra o gasto (não deve quebrar a resposta se falhar o registro)
  try { await sb.rpc('fn_budget_registrar_gasto', { p_custo_usd: custoReal ?? opts.custoEstimado, p_origem: opts.origem }) } catch { /* telemetria best-effort */ }
  return { pausado: false, result }
}
