// Gate (CEO 16/10 16:45) — patch-id ESTÁVEL à renumeração de migration. A fila renumerava o arquivo da migration e
// isso mudava o patch-id, invalidando a autorização do revisor (ciclo: ~25 PRs presas em "conteúdo mudou").
// (a) mesma mudança com migration renumerada mantém a autorização; (b) mudança real de conteúdo exige nova revisão;
// (c) prefixo único casa, prefixo curto/ambíguo não; (d) PR sem patch-id é dita pela fila, nunca pulada em silêncio.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const lib = join(process.cwd(), 'scripts/merge/patch-id-lib.sh')
const sh = readFileSync('scripts/merge/fila-merge.sh', 'utf8')
ok(/source "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/patch-id-lib\.sh"/.test(sh) && /patch_id_estavel "\$base"/.test(sh) && /autorizacao_casa "\$pid_aut"/.test(sh),
  'fila usa a lib do patch-id estável e o casamento por prefixo')
ok(/patch-id \[0-9a-f\]\{8,40\}/.test(sh), 'fila aceita autorização com prefixo (8 a 40 hex)')
ok(/não consegui calcular o patch-id/.test(sh) && /\[ -n "\$pid" \] \|\| \{ echo "vermelho:/.test(sh), '(d) PR sem patch-id: a fila diz o motivo (vermelho), não pula em silêncio')
ok(/patch_id_estavel/.test(readFileSync('scripts/merge/patch-id.sh', 'utf8')), 'patch-id.sh (o do revisor) calcula o mesmo id estável')

// Eng. Chefe 02/11: a renumeração NÃO pode derrubar a autorização do revisor (o patch-id é estável à renumeração, acima).
// renumerar_migrations não tira/recoloca a etiqueta sensível (isso só acordava o revisor à toa e devolvia a PR para a
// espera do revisor — o ciclo que prendia dezenas de PRs) e registra "autorização mantida: só renumeração".
const iRenum = sh.indexOf('renumerar_migrations()')
const renum = sh.slice(iRenum, sh.indexOf('\n}', iRenum))
ok(iRenum >= 0, 'renumerar_migrations existe')
ok(!/issues\/\$n\/labels\/\$SENSIVEL/.test(renum) && !/labels\[\]=\$SENSIVEL/.test(renum),
  'renumeração NÃO tira/recoloca a etiqueta sensível (não acorda o revisor à toa)')
ok(/autoriza[çc][ãa]o mantida/i.test(renum) && !/o patch-id mudou/.test(renum),
  'renumeração registra "autorização mantida: só renumeração" (não diz que o patch-id mudou)')

const raiz = mkdtempSync(join(tmpdir(), 'pid-'))
try {
  const g = (...a: string[]) => execFileSync('git', a, { cwd: raiz, encoding: 'utf8' }).trim()
  const lb = (fn: string, ...a: string[]) => execFileSync('bash', ['-c', `source "${lib}"; ${fn} "$@"`, '_', ...a], { cwd: raiz, encoding: 'utf8' }).trim()
  execFileSync('git', ['init', '-q', '-b', 'main', raiz]); g('config', 'user.email', 'g@g'); g('config', 'user.name', 'gate')
  mkdirSync(join(raiz, 'supabase/migrations'), { recursive: true })
  writeFileSync(join(raiz, 'a'), 'a\n'); g('add', '.'); g('commit', '-qm', 'base')
  const mig = (v: string) => join(raiz, `supabase/migrations/${v}_hub_colado.sql`)
  g('checkout', '-q', '-b', 'pr', 'main'); writeFileSync(mig('20261015000005'), 'create table t(i int);\n'); writeFileSync(join(raiz, 'b.ts'), '1\n')
  g('add', '.'); g('commit', '-qm', 'pr')
  const antes = lb('patch_id_estavel', 'main', 'pr'); const cruAntes = lb('patch_id_cru', 'main', 'pr')
  // renumeração pela fila: só o nome do arquivo muda
  renameSync(mig('20261015000005'), mig('20261016204500')); g('add', '-A'); g('commit', '-qm', 'renumera')
  const depois = lb('patch_id_estavel', 'main', 'pr'); const cruDepois = lb('patch_id_cru', 'main', 'pr')
  ok(/^[0-9a-f]{40}$/.test(antes), 'patch-id estável calculado (40 hex)')
  ok(cruAntes !== cruDepois, 'premissa: o patch-id CRU muda com a renumeração (o defeito)')
  ok(antes === depois, '(a) migration renumerada → mesmo patch-id estável: a autorização continua valendo')
  // mudança real do conteúdo da migration
  writeFileSync(mig('20261016204500'), 'create table t(i int, j int);\n'); g('add', '-A'); g('commit', '-qm', 'muda sql')
  ok(lb('patch_id_estavel', 'main', 'pr') !== depois, '(b) mudou o SQL da migration → patch-id muda: exige nova revisão')
  g('checkout', '-q', '-b', 'pr2', 'main'); mkdirSync(join(raiz, 'supabase/migrations'), { recursive: true }); writeFileSync(join(raiz, 'b.ts'), '1\n'); writeFileSync(mig('20261016204500'), 'create table t(i int);\n')
  g('add', '-A'); g('commit', '-qm', 'pr2')
  const base2 = lb('patch_id_estavel', 'main', 'pr2')
  g('checkout', '-q', '-b', 'pr3', 'main'); mkdirSync(join(raiz, 'supabase/migrations'), { recursive: true }); writeFileSync(join(raiz, 'b.ts'), '2\n'); writeFileSync(mig('20261016204500'), 'create table t(i int);\n')
  g('add', '-A'); g('commit', '-qm', 'pr3')
  ok(lb('patch_id_estavel', 'main', 'pr3') !== base2, '(b) mudou outro arquivo (não-migration) → patch-id muda')
  // (c) prefixo
  const casa = (aut: string, est: string, cru = '') => { try { execFileSync('bash', ['-c', `source "${lib}"; autorizacao_casa "$@"`, '_', aut, est, cru]); return true } catch { return false } }
  ok(casa(antes, antes), '(c) id inteiro casa')
  ok(casa(antes.slice(0, 8), antes), '(c) prefixo único de 8 hex casa (caso #2559)')
  ok(!casa(antes.slice(0, 7), antes), '(c) prefixo curto demais (<8) não casa — ambíguo')
  ok(!casa(`${antes.slice(0, 8)}`, 'f'.repeat(40)) && !casa('0'.repeat(40), antes), '(c) id/prefixo de outro conteúdo não casa')
  ok(casa(cruAntes, antes, cruAntes), 'autorização antiga (id cru) ainda casa com o conteúdo cru igual')
} finally { rmSync(raiz, { recursive: true, force: true }) }
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nOK — check-fila-patchid-estavel')
