// PROVA DE GERAÇÃO SICREDI (RD-38): reconstrói o .rem real anonimizado a partir de dados SEMÂNTICOS e
// confere linha a linha (o fixture veio em LF; o gerador emite CRLF — comparamos o conteúdo das 240 posições).
import { readFileSync } from 'node:fs'
import { buildArquivoSicredi, reconstruirInputSicredi } from '../src/lib/banco/cnab240/sicredi'

const fp = 'docs/cnab/cnab_pgto_748_sicredi_anon.rem'
const real = readFileSync(fp, 'latin1')
const gerado = buildArquivoSicredi(reconstruirInputSicredi(real))

const linhasReal = real.split(/\r\n|\n/).filter((l) => l.length > 0)
const linhasGer = gerado.split(/\r\n|\n/).filter((l) => l.length > 0)

let diffs = 0
const nMax = Math.max(linhasReal.length, linhasGer.length)
for (let i = 0; i < nMax; i++) {
  const r = linhasReal[i] ?? ''
  const g = linhasGer[i] ?? ''
  if (r !== g) {
    diffs++
    if (diffs <= 8) {
      let p = 0
      while (p < Math.max(r.length, g.length) && r[p] === g[p]) p++
      console.log(`L${i + 1} DIFERE @pos ${p + 1} (tipo=${r[7] ?? '?'} seg=${r[13] ?? '?'})`)
      console.log(`  real  : ${JSON.stringify(r.slice(Math.max(0, p - 8), p + 12))}`)
      console.log(`  gerado: ${JSON.stringify(g.slice(Math.max(0, p - 8), p + 12))}`)
    }
  }
}
console.log(`\nlinhas real=${linhasReal.length} gerado=${linhasGer.length} · divergências=${diffs}`)
if (diffs === 0) console.log('✅ SICREDI: gerado == real byte a byte (todas as 66 linhas)')
process.exit(diffs === 0 ? 0 : 1)
