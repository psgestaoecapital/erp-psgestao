'use client'

// P0 (16bc8561) · "registro de travamentos". Emissores fire-and-forget: NUNCA lançam, NUNCA bloqueiam,
// NUNCA recursam (chamam a RPC direto, sem comPrazo). Resolvem company/user-agent/rota/bundle sozinhos
// para não precisar passar contexto em cada chamada. Só rodam no browser.
import { supabase } from '@/lib/supabase'
import { BUNDLE_VERSION } from '@/lib/bundleVersion'

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

function rotaAtual(): string | null {
  try {
    return typeof window !== 'undefined' ? window.location.pathname : null
  } catch {
    return null
  }
}

function uaResumido(): string | null {
  return typeof navigator !== 'undefined' ? navigator.userAgent : null
}

/**
 * Registra um carregamento que pendurou (timeout=true) ou demorou demais (timeout=false).
 * Fire-and-forget: erros são engolidos — telemetria nunca pode piorar a experiência.
 */
export function registrarTravamento(label: string, duracaoMs: number, timeout: boolean): void {
  if (typeof window === 'undefined') return
  try {
    void supabase
      .rpc('fn_registrar_travamento', {
        p_label: label,
        p_duracao_ms: Math.round(duracaoMs),
        p_timeout: timeout,
        p_company_id: companyAtual(),
        p_user_agent: uaResumido(),
        p_rota: rotaAtual(),
        p_bundle_version: BUNDLE_VERSION,
      })
      .then(() => {}, () => {})
  } catch {
    // localStorage/navigator indisponível: desiste em silêncio
  }
}

/**
 * P0 · APP no celular — evento de AUTH (tipo='auth'): TOKEN_REFRESHED, refresh_falhou, SIGNED_OUT,
 * sessao_ausente. Vai por fn_registrar_evento_auth, que PERMITE anon — é o único jeito de gravar
 * justamente quando NÃO há sessão (o app virou visitante). Fire-and-forget.
 */
export function registrarEventoAuth(
  label: 'TOKEN_REFRESHED' | 'refresh_falhou' | 'SIGNED_OUT' | 'sessao_ausente' | string,
): void {
  if (typeof window === 'undefined') return
  try {
    void supabase
      .rpc('fn_registrar_evento_auth', {
        p_label: label,
        p_company_id: companyAtual(),
        p_user_agent: uaResumido(),
        p_rota: rotaAtual(),
        p_bundle_version: BUNDLE_VERSION,
      })
      .then(() => {}, () => {})
  } catch {
    // desiste em silêncio
  }
}
