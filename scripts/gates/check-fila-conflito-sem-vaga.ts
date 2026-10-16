// Gate (CEO 16/10) — PR bloqueada (conflito no update-branch) NÃO ocupa vaga do teto ATUALIZA_NA_VEZ.
// Incidente: 4 PRs com conflito queimavam as 4 vagas e 7 PRs prontas ficavam em "teto 4" sem nenhuma em preparo.
import { readFileSync } from 'node:fs'
import { SCRIPT_FILA } from '../merge/fila-simulada'

const sh = readFileSync(SCRIPT_FILA, 'utf8')
const i = sh.indexOf('atras=$(api "repos/$REPO/compare/$MAIN0...$sha"')
const bloco = sh.slice(i, sh.indexOf('tirar_da_fila "$n" "não consegui atualizar', i))
const upd = bloco.indexOf('update-branch')
const inc = bloco.indexOf('em_preparo=$((em_preparo + 1))')
if (i < 0 || upd < 0 || inc < 0 || inc < upd) {
  console.error('✗ fila: o incremento de em_preparo deve vir DEPOIS do update-branch bem-sucedido (PR com conflito não ocupa vaga)')
  process.exit(1)
}
console.log('✓ fila: PR bloqueada por conflito não ocupa vaga do teto')
