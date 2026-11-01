// Gate (#3188 · Jordana/Gean): a ficha do título (Receitas e Despesas) tem a aba "Histórico de pagamentos", com uma linha
// por baixa (data, valor, forma, conta, quem registrou, Recebido/Pago ou Conciliado) e o rodapé valor/total pago/aberto.
// Prova a montagem com o caso do chamado ("Motor ducato": 5.000 · 3.000 · 3.000 · 2.000 · 2.000, aberto R$ 689,50), uma
// despesa com baixa parcial, a ligação nas duas fichas e que todo "?" do painel tem chave na migration. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'
import { montarHistoricoPagamentos, rotuloForma } from '../../src/lib/financeiro/historicoPagamentos'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (cond) console.log(`  ✓ ${msg}`); else { console.error(`  ✗ ${msg}`); falhas++ } }

// 1) caso real do chamado (dados de 16/10, ids fictícios)
const b = (id: string, valor: number, data: string, forma: string | null, origem: string, mov: string | null, por: string | null, em: string) =>
  ({ id, valor, data, forma, origem, movimento_banco_id: mov, criado_por: por, criado_em: em })
const h = montarHistoricoPagamentos({
  tipo: 'receber',
  valorTitulo: '15689.50',
  contaTitulo: 'SICREDI',
  baixas: [
    b('5', 2000, '2026-10-08', 'conciliacao_bancaria', 'conciliacao', 'm5', 'u1', '2026-10-16T12:45:46Z'),
    b('1', 3000, '2026-09-17', 'conciliacao_bancaria', 'conciliacao', 'm1', 'u1', '2026-10-16T12:54:38Z'),
    b('2', 5000, '2026-09-21', 'PIX', 'conciliacao', 'm2', 'u1', '2026-09-21T19:01:40Z'),
    b('3', 3000, '2026-09-21', 'conciliacao_bancaria', 'conciliacao', 'm3', 'u1', '2026-10-16T12:55:18Z'),
    b('4', 2000, '2026-10-02', 'conciliacao_bancaria', 'conciliacao', 'm4', 'u1', '2026-10-16T12:46:09Z'),
  ],
  contaPorMovimento: { m1: 'SICREDI', m2: 'SICREDI', m3: 'SICREDI', m4: 'SICREDI', m5: 'SICREDI' },
  nomePorUsuario: { u1: 'Jordana' },
})
ok(h.linhas.map((l) => l.valor).join(',') === '3000,5000,3000,2000,2000', 'Motor ducato: 5 linhas na ordem das datas (3.000 · 5.000 · 3.000 · 2.000 · 2.000)')
ok(h.totalPago === 15000 && h.valorTitulo === 15689.5 && h.saldoAberto === 689.5, 'Motor ducato: rodapé 15.689,50 / pago 15.000,00 / aberto 689,50')
ok(h.linhas.every((l) => l.status === 'Conciliado' && l.conta === 'SICREDI' && l.usuario === 'Jordana'), 'baixa conciliada → "Conciliado", conta do extrato e nome de quem registrou')
ok(h.linhas[1].forma === 'PIX' && h.linhas[0].forma === 'Conciliação bancária', 'forma em rótulo legível (PIX · Conciliação bancária)')

// 2) despesa com baixa parcial manual (sem conciliar)
const d = montarHistoricoPagamentos({
  tipo: 'pagar', valorTitulo: 1000, contaTitulo: 'Caixa',
  baixas: [b('a', 400, '2026-10-10', null, 'trigger_guarda', null, null, '2026-10-10T10:00:00Z')],
})
ok(d.linhas.length === 1 && d.linhas[0].status === 'Pago' && d.linhas[0].conta === 'Caixa', 'despesa parcial: linha "Pago" na conta do título')
ok(d.totalPago === 400 && d.saldoAberto === 600, 'despesa parcial: pago 400 / aberto 600')
ok(d.linhas[0].forma === 'Baixa manual' && d.linhas[0].usuario === 'Sistema', 'sem forma/usuário: "Baixa manual" e "Sistema" (nunca código cru)')
ok(rotuloForma(null, null) === 'Não informada', 'sem forma nem origem → "Não informada"')
const v = montarHistoricoPagamentos({ tipo: 'receber', valorTitulo: 500, contaTitulo: null, baixas: [] })
ok(v.linhas.length === 0 && v.saldoAberto === 500, 'título sem baixa: lista vazia e aberto = valor do título')

// 3) ligação: as duas fichas usam as abas; o painel lê as duas tabelas de baixa
const abas = readFileSync('src/components/financeiro/FichaTituloAbas.tsx', 'utf8')
const painel = readFileSync('src/components/financeiro/HistoricoPagamentosPanel.tsx', 'utf8')
ok(/<FichaTituloAbas tipo="receber" editarId=\{editarId\}>/.test(readFileSync('src/components/financeiro/NovaReceitaModal.tsx', 'utf8')), 'ficha de Receita tem a aba')
ok(/<FichaTituloAbas tipo="pagar" editarId=\{editarId\}>/.test(readFileSync('src/components/financeiro/NovaDespesaModal.tsx', 'utf8')), 'ficha de Despesa tem a aba')
ok(painel.includes("'erp_receber_baixa'") && painel.includes("'erp_pagar_baixa'") && painel.includes(".is('deleted_at', null)"), 'painel lê só baixas ativas das duas tabelas')

// 4) RD-95: todo "?" do painel/abas tem chave na migration
const chaves = new Set<string>()
for (const f of readdirSync('supabase/migrations').filter((x) => x.endsWith('.sql'))) {
  for (const m of readFileSync(`supabase/migrations/${f}`, 'utf8').matchAll(/'(financeiro\.historico_pagamentos\.[a-z_]+)'/g)) chaves.add(m[1])
}
const usadas = [...`${abas}\n${painel}`.matchAll(/financeiro\.historico_pagamentos\.[a-z_]+/g)].map((m) => m[0])
const faltando = [...new Set(usadas)].filter((c) => !chaves.has(c))
ok(usadas.length >= 10 && faltando.length === 0, `"?" do painel com chave na migration (${new Set(usadas).size} chaves${faltando.length ? `; faltam: ${faltando.join(', ')}` : ''})`)

if (falhas) { console.error(`check-historico-pagamentos: ${falhas} falha(s)`); process.exit(1) }
console.log('check-historico-pagamentos: ok')
