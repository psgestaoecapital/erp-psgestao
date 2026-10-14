// Gate (chamado #120 · push custo zero): o service worker trata 'push' e 'notificationclick', agrupa por tag
// e só abre caminho do próprio app. Estático, sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const sw = readFileSync('src/app/sw.js/route.ts', 'utf8')

ok(/addEventListener\('push'/.test(sw) && /showNotification\(/.test(sw), 'SW mostra a notificação no evento push')
ok(/tag: d\.tag/.test(sw) && /renotify/.test(sw), 'push agrupado por tag (1 por oportunidade)')
ok(/addEventListener\('notificationclick'/.test(sw) && /openWindow\(/.test(sw), 'toque na notificação abre o link')
ok(/startsWith\('\/'\) && !raw\.startsWith\('\/\/'\)/.test(sw), 'link só do próprio app (nunca URL externa)')
if (falhas) process.exit(1)
