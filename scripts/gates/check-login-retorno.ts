// Gate (P0 16/10) — sessão expirada nunca leva a rota inexistente: /login existe e encaminha para `/` preservando o
// returnTo; ninguém redireciona para '/login' cru; returnTo só aceita rota interna.
import { existsSync, readFileSync } from 'node:fs'
import { retornoSeguro, urlDeLogin } from '../../src/lib/retornoLogin'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

ok(existsSync('src/app/login/page.tsx'), 'rota /login existe (endereços antigos não dão 404)')
ok(/redirect\(urlDeLogin/.test(readFileSync('src/app/login/page.tsx', 'utf8')), '/login encaminha para / com returnTo')
const auth = readFileSync('src/lib/AuthProvider.tsx', 'utf8')
ok(/urlDeLogin\(window\.location\.pathname/.test(auth) && !/assign\(`\/login/.test(auth), 'AuthProvider manda a sessão expirada para / com returnTo')
ok(/retornoSeguro\(/.test(readFileSync('src/app/page.tsx', 'utf8')), 'login em / volta para o returnTo depois de entrar')
ok(retornoSeguro('%2Fdashboard%2Fdev') === '/dashboard/dev', 'returnTo interno aceito')
ok(retornoSeguro('//evil.com') === null && retornoSeguro('https://evil.com') === null && retornoSeguro('/\\evil.com') === null, 'returnTo externo recusado')
ok(retornoSeguro('/login?returnTo=x') === null && retornoSeguro('/') === null, 'returnTo não gira em círculo')
ok(urlDeLogin('/dashboard/home?a=1') === '/?returnTo=%2Fdashboard%2Fhome%3Fa%3D1', 'urlDeLogin preserva rota e query')
if (falhas) process.exit(1)
