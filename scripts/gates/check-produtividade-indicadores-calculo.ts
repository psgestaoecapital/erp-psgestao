/**
 * Gate de build · Produtividade Fase 2: a fórmula kg/homem-hora da tela (média, melhor e pior dia) ignora dias sem dado.
 *   tsx scripts/gates/check-produtividade-indicadores-calculo.ts
 */
import { readFileSync } from 'node:fs'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

// Dias provados em produção (01, 02 e 05/10): kg ÷ horas; 03/10 não casa com o ponto e vem sem dado.
const dias = [
  { kg: 46614, horas: 244.5, kg_hh: 190.6 }, { kg: 88708, horas: 269.1, kg_hh: 329.7 },
  { kg: 37204, horas: 10, kg_hh: null }, { kg: 50874, horas: 284.3, kg_hh: 179.0 },
]
for (const d of dias) if (d.kg_hh != null) ok(Math.abs(d.kg / d.horas - d.kg_hh) < 0.1, `kg ÷ horas = ${d.kg_hh}`)
const com = dias.filter((d) => d.kg_hh != null)
const media = com.reduce((s, d) => s + (d.kg_hh as number), 0) / com.length
ok(Math.abs(media - 233.1) < 0.1, 'média ignora o dia sem dado')
ok(Math.max(...com.map((d) => d.kg_hh as number)) === 329.7 && Math.min(...com.map((d) => d.kg_hh as number)) === 179.0, 'melhor e pior dia')

const tela = readFileSync('src/app/dashboard/produtividade/indicadores/page.tsx', 'utf8')
ok(/filter\(\(d\) => d\.kg_hh != null\)/.test(tela), 'a tela filtra dias sem dado antes de calcular')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\n✓ cálculo ok')
