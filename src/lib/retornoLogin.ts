// Retorno pós-login (P0 16/10): sessão expirada leva ao login (`/`) com ?returnTo=<rota de origem>.
// Só aceita caminho interno do próprio site — nunca host externo (open redirect).
export function retornoSeguro(bruto: string | null | undefined): string | null {
  if (!bruto) return null
  let v = bruto
  try { v = decodeURIComponent(bruto) } catch { return null }
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\') || /[\r\n]/.test(v)) return null
  if (v === '/' || v === '/login' || v.startsWith('/login?') || v.startsWith('/login/')) return null
  return v
}

export function urlDeLogin(rotaAtual: string): string {
  const r = retornoSeguro(rotaAtual)
  return r ? `/?returnTo=${encodeURIComponent(r)}` : '/'
}
