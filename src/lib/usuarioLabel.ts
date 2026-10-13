// Rótulo de usuário para pickers de "escolher pessoa" (responsável / vendedor).
// Mostra o NOME DE EXIBIÇÃO (users.full_name), preenchido por humano no cadastro.
//
// #56 (Luzardo/Pdois): não INVENTAR nome a partir do e-mail. Antes esta função
// "embelezava" um full_name que parecia login (ex.: "bibiane.mallmann" → "Bibiane
// Mallmann"); era um chute — "luzardo" pode ser sobrenome, apelido ou o nome da conta.
// Agora mostra o full_name EXATAMENTE como está no banco; quem corrige é a pessoa,
// editando o nome de exibição no cadastro de usuários.
//
// Fallback quando não há full_name (RD-51): o e-mail INTEIRO, nunca a parte antes do "@".
// Meio e-mail não identifica ninguém e parece defeito.
export type UsuarioLite = { id: string; email?: string | null; full_name?: string | null }

export function nomeUsuario(u: UsuarioLite): string {
  const nome = (u.full_name ?? '').trim()
  if (nome) return nome
  const email = (u.email ?? '').trim()
  if (email) return email // e-mail INTEIRO (#56) — não `.split('@')[0]`
  return u.id ? u.id.slice(0, 8) : '—'
}

// Mantido por compatibilidade — os pickers chamam labelUsuario(u, lista). Agora é só o nome
// (o segundo argumento é ignorado; antes desambiguava nomes iguais com o e-mail).
export function labelUsuario(u: UsuarioLite, _lista?: UsuarioLite[]): string {
  return nomeUsuario(u)
}
