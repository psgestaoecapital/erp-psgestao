/**
 * Gate de build (CEO 25/11) — T1 do Consultor IA: o parser de segurança (src/lib/consultor/sqlGuard.ts) só deixa passar
 * SELECT de leitura sobre a camada semântica (schema consultor), e barra tudo que possa escapar: tabela de public,
 * set_config/current_setting/pg_*, dblink/lo_*, INSERT/UPDATE/DELETE/DDL, 2 comandos, FOR UPDATE, SELECT ... INTO,
 * função fora da allowlist. É a 1ª das 5 travas (a 2ª é o papel consultor_leitor no banco).
 *   npm run gates -- consultor-sql-guard
 */
import { validarSqlConsultor } from '../../src/lib/consultor/sqlGuard'

let falhas = 0
const pass = async (sql: string) => {
  const r = await validarSqlConsultor(sql)
  if (!r.ok) { falhas++; console.error(`✘ deveria PASSAR mas barrou (${r.motivo}): ${sql}`) }
  else console.log(`✓ passa: ${sql.slice(0, 70)}`)
}
const bloqueia = async (sql: string, oque: string) => {
  const r = await validarSqlConsultor(sql)
  if (r.ok) { falhas++; console.error(`✘ deveria BLOQUEAR (${oque}) mas passou: ${sql}`) }
  else console.log(`✓ bloqueia ${oque}: ${r.motivo}`)
}

async function main() {
  // PASSAM — leitura legítima sobre a camada semântica
  await pass("SELECT tipo, sum(valor) AS total FROM titulos WHERE status = 'pago' GROUP BY tipo")
  await pass("SELECT parceiro, saldo FROM titulos WHERE tipo = 'receber' AND saldo > 0 ORDER BY saldo DESC")
  await pass('SELECT nome, documento FROM parceiros WHERE papel = \'cliente\'')
  await pass("SELECT b.titulo_id, b.valor FROM baixas b JOIN boletos bo ON bo.titulo_id = b.titulo_id")
  await pass("WITH pg AS (SELECT titulo_id, sum(valor) v FROM baixas GROUP BY titulo_id) SELECT * FROM pg WHERE v > 100")
  await pass("SELECT quem, acao, quando FROM historico_titulo ORDER BY quando DESC")
  await pass("SELECT date_trunc('month', vencimento) m, count(*) FROM titulos GROUP BY 1")

  // BLOQUEIAM
  await bloqueia('SELECT * FROM public.erp_receber', 'tabela de public')
  await bloqueia('SELECT * FROM erp_receber', 'relação fora da camada semântica')
  await bloqueia("SELECT set_config('statement_timeout','1h',true)", 'set_config')
  await bloqueia("SELECT current_setting('request.jwt.claims')", 'current_setting')
  await bloqueia('SELECT pg_sleep(10)', 'pg_sleep')
  await bloqueia('SELECT pg_read_file(\'/etc/passwd\')', 'pg_* (leitura de arquivo)')
  await bloqueia("SELECT dblink('x','y')", 'dblink')
  await bloqueia("INSERT INTO consultor.sessao(txid, company_id) VALUES (1, gen_random_uuid())", 'INSERT')
  await bloqueia('UPDATE titulos SET valor = 0', 'UPDATE')
  await bloqueia('DELETE FROM titulos', 'DELETE')
  await bloqueia('DROP TABLE titulos', 'DROP')
  await bloqueia('SELECT 1; DROP TABLE titulos', '2 comandos')
  await bloqueia('SELECT * FROM titulos FOR UPDATE', 'FOR UPDATE')
  await bloqueia('SELECT valor INTO tmp FROM titulos', 'SELECT ... INTO')
  await bloqueia('SELECT gen_random_uuid()', 'função fora da allowlist')
  await bloqueia('SELECT public.fn_consultor_sql(gen_random_uuid(), \'x\')', 'função de public')
  await bloqueia('SELECT consultor.empresa_atual()', 'função de consultor')
  await bloqueia('TABLE erp_receber', 'TABLE de relação fora da camada')
  // TABLE <view> == SELECT * FROM <view>: leitura legítima de relação permitida
  await pass('TABLE titulos')

  if (falhas > 0) { console.error(`\n[check-consultor-sql-guard] ${falhas} caso(s) falharam`); process.exit(1) }
  console.log('\n[check-consultor-sql-guard] OK')
}
main()
