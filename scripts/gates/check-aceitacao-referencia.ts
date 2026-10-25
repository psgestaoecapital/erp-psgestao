// Gate (CEO 18/10, ETAPA B) — RECONCILIAÇÃO NO INÍCIO de toda aceitação de PR contra o BANCO DE REFERÊNCIA (vaga 1, só
// leitura), ANTES de aplicar a migration da PR. Prova, no texto do script e do workflow (sem rede/banco, lição da #2812):
//  TRAVAS: alvo só vaga 0/2 (allowlist dos ids), referência só a vaga 1 (mgyxiamybepkphtfhway) e SÓ LEITURA, produção em
//          qualquer URL → aborta, Session pooler nos dois, nenhum DROP fora do schema public.
//  CASOS do CEO: (a) versão órfã sai do ledger; (b) objeto criado por PR (vaga-only) é removido; (c) função alterada
//          (def/permissão) é restaurada da referência; (d) tabela/coluna divergente → dispara Montar (não corrige);
//          alvo = referência ou = produção → aborta.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const ler = (p: string) => readFileSync(p, 'utf8')

const sh = ler('scripts/banco-testes/reconciliar-referencia.sh')

// ── TRAVAS OBRIGATÓRIAS ───────────────────────────────────────────────────────────────────────────────────────────
ok(/PROD_REF=horsymhsinqcimflrtjo/.test(sh) && /REF_ALVO=mgyxiamybepkphtfhway/.test(sh)
  && /VAGA0_REF=xjzqndnvjkdjyisuklpy/.test(sh) && /VAGA2_REF=jvntcgqoeuckljzeojxp/.test(sh),
  'travas: ids de produção, referência (vaga 1) e vagas-alvo 0/2 declarados')
ok(/case "\$TEST_DATABASE_URL" in \*"\$PROD_REF"\*\) erro/.test(sh)
  && /case "\$REF_DATABASE_URL"\s+in \*"\$PROD_REF"\*\) erro/.test(sh),
  'trava: id da PRODUÇÃO em QUALQUER URL (alvo OU referência) → aborta')
ok(/case "\$TEST_DATABASE_URL" in\s*\n\s*\*"\$VAGA0_REF"\*\|\*"\$VAGA2_REF"\*\) ;;\s*\n\s*\*\) erro/.test(sh),
  '(trava) ALVO só vaga 0 ou 2 (allowlist positivo) — fecha "alvo = referência" e "alvo = produção"')
ok(/case "\$REF_DATABASE_URL" in\s*\n\s*\*"\$REF_ALVO"\*\) ;;\s*\n\s*\*\) erro/.test(sh),
  '(trava) REFERÊNCIA só pode ser a vaga 1 (mgyxiamybepkphtfhway)')
ok(/case "\$TEST_DATABASE_URL" in \*pooler\.supabase\.com\*\) ;; \*\) erro/.test(sh)
  && /case "\$REF_DATABASE_URL"\s+in \*pooler\.supabase\.com\*\) ;; \*\) erro/.test(sh),
  '(trava) Session pooler exigido no alvo E na referência')
// controle: o MESMO regex da allowlist reprova um case sem o ramo de erro (drift tipo #2812)
ok(!/case "\$TEST_DATABASE_URL" in\s*\n\s*\*"\$VAGA0_REF"\*\|\*"\$VAGA2_REF"\*\) ;;\s*\n\s*\*\) erro/.test(
  sh.replace(/(\*"\$VAGA0_REF"\*\|\*"\$VAGA2_REF"\*\) ;;\s*\n\s*)\*\) erro[^\n]*/, '$1:;')),
  '(trava) controle: allowlist do alvo sem o ramo de erro reprovaria o gate')

// ── REFERÊNCIA é lida SÓ por SELECT (nunca escrita) ───────────────────────────────────────────────────────────────
ok(!/"\$REF_DATABASE_URL"[^\n]*-f /.test(sh), 'referência: nunca roda arquivo (-f) nela')
ok(!/"\$REF_DATABASE_URL"[^\n]*\b(drop|delete|update|insert|alter|create|truncate)\b/i.test(sh),
  'referência: só SELECT (nenhum DDL/DML inline nela)')
ok(/"\$PSQL" "\$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "\$txn"/.test(sh),
  'as escritas (transação) vão para a VAGA ALVO (TEST_DATABASE_URL), nunca na referência')

