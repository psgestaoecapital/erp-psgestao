// PROVA (RD-38 / CEO 29/10) do estado do certificado A1 pela validade (#5661): vencido nunca é "ativo".
// Gate estático, sem rede/banco — importa só a função pura de ../../src/lib/fiscal/estadoCertificado.
import { estadoCertificado, CERT_VENCE_BREVE_MS, type EstadoCertificado } from '../../src/lib/fiscal/estadoCertificado'

const DIA = 86400000
const agora = Date.UTC(2026, 10, 10) // referência fixa para a prova ser determinística
let falhas = 0

const casos: [string, string | null, EstadoCertificado | null][] = [
  ['validade futura (1 ano)', new Date(agora + 365 * DIA).toISOString(), 'ativo'],
  ['faltando 29 dias', new Date(agora + 29 * DIA).toISOString(), 'vence_breve'],
  ['faltando 1 dia', new Date(agora + DIA).toISOString(), 'vence_breve'],
  ['venceu ontem', new Date(agora - DIA).toISOString(), 'vencido'],
  ['venceu há 1 ano', new Date(agora - 365 * DIA).toISOString(), 'vencido'],
  ['sem validade', null, null],
  ['data ilegível', 'xx/xx/xxxx', null],
]
for (const [nome, v, esp] of casos) {
  const got = estadoCertificado(v, agora)
  const ok = got === esp
  if (!ok) falhas++
  console.log(`${ok ? '✓' : '✗'} ${nome}: esperado ${esp}, obtido ${got}`)
}
// limite exato da janela (30 dias) = ainda ATIVO (a condição é estritamente menor que a janela)
{
  const got = estadoCertificado(new Date(agora + CERT_VENCE_BREVE_MS).toISOString(), agora)
  const ok = got === 'ativo'
  if (!ok) falhas++
  console.log(`${ok ? '✓' : '✗'} exatamente 30 dias: esperado ativo, obtido ${got}`)
}

if (falhas) { console.error(`\n${falhas} caso(s) de estado do certificado divergente(s) (RD-95/#5661)`); process.exit(1) }
console.log('✓ #5661: estado do certificado por validade — vencido nunca aparece como ativo')
