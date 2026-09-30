/**
 * Gate de build · Triches #133: imprimir a agenda da oficina (semana ou dia · todos ou um mecânico) para deixar exposta
 * a quem não usa tablet. Regras puras da folha + a tela tem o botão e a folha só aparece no papel.
 *   tsx scripts/check-agenda-impressao.ts
 */
import { readFileSync } from 'node:fs'
import { diasParaImpressao, mecanicosDoPeriodo, type AgImpressao } from '../../src/lib/agenda/impressao'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

const ag = (id: string, data: string, hora: string | null, mec: string | null, status = 'agendado'): AgImpressao =>
  ({ id, data, hora_inicio: hora, hora_fim: null, status, cliente_nome: `c${id}`, responsavel_nome: mec, titulo: null, dados: null, observacao: null })
const ags = [ag('1', '2026-10-01', '14:00', 'João'), ag('2', '2026-10-01', '08:00', 'Pedro'), ag('3', '2026-10-01', null, 'João'),
  ag('4', '2026-10-02', '09:00', 'João', 'cancelado'), ag('5', '2026-10-02', '10:00', null)]

const todos = diasParaImpressao(ags, ['2026-10-01', '2026-10-02'], '')
ok(todos[0].itens.map((a) => a.id).join(',') === '2,1,3', 'ordena por horário e deixa "sem horário" por último')
ok(todos[1].itens.map((a) => a.id).join(',') === '5', 'cancelado não sai na folha')
const joao = diasParaImpressao(ags, ['2026-10-01', '2026-10-02'], 'João')
ok(joao[0].itens.map((a) => a.id).join(',') === '1,3' && joao[1].itens.length === 0, 'folha individual: só o mecânico escolhido')
ok(JSON.stringify(mecanicosDoPeriodo(ags)) === JSON.stringify(['João', 'Pedro', 'Sem mecânico']), 'seletor lista os mecânicos do período (sem os cancelados)')

const tela = readFileSync('src/app/dashboard/oficina/agenda/page.tsx', 'utf8')
ok(/data-testid="agenda-imprimir"/.test(tela) && /window\.print\(\)/.test(tela), 'a agenda tem o botão Imprimir')
ok(/data-testid="agenda-imp-mecanico"/.test(tela), 'a agenda tem o seletor de mecânico para a folha')
ok(/#agenda-print \{ display: none; \}/.test(tela) && /@media print/.test(tela), 'a folha só aparece no papel')

if (falhas > 0) { console.error(`\n[check-agenda-impressao] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-agenda-impressao] impressão da agenda conferida.')
