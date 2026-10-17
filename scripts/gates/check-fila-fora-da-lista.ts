// Gate (CEO 16/10) — "FORA DA LISTA DE REVISÃO — pode mergear … (patch-id <hex>)" do gilberto-revisor libera a PR sensível,
// com as MESMAS travas do MERGE AUTORIZADO: primeira linha, sem marca da fila, patch-id casando com o atual e ser o
// comentário MAIS RECENTE do revisor (AJUSTES ANTES DO MERGE / AGUARDANDO ENG. CHEFE depois dele cancela).
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sh = readFileSync('scripts/merge/fila-merge.sh', 'utf8')
const ini = sh.indexOf('autorizacao() {')
const bloco = sh.slice(ini, sh.indexOf('echo ok', ini))
ok(/FORA DA LISTA DE REVISÃO — pode mergear/.test(bloco) && /AJUSTES ANTES DO MERGE/.test(bloco), 'autorizacao(): reconhece FORA DA LISTA e considera AJUSTES como veredito mais recente')
ok(/\[ -n "\$fora" \] && corpo=\$fora/.test(bloco), 'autorizacao(): FORA DA LISTA entra como corpo e passa pela mesma conferência de patch-id')

if (spawnSync('sh', ['-c', 'command -v jq']).status === 0) {
  // extrai o filtro jq do próprio script, para o gate testar o código real
  const m = bloco.match(/fora=\$\(comentarios "\$n" \| jq -rs --arg n "\$n" \\\n\s+'([\s\S]*?)'\)/)
  ok(!!m, 'filtro jq do FORA DA LISTA encontrado no script')
  const filtro = m ? m[1] : '.'
  const roda = (corpos: string[]) =>
    spawnSync('jq', ['-rs', '--arg', 'n', '7', filtro], { input: corpos.map((c) => JSON.stringify(c)).join('\n') }).stdout.toString().trim()
  const pid = 'b'.repeat(40)
  const fora = `FORA DA LISTA DE REVISÃO — pode mergear (patch-id ${pid})`
  const aut = `MERGE AUTORIZADO #7 — gilberto-revisor · patch-id ${pid}`
  ok(roda([fora]) === fora, 'FORA DA LISTA com patch-id vale')
  ok(roda([`FORA DA LISTA DE REVISÃO — pode mergear — só doc (patch-id ${pid.slice(0, 12)})`]).includes('patch-id'), 'prefixo de 8+ hex vale (casa por prefixo único depois)')
  ok(roda([fora, 'AJUSTES ANTES DO MERGE (patch-id ' + pid + '):\n1. x']) === '', 'AJUSTES depois do FORA DA LISTA cancela')
  ok(roda(['AJUSTES ANTES DO MERGE (patch-id ' + pid + '):\n1. x']) === '', 'AJUSTES sozinho nunca libera')
  ok(roda([fora, `AGUARDANDO ENG. CHEFE (patch-id ${pid}): x`]) === '', 'AGUARDANDO ENG. CHEFE depois cancela')
  ok(roda([aut, fora]) === fora, 'FORA DA LISTA mais recente que MERGE AUTORIZADO vale')
  ok(roda([`Fila de merge: ${fora}`]) === '', 'texto iniciado por "Fila de merge:" não vale')
  ok(roda([`${fora}\n<!-- fila:x -->`]) === '', 'comentário com marca escondida não vale')
  ok(roda([`oi\n${fora}`]) === '', 'FORA DA LISTA fora da primeira linha não vale')
  ok(roda([`FORA DA LISTA DE REVISÃO — pode mergear`]) === '', 'sem patch-id não vale')
}
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
