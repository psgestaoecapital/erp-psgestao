// Gate (CEO 08/10, RD-95): tela NOVA ou ALTERADA na PR não pode ter campo sem "?" (ajuda de campo). Regra:
//  • arquivo .tsx novo em src/app ou src/components → zero campo sem ajuda;
//  • arquivo alterado → o número de campos sem ajuda não pode AUMENTAR em relação à main (a dívida antiga não trava a PR,
//    mas campo novo já nasce com o "?"; quem mexe numa tela e põe o "?" nos campos antigos só melhora).
// Base de comparação: o pai da main no commit de merge do Actions (HEAD^1) ou o merge-base com origin/main. Sem base
// (clone raso, sem git) → avisa e passa: o gate nunca falha por falta de histórico. Sem rede.
// Também confere o próprio mecanismo (função de teste com fixtures) e a seção de regras no AGENTS.md.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { camposSemAjuda } from '../lib/camposSemAjuda'

let falhas = 0
const erro = (msg: string) => { falhas++; console.error('✗', msg) }
const ok = (cond: boolean, msg: string) => { if (!cond) erro(msg); else console.log('✓', msg) }
const git = (...a: string[]) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })

// ── 1. o detector funciona (fixtures) ──
const sem = `export function T(){ return <div><label>Nome <input type="text" /></label></div> }`
const com = `import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
export function T(){ return <div><label>Nome <AjudaCampo chave="x.y.z" /><input type="text" /></label></div> }`
ok(camposSemAjuda('t.tsx', sem).length === 1, 'detector: campo sem "?" é apontado')
ok(camposSemAjuda('t.tsx', com).length === 0, 'detector: campo com <AjudaCampo> passa')

// ── 2. AGENTS.md traz a seção de regras de tela ──
const agents = readFileSync('AGENTS.md', 'utf8')
ok(/Regras de tela RD-95 e RD-96/.test(agents) && /RD-95/.test(agents) && /RD-96/.test(agents), 'AGENTS.md: seção "Regras de tela RD-95 e RD-96"')
ok(existsSync('docs/design-system/ajuda-campo.md'), 'design system: docs/design-system/ajuda-campo.md')

// ── 3. arquivos da PR ──
let base = ''
try {
  try { git('rev-parse', '--verify', '-q', 'HEAD^2'); base = git('rev-parse', 'HEAD^1').trim() }   // commit de merge do Actions
  catch { base = git('merge-base', 'origin/main', 'HEAD').trim() }
} catch { /* sem base */ }
if (!base) {
  console.log('· sem base git (clone raso ou fora de PR): conferência dos arquivos da PR dispensada')
} else {
  const lista = git('diff', '--name-status', '--no-renames', base, 'HEAD').split('\n').filter(Boolean)
  let conferidos = 0
  for (const linha of lista) {
    const [st, arq] = linha.split('\t')
    if (st === 'D' || !/^src\/(app|components)\/.*\.tsx$/.test(arq) || /\.(test|spec)\.tsx$/.test(arq)) continue
    const agora = camposSemAjuda(arq, readFileSync(arq, 'utf8'))
    let antes = 0
    if (st !== 'A') { try { antes = camposSemAjuda(arq, git('show', `${base}:${arq}`)).length } catch { antes = 0 } }
    conferidos++
    if (agora.length > antes) {
      erro(`${arq}: ${agora.length} campo(s) sem "?" (antes: ${antes}) — todo campo novo leva <AjudaCampo chave="…"> (RD-95)`)
      for (const c of agora.slice(0, 5)) console.error(`    linha ${c.linha}: ${c.texto}`)
    }
  }
  console.log(`· ${conferidos} tela(s)/componente(s) novos ou alterados conferidos contra ${base.slice(0, 8)}`)
}

if (falhas) { console.error(`\ncheck-ajuda-campo-pr: ${falhas} falha(s)`); process.exit(1) }
console.log('\nAjuda de campo na PR (RD-95): ok')
