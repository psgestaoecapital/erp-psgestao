// Gate PS EHS E0: assistente com prévia e painel lateral presentes, com traduções pt/en/es.
import { readFileSync } from 'node:fs'
import { tEhs, EHS_IDIOMAS, type EhsChave } from '../../src/components/ps-ehs/i18n'

const erros: string[] = []
const a = readFileSync('src/components/ps-ehs/assistente.tsx', 'utf8')
const p = readFileSync('src/components/ps-ehs/painel-lateral.tsx', 'utf8')
if (!a.includes('ehs-assistente-previa')) erros.push('assistente sem prévia ao lado')
if (!p.includes('ehs-painel-lateral')) erros.push('painel lateral ausente')
const chaves: EhsChave[] = ['passo.de', 'passo.voltar', 'passo.avancar', 'passo.concluir', 'passo.previa', 'painel.fechar', 'painel.salvar']
for (const c of chaves) for (const l of EHS_IDIOMAS) if (!tEhs(c, l).trim()) erros.push(`tradução vazia: ${c}/${l}`)
if (erros.length) { console.error('check-ps-ehs-assistente FALHOU:\n' + erros.join('\n')); process.exit(1) }
console.log('check-ps-ehs-assistente ok')
