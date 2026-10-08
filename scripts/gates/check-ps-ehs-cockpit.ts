// Gate PS EHS E0: cockpit por papel presente, com os 4 papéis e traduções pt/en/es.
import { readFileSync } from 'node:fs'
import { tEhs, EHS_IDIOMAS } from '../../src/components/ps-ehs/i18n'

const erros: string[] = []
const src = readFileSync('src/components/ps-ehs/cockpit.tsx', 'utf8')
for (const p of ['gestor', 'tecnico', 'campo', 'rt']) if (!src.includes(`${p}: {`)) erros.push(`papel ausente: ${p}`)
for (const l of EHS_IDIOMAS) if (!tEhs('cockpit.papel', l).trim()) erros.push(`tradução vazia: cockpit.papel/${l}`)
const pagina = readFileSync('src/app/dashboard/compliance/page.tsx', 'utf8')
if (!pagina.includes('<EhsCockpit')) erros.push('painel piloto deixou de usar o cockpit')
for (const r of ['Funcionários ativos', 'Vencendo (10 dias)', 'Vencidos', '% em dia']) if (!pagina.includes(r)) erros.push(`indicador removido do painel: ${r}`)
if (erros.length) { console.error('check-ps-ehs-cockpit FALHOU:\n' + erros.join('\n')); process.exit(1) }
console.log('check-ps-ehs-cockpit ok')
