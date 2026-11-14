// Gate — Portal do cliente da obra (H9), ETAPA (c): LEITURA.
// Garante, sem rede, que as RPCs de leitura do portal nascem fail-closed e que a tela as consome com "?" (RD-95).
//   1) as 4 funções existem (conferidor + 3 leituras), SECURITY DEFINER e sem EXECUTE para anon;
//   2) cada RPC de leitura confere o acesso por fn_obra_portal_pode_ver ANTES de qualquer dado;
//   3) a tela portal-cliente lê as 3 RPCs e tem o "?" de cada bloco da prévia;
//   4) a ajuda de campo (RD-95) das chaves da prévia está seedada na migration.
import { readFileSync, readdirSync } from 'node:fs'

let fail = 0
const ok = (c: boolean, m: string) => { if (c) { console.log('✓', m) } else { console.error('✗', m); fail++ } }

const migs = readdirSync('supabase/migrations').filter((f) => f.includes('hub_obra_portal_cliente_leitura'))
const sql = migs.length ? readFileSync(`supabase/migrations/${migs[0]}`, 'utf8') : ''
ok(sql.length > 0, 'migration da leitura do portal do cliente existe')

const READ_FNS = ['fn_obra_portal_avanco', 'fn_obra_portal_fotos', 'fn_obra_portal_medicoes']
const ALL_FNS = ['fn_obra_portal_pode_ver', ...READ_FNS]

for (const fn of ALL_FNS) {
  ok(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b`).test(sql), `${fn} definida`)
  ok(new RegExp(`${fn}[\\s\\S]{0,400}SECURITY DEFINER`).test(sql), `${fn} é SECURITY DEFINER`)
  ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon`).test(sql), `${fn} sem EXECUTE para anon`)
}

// O conferidor é fail-closed (nega sem login).
ok(/fn_obra_portal_pode_ver[\s\S]*?auth\.uid\(\) IS NULL[\s\S]*?RETURN false/.test(sql), 'conferidor nega quando não há login (fail-closed)')

// Cada RPC de leitura confere o acesso antes dos dados.
const guardas = (sql.match(/IF NOT public\.fn_obra_portal_pode_ver\(p_obra_id\) THEN/g) || []).length
ok(guardas >= READ_FNS.length, `as 3 leituras conferem o acesso por fn_obra_portal_pode_ver (achei ${guardas})`)
ok((sql.match(/RAISE EXCEPTION 'Sem acesso a esta obra' USING ERRCODE = '42501'/g) || []).length >= READ_FNS.length,
   'leituras levantam 42501 quando o acesso é negado')

// Projeção sem custo/margem interno (o cliente nunca vê custo).
ok(!/jsonb_build_object\([^;]*custo_previsto/i.test(sql), 'a prévia não projeta custo_previsto')

const COMP = 'src/app/dashboard/projetos/obras/[id]/portal-cliente/page.tsx'
const comp = readFileSync(COMP, 'utf8')
for (const fn of READ_FNS) ok(comp.includes(fn), `tela consome ${fn}`)
ok(comp.includes('data-testid="portal-previa"'), 'tela tem a prévia do portal')

// RD-95: "?" de cada bloco da prévia + chave no banco.
for (const chave of ['obra.portal.previa', 'obra.portal.avanco', 'obra.portal.fotos', 'obra.portal.medicoes']) {
  ok(sql.includes(`'${chave}'`), `ajuda ${chave} seedada na migration`)
  ok(comp.includes(`chave="${chave}"`), `tela usa AjudaCampo chave="${chave}"`)
}

// Seed DEMO restrito a empresa DEMO (is_demo), nunca cliente real.
ok(/companies c ON c\.id = o\.company_id AND c\.is_demo = true/.test(sql), 'seed restrito à empresa DEMO (is_demo)')
ok(!/\bDELETE\s+FROM\b|\bTRUNCATE\b/i.test(sql), 'migration não apaga dado (sem DELETE FROM/TRUNCATE)')

if (fail) { console.error(`\n${fail} falha(s) — Portal do cliente (leitura) não entregue.`); process.exit(1) }
console.log('\nOK · Portal do cliente da obra — leitura (H9 etapa c)')
