import type { SupabaseClient } from '@supabase/supabase-js'

// RD-69 Parte 1 / RD-70 (contexto f04713ca): o robô/auditor SÓ pode abrir a tela de uma empresa de
// DEMONSTRAÇÃO (companies.is_demo=true). Fim dos ids fixos ([BOT] b0700000-…) e da PS LTDA
// (b26c19c0-…): a permissão é 100% dirigida por dado (is_demo). Helper ÚNICO, fail-closed — qualquer
// erro, empresa ausente, ou is_demo≠true ⇒ NÃO permitido. Nunca tocar empresa de cliente (LGPD).
export const MSG_ROBO_SO_DEMO =
  'empresa não é de demonstração — o robô/auditor só opera em companies.is_demo=true'

export async function empresaPermitidaParaRobo(
  sb: SupabaseClient,
  empresaId: string | null | undefined,
): Promise<boolean> {
  if (!empresaId || typeof empresaId !== 'string') return false
  try {
    const { data, error } = await sb.from('companies').select('is_demo').eq('id', empresaId).maybeSingle()
    if (error) return false
    return data?.is_demo === true
  } catch {
    return false // fail-closed
  }
}
