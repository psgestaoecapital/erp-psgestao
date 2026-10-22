// Gate (P0 16/10) — "/login" não é tela (o login é a raiz "/"): quem manda para lá cai em 404 e ninguém reentra.
// A rota /login encaminha para "/" preservando returnTo; a sessão expirada aponta para "/" e a raiz respeita o returnTo
// (só rota interna).
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const rota = readFileSync('src/app/login/page.tsx', 'utf8')
ok(/redirect\(/.test(rota) && /returnTo/.test(rota), '/login encaminha para / preservando returnTo')
const auth = readFileSync('src/lib/AuthProvider.tsx', 'utf8')
ok(!/assign\(`?'?\/login/.test(auth), 'AuthProvider: sessão expirada não manda mais para /login')
ok(/assign\(`\/\?returnTo=/.test(auth), 'AuthProvider: sessão expirada vai para /?returnTo=')
const raiz = readFileSync('src/app/page.tsx', 'utf8')
ok(/get\("returnTo"\)/.test(raiz) && /startsWith\("\/\/"\)/.test(raiz), 'raiz: volta ao returnTo, só rota interna (bloqueia //)')
ok(!/replace\("\/login"\)/.test(readFileSync('src/components/bpo/AdminGuard.tsx', 'utf8')), 'AdminGuard não redireciona para /login')
if (falhas) process.exit(1)
