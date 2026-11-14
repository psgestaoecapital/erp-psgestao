// Gate · Motor do Painel Comercial v5 (CEO 07/11/2026). Sem rede, sem banco.
// Prova que o porte de docs/prototipos/bi-comercial-v5/logica.js (model()) para TypeScript puro continua fiel:
//  1) o módulo é PURO — sem React, sem DOM, sem rede (a tela desenha; o motor só calcula);
//  2) os indicadores de topo, as metades, a curva ABC, os segmentos e o preço produto-a-produto batem com
//     valores calculados à mão numa base sintética determinística;
//  3) os filtros (escopo das exclusões, vendedor, linha) recortam como no protótipo.
// Os números de ACEITAÇÃO da Frioeste (R$ 13.983.740 · 6.285 · 482 · 127 · R$ 30,61/kg) são provados contra o
// banco real na PR (RD-38); aqui provamos a LÓGICA do porte, de forma determinística e offline.
import { readFileSync } from 'node:fs'
import {
  calcularModelo, estadoPadrao, resumo, gruposProduto, maxDia,
  type BaseV5, type EstadoV5,
} from '../../src/app/dashboard/comercial/meu-painel/motor-v5'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const eq = (a: number, b: number, m: string, tol = 1e-6) => ok(Math.abs(a - b) <= tol, `${m} (esperado ${b}, obtido ${a})`)

// 1) Pureza do módulo — nada de tela/rede no motor.
const src = readFileSync('src/app/dashboard/comercial/meu-painel/motor-v5.ts', 'utf8')
ok(!/from ['"]react['"]|from ['"]next\//.test(src), 'motor não importa react/next')
ok(!/\bdocument\b|\bwindow\b|\bfetch\(|createClient|supabase/.test(src), 'motor não toca DOM nem rede')

// 2) Base sintética determinística. items: [dia,nota,ven,cli,prod,kg,valor,valor_tabela,carga,tr].
const base: BaseV5 = {
  modo: 'lider', de: '2026-10-01', ate: '2026-10-26',
  ven: [['V1', 'Ana'], ['V2', 'Beto']],
  cid: ['Cascavel', 'Toledo'],
  tr: ['TR1'],
  grp: ['GrupoX'],
  prod: [
    ['Alcatra', 'Dianteiro s/osso', 1], // PG 0 (desossado), carne
    ['Costela', 'Traseiro c/osso', 1],  // PG 1 (com osso), carne
    ['Fígado', 'Miudo bovino', 1],      // PG 2 (miúdo), carne
    ['Sebo', 'Subproduto', 0],          // PG 3, NÃO carne → excluído por padrão
  ],
  notas: [[28, '28 dias'], [null, 'à vista']],
  cli: [['Cliente A', 0, 0], ['Cliente B', 1, -1], ['Cliente C', 0, -1]],
  items: [
    [0, 0, 0, 0, 0, 100, 3000, 3200, 0, 0], // Ana · A · Alcatra · desconto 200
    [2, 0, 0, 0, 0, 100, 3100, 3100, 0, 0], // Ana · A · Alcatra · no preço
    [20, 1, 1, 1, 1, 50, 2000, 1900, -1, 0], // Beto · B · Costela · acima 100 · sem carga
    [25, 0, 1, 2, 2, 40, 800, 850, 0, 0], // Beto · C · Fígado · desconto 50
    [10, 1, 0, 0, 3, 10, 150, 150, 0, 0], // Ana · A · Sebo (subproduto)
  ],
  dev: [],
}

// Dimensões derivadas
ok(JSON.stringify(gruposProduto(base)) === JSON.stringify([0, 1, 2, 3]), 'grupos de produto por linha')
eq(maxDia(base), 25, 'maxDia')

const est = estadoPadrao(base)
ok(est.escopo === 'preco' && est.ven === 'todos' && est.lin === 'todas', 'estado padrão: análise padrão')
ok(est.excl[3] === true && est.excl[0] === undefined, 'exclusão padrão só tira o não-carne (Sebo)')
eq(est.ate, 25, 'estado padrão ate = maxDia')

// Análise padrão (escopo preço: exclusões afetam só o preço, não os totais)
const m = calcularModelo(base, est)
const r = resumo(m)
eq(r.totalValor, 9050, 'total valor')
eq(r.itens, 5, 'itens (todos, escopo preço)')
eq(r.clientes, 3, 'clientes distintos')
eq(r.produtos, 4, 'produtos distintos')
eq(Math.round(r.precoPorKg * 100) / 100, 30.69, 'R$/kg análise = 8900/290')

// Metades por dias corridos (mid = 13): half1 dias 0,2,10 = 6250; half2 dias 20,25 = 2800
eq(m.mid, 13, 'mid por dias corridos')
eq(m.tot.v1, 6250, 'metade 1')
eq(m.tot.v2, 2800, 'metade 2')
// Descontos e acima
eq(m.tot.desc, 250, 'desconto total (200+50)')
eq(m.tot.ab, 2, 'itens abaixo da tabela')
eq(m.tot.acima, 100, 'acima da tabela')
// Prazo médio ponderado por valor (nota 0 = 28 dias; nota 1 sem prazo)
eq(m.pz, 28, 'prazo médio ponderado')
// Recortes
eq(m.venM.size, 2, 'vendedores no recorte')
eq(m.cliM.size, 3, 'clientes no recorte')
eq(m.venM.get(0)!.val, 6250, 'faturamento Ana')
eq(m.venM.get(1)!.val, 2800, 'faturamento Beto')

// Curva ABC e segmentos (clientes ordenados por valor: A 6250, B 2000, C 800)
const cliA = m.clis.find((c) => c.ci === 0)!
const cliB = m.clis.find((c) => c.ci === 1)!
const cliC = m.clis.find((c) => c.ci === 2)!
eq(cliA.cur, 0, 'ABC cliente A = A')
eq(cliC.cur, 1, 'ABC cliente C = B')
eq(cliA.seg, 4, 'segmento A = Em risco')
eq(cliB.seg, 2, 'segmento B = Novo')
eq(cliC.seg, 2, 'segmento C = Novo')
eq(cliA.f, 3, 'frequência (dias com compra) de A')
eq(cliA.r, 15, 'recência de A (ate - último dia)')

// 3) Filtros
// escopo 'tudo': exclusão tira o Sebo dos totais
const mTudo = calcularModelo(base, { ...est, escopo: 'tudo' } as EstadoV5)
eq(resumo(mTudo).itens, 4, 'escopo tudo: Sebo sai dos itens')
eq(mTudo.tot.val, 8900, 'escopo tudo: total sem o Sebo')
eq(resumo(mTudo).produtos, 3, 'escopo tudo: 3 produtos')
// filtro por vendedor (Ana = índice 0)
const mAna = calcularModelo(base, { ...est, ven: 0 } as EstadoV5)
eq(resumo(mAna).itens, 3, 'filtro vendedor Ana: 3 itens')
eq(mAna.tot.val, 6250, 'filtro vendedor Ana: total')
// filtro por linha (miúdo = PG 2 = só o Fígado)
const mMiudo = calcularModelo(base, { ...est, lin: 2 } as EstadoV5)
eq(resumo(mMiudo).itens, 1, 'filtro linha miúdo: 1 item')
eq(mMiudo.tot.val, 800, 'filtro linha miúdo: total')

if (falhas) { console.error(`\n${falhas} falha(s) — Motor do Painel Comercial v5`); process.exit(1) }
console.log('\nMotor do Painel Comercial v5 ok')
