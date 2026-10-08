// Gate (Eng. Chefe 08/10) — a fila só aceita como autorização do revisor o comentário cuja PRIMEIRA linha é exatamente
// "MERGE AUTORIZADO #<n> — gilberto-revisor · patch-id <40 hex>"; o aviso da fila (marca escondida ou "Fila de merge:")
// cita o texto, sai da mesma conta do GitHub e NUNCA conta.
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sh = readFileSync('scripts/merge/fila-merge.sh', 'utf8')
const bloco = sh.slice(sh.indexOf('autorizacao() {'), sh.indexOf('echo ok', sh.indexOf('autorizacao() {')))
ok(/\^MERGE AUTORIZADO #\$n — gilberto-revisor · patch-id \[0-9a-f\]\{40\}/.test(bloco), 'autorizacao(): regex ancorada na primeira linha com patch-id de 40 hex')
ok(/split\("\\n"\)\[0\] \| test\(\$re\)/.test(bloco), 'autorizacao(): testa só a primeira linha do comentário')
ok(/contains\("<!-- fila:"\) \| not/.test(bloco) && /startswith\("Fila de merge:"\) \| not/.test(bloco), 'autorizacao(): ignora comentário com a marca da fila ou "Fila de merge:"')

if (spawnSync('sh', ['-c', 'command -v jq']).status === 0) {
  const n = 7
  const pid = 'a'.repeat(40)
  const re = `^MERGE AUTORIZADO #${n} — gilberto-revisor · patch-id [0-9a-f]{40}[ \\t\\r]*$`
  const filtro = '[.[] | select((contains("<!-- fila:") | not) and (startswith("Fila de merge:") | not) and (split("\\n")[0] | test($re)))] | last // empty | split("\\n")[0]'
  const roda = (corpos: string[]) =>
    spawnSync('jq', ['-rs', '--arg', 're', re, filtro], { input: corpos.map((c) => JSON.stringify(c)).join('\n') }).stdout.toString().trim()
  const boa = `MERGE AUTORIZADO #${n} — gilberto-revisor · patch-id ${pid}\nrevisado`
  ok(roda([boa]) === boa.split('\n')[0], 'jq: autorização do revisor vale')
  ok(roda([`🚫 **Fila de merge:** não publicada — MERGE AUTORIZADO #${n} — gilberto-revisor · patch-id ${pid}`]) === '', 'jq: aviso da fila não vale')
  ok(roda([`Fila de merge: MERGE AUTORIZADO #${n} — gilberto-revisor · patch-id ${pid}`]) === '', 'jq: texto iniciado por "Fila de merge:" não vale')
  ok(roda([`oi\n${boa}`]) === '', 'jq: autorização fora da primeira linha não vale')
  ok(roda([`${boa.split('\n')[0]}\n<!-- fila:x -->`]) === '', 'jq: comentário com marca escondida não vale')
  ok(roda([`MERGE AUTORIZADO #${n}0 — gilberto-revisor · patch-id ${pid}`]) === '', 'jq: outro número de PR não vale')
} else console.log('… cenários jq pulados (jq ausente)')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
