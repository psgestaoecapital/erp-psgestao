// Rótulo de usuário para pickers de "escolher pessoa".
// Regra (decisão do CEO): mostra "Nome Completo"; se houver nome DUPLICADO na lista,
// desambigua com "Nome (email)"; se não houver nome, cai pro email (fallback).
export type UsuarioLite = { id: string; email?: string | null; full_name?: string | null }

export function labelUsuario(u: UsuarioLite, lista: UsuarioLite[]): string {
  const nome = (u.full_name ?? '').trim()
  if (!nome) return u.email ?? u.id.slice(0, 8)
  const dupes = lista.filter((x) => (x.full_name ?? '').trim().toLowerCase() === nome.toLowerCase())
  return dupes.length > 1 ? `${nome} (${u.email ?? '—'})` : nome
}
