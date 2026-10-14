// Gate: limite de PRs prontas esperando (CEO 14/10) — função de serviço + regra no AGENTS.md.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = 'supabase/migrations'
const arq = readdirSync(dir).find((f) => f.endsWith('_esteira_pode_abrir_pr.sql'))
const erros: string[] = []
if (!arq) erros.push('migration fn_esteira_pode_abrir_pr ausente')
else {
  const sql = readFileSync(join(dir, arq), 'utf8')
  if (!/fn_esteira_pode_abrir_pr\(\s*p_agente text/.test(sql)) erros.push('assinatura da função')
  if (!/prontas\s*<=\s*3/.test(sql)) erros.push('limite 3')
  if (!/p_urgente/.test(sql) || !/p_correcao_esteira/.test(sql)) erros.push('exceções urgente/correção de esteira')
  if (!/REVOKE ALL ON FUNCTION[^;]*anon/.test(sql)) erros.push('REVOKE de anon')
  if (!/GRANT EXECUTE[^;]*service_role/.test(sql)) erros.push('GRANT só service_role')
}
if (!/fn_esteira_pode_abrir_pr/.test(readFileSync('AGENTS.md', 'utf8'))) erros.push('regra no AGENTS.md')
if (erros.length) { console.error('check-esteira-limite-prontas: ' + erros.join('; ')); process.exit(1) }
console.log('check-esteira-limite-prontas: ok')
