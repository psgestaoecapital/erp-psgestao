// Gate (CEO 25/11): o roteador de chamados (fn_dev_mais_vazio → fn_devs_pool) NUNCA pode mandar chamado para um
// agente com erp_agente_rotina.ativo = false. A proteção real está em fn_devs_pool: ela filtra os devs do universo
// por erp_agente_rotina.ativo = true, então um Code extinto (ex.: rodrigo-code, jordana-code, dev7claudeps) sai da
// fila sozinho. Este gate trava a regressão: a definição VIGENTE de fn_devs_pool (a última migration que a (re)cria)
// tem de filtrar por erp_agente_rotina + ativo = true — não pode voltar a ser uma lista fixa sem o filtro. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// Última migration (por nome = timestamp) que (re)define public.fn_devs_pool.
const migs = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()
const reDef = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_devs_pool\s*\(/i
let ultima: string | null = null
for (const f of migs) {
  const sql = readFileSync(`supabase/migrations/${f}`, 'utf8')
  if (reDef.test(sql)) ultima = f
}

ok(ultima !== null, 'existe migration que define public.fn_devs_pool')
if (ultima) {
  const sql = readFileSync(`supabase/migrations/${ultima}`, 'utf8').replace(/--.*$/gm, '')
  // Isola o corpo da ÚLTIMA definição de fn_devs_pool (do CREATE OR REPLACE até o fim do $...$ … $...$).
  const idx = sql.search(reDef)
  const corpo = idx >= 0 ? sql.slice(idx) : ''
  // Extrai o bloco entre o primeiro $tag$ e o seu fechamento (corpo SQL da função).
  const abre = corpo.match(/AS\s+(\$[a-zA-Z_]*\$)/)
  const tag = abre?.[1]
  const fim = tag ? corpo.indexOf(tag, corpo.indexOf(tag) + tag.length) : -1
  const body = tag && fim > 0 ? corpo.slice(corpo.indexOf(tag) + tag.length, fim) : corpo
  console.log(`· definição vigente de fn_devs_pool: ${ultima}`)
  ok(/erp_agente_rotina/i.test(body), 'fn_devs_pool lê erp_agente_rotina (não é lista fixa de agentes)')
  ok(/\bativo\b\s*=\s*true/i.test(body) || /\bativo\s+is\s+true\b/i.test(body), 'fn_devs_pool filtra por ativo = true')
}

if (falhas) {
  console.error(`\n${falhas} falha(s): fn_devs_pool precisa filtrar os devs por erp_agente_rotina.ativo = true (CEO 25/11) — senão o roteador manda chamado para Code extinto.`)
  process.exit(1)
}
console.log('✓ roteamento de chamado: fn_devs_pool só lista dev ativo (erp_agente_rotina.ativo)')
