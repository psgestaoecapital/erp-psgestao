// Erro do login → frase do usuário (HB0, auditor_pdca_g 24/10): a tela dizia "E-mail ou senha incorretos" também
// quando o POST ao Supabase caía (rede), e o usuário ia trocar a senha à toa. Só credencial recusada diz "incorretos".
// - Falha de rede (auth-js: AuthRetryableFetchError, status 0) ou servidor fora (5xx) → sem conexão.
// - 429 / limite de tentativas → aguardar.
// - E-mail ainda não confirmado → confirmar.

export const MSG_LOGIN_INCORRETO = 'E-mail ou senha incorretos'
export const MSG_LOGIN_SEM_CONEXAO = 'Sem conexão com o servidor. Confira sua internet e tente de novo.'
export const MSG_LOGIN_MUITAS_TENTATIVAS = 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.'
export const MSG_LOGIN_EMAIL_NAO_CONFIRMADO = 'Seu e-mail ainda não foi confirmado. Abra o link que enviamos e tente de novo.'

type ErroAuthLike = { name?: unknown; status?: unknown; code?: unknown; message?: unknown } | null | undefined

export function mensagemErroLogin(e: unknown): string {
  const err = (e && typeof e === 'object' ? e : { message: e }) as ErroAuthLike
  const nome = typeof err?.name === 'string' ? err.name : ''
  const status = typeof err?.status === 'number' ? err.status : undefined
  const code = typeof err?.code === 'string' ? err.code : ''
  const msg = typeof err?.message === 'string' ? err.message : ''

  if (nome === 'AuthRetryableFetchError' || status === 0 || (status !== undefined && status >= 500)
    || /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(msg)) return MSG_LOGIN_SEM_CONEXAO
  if (status === 429 || /rate_limit/.test(code)) return MSG_LOGIN_MUITAS_TENTATIVAS
  if (code === 'email_not_confirmed') return MSG_LOGIN_EMAIL_NAO_CONFIRMADO
  return MSG_LOGIN_INCORRETO
}
