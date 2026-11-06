/**
 * Gate de build (#5933 · Jordana · Gean): peça da OS com 2 un. comprada em 2 NF-e continua disponível para a
 * 2ª nota enquanto o saldo (qtd da OS − soma das notas já vinculadas a ela) for maior que zero.
 *   npm run gates -- nfe-vinculo-os-parcial
 */
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }
const src = readFileSync('src/app/dashboard/compras/documentos-recebidos/_components/ItensNfeRecebida.tsx', 'utf8')

ok(src.includes('produto_id.is.null,produto_id.eq.'), 'lista também a peça da OS já ligada ao MESMO produto')
ok(src.includes("like('vinculo_origem', `os:${o.id}:diag:%`)"), 'saldo calculado pelas notas já vinculadas à peça')
ok(/filter\(\(d\) => !d\.produto_id \|\| \(d\.saldo \?\? 0\) > 0\)/.test(src), 'peça só some quando o saldo zera')
ok(src.includes('falta {Number(d.saldo)'), 'tela mostra quanto ainda falta')
if (falhas) process.exit(1)
