// Gate do chamado #6733 (continuação) — o alerta de duplicidade da Nova despesa mostra data pura sem conversão de fuso.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const src = readFileSync('src/components/financeiro/NovaDespesaForm.tsx', 'utf8')
const fn = src.split('function fmtDataBr(')[1]?.split('\n}\n')[0] ?? ''
ok(fn.length > 0, 'fmtDataBr existe')
ok(fn.includes('puro') && fn.indexOf('puro[3]') < fn.indexOf('new Date(iso)'), 'data pura é resolvida antes de new Date')

if (falhas) process.exit(1)
