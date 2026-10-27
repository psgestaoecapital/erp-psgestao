// Gate (24/10, gilberto-desenv, msg ba5e5e8a): INSERT … (colunas) VALUES (…) com o MESMO número de valores e de colunas.
// A 20261023135000 (ajuda do "Novo serviço") foi "corrigida" tirando a coluna `ordem` da lista e deixando o valor: 10 valores
// para 9 colunas. A produção já tinha aplicado a versão boa, mas o `db push` do banco de testes (vaga 1) parava ali e a
// aceitação da main abortava em segundos (#807). Confere toda tupla de todo INSERT … VALUES nas migrations (a partir de
// 20261001) contra a lista de colunas. Sem rede, banco ou variável.
import { readdirSync, readFileSync } from 'node:fs'

const DIR = 'supabase/migrations'
const DESDE = '20261001'

// Pula espaço e comentário (-- e /* */) a partir de i.
function pular(s: string, i: number): number {
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i++
    if (s.startsWith('--', i)) { const j = s.indexOf('\n', i); i = j < 0 ? s.length : j; continue }
    if (s.startsWith('/*', i)) { const j = s.indexOf('*/', i); i = j < 0 ? s.length : j + 2; continue }
    return i
  }
}

// Lê a tupla que começa em s[i] === '(' e devolve [nº de elementos de 1º nível, índice depois do ')'].
function tupla(s: string, i: number): [number, number] | null {
  let prof = 0, n = 1
  for (; i < s.length; i++) {
    const c = s[i]
    if (c === "'") { i++; while (i < s.length && !(s[i] === "'" && s[i + 1] !== "'")) i += s[i] === "'" ? 2 : 1; continue }
    if (c === '"') { const j = s.indexOf('"', i + 1); if (j < 0) return null; i = j; continue }
    if (c === '$') { const m = /^\$[A-Za-z_]*\$/.exec(s.slice(i)); if (m) { const j = s.indexOf(m[0], i + m[0].length); if (j < 0) return null; i = j + m[0].length - 1; continue } }
    if (s.startsWith('--', i)) { const j = s.indexOf('\n', i); i = j < 0 ? s.length : j; continue }
    if (c === '[') { prof++; continue }
    if (c === ']') { prof--; continue }
    if (c === '(') prof++
    else if (c === ')') { prof--; if (prof === 0) return [n, i + 1] }
    else if (c === ',' && prof === 1) n++
  }
  return null
}

const erros: string[] = []
let conferidos = 0
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.sql') && x >= DESDE).sort()) {
  const s = readFileSync(`${DIR}/${f}`, 'utf8')
  const re = /INSERT\s+INTO\s+[\w."]+\s*\(([^()]*)\)\s*VALUES\s*/gi
  for (let m; (m = re.exec(s)); ) {
    const ncol = m[1].split(',').length
    let i = pular(s, re.lastIndex), k = 0
    while (s[i] === '(') {
      const t = tupla(s, i)
      if (!t) break
      k++
      conferidos++
      if (t[0] !== ncol) erros.push(`${f}: INSERT com ${ncol} colunas tem tupla nº ${k} com ${t[0]} valores`)
      i = pular(s, t[1])
      if (s[i] !== ',') break
      i = pular(s, i + 1)
    }
  }
}

const fixo = readFileSync(`${DIR}/20261023135000_ajuda_catalogo_novo_servico.sql`, 'utf8')
if (!/erro_comum, ordem\)\s*VALUES/.test(fixo)) erros.push('20261023135000: a lista de colunas precisa ter `ordem` (os valores trazem a ordem 1..4)')

if (erros.length) { for (const e of erros) console.error('✗ ' + e); console.error(`\n${erros.length} falha(s)`); process.exit(1) }
console.log(`✓ ${conferidos} tuplas de INSERT … VALUES conferidas: valores = colunas em todas`)