// ── Nenhum DROP fora do schema public ─────────────────────────────────────────────────────────────────────────────
ok(!/drop\s+schema/i.test(sh), 'nunca DROP SCHEMA')
{
  // todo comando de DROP de objeto é qualificado com public. (ou é "drop function <sig>" cujo sig já é public.<nome>())
  const drops = (sh.match(/echo "(drop [^"]*|do \$d\$ begin drop [^"]*)"/gi) || [])
  ok(drops.length > 0, 'há comandos de DROP no texto (b)')
  ok(drops.every((l) => /drop (function if exists \$\{k#func \}|view if exists public\.|table if exists public\.|type if exists public\.|sequence if exists public\.|index if exists public\.)/i.test(l)
    || /drop trigger if exists/.test(l) || /drop policy if exists/.test(l) || /drop constraint if exists/.test(l) || /drop column if exists/.test(l)),
    'todo DROP é no schema public (view/table/type/sequence/index/policy public.; função pelo regprocedure public.)')
  // constraint/trigger/coluna são por ALTER TABLE public."..." / DROP TRIGGER ... ON public."..."
  ok(/alter table if exists public\.\\?"\$t\\?" drop column if exists/.test(sh), 'coluna: ALTER TABLE public. … DROP COLUMN')
  ok(/drop trigger if exists \\?"\$tg\\?" on public\./.test(sh), 'trigger: DROP TRIGGER … ON public.')
  ok(/drop policy if exists \\?"\$pl\\?" on public\./.test(sh), 'policy: DROP POLICY … ON public.')
}

// ── (a) versão órfã sai do ledger (ausente na referência E na main) ───────────────────────────────────────────────
ok(/comm -13 "\$dir\/ref\.led" "\$dir\/vaga\.led" > "\$dir\/orphan\.pre"/.test(sh)
  && /comm -23 "\$dir\/orphan\.pre" "\$dir\/main\.led" > "\$dir\/orphan\.led"/.test(sh),
  '(a) órfão = versão na vaga, ausente na referência (comm vaga−ref) E ausente na main (comm −main)')
ok(/delete from supabase_migrations\.schema_migrations where version not in \(select version from _refled\) and version not in \(select version from _mainled\)/.test(sh),
  '(a) remove do ledger só os órfãos (ausentes na referência E na main) — nunca uma versão de migration da main (P1)')

// ── (b) objeto criado por PR (vaga-only) é removido ───────────────────────────────────────────────────────────────
ok(/comm -13 "\$dir\/ref\.keys" "\$dir\/vaga\.keys" > "\$dir\/vaga_only\.keys"/.test(sh),
  '(b) vaga-only = objeto na vaga e ausente na referência')
ok(/"func "\*\)\s*echo "drop function if exists \$\{k#func \};"/.test(sh)
  && /"table "\*\)\s*echo "drop table if exists public\./.test(sh),
  '(b) vaga-only vira DROP (função/tabela/… no public)')

// ── (c) função alterada (def/permissão) restaurada da referência ──────────────────────────────────────────────────
ok(/comm -12 "\$dir\/changed\.all" "\$dir\/ref\.keys" \| comm -12 - "\$dir\/vaga\.keys" > "\$dir\/diff\.keys"/.test(sh),
  '(c) diff = objeto em ambos com assinatura diferente')
ok(/"func "\*\) sig=\$\{k#func \}[\s\S]{0,400}pg_get_functiondef\('\$sig'::regprocedure\)/.test(sh),
  '(c) função diferente → recria da referência via pg_get_functiondef')
ok(/revoke all on function \$\{sig\} from public, anon, authenticated, service_role;/.test(sh)
  && /grant %s on function %s to %s/.test(sh),
  '(c) função: REVOKE + GRANT (permissões) reaplicados da referência')
ok(/"grant-fn "\*\) sig=\$\{k#grant-fn \}/.test(sh),
  '(c) permissão de função divergente (grant-fn) → reaplica as permissões da referência (sem recriar o corpo)')
