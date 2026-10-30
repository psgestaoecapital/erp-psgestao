// Erro do login (Supabase Auth) → frase do usuário (auditor_pdca_g 24/10: o login dizia "E-mail ou senha incorretos"
// também quando o POST ao Supabase caía por falha de rede — o usuário trocava a senha à toa).
// Regra: só credencial recusada vira "e-mail ou senha incorretos"; rede, servidor fora, limite de tentativas e e-mail
// não confirmado têm frase própria. Sem rede, sem dependência do SDK (lê name/status/code/message do objeto de erro).

export const MSG_LOGIN_CREDENCIAIS = 'E-mail ou senha incorretos.'
export const MSG_LOGIN_SEM_CONEXAO = 'Sem conexão com o servidor. Confira a internet e tente de novo.'
export const MSG_LOGIN_SERVIDOR = 'O servidor de login não respondeu. Tente de novo em instantes.'
export const MSG_LOGIN_LIMITE = 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.'
export const MSG_LOGIN_EMAIL_NAO_CONFIRMADO = 'Seu e-mail ainda não foi confirmado. Abra o link que enviamos e entre de novo.'

type ErroAuthLike = { name?: unknown; status?: unknown; code?: unknown; message?: unknown } | null | undefined

export function mensagemErroLogin(e: unknown): string {
  const err = (e && typeof e === 'object' ? e : { message: e }) as ErroAuthLike
  const name = typeof err?.name === 'string' ? err.name : ''
  const status = typeof err?.status === 'number' ? err.status : undefined
  const code = typeof err?.code === 'string' ? err.code : ''
  const msg = typeof err?.message === 'string' ? err.message : ''

  // auth-js: fetch que falhou (offline, DNS, CORS, conexão cortada) vem como AuthRetryableFetchError com status 0;
  // fora do SDK, o próprio fetch lança TypeError "Failed to fetch" / "fetch failed" / "NetworkError…" / "Load failed".
  if (status === 0 || /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(msg)) return MSG_LOGIN_SEM_CONEXAO
  if (status === 429 || code === 'over_request_rate_limit') return MSG_LOGIN_LIMITE
  if (code === 'email_not_confirmed') return MSG_LOGIN_EMAIL_NAO_CONFIRMADO
  if ((status !== undefined && status >= 500) || name === 'AuthRetryableFetchError') return MSG_LOGIN_SERVIDOR
  return MSG_LOGIN_CREDENCIAIS
}
