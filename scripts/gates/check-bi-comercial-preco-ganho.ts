// Gate · Comercial › Meu painel › aba Preço e desconto: GANHOS na tabela + PONDERADO (spec do CEO 26/11). Sem rede.
// Prova, numa base sintética determinística, que calcularPrecoV7 (precoV7.ts):
//  1) ganho = praticado − tabela quando acima (espelho do desconto); líquido = ganhos − descontos;
//  2) % ponderado por faturamento = Σ R$ ÷ Σ tabela; % simples = média do % por item; % por volume pesa por kg;
//  3) faixas trazem o detalhe por cliente/vendedor também no lado "Acima da tabela";
//  4) média do índice ponderada (Σ praticado ÷ Σ esperado = 100 com a equipe toda) ao lado da simples;
//  5) com UM vendedor o desvio é exatamente 0 (não 1e-14) e a tela troca o gráfico pelo estado vazio explicativo;
//  6) a tela tem o "?" das chaves novas e cada chave está semeada numa migration (RD-95); aviso da tabela mantido.
import { readFileSync, readdirSync } from 'node:fs'
import { calcularModelo, estadoPadrao, type BaseV5 } from '../../src/app/dashboard/comercial/meu-painel/motor-v5'
import { calcularPrecoV7 } from '../../src/app/dashboard/comercial/meu-painel/precoV7'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const eq = (a: number | null | undefined, b: number, m: string, tol = 1e-6) => ok(a != null && Math.abs(a - b) <= tol, `${m} (esperado ${b}, obtido ${a})`)

// items: [dia,nota,ven,cli,prod,kg,valor,valor_tabela,carga,tr]
const base: BaseV5 = {
  modo: 'lider', de: '2026-10-01', ate: '2026-10-26',
  ven: [['V1', 'Ana'], ['V2', 'Beto']], cid: ['Cascavel', 'Toledo'], tr: ['TR1'], grp: ['GrupoX'],
  prod: [['Alcatra', 'Dianteiro s/osso', 1], ['Costela', 'Traseiro c/osso', 1], ['Fígado', 'Miudo bovino', 1], ['Sebo', 'Subproduto', 0]],
  notas: [[28, '28 dias'], [null, 'à vista']],
  cli: [['Cliente A', 0, 0], ['Cliente B', 1, -1], ['Cliente C', 0, -1]],
  items: [
    [0, 0, 0, 0, 0, 100, 3000, 3200, 0, 0], // Ana · A · desconto 200 (6,25%)
    [2, 0, 0, 0, 0, 100, 3100, 3100, 0, 0], // Ana · A · na tabela
    [20, 1, 1, 1, 1, 50, 2000, 1900, -1, 0], // Beto · B · GANHO 100 (5,263%)
    [25, 0, 1, 2, 2, 40, 800, 850, 0, 0], // Beto · C · desconto 50 (5,882%)
    [10, 1, 0, 0, 3, 10, 150, 150, 0, 0], // Ana · A · Sebo na tabela
  ],
  dev: [],
}
const est = estadoPadrao(base)
const p = calcularPrecoV7(base, calcularModelo(base, est), est)
const t = p.total

