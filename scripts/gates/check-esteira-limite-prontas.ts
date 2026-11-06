// Gate: esteira — fn_esteira_pode_abrir_pr existe, trancada (REVOKE anon / GRANT service_role), mantém os
// parâmetros conhecidos e NÃO tem mais teto de PRs prontas (CEO 30/10 removeu o limite de 3). Lê a migration
// MAIS NOVA da função (sort + última) para conferir a versão vigente. Regra espelhada no AGENTS.md.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = 'supabase/migrations'
const arq = readdirSync(dir).filter((f) => f.endsWith('_esteira_pode_abrir_pr.sql')).sort().at(-1)
const erros: string[] = []
if (!arq) erros.push('migration fn_esteira_pode_abrir_pr ausente')
else {
  const sql = readFileSync(join(dir, arq), 'utf8')
  if (!/fn_esteira_pode_abrir_pr\(\s*\n?\s*p_agente text/.test(sql)) erros.push('assinatura da função')
  if (!/p_urgente/.test(sql) || !/p_correcao_esteira/.test(sql)) erros.push('parâmetros urgente/correção de esteira')
  if (!/REVOKE ALL ON FUNCTION[^;]*anon/.test(sql)) erros.push('REVOKE de anon')
  if (!/GRANT EXECUTE[^;]*service_role/.test(sql)) erros.push('GRANT só service_role')
  // CEO 30/10: sem teto — 'pode' sempre true e nenhum "prontas <= N" segurando a abertura.
  if (!/'pode',\s*true/.test(sql)) erros.push('sem teto: a função tem de devolver pode=true (CEO 30/10)')
  if (/prontas\s*<=\s*\d/.test(sql)) erros.push('ainda há teto de prontas — CEO 30/10 removeu')
}
if (!/fn_esteira_pode_abrir_pr/.test(readFileSync('AGENTS.md', 'utf8'))) erros.push('regra no AGENTS.md')
if (erros.length) { console.error('check-esteira-limite-prontas: ' + erros.join('; ')); process.exit(1) }
console.log('check-esteira-limite-prontas: ok (sem teto, CEO 30/10)')
