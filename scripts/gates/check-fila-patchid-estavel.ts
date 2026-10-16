// Gate (CEO 16/10) — PATCH-ID ESTÁVEL À RENUMERAÇÃO. A fila renumera o arquivo da migration e isso mudava o patch-id,
// invalidando o MERGE AUTORIZADO do revisor (ciclo que parou ~25 PRs sensíveis). Casos: (a) migration renumerada mantém o
// id; (b) mudança real de conteúdo muda; (c) prefixo único casa, ambíguo não; (d) PR sem patch-id é calculada/recusada
// com motivo, nunca pulada em silêncio.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const FILTRO = resolve('scripts/merge/patch-id-estavel.sh')
const fila = readFileSync('scripts/merge/fila-merge.sh', 'utf8')
const pidsh = readFileSync('scripts/merge/patch-id.sh', 'utf8')

ok(/patch-id-estavel\.sh/.test(fila) && /patch_id_confere "\$pid_aut" "\$pid" "\$pid_raw"/.test(fila), 'fila: autorização confere pelo patch-id estável (e aceita o bruto antigo)')
ok(/patch-id-estavel\.sh/.test(pidsh), 'patch-id.sh (usado pelo revisor) emite o id estável')
ok(/--unshallow/.test(pidsh) && /patch-id vazio/.test(pidsh), '(d) patch-id.sh aprofunda clone raso e nunca devolve id vazio em silêncio')
ok(/não consegui calcular o patch-id/.test(fila), '(d) a fila recusa com motivo quando não consegue calcular (nunca pula em silêncio)')

const tem = (b: string) => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0
if (!tem('git')) console.log('… cenários git pulados')
else {
  const raiz = mkdtempSync(join(tmpdir(), 'pid-gate-'))
  try {
    const git = (...a: string[]) => execFileSync('git', a, { cwd: raiz, encoding: 'utf8' }).trim()
    execFileSync('git', ['init', '-q', '-b', 'main', raiz]); git('config', 'user.email', 'g@g'); git('config', 'user.name', 'g')
    mkdirSync(join(raiz, 'supabase/migrations'), { recursive: true }); writeFileSync(join(raiz, 'a'), 'a\n'); writeFileSync(join(raiz, 'supabase/migrations/.gitkeep'), ''); git('add', '.'); git('commit', '-qm', 'base')
    const pid = (ref: string) => execFileSync('bash', ['-c', `git diff "$(git merge-base main ${ref})" ${ref} | ${FILTRO}`], { cwd: raiz, encoding: 'utf8' }).trim()
    const ramo = (nome: string, arq: string, sql: string, outro = '') => {
      git('checkout', '-q', '-b', nome, 'main'); writeFileSync(join(raiz, 'supabase/migrations', arq), sql)
      if (outro) writeFileSync(join(raiz, 'src.ts'), outro)
      git('add', '.'); git('commit', '-qm', nome); git('checkout', '-q', 'main')
    }
    ramo('orig', '20261015000005_x.sql', 'create table t_x (id int);\n', 'export const a = 1\n')
    ramo('renum', '20261016193005_x.sql', 'create table t_x (id int);\n', 'export const a = 1\n')          // só renumerada
    ramo('mudou', '20261016193005_x.sql', 'create table t_x (id int, y int);\n', 'export const a = 1\n')    // conteúdo da migration mudou
    ramo('mudou2', '20261016193005_x.sql', 'create table t_x (id int);\n', 'export const a = 2\n')           // outro arquivo mudou
    ramo('outronome', '20261016193005_y.sql', 'create table t_x (id int);\n', 'export const a = 1\n')        // nome além do prefixo mudou
    const [o, r, m, m2, on] = ['orig', 'renum', 'mudou', 'mudou2', 'outronome'].map(pid)
    ok(o.length === 40 && o === r, '(a) migration só RENUMERADA mantém o patch-id (autorização continua valendo)')
    ok(o !== m, '(b) mudança de conteúdo da migration muda o patch-id (exige nova revisão)')
    ok(o !== m2, '(b) mudança em outro arquivo muda o patch-id (exige nova revisão)')
    ok(o !== on, '(b) mudança de nome além do prefixo de versão muda o patch-id')
    // (c) prefixo: roda patch_id_confere extraída do fila-merge.sh
    const fn = fila.slice(fila.indexOf('patch_id_confere() {'), fila.indexOf('# (c) autorização pelo conteúdo.'))
    const confere = (aut: string, est: string, raw: string) => spawnSync('bash', ['-c', `${fn}\npatch_id_confere "${aut}" "${est}" "${raw}"`]).status === 0
    const E = 'abcdef0123456789abcdef0123456789abcdef01'; const R = 'abcdef0999999999999999999999999999999999'; const Z = 'ffffff0123456789abcdef0123456789abcdef01'
    ok(confere(E, E, R), '(c) id completo casa')
    ok(confere('abcdef01', E, Z), '(c) prefixo único (8 hex) casa')
    ok(confere(R, Z, R), '(c) id bruto antigo ainda casa')
    ok(!confere('abcdef0', E, Z), '(c) prefixo curto demais (<8) não casa')
    const E2 = 'abcdef0188888888888888888888888888888888'
    ok(!confere('abcdef01', E, E2), '(c) prefixo AMBÍGUO (casa com dois ids distintos) não casa')
    ok(!confere('12345678', E, R), '(c) prefixo que não é de nenhum id não casa')
  } finally { rmSync(raiz, { recursive: true, force: true }) }
}
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nFila — patch-id estável: ok')