// 1) ganho, desconto, líquido
eq(t.ganho, 100, 'ganho total na tabela')
eq(t.desc, 250, 'desconto total na tabela')
eq(t.liquido, -150, 'líquido = ganhos − descontos')
eq(p.descR, 250, 'compatibilidade: descR')
// 2) simples × ponderado (Σ tabela = 9200)
eq(t.descPct.ponderado, 100 * 250 / 9200, 'desconto ponderado por faturamento na tabela')
eq(t.ganhoPct.ponderado, 100 * 100 / 9200, 'acréscimo ponderado por faturamento na tabela')
eq(t.descPct.simples, (6.25 + 100 * 50 / 850) / 5, 'desconto simples = média do % por item')
eq(t.ganhoPct.simples, (100 * 100 / 1900) / 5, 'acréscimo simples = média do % por item')
eq(t.descPct.volume, (6.25 * 100 + (100 * 50 / 850) * 40) / 300, 'desconto ponderado por volume (kg)')
eq(t.liquidoPct, 100 * -150 / 9200, 'líquido % sobre a tabela')
eq(p.descPct, t.descPct.ponderado, 'compatibilidade: descPct é o ponderado')
// 3) faixas com detalhe
const acima = p.faixas.find((f) => f.faixa === 'Acima da tabela')!
ok(acima.itens === 1 && acima.val === 2000, 'faixa acima da tabela: 1 item, R$ 2.000')
ok(acima.clientes[0]?.nome === 'Cliente B' && Math.abs(acima.clientes[0].diff - 100) < 1e-9, 'faixa acima detalha por cliente (+100)')
ok(acima.vendedores[0]?.nome === 'Beto', 'faixa acima detalha por vendedor')
const f510 = p.faixas.find((f) => f.faixa === '5–10%')!
ok(f510.itens === 2 && f510.clientes.length === 2 && f510.vendedores.length === 2, 'faixa de desconto também detalha')
ok(p.faixas.reduce((s, f) => s + f.val, 0) === 9050, 'faixas somam o faturamento total')
// rankings
const beto = p.vendedores.find((v) => v.nome === 'Beto')!
const ana = p.vendedores.find((v) => v.nome === 'Ana')!
eq(beto.ganho, 100, 'Beto: ganho'); eq(beto.desc, 50, 'Beto: desconto'); eq(beto.liquido, 50, 'Beto: líquido')
eq(ana.ganho, 0, 'Ana: sem ganho'); eq(ana.desc, 200, 'Ana: desconto')
const cliB = p.clientes.find((c) => c.nome === 'Cliente B')!
eq(cliB.ganhoPct.ponderado, 100 * 100 / 1900, 'cliente B: % acima ponderado')
// 4) índice: média ponderada × simples
eq(p.mediaIdxPonderada, 100, 'média ponderada do índice = 100 com a equipe toda', 1e-9)
ok(p.mediaIdx != null && p.nVendedoresIdx === 2, 'média simples do índice ao lado, 2 vendedores comparáveis')
ok(p.vendedores.every((v) => v.idxSimples != null), 'índice simples por vendedor')
// 5) um vendedor só
const est1 = { ...est, ven: 0 as const }
const p1 = calcularPrecoV7(base, calcularModelo(base, est1), est1)
ok(p1.nVendedoresIdx === 1, 'um vendedor: 1 comparável')
ok(p1.vendedores[0].desvio === 0, `um vendedor: desvio exatamente 0 (obtido ${p1.vendedores[0].desvio})`)
// 6) tela: "?" e chaves semeadas; aviso da tabela mantido; estado vazio do gráfico
const tela = readFileSync('src/app/dashboard/comercial/meu-painel/AbaPrecoV7.tsx', 'utf8')
const migs = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
const novas = ['ganho_tabela', 'desconto_total', 'liquido_tabela', 'ponderado', 'indice_media', 'faixa_detalhe', 'preco_vendedor', 'ganho_cliente', 'desconto_cliente']
for (const k of novas) ok(tela.includes(`"com.painel.${k}"`) && migs.includes(`'com.painel.${k}'`), `"?" com.painel.${k} na tela e no banco`)
ok(/pode estar desatualizada/.test(tela), 'aviso: tabela de referência pode estar desatualizada')
ok(/graficoOk = preco\.nVendedoresIdx >= 2/.test(tela) && /Só há um vendedor neste recorte/.test(tela), 'gráfico de índice: estado vazio com um vendedor só')

if (falhas) { console.error(`\n${falhas} falha(s) no gate de ganho/ponderado da aba Preço e desconto`); process.exit(1) }
console.log('✓ aba Preço e desconto: ganhos, líquido, ponderado e gráfico com um vendedor')
