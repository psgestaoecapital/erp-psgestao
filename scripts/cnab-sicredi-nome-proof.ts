// PROVA — nome do arquivo de remessa Sicredi no padrão exigido pelo banco: XXXXXXXX.REM (8 dígitos + .REM,
// sem underscore/prefixo). O conteúdo NÃO muda (buildArquivoSicredi intacto — a prova byte a byte segue no
// scripts/cnab-mapear-proof-sicredi.ts). Aqui só o NOME.
import { nomeArquivoRemessaSicredi } from '../src/lib/banco/cnab240'

let falhas = 0
const check = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('  ❌ ' + msg) } else console.log('  ✓ ' + msg) }
const re = /^[0-9]{8}\.REM$/

for (const [seq, esp] of [[48, '00000048.REM'], [49, '00000049.REM'], [1, '00000001.REM']] as [number, string][]) {
  const nome = nomeArquivoRemessaSicredi(seq)
  check(nome === esp, `remessa ${seq} → ${nome} (esperado ${esp})`)
  check(re.test(nome), `remessa ${seq} bate o padrão XXXXXXXX.REM`)
  check(nome.length === 12 && nome.indexOf('_') === -1, `remessa ${seq} tem 8+".REM", sem underscore`)
}

console.log(falhas === 0
  ? '\n✅ Nome do arquivo Sicredi no padrão XXXXXXXX.REM (48 → 00000048.REM). Conteúdo inalterado.'
  : `\n❌ ${falhas} verificação(ões) falharam.`)
process.exit(falhas === 0 ? 0 : 1)
