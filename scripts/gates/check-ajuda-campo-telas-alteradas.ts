// Gate (CEO 08/10, RD-95): formulário/tela NOVO ou ALTERADO na PR não pode ter campo (input, select, textarea) sem o "?"
// (<AjudaCampo chave="..."> ou atributo `ajuda`). Vale para todo o app (src/app/dashboard e src/components); o Hub segue
// também no check-ajuda-campo.ts (que guarda a lista PENDENTES, e esses arquivos ficam fora daqui para não duplicar).
// Compara com o merge-base da origin/main. Sem git/base disponível (checkout raso) → aviso, nunca falha por falta de base.
// Sem rede.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { camposSemAjuda, RAIZES_TELA } from './_ajuda-lib'

let falhas = 0
const git = (...a: string[]) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

function alterados(): string[] | null {
  try {
    for (const ref of ['origin/main', 'main']) {
      try {
        const base = git('merge-base', 'HEAD', ref)
        if (!base) continue
        return git('diff', '--name-only', '--diff-filter=AM', `${base}...HEAD`).split('\n').filter(Boolean)
      } catch { /* tenta a próxima ref */ }
    }
  } catch { /* sem git */ }
  return null
}

// arquivos do Hub ainda pendentes (lista do gate antigo, que só pode diminuir)
const antigo = existsSync('scripts/gates/check-ajuda-campo.ts') ? readFileSync('scripts/gates/check-ajuda-campo.ts', 'utf8') : ''
const bloco = antigo.match(/const PENDENTES = \[([\s\S]*?)\n\]/)?.[1] ?? ''
const pendentesHub = new Set([...bloco.matchAll(/'([^']+\.tsx)'/g)].map((m) => m[1]))

const lista = alterados()
if (!lista) {
  console.log('· aviso: sem merge-base com a main (checkout raso?) — gate das telas alteradas não rodou nesta execução')
} else {
  const telas = lista.filter((f) => f.endsWith('.tsx') && RAIZES_TELA.some((r) => f.startsWith(r + '/')) && existsSync(f) && !pendentesHub.has(f))
  console.log(`· ${telas.length} tela(s)/componente(s) .tsx novo(s) ou alterado(s) na PR`)
  for (const f of telas) {
    const faltando = camposSemAjuda(f)
    for (const c of faltando) { falhas++; console.error(`✗ ${f}:${c.linha} campo sem "?" (RD-95): ${c.texto}`) }
    if (!faltando.length) console.log(`✓ ${f}`)
  }
}
if (falhas) { console.error(`\n${falhas} campo(s) sem "?". Use <AjudaCampo chave="..." /> (src/components/ajuda/AjudaCampo.tsx) e cadastre a chave em erp_ajuda_campo (migration).`); process.exit(1) }
console.log('✓ RD-95: nenhum campo sem "?" nas telas alteradas')
