import type { SupabaseClient } from '@supabase/supabase-js'

// Trava LGPD do robô (RD-69 · gate fa303195): o auditor/robô só pode abrir/fotografar telas de
// empresas de DEMONSTRAÇÃO (companies.is_demo=true) ou da PS LTDA — nunca de cliente real (evita
// nome/telefone/placa em URL/screenshot público). Antes a regra era um prefixo fixo de uuid
// ('b0700000-…') — que não cobre as novas "Demonstração · <Vertical>" de uuid aleatório. Agora é
// baseada na FLAG is_demo (fonte única). FAIL-CLOSED: qualquer dúvida/erro → nega.

export const EMPRESA_PS_LTDA = 'b26c19c0-bf6d-495b-b8d1-9fa8d6896725'

export async function empresaPermitidaParaRobo(sb: SupabaseClient, empresaId: string): Promise<boolean> {
  const id = (empresaId || '').trim()
  if (!id) return false
  if (id === EMPRESA_PS_LTDA) return true
  try {
    const { data, error } = await sb.from('companies').select('is_demo').eq('id', id).maybeSingle()
    if (error) return false
    return data?.is_demo === true
  } catch {
    return false // fail-closed: sem confirmar is_demo, não deixa o robô abrir a empresa
  }
}
