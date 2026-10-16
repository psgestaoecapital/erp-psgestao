// Gate (P0 16/10) — /login não pode dar 404: a rota existe e encaminha para "/" preservando o returnTo, e nenhum
// redirecionamento do app aponta para "/login" (o login vive em "/").
import { readFileSync, existsSync } from 'node:fs'
import { retornoSeguro } from '../../src/lib/retorno-login'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

ok(existsSync('src/app/login/page.tsx'), 'rota /login existe')
ok(/redirect\(/.test(readFileSync('src/app/login/page.tsx', 'utf8')), '/login encaminha (redirect)')
ok(!/assign\(`?'?\/login/.test(readFileSync('src/lib/AuthProvider.tsx', 'utf8')), 'AuthProvider não manda para /login')
ok(!/replace\("\/login"\)/.test(readFileSync('src/components/bpo/AdminGuard.tsx', 'utf8')), 'AdminGuard não manda para /login')
ok(/returnTo/.test(readFileSync('src/app/page.tsx', 'utf8')), '"/" respeita o returnTo após entrar')
ok(retornoSeguro('/dashboard/dev?a=1') === '/dashboard/dev?a=1', 'returnTo interno aceito')
ok(retornoSeguro('//evil.com') === null && retornoSeguro('https://evil.com') === null && retornoSeguro(null) === null, 'returnTo externo/vazio recusado')

if (falhas) process.exit(1)
