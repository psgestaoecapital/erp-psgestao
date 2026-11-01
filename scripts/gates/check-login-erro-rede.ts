// Gate (auditor_pdca_g 24/10) — o login não chama falha de rede de "e-mail ou senha incorretos".
// Regra: src/lib/erroLogin.ts separa credencial recusada de rede caída / servidor fora / limite / e-mail não confirmado,
// e as duas telas de login (raiz "/" e /oauth/consent) usam essa função, sem frase fixa de senha no lugar. Sem rede.
import { readFileSync } from 'node:fs'
import {
  mensagemErroLogin, MSG_LOGIN_CREDENCIAIS, MSG_LOGIN_SEM_CONEXAO, MSG_LOGIN_SERVIDOR, MSG_LOGIN_LIMITE, MSG_LOGIN_EMAIL_NAO_CONFIRMADO,
} from '../../src/lib/erroLogin'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── regras puras (formas reais do auth-js) ──
ok(mensagemErroLogin({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }) === MSG_LOGIN_SEM_CONEXAO, 'fetch que falhou (status 0) = sem conexão')
ok(mensagemErroLogin(new TypeError('Failed to fetch')) === MSG_LOGIN_SEM_CONEXAO, 'TypeError "Failed to fetch" lançado = sem conexão')
ok(mensagemErroLogin(new TypeError('Load failed')) === MSG_LOGIN_SEM_CONEXAO, 'Safari "Load failed" = sem conexão')
ok(mensagemErroLogin(new TypeError('NetworkError when attempting to fetch resource.')) === MSG_LOGIN_SEM_CONEXAO, 'Firefox NetworkError = sem conexão')
ok(mensagemErroLogin({ name: 'AuthApiError', status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' }) === MSG_LOGIN_CREDENCIAIS, 'invalid_credentials = e-mail ou senha incorretos')
ok(mensagemErroLogin({ name: 'AuthRetryableFetchError', status: 503, message: '' }) === MSG_LOGIN_SERVIDOR, '503 = servidor não respondeu')
ok(mensagemErroLogin({ name: 'AuthApiError', status: 500, message: 'Database error' }) === MSG_LOGIN_SERVIDOR, '500 = servidor não respondeu')
ok(mensagemErroLogin({ name: 'AuthApiError', status: 429, code: 'over_request_rate_limit' }) === MSG_LOGIN_LIMITE, '429 = muitas tentativas')
ok(mensagemErroLogin({ name: 'AuthApiError', status: 400, code: 'email_not_confirmed' }) === MSG_LOGIN_EMAIL_NAO_CONFIRMADO, 'email_not_confirmed tem frase própria')
for (const m of [MSG_LOGIN_SEM_CONEXAO, MSG_LOGIN_SERVIDOR, MSG_LOGIN_LIMITE, MSG_LOGIN_EMAIL_NAO_CONFIRMADO]) {
  ok(!/senha incorret/i.test(m), `"${m}" não fala em senha incorreta`)
}

// ── telas de login ──
for (const t of ['src/app/page.tsx', 'src/app/oauth/consent/page.tsx']) {
  const src = readFileSync(t, 'utf8')
  ok(src.includes('@/lib/erroLogin') && src.includes('mensagemErroLogin('), `${t}: usa mensagemErroLogin`)
  ok(!/set\w*\(\s*["']E-mail ou senha incorretos/.test(src), `${t}: sem "E-mail ou senha incorretos" fixo para qualquer erro`)
}
ok(readFileSync('e2e/jornadas/aceitacao/login-erro-rede.spec.ts', 'utf8').includes("route.abort('internetdisconnected')"), 'spec de jornada derruba a rede do login')

if (falhas) { console.error(`\ncheck-login-erro-rede: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-login-erro-rede: ok')
