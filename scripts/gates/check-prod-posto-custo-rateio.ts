// Gate (revisor #3406) — invariantes de LGPD/isolamento da migration A2 (custo do posto e rateio da Produtividade).
// Estático (sem rede/banco). A prova com dado vive em scripts/testes-sql/prod_posto_custo_rateio.sql (Postgres local).
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const ARQ = readdirSync('supabase/migrations').find((f) => f.endsWith('_prod_posto_custo_rateio_banco.sql'))
if (!ARQ) { console.error('✗ migration *_prod_posto_custo_rateio_banco.sql não encontrada'); process.exit(1) }
const SQL = readFileSync(`supabase/migrations/${ARQ}`, 'utf8')
const tem = (re: RegExp) => re.test(SQL)

for (const t of ['prod_posto_custo', 'prod_rateio_config']) {
  ok(tem(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`)), `${t}: RLS ligada`)
  ok(tem(new RegExp(`REVOKE ALL ON public\\.${t} FROM anon, authenticated`)), `${t}: sem acesso direto (só RPC)`)
  ok(!tem(new RegExp(`CREATE POLICY[^;]*${t}`, 'i')), `${t}: nenhuma policy`)
}
ok(tem(/REVOKE ALL ON FUNCTION public\.fn_prod_posto_custo_hora_interno\(uuid, date\) FROM PUBLIC, anon, authenticated/),
  'função interna de custo/hora não é chamável por ninguém além das RPCs')
// LGPD (CEO 28/10): menos de 3 pessoas = mão de obra protegida
ok(tem(/v_prot := \(v_n = 2147483647 OR v_n < 3\)/), 'LGPD: posto com menos de 3 pessoas (ou sem contagem) é protegido')
ok(tem(/IF v_prot THEN\s+v_mo := NULL; v_mo_origem := NULL;/), 'LGPD: protegido zera mão de obra (manual e por salário)')
ok(tem(/'mao_obra_protegida', v_prot/), 'LGPD: devolve o marcador mao_obra_protegida')
ok(!/sb\.valor\)?\s*,\s*'/.test(SQL) && !tem(/'salario/i), 'LGPD: nenhum campo de salário individual no JSON')
// isolamento
ok(tem(/industrial_plants ip WHERE ip\.id = p_plant_id AND ip\.company_id = p_company_id/), 'planta conferida contra a empresa')
ok((SQL.match(/planta_de_outra_empresa/g) ?? []).length >= 2, 'planta alheia recusada em vivo_listar e criterio_salvar')
ok(tem(/LEFT JOIN prod_setor s ON s\.id = p\.setor_id AND s\.company_id = p\.company_id/), 'setor da mesma empresa')
const defs = SQL.match(/CREATE OR REPLACE FUNCTION public\.fn_prod_\w+/g) ?? []
const revokes = SQL.match(/REVOKE ALL ON FUNCTION public\.fn_prod_\w+\([^)]*\) FROM PUBLIC/g) ?? []
ok(defs.length === revokes.length && defs.length >= 6, `toda função tem REVOKE (${revokes.length}/${defs.length})`)
// teste com dado existe
const T = readFileSync('scripts/testes-sql/prod_posto_custo_rateio.sql', 'utf8')
ok(/posto de 3|mao_obra_protegida/.test(T) && /fecha 100%/.test(T), 'teste SQL cobre posto de 1/2/3 pessoas e rateio 100%')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
