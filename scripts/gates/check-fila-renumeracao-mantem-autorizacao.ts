// Gate (Eng. Chefe 02/11) — RENUMERAÇÃO de migration NÃO derruba a autorização do revisor.
// Defeito corrigido: ao renumerar uma migration (só o NOME/versão do arquivo muda), a fila (renumerar_migrations)
// postava "o patch-id mudou — precisa autorizar de novo" e TIRAVA/RECOLOCAVA a etiqueta `revisao-eng-chefe`, um ciclo
// que fazia a PR voltar a esperar o revisor a cada vez que a main avançava (fila crítica travada; code-3 com 17 tarefas
// paradas). Como o patch-id do CONTEÚDO é ESTÁVEL à renumeração (scripts/merge/patch-id-lib.sh), a autorização
// CONTINUA VALENDO: a fila mantém a etiqueta e não pede nova revisão por renumeração.
//
// Parte 1 (estrutura): renumerar_migrations não tira/recoloca a etiqueta nem diz "precisa autorizar de novo"; registra
// "autorização mantida: só renumeração". Parte 2 (prova no dado, se houver git+bash): com a autorização que o revisor
// deu (patch-id estável do conteúdo), autorizacao_casa CONTINUA casando após a renumeração; muda o SQL de verdade → NÃO casa.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

// ── Parte 1: estrutura de renumerar_migrations ───────────────────────────────────────────────────────────────────────
const sh = readFileSync('scripts/merge/fila-merge.sh', 'utf8')
const i0 = sh.indexOf('renumerar_migrations() {')
ok(i0 >= 0, 'renumerar_migrations existe')
// corpo da função: da definição até o próximo `^}` (fecha a função)
const resto = sh.slice(i0)
const corpo = resto.slice(0, (resto.slice(1).search(/\n\}/) + 2) || resto.length)
ok(!/labels\/\$SENSIVEL/.test(corpo),
  'renumerar_migrations NÃO tira a etiqueta $SENSIVEL (sem DELETE em issues/$n/labels/$SENSIVEL)')
ok(!/labels\[\]=\$SENSIVEL/.test(corpo),
  'renumerar_migrations NÃO recoloca a etiqueta $SENSIVEL (sem POST de labels)')
ok(!/precisa autorizar de novo/.test(corpo),
  'renumerar_migrations NÃO diz "precisa autorizar de novo"')
ok(/patch-id do (CONTEÚDO|conteúdo) (é|e) (ESTÁVEL|estável|est)/i.test(corpo) || /est[aá]vel à renumera/i.test(corpo),
  'renumerar_migrations explica que o patch-id do conteúdo é estável à renumeração')
ok(/autoriza[çc][aã]o .*mantida|mantida: s[óo] renumera/i.test(corpo),
  'renumerar_migrations registra "autorização mantida: só renumeração"')
ok(/CONTINUA VALENDO|continua valendo/.test(corpo),
  'renumerar_migrations deixa claro que a autorização continua valendo')

// ── Parte 2: prova no dado — a autorização do revisor casa após renumeração, não casa após mudança real ─────────────
const temGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); execFileSync('bash', ['--version'], { stdio: 'ignore' }); return true } catch { return false } })()
if (!temGit) {
  console.log('… prova no dado pulada: git/bash ausentes (a parte 1 continua valendo)')
} else {
  const lib = join(process.cwd(), 'scripts/merge/patch-id-lib.sh')
  const raiz = mkdtempSync(join(tmpdir(), 'renum-'))
  try {
    const g = (...a: string[]) => execFileSync('git', a, { cwd: raiz, encoding: 'utf8' }).trim()
    const lb = (fn: string, ...a: string[]) => execFileSync('bash', ['-c', `source "${lib}"; ${fn} "$@"`, '_', ...a], { cwd: raiz, encoding: 'utf8' }).trim()
    const casa = (aut: string, est: string, cru = '') => { try { execFileSync('bash', ['-c', `source "${lib}"; autorizacao_casa "$@"`, '_', aut, est, cru]); return true } catch { return false } }
    execFileSync('git', ['init', '-q', '-b', 'main', raiz]); g('config', 'user.email', 'g@g'); g('config', 'user.name', 'gate')
    mkdirSync(join(raiz, 'supabase/migrations'), { recursive: true })
    writeFileSync(join(raiz, 'a'), 'a\n'); g('add', '.'); g('commit', '-qm', 'base')
    const mig = (v: string) => join(raiz, `supabase/migrations/${v}_pm_proposta_excluir_rastro.sql`)
    g('checkout', '-q', '-b', 'pr', 'main')
    writeFileSync(mig('20261101220545'), 'alter table public.p add column deleted_by uuid;\n'); writeFileSync(join(raiz, 'src.ts'), 'x\n')
    g('add', '.'); g('commit', '-qm', 'pr')
    // o revisor autorizou AGORA: o patch-id que ele cola é o estável do conteúdo atual
    const autRevisor = lb('patch_id_estavel', 'main', 'pr')
    ok(/^[0-9a-f]{40}$/.test(autRevisor), 'revisor autoriza com o patch-id estável (40 hex)')
    // a fila renumera: só o nome do arquivo muda (versão acima da main). Repetido 3x, como no ciclo da #3672.
    for (const v of ['20261102011045', '20261102160845', '20261103170845']) {
      renameSync(join(raiz, 'supabase/migrations'), join(raiz, '_m')); mkdirSync(join(raiz, 'supabase/migrations'))
      // move o único .sql de volta com o novo nome (renumeração = só o nome muda)
      const prev = execFileSync('bash', ['-c', `ls "${raiz}/_m"`], { encoding: 'utf8' }).trim().split('\n').find(x => x.endsWith('.sql'))!
      renameSync(join(raiz, '_m', prev), mig(v)); rmSync(join(raiz, '_m'), { recursive: true, force: true })
      g('add', '-A'); g('commit', '-qm', `renumera ${v}`)
      const est = lb('patch_id_estavel', 'main', 'pr'); const cru = lb('patch_id_cru', 'main', 'pr')
      ok(casa(autRevisor, est, cru), `após renumerar para ${v}: a autorização do revisor CONTINUA casando (autorização mantida)`)
    }
    // mudança REAL do conteúdo do SQL → a autorização não casa mais (exige nova revisão)
    writeFileSync(mig('20261103170845'), 'alter table public.p add column deleted_by uuid, add column deleted_at timestamptz;\n')
    g('add', '-A'); g('commit', '-qm', 'muda sql de verdade')
    const estReal = lb('patch_id_estavel', 'main', 'pr'); const cruReal = lb('patch_id_cru', 'main', 'pr')
    ok(!casa(autRevisor, estReal, cruReal), 'mudança REAL do SQL → a autorização NÃO casa mais: exige nova revisão')
  } finally { rmSync(raiz, { recursive: true, force: true }) }
}

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nOK — check-fila-renumeracao-mantem-autorizacao')
