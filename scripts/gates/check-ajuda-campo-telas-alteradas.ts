// Gate (CEO 08/10, RD-95): formulário/tela NOVO ou ALTERADO na PR não pode ter campo (input, select, textarea) sem o "?"
// (<AjudaCampo chave="..."> ou atributo `ajuda`). Vale para todo o app (src/app/dashboard e src/components); o Hub segue
// também no check-ajuda-campo.ts (que guarda a lista PENDENTES, e esses arquivos ficam fora daqui para não duplicar).
// Compara com o merge-base da origin/main. Sem git/base disponível (checkout raso) → aviso, nunca falha por falta de base.
// Sem rede.
//
// CEO 09/10 (opção A): a régua cobra só o campo NOVO/ALTERADO no diff da PR — a DÍVIDA ANTIGA da tela (campos que já
// estavam sem "?") NÃO reprova um hotfix que mexe noutra parte do arquivo. Arquivo novo inteiro conta como adicionado.
// A dívida antiga fica para a varredura do "?" (relatório de cobertura) e o PDCA cobra. Assim RD-95 segue firme para
// campo novo, sem travar correção urgente em tela com débito pré-existente.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { camposSemAjuda, RAIZES_TELA } from './_ajuda-lib'

let falhas = 0
const git = (...a: string[]) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

// merge-base + arquivos AM da PR (ou null sem git/base)
function diffBase(): { base: string; arquivos: string[] } | null {
  try {
    for (const ref of ['origin/main', 'main']) {
      try {
        const base = git('merge-base', 'HEAD', ref)
        if (!base) continue
        return { base, arquivos: git('diff', '--name-only', '--diff-filter=AM', `${base}...HEAD`).split('\n').filter(Boolean) }
      } catch { /* tenta a próxima ref */ }
    }
  } catch { /* sem git */ }
  return null
}

// Linhas ADICIONADAS/ALTERADAS do arquivo neste diff da PR (lado "+"). Arquivo novo → todas as linhas entram.
// É nelas que a régua cobra o "?"; campo pré-existente intocado (fora deste conjunto) não reprova.
function linhasNovas(base: string, f: string): Set<number> {
  const set = new Set<number>()
  let diff = ''
  try { diff = git('diff', '--unified=0', `${base}...HEAD`, '--', f) } catch { return set }
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const ini = Number(m[1])
    const n = m[2] === undefined ? 1 : Number(m[2])
    for (let i = 0; i < n; i++) set.add(ini + i)
  }
  return set
}

// arquivos do Hub ainda pendentes (lista do gate antigo, que só pode diminuir)
const antigo = existsSync('scripts/gates/check-ajuda-campo.ts') ? readFileSync('scripts/gates/check-ajuda-campo.ts', 'utf8') : ''
const bloco = antigo.match(/const PENDENTES = \[([\s\S]*?)\n\]/)?.[1] ?? ''
const pendentesHub = new Set([...bloco.matchAll(/'([^']+\.tsx)'/g)].map((m) => m[1]))

const info = diffBase()
if (!info) {
  console.log('· aviso: sem merge-base com a main (checkout raso?) — gate das telas alteradas não rodou nesta execução')
} else {
  const telas = info.arquivos.filter((f) => f.endsWith('.tsx') && RAIZES_TELA.some((r) => f.startsWith(r + '/')) && existsSync(f) && !pendentesHub.has(f))
  console.log(`· ${telas.length} tela(s)/componente(s) .tsx novo(s) ou alterado(s) na PR`)
  for (const f of telas) {
    const novas = linhasNovas(info.base, f)
    // só os campos em linhas tocadas por ESTA PR (dívida antiga da tela não entra — vai para a varredura do "?")
    const faltando = camposSemAjuda(f).filter((c) => novas.has(c.linha))
    for (const c of faltando) { falhas++; console.error(`✗ ${f}:${c.linha} campo NOVO/alterado sem "?" (RD-95): ${c.texto}`) }
    if (!faltando.length) console.log(`✓ ${f}`)
  }
}
if (falhas) { console.error(`\n${falhas} campo(s) novo(s)/alterado(s) sem "?". Use <AjudaCampo chave="..." /> (src/components/ajuda/AjudaCampo.tsx) e cadastre a chave em erp_ajuda_campo (migration).`); process.exit(1) }
console.log('✓ RD-95: nenhum campo novo/alterado sem "?" nas telas alteradas')
