'use client'

// P0 (16bc8561) · "registro de travamentos". Emissor fire-and-forget: NUNCA lança, NUNCA bloqueia,
// NUNCA recursa (chama a RPC direto, sem comPrazo). Resolve company/user-agent sozinho para não
// precisar passar contexto em cada chamada. Só roda no browser.
import { supabase } from '@/lib/supabase'

const EMPRESA_STORAGE_KEY = 'ps_empresa_sel'

function companyAtual(): string | null {
  try {
    const v = localStorage.getItem(EMPRESA_STORAGE_KEY)
    if (!v || v === 'consolidado' || v.startsWith('group_')) return null
    return v
  } catch {
    return null
  }
}

/**
 * Registra um carregamento que pendurou (timeout=true) ou demorou demais (timeout=false).
 * Fire-and-forget: erros são engolidos — telemetria nunca pode piorar a experiência.
 */
export function registrarTravamento(label: string, duracaoMs: number, timeout: boolean): void {
  if (typeof window === 'undefined') return
  try {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null
    void supabase
      .rpc('fn_registrar_travamento', {
        p_label: label,
        p_duracao_ms: Math.round(duracaoMs),
        p_timeout: timeout,
        p_company_id: companyAtual(),
        p_user_agent: ua,
      })
      .then(() => {}, () => {}) // silencia sucesso e falha — nunca propaga
  } catch {
    // localStorage/navigator indisponível: desiste em silêncio
  }
}
