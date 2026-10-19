// Gate RD-97 (CEO 16/10) — migration nova da PR só pode ser ADITIVA. Reprova DROP de objeto existente, TRUNCATE,
// DELETE/UPDATE sem WHERE ou em tabela de domínio (financeiro/fiscal/estoque/clientes…), ALTER COLUMN TYPE, SET NOT NULL
// sem DEFAULT, ADD COLUMN NOT NULL sem DEFAULT e RENAME de tabela/coluna. Exceção só com a etiqueta
// "migration-destrutiva-autorizada" (posta pelo revisor) + "Plano de volta: …" no corpo da PR.
//   Em PR (CI): lê as migrations ADICIONADAS contra origin/main; PR_LABELS (JSON) e PR_BODY vêm do workflow gates.yml.
//   Local: `npm run gates -- migration-segura` (compara com origin/main, se existir).
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { analisarMigration, excecaoValida, ehTabelaDominio, ETIQUETA_EXCECAO } from './_migration-segura-lib'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const reprova = (sql: string) => analisarMigration(sql).length > 0

// ── Casos de teste: cada proibição reprova ──
ok(reprova('DROP TABLE erp_pagar;'), 'DROP TABLE reprova')
ok(reprova('DROP COLUMN x;') === false && reprova('ALTER TABLE t DROP COLUMN x;'), 'ALTER TABLE … DROP COLUMN reprova')
ok(reprova('DROP FUNCTION IF EXISTS public.fn_x(int);'), 'DROP FUNCTION reprova')
ok(reprova('DROP VIEW v_x;'), 'DROP VIEW reprova')
ok(reprova('TRUNCATE erp_receber;'), 'TRUNCATE reprova')
ok(reprova('DELETE FROM erp_aux;'), 'DELETE sem WHERE reprova')
ok(reprova("DELETE FROM erp_pagar WHERE id = 1;"), 'DELETE em tabela de domínio (erp_pagar) reprova mesmo com WHERE')
ok(reprova("UPDATE erp_nfe_itens SET x = 1 WHERE id = 2;"), 'UPDATE em erp_nfe_* reprova')
ok(reprova("UPDATE public.erp_clientes SET nome = 'x' WHERE id = 2;"), 'UPDATE em erp_clientes (com schema) reprova')
ok(reprova('UPDATE erp_aux SET x = 1;'), 'UPDATE sem WHERE reprova')
ok(reprova('ALTER TABLE t ALTER COLUMN c TYPE bigint;'), 'ALTER COLUMN TYPE reprova')
ok(reprova('ALTER TABLE t ALTER COLUMN c SET DATA TYPE text;'), 'ALTER COLUMN SET DATA TYPE reprova')
ok(reprova('ALTER TABLE t ALTER COLUMN c SET NOT NULL;'), 'SET NOT NULL reprova')
ok(reprova('ALTER TABLE t ADD COLUMN c int NOT NULL;'), 'ADD COLUMN NOT NULL sem DEFAULT reprova')
ok(reprova('ALTER TABLE t RENAME COLUMN a TO b;'), 'RENAME COLUMN reprova')
ok(reprova('ALTER TABLE t RENAME TO t2;'), 'RENAME TABLE reprova')
ok(reprova('DO $$ BEGIN DROP TABLE x; END $$;'), 'DROP escondido em DO $$ reprova')
ok(reprova('DROP TABLE x /* ; */;') , 'DROP com comentário no meio reprova')

// ── Aditiva passa ──
const aditiva = `
-- tabela nova com RLS
CREATE TABLE IF NOT EXISTS public.erp_exemplo_novo (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL, nome text);
ALTER TABLE public.erp_exemplo_novo ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_emp ON public.erp_exemplo_novo USING (true);
REVOKE ALL ON public.erp_exemplo_novo FROM anon;
ALTER TABLE public.erp_pagar ADD COLUMN IF NOT EXISTS obs text;
ALTER TABLE public.erp_pagar ADD COLUMN flag boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS ix_exemplo ON public.erp_exemplo_novo (empresa_id);
CREATE OR REPLACE FUNCTION public.fn_exemplo() RETURNS void LANGUAGE plpgsql AS $f$ BEGIN DELETE FROM erp_aux WHERE true; DROP TABLE IF EXISTS tmp_x; END $f$;
INSERT INTO erp_ajuda_campo (chave, texto) VALUES ('a', 'DROP TABLE; DELETE FROM erp_pagar') ON CONFLICT DO NOTHING;
UPDATE erp_config_nova SET v = 1 WHERE chave = 'x';
`
ok(analisarMigration(aditiva).length === 0, `migration aditiva passa (${JSON.stringify(analisarMigration(aditiva))})`)
ok(ehTabelaDominio('erp_nfse_itens') && ehTabelaDominio('public.tenant_subscriptions') && !ehTabelaDominio('erp_config_nova'), 'classificação de tabela de domínio')

