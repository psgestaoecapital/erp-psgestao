// Gate RD-95 (CEO 08/10): tela/formulário NOVO ou ALTERADO na PR não pode ter campo sem o "?" (<AjudaCampo> ou
// atributo `ajuda`), em QUALQUER vertical (o check-ajuda-campo.ts cobre só o Hub e o P&M).
//   · arquivo NOVO: todo campo precisa do "?".
//   · arquivo ALTERADO: o número de campos sem "?" não pode AUMENTAR em relação à main (dívida antiga não trava
//     correção pequena; campo novo sem "?" trava).
// Compara com o merge-base de origin/main. Sem origin/main (checkout raso, fora do git) → avisa e passa; o workflow
// gates.yml faz checkout completo. Sem rede, sem banco.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { camposSemAjuda } from './_ajuda-campo-lib'

const git = (...a: string[]) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })

const ESCOPO = /^src\/(app\/dashboard|components)\/.+\.tsx$/
const IGNORAR = /^src\/components\/ajuda\//   // o próprio componente do "?"

let base = ''
try { base = git('merge-base', 'origin/main', 'HEAD').trim() } catch { /* sem origin/main */ }
if (!base) { console.log('check-ajuda-campo-alterados: sem origin/main (checkout raso) — pulado'); process.exit(0) }

const linhas = git('diff', '--name-status', '--diff-filter=AM', `${base}...HEAD`).split('\n').filter(Boolean)
let falhas = 0
let checados = 0
for (const l of linhas) {
  const [st, arq] = l.split('\t')
  if (!arq || !ESCOPO.test(arq) || IGNORAR.test(arq) || !existsSync(arq)) continue
  checados++
  const agora = camposSemAjuda(arq)
  let antes = 0
  if (st === 'M') { try { antes = camposSemAjuda(arq, git('show', `${base}:${arq}`)).length } catch { antes = 0 } }
  if (agora.length > antes) {
    falhas++
    console.error(`✗ ${arq}: ${agora.length} campo(s) sem "?" (na main: ${antes}). RD-95: todo campo leva <AjudaCampo chave="..."> com texto em erp_ajuda_campo.`)
    for (const c of agora.slice(0, 8)) console.error(`    linha ${c.linha}: ${c.texto}`)
  }
}
if (falhas) { console.error(`\ncheck-ajuda-campo-alterados: ${falhas} tela(s) com campo novo sem "?"`); process.exit(1) }
console.log(`Ajuda de campo nas telas tocadas: ok — ${checados} arquivo(s) de tela novos/alterados conferidos`)
