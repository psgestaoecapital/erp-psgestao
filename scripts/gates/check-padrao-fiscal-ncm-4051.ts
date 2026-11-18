// Gate do chamado #4051 — "Padrão fiscal por NCM" (fatia 1, backend).
// Confere, de forma estática, que a migration cria a tabela company-scoped com RLS + REVOKE anon,
// e que o resolver aplica a regra do chamado: o padrão MAIS ESPECÍFICO cujo NCM é prefixo do NCM do
// produto vence. A migration é achada pelo sufixo (a fila pode renumerar a versão).
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const dir = 'supabase/migrations'
const arq = readdirSync(dir).find((f) => f.endsWith('_padrao_fiscal_ncm_4051.sql'))
ok(!!arq, 'migration do #4051 existe')
const sql = arq ? readFileSync(`${dir}/${arq}`, 'utf8') : ''

// tabela nova, company-scoped
ok(/CREATE TABLE IF NOT EXISTS public\.erp_padrao_fiscal_ncm/.test(sql), 'cria a tabela erp_padrao_fiscal_ncm')
ok(/company_id\s+uuid NOT NULL REFERENCES public\.companies\(id\)/.test(sql), 'company_id NOT NULL referencia companies (company-scoped)')
ok(/ncm\s+~\s+'\^\[0-9\]\{2,8\}\$'/.test(sql), 'NCM só dígitos, 2 a 8 (capítulo ao item completo)')
ok(/CREATE UNIQUE INDEX IF NOT EXISTS ux_padrao_fiscal_ncm_empresa_ncm[\s\S]*\(company_id, ncm\)/.test(sql),
  'índice único por (company_id, ncm)')

// RLS ligada + policy por empresa (sem policy permissiva) + REVOKE anon
ok(/ALTER TABLE public\.erp_padrao_fiscal_ncm ENABLE ROW LEVEL SECURITY/.test(sql), 'RLS habilitada')
ok(/CREATE POLICY erp_padrao_fiscal_ncm_sel[\s\S]*company_id IN \(SELECT get_user_company_ids\(\)\) OR is_admin\(\)/.test(sql),
  'policy SELECT por empresa (get_user_company_ids/is_admin)')
ok(/CREATE POLICY erp_padrao_fiscal_ncm_mod[\s\S]*WITH CHECK \(company_id IN \(SELECT get_user_company_ids\(\)\) OR is_admin\(\)\)/.test(sql),
  'policy de escrita com WITH CHECK por empresa (nunca permissiva)')
ok(/REVOKE ALL ON TABLE public\.erp_padrao_fiscal_ncm FROM PUBLIC, anon/.test(sql), 'REVOKE anon/PUBLIC na tabela')

// resolver: guard de tenant, regra do prefixo mais específico, nunca inventa número
const fnResolver = sql.split('fn_padrao_fiscal_ncm_resolver(p_company_id uuid, p_ncm text)')[1]?.split('$function$;')[0] ?? ''
ok(fnResolver.length > 0, 'cria fn_padrao_fiscal_ncm_resolver')
ok(/NOT \(p_company_id IN \(SELECT get_user_company_ids\(\)\) OR is_admin\(\)\)/.test(fnResolver), 'resolver: guard de tenant')
ok(/left\(v_ncm, length\(p\.ncm\)\) = p\.ncm/.test(fnResolver) && /ORDER BY length\(p\.ncm\) DESC/.test(fnResolver),
  'resolver: NCM do padrão é prefixo do NCM do produto, mais específico (maior prefixo) vence')
ok(/'ok', false, 'motivo', 'sem_padrao_para_ncm'/.test(fnResolver), 'resolver: sem padrão -> ok:false (não inventa número)')

// CRUD guardado por empresa
ok(/fn_padrao_fiscal_ncm_salvar/.test(sql) && /fn_padrao_fiscal_ncm_remover/.test(sql) && /fn_padrao_fiscal_ncm_listar/.test(sql),
  'funções salvar/remover/listar presentes')

// ACL explícita nas funções SECURITY DEFINER
for (const fn of ['resolver', 'salvar', 'remover', 'listar']) {
  ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.fn_padrao_fiscal_ncm_${fn}\\(`).test(sql)
    && new RegExp(`GRANT EXECUTE ON FUNCTION public\\.fn_padrao_fiscal_ncm_${fn}\\([^)]*\\) TO authenticated, service_role`).test(sql),
    `ACL explícita em fn_padrao_fiscal_ncm_${fn} (REVOKE anon + GRANT authenticated, service_role)`)
}

if (falhas) { console.error(`\n${falhas} verificação(ões) falharam — padrão fiscal por NCM (#4051)`); process.exit(1) }
console.log('\ncheck-padrao-fiscal-ncm-4051: ok')
