// Gate (HB0, auditor_pdca_g 24/10) — o login só diz "E-mail ou senha incorretos" quando a credencial é recusada.
// Falha de rede (POST ao Supabase caiu) diz "sem conexão com o servidor"; limite de tentativas e e-mail não confirmado
// têm frase própria. A tela de login usa a função e não fixa mais a frase de senha errada para todo erro.
import { readFileSync } from 'node:fs'
import {
  mensagemErroLogin, MSG_LOGIN_INCORRETO, MSG_LOGIN_SEM_CONEXAO, MSG_LOGIN_MUITAS_TENTATIVAS, MSG_LOGIN_EMAIL_NAO_CONFIRMADO,
} from '../../src/lib/auth/erroLogin'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

ok(mensagemErroLogin({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }) === MSG_LOGIN_SEM_CONEXAO, 'rede caiu (auth-js) → sem conexão')
ok(mensagemErroLogin(new TypeError('Failed to fetch')) === MSG_LOGIN_SEM_CONEXAO, 'fetch lançou TypeError → sem conexão')
ok(mensagemErroLogin({ name: 'AuthRetryableFetchError', status: 503, message: '' }) === MSG_LOGIN_SEM_CONEXAO, 'servidor fora (503) → sem conexão')
ok(mensagemErroLogin({ name: 'AuthApiError', status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' }) === MSG_LOGIN_INCORRETO, 'credencial recusada → incorretos')
ok(mensagemErroLogin({ name: 'AuthApiError', status: 429, code: 'over_request_rate_limit' }) === MSG_LOGIN_MUITAS_TENTATIVAS, '429 → muitas tentativas')
ok(mensagemErroLogin({ name: 'AuthApiError', status: 400, code: 'email_not_confirmed' }) === MSG_LOGIN_EMAIL_NAO_CONFIRMADO, 'e-mail não confirmado → confirmar')

const raiz = readFileSync('src/app/page.tsx', 'utf8')
ok(/mensagemErroLogin\(/.test(raiz), 'login (/) usa mensagemErroLogin')
ok(!/setError\("E-mail ou senha incorretos"\)/.test(raiz), 'login (/) não fixa "incorretos" para todo erro')
if (falhas) process.exit(1)
