// Lê o JSON do reporter do Playwright e publica TODAS as falhas numa única anotação do check-run:
//   título PW-FALHAS-COMPLETAS · mensagem "total=N" + uma linha por teste que falhou (arquivo do spec, ou "?" se ilegível).
// A fila (fila-merge.sh › pos_anot_falhas) lê isto no lugar do log do job. Sem JSON legível → anota total=? (fila bloqueia).
const { readFileSync } = require('node:fs')

function coletar(json) {
  const linhas = []
  const visita = (suite, arq) => {
    const f = suite.file || arq
    for (const sp of suite.specs || []) {
      for (const t of sp.tests || []) {
        if (t.status !== 'unexpected') continue
        const rel = sp.file || f || ''
        linhas.push(rel ? (rel.startsWith('e2e/') ? rel : `e2e/jornadas/${rel}`) : '?')
      }
    }
    for (const s of suite.suites || []) visita(s, f)
  }
  for (const s of json.suites || []) visita(s, s.file)
  // erro fora de teste (global-setup, falha de carga do spec): sem arquivo de spec → a fila fecha por fail-closed
  for (const _ of json.errors || []) linhas.push('?')
  return linhas
}

function formatar(linhas) {
  return [`total=${linhas.length}`, ...linhas].join('\n')
}

function escapar(m) { return m.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A') }

if (require.main === module) {
  let msg
  try { msg = formatar(coletar(JSON.parse(readFileSync(process.argv[2], 'utf8')))) } catch { msg = 'total=?' }
  console.log(`::error title=PW-FALHAS-COMPLETAS::${escapar(msg)}`)
}
module.exports = { coletar, formatar }
