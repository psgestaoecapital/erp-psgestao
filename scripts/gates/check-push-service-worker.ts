// Gate (#120) — o service worker trata push e notificationclick (Web Push custo zero) e só abre links do próprio app.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const sw = readFileSync('src/app/sw.js/route.ts', 'utf8')
ok(sw.includes("addEventListener('push'"), 'SW tem handler de push')
ok(sw.includes('showNotification'), 'push exibe a notificação')
ok(sw.includes("addEventListener('notificationclick'"), 'SW tem handler de notificationclick')
ok(sw.includes('openWindow') && sw.includes('matchAll'), 'clique foca a aba aberta ou abre o link')
ok(sw.includes("d.link.startsWith('/') && !d.link.startsWith('//')"), 'só aceita link relativo do app (sem // externo)')
ok(sw.indexOf("addEventListener('push'") < sw.indexOf("addEventListener('fetch'"), 'push registrado antes do fetch')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-push-service-worker OK')
