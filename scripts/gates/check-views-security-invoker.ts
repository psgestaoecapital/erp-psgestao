// Gate (CEO 05/10 · RD-79): view em public legível por authenticated sem security_invoker=true ignora a RLS e vaza dado
// entre empresas. Roda no build, sem rede: toda migration que cria/recria view precisa reaplicar security_invoker, e a
// Onda 1 (financeiro, compliance/EPI/folha, odonto, veículos) tem de estar coberta.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261005143000_views_security_invoker_onda1.sql', 'utf8')
const onda1 = ['v_compliance_calendar_dashboard', 'v_compliance_matriz_prestadores', 'v_compliance_status_consultas',
  'v_contas_pagar_aging', 'v_contas_receber_aging', 'v_custo_folha_setor', 'v_psgc_dre_divisional', 'v_dre_divisional_completo',
  'v_dre_receita_3_fontes', 'v_epi_dashboard', 'v_epi_ficha_funcionario', 'v_epi_funcionarios_consolidado',
  'v_lancamentos_consolidado', 'v_odonto_debitos_paciente', 'v_psgc_dre_nivel2', 'v_psgc_dre_nivel3', 'v_psgc_fluxo_projecao',
  'v_psgc_pagar_distribuido', 'v_receber_efetivo', 'v_titulos_consolidados', 'v_veic_patio', 'v_veic_venda']
for (const v of onda1) ok(new RegExp(`ALTER VIEW public\\.${v}\\s+SET \\(security_invoker = true\\)`).test(mig), `Onda 1: ${v} com security_invoker`)
ok(/REVOKE ALL ON FUNCTION public\.fn_seguranca_views_sem_invoker\(\) FROM PUBLIC, anon, authenticated/.test(mig), 'auditoria fechada a anon/authenticated')

// Migrations posteriores à Onda 1 que criam view: precisam declarar security_invoker (ou REVOKE do authenticated).
const novas = readdirSync('supabase/migrations').filter(f => f > '20261005143000' && f.endsWith('.sql'))
for (const f of novas) {
  const sql = readFileSync(`supabase/migrations/${f}`, 'utf8').replace(/--.*$/gm, '')
  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?(\w+)\s*(\([^)]*\))?\s*(WITH\s*\([^)]*\))?/gi)) {
    ok(/security_invoker\s*=\s*(true|on)/i.test(m[3] || ''), `${f}: view ${m[1]} criada com security_invoker=true`)
  }
}
if (falhas) { console.error(`\n${falhas} falha(s) em views sem security_invoker`); process.exit(1) }
console.log('\nViews com security_invoker (Onda 1): ok')