// ── Redefinir é aditivo (DROP IF EXISTS + CREATE do mesmo nome); sem recriar, reprova ──
ok(!reprova('DROP POLICY IF EXISTS p ON t; CREATE POLICY p ON t USING (true);'), 'DROP POLICY + CREATE POLICY do mesmo nome passa')
ok(!reprova('DROP TRIGGER IF EXISTS tg ON t; CREATE TRIGGER tg BEFORE INSERT ON t FOR EACH ROW EXECUTE FUNCTION f();'), 'DROP TRIGGER + CREATE TRIGGER passa')
ok(!reprova('ALTER TABLE t DROP CONSTRAINT IF EXISTS c; ALTER TABLE t ADD CONSTRAINT c CHECK (x > 0);'), 'DROP CONSTRAINT + ADD CONSTRAINT passa')
ok(!reprova('DROP FUNCTION IF EXISTS public.fn_a(int); CREATE OR REPLACE FUNCTION public.fn_a(int, int) RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;'), 'DROP FUNCTION + CREATE do mesmo nome passa')
ok(reprova('DROP POLICY IF EXISTS p ON t;'), 'DROP POLICY sem recriar reprova')
ok(reprova('ALTER TABLE t DROP CONSTRAINT c;'), 'DROP CONSTRAINT sem recriar reprova')
ok(reprova('DROP TABLE IF EXISTS t; CREATE TABLE t (id int);'), 'DROP TABLE nunca tem folga, nem recriando')

// ── Exceção: etiqueta do revisor + plano de volta ──
ok(!excecaoValida([], 'Plano de volta: restaurar do backup tal').ok, 'exceção sem etiqueta não vale')
ok(!excecaoValida([ETIQUETA_EXCECAO], 'sem plano').ok, 'exceção sem plano de volta não vale')
ok(excecaoValida([ETIQUETA_EXCECAO], 'Plano de volta: restaurar a coluna do backup de 16/10 e reverter o código').ok, 'etiqueta + plano de volta valem')

// ── Migrations novas desta PR ──
function novasMigrations(): string[] {
  const base = process.env.MIGRATION_SEGURA_BASE || 'origin/main'
  try {
    execFileSync('git', ['rev-parse', '--verify', '-q', base], { stdio: 'ignore' })
  } catch { console.log(`(sem ${base}: só os casos de teste)`); return [] }
  if (process.env.GITHUB_EVENT_NAME && process.env.GITHUB_EVENT_NAME !== 'pull_request') { console.log('(não é PR: só os casos de teste)'); return [] }
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=AM', `${base}...HEAD`, '--', 'supabase/migrations'], { encoding: 'utf8' })
  return out.split('\n').filter((f) => f.endsWith('.sql') && existsSync(f))
}
let labels: string[] = []
try { labels = JSON.parse(process.env.PR_LABELS || '[]') } catch { labels = [] }
const excecao = excecaoValida(labels, process.env.PR_BODY || '')
for (const f of novasMigrations()) {
  const achados = analisarMigration(readFileSync(f, 'utf8'))
  if (achados.length === 0) { ok(true, `${f}: aditiva`); continue }
  if (excecao.ok) { console.log(`⚠ ${f}: ${achados.length} achado(s) liberados pela exceção (${excecao.motivo})`); continue }
  for (const a of achados) console.error(`  RD-97 · ${f}: ${a.regra} → ${a.trecho}`)
  ok(false, `${f}: migration destrutiva (RD-97) — ${excecao.motivo}`)
}

if (falhas) { console.error(`\n${falhas} falha(s) no gate check-migration-segura`); process.exit(1) }
console.log('\ncheck-migration-segura: OK')
