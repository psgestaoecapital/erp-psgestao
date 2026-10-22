/**
 * Gate de build (#3183 · Jordana/Gean): na lista de extratos da Conciliação cada linha mostra o período movimentado
 * do extrato (periodo_inicio a periodo_fim), e a tela usa esse rótulo.
 *   tsx scripts/gates/check-conciliacao-periodo-lote.ts
 */
import { readFileSync } from 'node:fs'
import { periodoLote, rotuloLote } from '../../src/lib/conciliacao/rotuloLote'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const base = { nome: 'extrato (69).ofx', total_movimentos: 63, total_conciliados: 28, total_ignorados: 2 }
ok(rotuloLote({ ...base, periodo_inicio: '2026-09-01', periodo_fim: '2026-09-30' }) === 'extrato (69).ofx — 01/09/2026 a 30/09/2026 — 30/63 ok',
  'linha mostra nome, período e resolvidos/total')
ok(periodoLote({ periodo_inicio: '2026-10-16', periodo_fim: '2026-10-16' }) === '16/10/2026', 'extrato de um dia só → uma data')
ok(periodoLote({ periodo_inicio: '2026-09-01T00:00:00+00:00', periodo_fim: null }) === '01/09/2026', 'só a data inicial (com hora) → mostra a que tem')
ok(rotuloLote({ ...base, periodo_inicio: null, periodo_fim: null }) === 'extrato (69).ofx — 30/63 ok', 'sem período → linha como antes')
ok(rotuloLote({ nome: null, periodo_inicio: null, periodo_fim: null, total_movimentos: null, total_conciliados: null, total_ignorados: null }) === '(sem nome) — 0/0 ok',
  'lote vazio não quebra')

const tela = readFileSync('src/app/dashboard/financeiro/conciliacao/inbox/page.tsx', 'utf8')
ok(/\{rotuloLote\(l\)\}/.test(tela), 'a lista de extratos da Conciliação usa rotuloLote (período em cada linha)')

if (falhas) { console.error(`\n[check-conciliacao-periodo-lote] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-conciliacao-periodo-lote] período de cada extrato na lista conferido.')
