// Gate PS EHS E0: assistente com prévia e painel lateral existem e usam o dicionário pt/en/es.
import { readFileSync } from 'node:fs'
import { tEhs, EHS_IDIOMAS } from '../../src/components/ps-ehs/i18n'

const src = readFileSync('src/components/ps-ehs/assistente.tsx', 'utf8')
const erros: string[] = []
for (const n of ['EhsAssistente', 'EhsPainelLateral']) if (!src.includes(`export function ${n}`)) erros.push(`falta ${n}`)
for (const t of ['ehs-assistente', 'ehs-previa', 'ehs-painel-lateral']) if (!src.includes(t)) erros.push(`falta data-testid ${t}`)
for (const c of ['painel.fechar', 'passo.concluir'] as const) for (const l of EHS_IDIOMAS) if (!tEhs(c, l).trim()) erros.push(`tradução vazia: ${c}/${l}`)
if (erros.length) { console.error('check-ps-ehs-assistente FALHOU:\n' + erros.join('\n')); process.exit(1) }
console.log('check-ps-ehs-assistente ok')
