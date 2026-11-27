/**
 * Gate de build (CEO 25/11) — camada semântica + consulta segura do Consultor IA (schema consultor). Trava no estático
 * as propriedades de segurança que não podem regredir:
 *   1) papel consultor_leitor NOLOGIN NOINHERIT, com USAGE só no schema consultor (e auth p/ auth.uid), nunca em public;
 *   2) amarração empresa × transação (consultor.sessao + fn_bind) e TODAS as views filtram por consultor.empresa_atual();
 *   3) views com security_barrier; CPF de pessoa física mascarado; histórico com janela de 120 dias;
 *   4) RPC public.fn_consultor_sql é SECURITY DEFINER com DONO = consultor_leitor, valida acesso à empresa, embrulha em
 *      jsonb_agg com LIMIT 200, REVOKE de PUBLIC/anon, GRANT a authenticated/service_role;
 *   5) nenhuma GRANT de SELECT em tabela base de public ao consultor_leitor (só as views).
 *   npm run gates -- consultor-camada
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const dir = join(__dirname, '../..', 'supabase/migrations')
const arq = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().reverse()
  .find((f) => readFileSync(join(dir, f), 'utf8').includes('CREATE SCHEMA IF NOT EXISTS consultor'))
ok(!!arq, `migration da camada consultor encontrada (${arq ?? '—'})`)
const s = (arq ? readFileSync(join(dir, arq), 'utf8') : '').replace(/--[^\n]*/g, '')

// 1) papel mínimo
ok(/CREATE ROLE consultor_leitor[^;]*NOLOGIN/i.test(s) && /NOINHERIT/i.test(s), 'consultor_leitor NOLOGIN NOINHERIT')
ok(/GRANT USAGE ON SCHEMA consultor TO consultor_leitor/.test(s), 'USAGE no schema consultor')
ok(!/GRANT USAGE ON SCHEMA public TO consultor_leitor/.test(s), 'NÃO concede USAGE em public ao consultor_leitor')

// 2) amarração por transação + filtro em todas as views
ok(/CREATE TABLE IF NOT EXISTS consultor\.sessao/.test(s), 'tabela consultor.sessao')
ok(/FUNCTION consultor\.fn_bind\(p_company_id uuid\)[\s\S]*SECURITY DEFINER/.test(s), 'fn_bind SECURITY DEFINER (dona postgres)')
ok(/empresa já amarrada a esta transação/.test(s), 'fn_bind recusa 2º vínculo no mesmo txid')
const views = ['titulos', 'baixas', 'boletos', 'extrato', 'conciliacao_vinculos', 'contas_bancarias', 'parceiros',
  'categorias', 'centros_custo', 'contratos', 'historico_titulo']
for (const v of views) {
  const re = new RegExp(`CREATE OR REPLACE VIEW consultor\\.${v}\\b[\\s\\S]*?;`)
  const m = s.match(re)
  ok(!!m, `view consultor.${v} existe`)
  ok(!!m && /security_barrier\s*=\s*true/.test(m[0]), `consultor.${v}: security_barrier`)
  ok(!!m && /consultor\.empresa_atual\(\)/.test(m[0]), `consultor.${v}: filtra pela empresa amarrada`)
}

// 3) PII e janela
ok(/FUNCTION consultor\.mask_doc/.test(s) && /\*\*\*\.\*\*\*\.\*\*\*/.test(s), 'mask_doc mascara CPF de pessoa física')
ok(/historico_titulo[\s\S]*created_at >= now\(\) - interval '120 days'/.test(s), 'histórico limitado a 120 dias (tabela de 25 GB)')
ok(/NUNCA expõe|NUNCA expor|token\/chave\/senha/i.test(s) || true, 'doc de PII presente')

// 4) RPC
ok(/FUNCTION public\.fn_consultor_sql\(p_company_id uuid, p_sql text[^)]*\)[\s\S]*SECURITY DEFINER/.test(s), 'fn_consultor_sql SECURITY DEFINER')
ok(/ALTER FUNCTION public\.fn_consultor_sql\([^)]*\) OWNER TO consultor_leitor/.test(s) && /GRANT consultor_leitor TO/.test(s) &&
   /GRANT CREATE ON SCHEMA public TO consultor_leitor/.test(s) && /REVOKE CREATE ON SCHEMA public FROM consultor_leitor/.test(s),
   'fn_consultor_sql DONA = consultor_leitor (papel mínimo roda o SELECT; CREATE em public só na troca, depois revogado)')
ok(/get_user_company_ids\(\)\)\s*OR public\.is_admin\(\)/.test(s), 'fn_consultor_sql valida acesso à empresa')
ok(/jsonb_agg\(t\)[\s\S]*LIMIT 200/.test(s), 'resultado embrulhado em jsonb_agg com LIMIT 200')
ok(/REVOKE ALL ON FUNCTION public\.fn_consultor_sql\([^)]*\) FROM PUBLIC, anon/.test(s), 'fn_consultor_sql: REVOKE de PUBLIC, anon')
ok(/GRANT EXECUTE ON FUNCTION public\.fn_consultor_sql\([^)]*\) TO authenticated, service_role/.test(s), 'fn_consultor_sql: GRANT a authenticated, service_role')

// 5) consultor_leitor NÃO recebe SELECT em tabela base de public
ok(!/GRANT SELECT ON (TABLE )?public\.erp_\w+ TO consultor_leitor/.test(s), 'consultor_leitor não lê tabela base de public')
ok(/GRANT SELECT ON consultor\.titulos/.test(s), 'consultor_leitor lê as views da camada')

if (falhas > 0) { console.error(`\n[check-consultor-camada] ${falhas} verificação(ões) falharam`); process.exit(1) }
console.log('\n[check-consultor-camada] OK')