ok(/"view "\*\) vn=\$\{k#view \}[\s\S]{0,200}pg_get_viewdef/.test(sh), '(c) view diferente → create or replace da referência')

// ── (d) tabela/coluna divergente → Montar (não corrige) ───────────────────────────────────────────────────────────
ok(/comm -23 "\$dir\/ref\.keys" "\$dir\/vaga\.keys" > "\$dir\/ref_only\.keys"/.test(sh),
  '(d) ref-only = objeto aprovado na referência e AUSENTE na vaga (estrutural)')
ok(/if \[ -s "\$dir\/ref_only\.keys" \]; then[\s\S]{0,260}montar /.test(sh),
  '(d) objeto da referência ausente na vaga (tabela/coluna) → montar (exit 2), não corrige')
ok(/grep -qvE '\^\(func\|view\|grant-fn\) ' "\$dir\/diff\.keys"[\s\S]{0,220}montar /.test(sh),
  '(d) modificação fora de função/view/permissão-de-função → montar (exit 2)')
ok(/montar\(\)\s*\{ echo "::error::vaga \$\{VAGA\} precisa de Montar: \$\*"; exit 2; \}/.test(sh),
  '(d) "precisa de Montar" é exit 2 (distinto de erro de guarda = exit 1)')

// ── VERIFY-BEFORE-COMMIT + verificação final (RD-38) ──────────────────────────────────────────────────────────────
ok(/\bbegin;/.test(sh) && /\bcommit;/.test(sh), 'reconciliação roda numa transação (begin … commit)')
ok(/raise exception 'reconcilia-ref: vaga nao convergiu para a referencia/.test(sh),
  'verify-before-commit: RAISE (rollback) se não convergir para a referência')
ok(/_refsig[\s\S]*except[\s\S]*_vagasig[\s\S]*except[\s\S]*_refsig/.test(sh),
  'verify compara assinatura vaga×referência (EXCEPT nos dois sentidos)')
ok(/VERIFICA[ÇC][ÃA]O FINAL OBRIGAT[ÓO]RIA/.test(sh), 'há verificação final obrigatória no dado (pós-reconciliação)')
ok(/\[ "\$sig_div" -ne 0 \] \|\| \[ "\$orphan_fim" -ne 0 \]/.test(sh) && /montar "verificação final/.test(sh),
  'verificação final: assinatura divergente OU órfão restante → Montar, nunca verde')

// ── WIRING no aceitacao-pr.yml ────────────────────────────────────────────────────────────────────────────────────
const pr = ler('.github/workflows/aceitacao-pr.yml')
ok(/Reconciliar a vaga com a referência \(vaga 1, só leitura\) — antes dos testes/.test(pr),
  'aceitacao-pr: tem o passo de reconciliação com a referência')
ok(/REF_DATABASE_URL: \$\{\{ secrets\.TEST_DATABASE_URL_1 \}\}/.test(pr),
  'aceitacao-pr: a referência é a vaga 1 (secrets.TEST_DATABASE_URL_1) — banco de TESTES, não produção (Pilar 2)')
ok(/scripts\/banco-testes\/reconciliar-referencia\.sh/.test(pr), 'aceitacao-pr: chama reconciliar-referencia.sh')
ok(/MAIN_MIGR_DIR="\$mmain\/supabase\/migrations" scripts\/banco-testes\/reconciliar-referencia\.sh/.test(pr),
  'aceitacao-pr: passa MAIN_MIGR_DIR (origin/main) para a proteção "referência atrasada" (P1)')
// o passo roda ANTES do "Sincronizar só-com-a-main → foto → aplicar migrations da PR" (reconcilia antes de aplicar a PR)
{
  const iRec = pr.indexOf('Reconciliar a vaga com a referência')
  const iFoto = pr.indexOf('Sincronizar só-com-a-main → foto → aplicar migrations da PR')
  ok(iRec > 0 && iFoto > 0 && iRec < iFoto, 'aceitacao-pr: reconciliação vem ANTES da foto/aplicar-migrations da PR')
}
ok(/rc" = 2[\s\S]{0,800}gh workflow run montar-banco-testes\.yml -f vaga="\$\{ACEITACAO_VAGA:-0\}" -f recriar=true/.test(pr),
  'aceitacao-pr: exit 2 (precisa de Montar) → dispara o Montar da vaga e falha (re-rodar)')
// Pilar 2: o passo (e o workflow) não carregam segredo de produção
ok(!/prod-url\.sh/.test(pr) && !/SUPABASE_ACCESS_TOKEN/.test(pr) && !/SUPABASE_DB_PASSWORD/.test(pr),
  'aceitacao-pr NÃO carrega segredo de produção (Pilar 2) — a referência é lida com o segredo de TESTE da vaga 1')

// ── P1: REFERÊNCIA ATRASADA — só reconcilia com o ledger da referência contendo toda a main e mesma versão máxima ──
ok(/MAIN_MIGR_DIR:\?MAIN_MIGR_DIR ausente/.test(sh), 'P1: MAIN_MIGR_DIR é obrigatório (última migration da main)')
ok(/comm -23 "\$dir\/main\.led" "\$dir\/ref\.led" \| grep -c \. \|\| true/.test(sh)
  && /faltando" -ne 0 \]; then[\s\S]{0,700}erro "referência \(vaga 1\) atrás da main/.test(sh),
  'P1: migration da main ausente no ledger da referência → FALHA explícito (22/10: não pula em silêncio)')
ok(/if \[ "\$ref_max" != "\$main_max" \]; then\s*\n\s*erro "a versão máxima/.test(sh),
  'P1: versão máxima da referência ≠ última migration da main → FALHA explícito')
ok(/pular\(\)\s*\{[\s\S]{0,160}exit 0; \}/.test(sh), 'P1/P2: "pular" é exit 0 (segue o comportamento atual), nunca remove nada')
ok(/comm -23 "\$dir\/orphan\.pre" "\$dir\/main\.led"/.test(sh) && /version not in \(select version from _mainled\)/.test(sh),
  'P1: NUNCA remove da vaga uma versão/objeto que pertença a uma migration presente na main (órfão e DELETE excluem a main)')

// ── P2: LEITURA CONSISTENTE — lê o ledger da referência antes e depois do catálogo; mudou → pula ──────────────────
ok(/ref\.led\.antes[\s\S]*ref\.sig[\s\S]*ref\.led\.depois/.test(sh),
  'P2: ledger da referência lido ANTES e DEPOIS de coletar o catálogo')
ok(/if ! cmp -s "\$dir\/ref\.led\.antes" "\$dir\/ref\.led\.depois"; then\s*\n\s*pular "o ledger da referência mudou/.test(sh),
  'P2: ledger da referência mudou durante a leitura (aceitação da main rodou no meio) → descarta e PULA')

// ── P3: EXTENSÕES — objetos de extensão (pg_depend deptype=e) fora da comparação e de qualquer DROP ───────────────
{
  const extCount = (sh.match(/not exists \(select 1 from pg_depend d where d\.objid=[^\n]*and d\.deptype='e'\)/g) || []).length
  ok(extCount >= 10, `P3: a assinatura exclui objetos de extensão (deptype='e') em todas as classes (${extCount} filtros)`)
}
ok(/not exists \(select 1 from pg_depend d join pg_class c2 on c2\.oid=d\.objid[\s\S]{0,160}c2\.relname=ic\.table_name and d\.deptype='e'\)/.test(sh),
  'P3: colunas de tabela de extensão também são excluídas')
// como objetos de extensão nunca entram na assinatura, nunca aparecem em vaga_only/ref_only/diff → nunca são derrubados
ok(/EXCLUINDO objetos de extensão/.test(sh), 'P3: documentado — objeto de extensão nunca entra na comparação nem vira DROP')

// ── P4: SEM CASCADE — nenhum DROP ... CASCADE; DROP com dependência → Montar ──────────────────────────────────────
ok(!/echo "[^"]*cascade[^"]*" >> "\$txn"/i.test(sh), 'P4: nenhum comando SQL emitido na transação (echo … >> $txn) usa CASCADE')
ok(/em ORDEM DE DEPEND[ÊE]NCIA/.test(sh)
  && /for classe in policy trigger constraint index col view table sequence type func; do emitir/.test(sh),
  'P4: DROPs emitidos SEM cascade, em ordem de dependência (dependentes primeiro)')
ok(/if ! "\$PSQL" "\$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "\$txn"; then\s*\n\s*montar /.test(sh),
  'P4: DROP que falha por dependência (sem cascade) aborta a transação → montar (caso d), não remenda')

if (falhas) { console.error(`\n${falhas} verificação(ões) falharam — reconciliação com a referência (ETAPA B)`); process.exit(1) }
console.log('\ncheck-aceitacao-referencia: ok')
