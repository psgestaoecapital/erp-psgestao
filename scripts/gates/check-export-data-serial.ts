/**
 * Gate (chamado #6713/fb74757d): data do relatório exportado (Excel) sai no dia certo.
 * Antes: `new Date(y,m,d)` local + SheetJS deslocava pelo fuso → "pago 06/10" saía 05/10 23:59.
 * Agora: número serial do Excel (UTC puro), formato dd/mm/yyyy.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataSerialExcel } from '../../src/lib/export/relatorioLista'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

ok(dataSerialExcel(2026, 10, 6) === 46301, '06/10/2026 = serial 46301 (inteiro, sem hora)')
ok(Number.isInteger(dataSerialExcel(2026, 10, 31)), 'serial sempre inteiro (sem 23:59)')
const src = readFileSync(join(process.cwd(), 'src/lib/export/relatorioLista.ts'), 'utf8')
ok(!/new Date\(Number\(y\)/.test(src), 'cell() não cria Date local para coluna de data')
ok(/typeof cObj\.v === 'number'/.test(src), 'formato dd/mm/yyyy aplicado ao serial numérico')
if (falhas) process.exit(1)
