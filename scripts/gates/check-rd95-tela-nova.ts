// Gate RD-95 (CEO 08/10) — tela NOVA ou ALTERADA na PR não pode ter campo sem o "?" (<AjudaCampo> ou <Campo ajuda>).
// Arquivo novo: todo campo precisa do "?". Arquivo alterado: só os campos nas linhas ACRESCENTADAS pela PR (a dívida antiga
// segue no relatório scripts/relatorio-cobertura-ajuda.ts). Sem rede; sem base git (clone raso sem a main) = aviso, não falha.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { camposSemAjuda } from '../../src/lib/dev/ajudaCampoAnalise'

const git = (...a: string[]) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
const escopo = /^src\/(app\/dashboard|components)\/.+\.tsx$/

let base = ''
for (const ref of ['origin/main', 'main']) { try { base = git('merge-base', ref, 'HEAD').trim(); if (base) break } catch { /* tenta o próximo */ } }
if (!base) { console.log('check-rd95-tela-nova: sem base git (clone raso) — pulado'); process.exit(0) }

const linhasNovas = (arq: string): Set<number> | 'todas' => {
  const novo = git('diff', '--name-status', '--diff-filter=A', `${base}...HEAD`, '--', arq).trim() !== ''
  if (novo) return 'todas'
  const s = new Set<number>()
  for (const m of git('diff', '-U0', `${base}...HEAD`, '--', arq).matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const ini = Number(m[1]), n = m[2] === undefined ? 1 : Number(m[2])
    for (let i = 0; i < n; i++) s.add(ini + i)
  }
  return s
}

let falhas = 0
let vistos = 0
for (const f of git('diff', '--name-only', '--diff-filter=AM', `${base}...HEAD`).split('\n').filter((x) => escopo.test(x) && existsSync(x))) {
  vistos++
  const alvo = linhasNovas(f)
  for (const c of camposSemAjuda(f)) {
    if (alvo === 'todas' || alvo.has(c.linha)) { falhas++; console.error(`✗ ${f}:${c.linha} campo sem "?" (RD-95): ${c.texto}`) }
  }
}
if (falhas) { console.error(`\ncheck-rd95-tela-nova: ${falhas} campo(s) sem ajuda — use <AjudaCampo chave="…"> (ver AGENTS.md › Regras de tela RD-95 e RD-96)`); process.exit(1) }
console.log(`RD-95 tela nova/alterada: ok — ${vistos} arquivo(s) de tela na PR, nenhum campo novo sem "?"`)
