// Onda IA-1 · guarda de custo padrão de TODA chamada de IA (RD-42/RD-57). Amarra o budget guard que já
// existe (fn_budget_pode_executar → fn_budget_registrar_gasto) num único helper, pra nenhuma feature de
// IA re-decidir isso: antes de chamar o modelo pergunta se pode; se pode, chama e registra o gasto real.
//
// v2 (Controle & Metering por clínica): quando `companyId` + `feature` são passados, checa TAMBÉM o
// toggle e o teto da clínica (fn_ia_empresa_pode_gastar) ANTES do teto global, e registra o gasto por
// empresa (fn_ia_empresa_registrar_gasto) além do global. DEFAULT ON: ausência de linha = habilitado.
import type { SupabaseClient } from '@supabase/supabase-js'

// desativado = a clínica DESLIGOU a feature (degradação honesta, não é erro nem limite de custo).
// pausado   = algum teto de custo (da clínica OU global da PS) travou hoje.
export type GuardaResultado<T> = { pausado: boolean; desativado?: boolean; motivo?: string; result?: T }

// sb = client autenticado (JWT do usuário) — as RPCs são SECURITY DEFINER e resolvem/checam tenant por
// auth.uid()/get_user_company_ids(). `run` faz a chamada ao modelo e devolve { result, custoReal } (US$).
// companyId/feature são OPCIONAIS: sem eles o helper se comporta como v1 (só teto global da PS).
export async function aiGuardedCall<T>(
  sb: SupabaseClient,
  opts: { origem: string; custoEstimado: number; companyId?: string; feature?: string; run: () => Promise<{ result: T; custoReal?: number }> },
): Promise<GuardaResultado<T>> {
  // 1) toggle + teto da clínica (só quando temos companyId+feature). habilitado=false → desativado (honesto);
  //    pode=false → pausado (teto da clínica). Se a própria checagem falhar, NÃO trava a feature (best-effort).
  if (opts.companyId && opts.feature) {
    const { data } = await sb.rpc('fn_ia_empresa_pode_gastar', { p_company_id: opts.companyId, p_feature: opts.feature, p_custo_estimado: opts.custoEstimado })
    const c = data as { habilitado?: boolean; pode?: boolean; motivo?: string } | null
    if (c && c.habilitado === false) return { pausado: false, desativado: true, motivo: c.motivo || 'IA desativada para esta clínica' }
    if (c && c.pode === false) return { pausado: true, motivo: c.motivo }
  }

  // 2) teto global da PS (só BLOQUEIA em 'false' explícito — se a guarda em si falhar, não trava a feature)
  const { data: gData } = await sb.rpc('fn_budget_pode_executar', { p_custo_estimado_usd: opts.custoEstimado })
  const g = gData as { pode_executar?: boolean; motivo?: string } | null
  if (g && g.pode_executar === false) return { pausado: true, motivo: g.motivo }

  // 3) chama o modelo
  const { result, custoReal } = await opts.run()
  const custo = custoReal ?? opts.custoEstimado

  // 4) registra o gasto — por empresa (metering) e global (não deve quebrar a resposta se falhar o registro)
  if (opts.companyId && opts.feature) {
    try { await sb.rpc('fn_ia_empresa_registrar_gasto', { p_company_id: opts.companyId, p_feature: opts.feature, p_custo_usd: custo, p_chamadas: 1 }) } catch { /* telemetria best-effort */ }
  }
  try { await sb.rpc('fn_budget_registrar_gasto', { p_custo_usd: custo, p_origem: opts.origem }) } catch { /* telemetria best-effort */ }
  return { pausado: false, result }
}
