/**
 * Gate de build (CEO 25/11) — trava de número do Consultor IA: todo valor em R$ citado na resposta tem de aparecer nos
 * resultados das ferramentas; se não aparecer, é "inventado" (o servidor refaz uma vez e, persistindo, avisa). Este gate
 * trava a lógica determinística de detecção (src/lib/consultor/agente.ts: numerosInventados).
 *   npm run gates -- consultor-numero-trap
 */
import { numerosInventados, numerosDaResposta, type ToolResult } from '../../src/lib/consultor/agente'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const tr = (saida: unknown): ToolResult[] => [{ nome: 'consultar_dados', input: {}, saida }]

// valor citado que ESTÁ nos dados → não é inventado
ok(numerosInventados('O boleto foi pago por R$ 143,52.', tr({ dados: [{ valor_pago: 143.52 }] })).length === 0,
   '143,52 citado e presente (143.52) → não inventado')
// valor inteiro presente como número → não inventado (fallback sem casas)
ok(numerosInventados('O título é de R$ 138,00.', tr({ dados: [{ valor: 138 }] })).length === 0,
   '138,00 citado e presente como 138 → não inventado')
// milhar pt-BR presente como 3386.52 → não inventado
ok(numerosInventados('O crédito foi de R$ 3.386,52.', tr({ dados: [{ v: 3386.52 }] })).length === 0,
   '3.386,52 citado e presente (3386.52) → não inventado')
// valor que NÃO está em lugar nenhum → inventado
const inv = numerosInventados('O saldo é R$ 999,00.', tr({ dados: [{ valor: 138 }] }))
ok(inv.length === 1 && inv[0] === '999.00', 'valor ausente dos dados → marcado como inventado')
// resposta sem número → nada a conferir
ok(numerosInventados('Está tudo certo, sem pendências.', tr({ dados: [] })).length === 0, 'resposta sem número → vazio')
// vários valores: um presente, um ausente
const mix = numerosInventados('Recebeu R$ 143,52 e deve ainda R$ 50,00.', tr({ dados: [{ valor_pago: 143.52 }] }))
ok(mix.length === 1 && mix[0] === '50.00', 'mistura: só o ausente (50,00) é apontado')
// extração pt-BR básica
ok(JSON.stringify(numerosDaResposta('R$ 1.234,56 e 7,00').sort()) === JSON.stringify(['1234.56', '7.00'].sort()),
   'numerosDaResposta extrai valores pt-BR')

if (falhas > 0) { console.error(`\n[check-consultor-numero-trap] ${falhas} caso(s) falharam`); process.exit(1) }
console.log('\n[check-consultor-numero-trap] OK')
