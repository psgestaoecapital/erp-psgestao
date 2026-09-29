/**
 * Gate de build: salvar a Configuração Fiscal não apaga o regime da empresa (CEO 29/09 · FC é LUCRO REAL).
 * fn_fiscal_salvar_config grava p_regime da CONFIG ("regime_normal" cobre presumido e real) — por cima de
 * lucro_presumido/lucro_real isso apagava a informação (audit_log: FC 08/09 e 23/09).
 *   tsx scripts/check-regime-empresa-preservado.ts
 */
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

const dir = 'supabase/migrations'
const ultimas = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  .filter((f) => /FUNCTION\s+public\.fn_fiscal_salvar_config\s*\(/i.test(readFileSync(`${dir}/${f}`, 'utf8')))
const vigente = ultimas[ultimas.length - 1]
ok(vigente === '20260929070000_fiscal_config_preserva_regime.sql', `a definição vigente de fn_fiscal_salvar_config é a que preserva o regime (${vigente})`)
const sql = readFileSync(`${dir}/${vigente}`, 'utf8')
const upd = sql.slice(sql.indexOf('UPDATE companies SET'), sql.indexOf('WHERE id = p_company_id;'))
ok(/WHEN p_regime = 'regime_normal' AND regime_tributario IN \('lucro_presumido', 'lucro_real'\)\s*THEN regime_tributario/.test(upd),
  'regime_normal não sobrescreve lucro_presumido/lucro_real na empresa')
ok(/ELSE COALESCE\(p_regime, regime_tributario\)/.test(upd), 'Simples/MEI continuam atualizando a empresa')
ok(/REVOKE ALL ON FUNCTION public\.fn_fiscal_salvar_config\([^)]*\) FROM PUBLIC, anon/.test(sql), 'sem acesso anônimo')

if (falhas > 0) { console.error(`\n[check-regime-empresa-preservado] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-regime-empresa-preservado] regime da empresa preservado.')
