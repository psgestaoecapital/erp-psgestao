// Rótulo de usuário para pickers de "escolher pessoa" (responsável / vendedor).
// Decisão do CEO: mostra SÓ o nome, nunca o e-mail.
// Fallback (RD-51): sem full_name → usa o prefixo do e-mail; se o texto parecer login
// (sem espaço, minúsculo, com "." "_" "-", ex.: "bibiane.mallmann"), embeleza pra
// "Nome Sobrenome" (ex.: "Bibiane Mallmann"). Nunca mostra o e-mail inteiro nem o domínio.
export type UsuarioLite = { id: string; email?: string | null; full_name?: string | null }

export function nomeUsuario(u: UsuarioLite): string {
  const raw = (u.full_name ?? '').trim() || (u.email ?? '').split('@')[0].trim()
  if (!raw) return u.id ? u.id.slice(0, 8) : '—'
  // "parece login": sem espaço e todo minúsculo (ex.: "bibiane.mallmann", "bibiane") → embeleza.
  const pareceLogin = !/\s/.test(raw) && raw === raw.toLowerCase()
  if (pareceLogin) {
    const bonito = raw
      .split(/[._-]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ')
    return bonito || raw
  }
  return raw
}

// Mantido por compatibilidade — os pickers chamam labelUsuario(u, lista). Agora é só o nome
// (o segundo argumento é ignorado; antes desambiguava nomes iguais com o e-mail).
export function labelUsuario(u: UsuarioLite, _lista?: UsuarioLite[]): string {
  return nomeUsuario(u)
}
