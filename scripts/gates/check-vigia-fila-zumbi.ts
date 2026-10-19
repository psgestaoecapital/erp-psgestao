// Gate: o vigia cancela run da Fila de merge preso (jobs concluídos, run em andamento) — zumbi de 19/10.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const yml = readFileSync(join(process.cwd(), '.github/workflows/vigia-runs.yml'), 'utf8')
const erros: string[] = []
if (!yml.includes('Cancelar run da fila de merge preso')) erros.push('passo do zumbi da fila ausente')
if (!yml.includes('workflows/fila-merge.yml/runs?status=in_progress')) erros.push('não lista os runs da fila em andamento')
if (!yml.includes('select(.status != "completed")')) erros.push('não confere que todos os jobs estão concluídos')
if (!yml.includes('[ "$min" -gt 10 ]')) erros.push('teto de 10 min ausente')
if (erros.length) {
  console.error('check-vigia-fila-zumbi: FALHOU\n - ' + erros.join('\n - '))
  process.exit(1)
}
console.log('check-vigia-fila-zumbi: OK')
