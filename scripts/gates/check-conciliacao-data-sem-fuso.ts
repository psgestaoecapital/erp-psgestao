// Gate do chamado #6733 — a Conciliação mostra data pura (YYYY-MM-DD) como está no cadastro, sem conversão de fuso.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const src = readFileSync('src/app/dashboard/financeiro/conciliacao/inbox/page.tsx', 'utf8')
const fn = src.split('function fmtBR(')[1]?.split('\n}\n')[0] ?? ''
ok(fn.length > 0, 'fmtBR existe')
ok(/\\d\{4\}\)-\(\\d\{2\}\)-\(\\d\{2\}/.test(fn), 'fmtBR trata data pura (YYYY-MM-DD) sem new Date')
ok(fn.indexOf('puro') < fn.lastIndexOf('new Date(d)'), 'data pura é resolvida antes de qualquer new Date')

if (falhas) process.exit(1)
