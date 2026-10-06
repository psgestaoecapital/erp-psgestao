// /api/saude (CEO 05/10): monitor externo de queda. Sem dado sensível, sem segredo na resposta.
export const TIMEOUT_SAUDE_MS = 5000

export type ResultadoSaude = { status: 200; corpo: { ok: true; db_ms: number } } | { status: 503; corpo: { ok: false } }

// Banco "de pé" = o PostgREST respondeu (qualquer status < 500, inclusive 401/403 da RLS) dentro do prazo.
export function avaliarSaude(statusHttp: number | null, ms: number): ResultadoSaude {
  if (statusHttp !== null && statusHttp < 500 && ms <= TIMEOUT_SAUDE_MS) return { status: 200, corpo: { ok: true, db_ms: Math.round(ms) } }
  return { status: 503, corpo: { ok: false } }
}
