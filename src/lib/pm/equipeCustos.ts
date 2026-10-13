// Custo/hora por pessoa da equipe do P&M (agency_equipe.custo_hora) — LGPD (CEO 03/10, migration 20261003107000).
// O logado NÃO lê a coluna custo_hora direto (direito por coluna): quem vê salário (fn__mao_obra_pode_ver_individual:
// owner, socio, diretor, gerente, financeiro, admin, adm, acesso_total) recebe o custo por fn_pm_equipe_custos, que
// registra o acesso em pm_equipe_custo_acesso_log. Os demais não recebem valor por pessoa — só totais.
import type { SupabaseClient } from '@supabase/supabase-js'

// colunas de agency_equipe que o logado pode ler (todas menos custo_hora)
export const COLUNAS_EQUIPE = 'id, company_id, user_id, nome, cargo, setor, jornada_horas_dia, ativo'

export type CustosEquipe = { podeVer: boolean; custos: Map<string, number | null> }

export async function carregarCustosEquipe(sb: SupabaseClient, empresa: string): Promise<CustosEquipe> {
  const { data: pode } = await sb.rpc('fn__mao_obra_pode_ver_individual', { p_company_id: empresa })
  if (pode !== true) return { podeVer: false, custos: new Map() }
  const { data, error } = await sb.rpc('fn_pm_equipe_custos', { p_company_id: empresa })
  if (error) return { podeVer: false, custos: new Map() }
  const custos = new Map<string, number | null>()
  for (const r of (data ?? []) as { id: string; custo_hora: number | null }[]) {
    custos.set(r.id, r.custo_hora == null ? null : Number(r.custo_hora))
  }
  return { podeVer: true, custos }
}
