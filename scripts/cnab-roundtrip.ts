/* eslint-disable no-console */
// Prova RD-38 (round-trip) do motor CNAB 240 Sicoob: parse(real) -> build -> byte a byte com os .rem reais.
// Usa os MESMOS mapas do perfil (src/lib/banco/cnab240/sicoob.ts) — sem duplicar layout.
import { readFileSync } from 'node:fs'
import { parseLine, buildLine } from '../src/lib/banco/cnab240/engine'
import { mapForLine } from '../src/lib/banco/cnab240/sicoob'

const files = ['docs/cnab/cnab_pgto_756_56979.rem', 'docs/cnab/cnab_pgto_756_63082.rem']
let totLines = 0, totOk = 0
for (const fp of files) {
  const raw = readFileSync(fp, 'latin1')
  const lines = raw.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0)
  for (let i = 0; i < lines.length; i++) {
    totLines++
    const orig = lines[i]
    const map = mapForLine(orig)
    const rebuilt = buildLine(parseLine(orig, map), map)
    if (rebuilt === orig) { totOk++; continue }
    console.log(`\n❌ ${fp} linha ${i + 1} DIFERE`)
    for (let p = 0; p < Math.max(orig.length, rebuilt.length); p++) {
      if (orig[p] !== rebuilt[p]) { console.log(`   1ª divergência pos ${p + 1}: orig=${JSON.stringify(orig[p])} rebuilt=${JSON.stringify(rebuilt[p])}`); break }
    }
  }
}
console.log(`${totOk}/${totLines} linhas byte-idênticas (round-trip).`)
process.exit(totOk === totLines ? 0 : 1)
