// Gate (CEO 09/10, msg c2d861ab · jordana-code): a DEMO "Agência (P&M) - DEMO" (…02) tem a JORNADA INTEIRA
// cliente → fee (contrato na GE) → briefing → job → tarefas → horas → aprovação do cliente → custo/margem → título na GE → DRE,
// semeada de forma reparável e ligada ao mapa de ligações do PDCA. Roda sem rede: confere a migration.
// A migration é achada pelo SUFIXO do nome (a fila de merge pode renumerar a versão).
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const dir = 'supabase/migrations'
const arq = readdirSync(dir).filter((f) => f.endsWith('_pm_demo_jornada_seed.sql'))
ok(arq.length === 1, `uma migration *_pm_demo_jornada_seed.sql (achou ${arq.length})`)
const sql = arq.length ? readFileSync(`${dir}/${arq[0]}`, 'utf8').replace(/--[^\n]*/g, '') : ''
const corpo = (nome: string) => {
  const i = sql.indexOf(`FUNCTION public.${nome}(`)
  if (i < 0) return ''
  const fim = sql.indexOf('END $function$', i)
  return fim < 0 ? '' : sql.slice(i, fim)
}
const jornada = corpo('fn_demo_seed_pm_jornada')
const gold = corpo('fn_gold_pm_seed_reparar')

// Só a DEMO fixa da P&M, nunca empresa real
ok(jornada.includes("v_demo uuid := 'b0700000-0000-4000-a000-000000000002'"), 'jornada presa à DEMO …02')
ok(/IF p_company_id IS DISTINCT FROM v_demo\s+OR NOT EXISTS \(SELECT 1 FROM companies WHERE id = p_company_id AND is_demo IS TRUE\) THEN\s+RETURN/.test(jornada),
  'outra empresa (ou empresa sem is_demo) é recusada antes de qualquer escrita')
ok(/REVOKE ALL ON FUNCTION public\.fn_demo_seed_pm_jornada\(uuid\) FROM PUBLIC, anon, authenticated/.test(sql), 'sem GRANT a usuário (só fn_demo_reset/service_role)')
ok(!/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i.test(sql), 'não apaga nada')

// Cada elo da jornada
const elos: [RegExp, string][] = [
  [/INSERT INTO erp_contratos \([^)]*\)[\s\S]*?'DEMO-PM-FEE-01'[\s\S]*?'agencia_pm', 'receita'/, '(2) fee = contrato ATIVO na GE (erp_contratos, tipo agencia_pm)'],
  [/INSERT INTO agency_contratos \([^)]*erp_contrato_id[^)]*\)/, '(2) contrato da P&M ligado ao da GE (erp_contrato_id)'],
  [/INSERT INTO agency_briefings[\s\S]*?'virou_job'/, '(3) briefing do cliente que virou job'],
  [/INSERT INTO agency_jobs \([^)]*briefing_id, contrato_id, fee_id[^)]*\)/, '(4) job ligado ao briefing e ao fee'],
  [/INSERT INTO agency_tarefas/, '(5) tarefas do job'],
  [/INSERT INTO agency_timesheet \([^)]*tarefa_id[^)]*custo_hora, inicio_em, fim_em, aprovado, aprovado_por\)/, '(6) horas por tarefa, com custo/hora, FECHADAS (fim_em) e aprovadas'],
  [/INSERT INTO agency_aprovacoes[\s\S]*?'aprovado'/, '(7) aprovação do cliente'],
  [/UPDATE agency_jobs j SET horas_realizadas = s\.h, custo_real = s\.c/, '(8) custo do job = soma das horas apontadas'],
  [/fn_contrato_gerar_receber\(v_erp_contr, r\.d\)/, '(9) título na GE pelo gerador REAL do contrato'],
  [/PERFORM fn_psgc_recalcular_dre_mes\(v_demo,/, '(10) DRE pelo recálculo REAL'],
]
for (const [re, msg] of elos) ok(re.test(jornada), msg)
ok(!/custo_total\s*,\s*aprovado/.test(jornada), 'não grava custo_total (coluna gerada)')

// Reparável e no reset
ok((jornada.match(/IF (v_[a-z_0-9]+ IS NULL|NOT EXISTS)/g) ?? []).length >= 9, 'cada peça só é criada se faltar (reparável)')
ok(/v_jornada := fn_demo_seed_pm_jornada\(v_bot\)/.test(gold), 'fn_gold_pm_seed_reparar (chamado pelo fn_demo_reset) roda a jornada')
ok(/IF p_company_id <> v_bot THEN\s+RETURN jsonb_build_object\('ok', false, 'erro', 'so_empresa_bot'\)/.test(gold), 'fn_gold_pm_seed_reparar mantém a recusa de outra empresa')

// Mapa de ligações do PDCA
ok(/IF to_regclass\('public\.pdca_ligacao'\) IS NOT NULL THEN/.test(jornada), 'ligações só gravadas se o mapa do PDCA existir')
for (let n = 1; n <= 8; n++) ok(jornada.includes(`('pm','PM-0${n}',`), `ligação PM-0${n} no mapa`)
ok((jornada.match(/\$q\$SELECT GREATEST\(count\(\*\),1\)::int/g) ?? []).length === 8, 'toda ligação exige pelo menos 1 (DEMO vazia = vermelho, não verde)')
ok((jornada.match(/'jordana-code'\)/g) ?? []).length === 8, 'dono das ligações = jordana-code')
ok(/ON CONFLICT \(vertical, codigo\) DO NOTHING/.test(jornada), 'ligações idempotentes')

if (falhas) { console.error(`\n${falhas} falha(s) na DEMO da P&M (jornada)`); process.exit(1) }
console.log('\nDEMO da P&M com a jornada inteira: ok')
