/**
 * Gate de build (#273 · Frioeste SST): a Supervisão nunca escreve "undefined" — cada pausa curta aparece com horário e
 * minutos (formato da apuração atual: { tipo, quantidade } + pausas do dia).
 *   tsx scripts/check-supervisao-frases.ts
 */
import { frasesPausasCurtas, frasesExcesso, trechosSemPausa, fraseSinal } from '../../src/lib/ponto/supervisaoFrases'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

// caso real: Anderson 16/09 depois do #272 — desvio { quantidade: 1 } e as 3 pausas do dia
const pausas = [{ de: '05:36', ate: '05:56', min: 21, classe: 'pausa_normal' }, { de: '07:42', ate: '08:02', min: 19, classe: 'pausa_insuficiente' },
  { de: '11:37', ate: '11:59', min: 23, classe: 'pausa_excesso' }]
const f = frasesPausasCurtas({ tipo: 'pausa_insuficiente', quantidade: 1 }, pausas, 20)
ok(f.length === 1 && f[0] === 'pausa das 07:42 às 08:02: 19 min — o mínimo é 20 min', 'pausa curta com horário e minutos')
ok(!f.join(' ').includes('undefined'), 'nunca escreve "undefined"')
ok(frasesPausasCurtas({ tipo: 'pausa_insuficiente', quantidade: 2 }, null, 20)[0] === '2 pausas abaixo de 20 min', 'sem as pausas, diz quantas (sem undefined)')
ok(frasesPausasCurtas({ tipo: 'pausa_insuficiente', duracao_min: 18, inicio: '09:10', minimo: 20 }, null, 20)[0] === 'pausa de 18 min às 09:10 — o mínimo é 20 min', 'formato antigo continua legível')
ok(frasesExcesso(pausas)[0] === 'pausa das 11:37 às 11:59: 23 min — acima do tempo previsto (gestão, não é infração)', 'excesso aparece como gestão')
ok(frasesExcesso(null).length === 0, 'sem pausas, nada de excesso')

// sinal de gestão de 1h40 (art. 253 CLT) — Anderson 16/09: ponto 03:55–09:00 / 10:10–13:47, pausas 05:36–05:56, 07:42–08:02, 11:37–11:59
const tr = trechosSemPausa(['03:55', '09:00', '10:10', '13:47'], [{ de: '05:36', ate: '05:56' }, { de: '07:42', ate: '08:02' }, { de: '11:37', ate: '11:59' }], 100)
ok(tr.map(t => `${t.de}-${t.ate}=${t.min}`).join(' ') === '03:55-05:36=101 05:56-07:42=106 11:59-13:47=108',
  'acha os trechos sem pausa acima de 1h40 (1h41, 1h46 e 1h48 no dia do Anderson)')
ok(fraseSinal(tr[2]) === 'ficou 1h48 sem pausa, das 11:59 às 13:47 — o limite é 1h40 (art. 253 da CLT)', 'frase do sinal com horário')
ok(trechosSemPausa(['06:00', '07:40'], [], 100).length === 0, 'exatamente 1h40 não é sinal')
ok(trechosSemPausa(['06:00', '09:00'], [{ de: '07:00', ate: '07:20' }], 100).length === 0, 'pausa no meio quebra o trecho')
ok(trechosSemPausa(['06:00', '09:00', '10:00'], [], 100).length === 1, 'batida sem par no fim é ignorada (só pares entrada/saída)')

if (falhas) { console.error(`\n[check-supervisao-frases] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-supervisao-frases] frases da Supervisão conferidas.')
