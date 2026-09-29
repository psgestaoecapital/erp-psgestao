/**
 * Gate de build: relatório Plano Gerencial × Contábil (CEO 29/09 · FC). Lê-se pela árvore GERENCIAL, com as contábeis
 * vinculadas logo abaixo de cada conta; as contábeis sem conta gerencial vão numa seção compacta no FIM; o texto do
 * relatório é só preto/espresso (sem cinza-claro nem laranja) e sai preto na impressão.
 *   tsx scripts/check-relatorio-plano.ts
 */
import { readFileSync } from 'node:fs'
import { compararCodigo, montarRelatorioPlano, soVinculadas, type LinhaRelatorioPlano } from '../src/lib/contabil/relatorioPlano'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

const L = (p: Partial<LinhaRelatorioPlano>): LinhaRelatorioPlano => ({
  origem: 'gerencial', ger_codigo: null, ger_descricao: null, ger_grupo: null, ger_tipo: null, ger_nivel: null, ger_is_totalizador: null,
  cont_codigo: null, cont_descricao: null, cont_nivel: null, cont_analitica: null, cont_codigo_antigo: null, vinculo_observacao: null, ...p,
})

// 1) ordem natural do código
ok(['10', '2', '1.02', '1', '2.01', '1.01'].sort(compararCodigo).join(' ') === '1 1.01 1.02 2 2.01 10', 'ordem natural: 1, 1.01, 1.02, 2, 2.01, 10')

// 2) como o banco devolve (órfãs primeiro, uma linha por vínculo): vira árvore + pendentes no fim
const linhas: LinhaRelatorioPlano[] = [
  L({ origem: 'contabil_sem_vinculo', cont_codigo: '5.01.01.06.00006', cont_descricao: 'Tarifas bancárias', cont_codigo_antigo: '279' }),
  L({ origem: 'contabil_sem_vinculo', cont_codigo: '5.01.01.03.00008', cont_descricao: 'Energia elétrica' }),
  L({ ger_codigo: '2.02', ger_descricao: 'Mão de obra de campo', ger_nivel: 2, cont_codigo: '5.03', cont_descricao: 'Salários' }),
  L({ ger_codigo: '2', ger_descricao: 'CUSTO DAS OBRAS', ger_nivel: 1, ger_is_totalizador: true }),
  L({ ger_codigo: '2.02', ger_descricao: 'Mão de obra de campo', ger_nivel: 2, cont_codigo: '5.01', cont_descricao: 'FGTS' }),
  L({ ger_codigo: '1', ger_descricao: 'RECEITA', ger_nivel: 1, ger_is_totalizador: true }),
  L({ ger_codigo: '1.01', ger_descricao: 'Serviços', ger_nivel: 2 }),
]
const r = montarRelatorioPlano(linhas)
ok(r.arvore.map((n) => n.codigo).join(' ') === '1 1.01 2 2.02', 'árvore gerencial em ordem, uma vez cada conta')
const n202 = r.arvore.find((n) => n.codigo === '2.02')!
ok(n202.contabeis.map((c) => c.codigo).join(' ') === '5.01 5.03', 'as contábeis vinculadas ficam debaixo da gerencial, em ordem')
ok(r.arvore.find((n) => n.codigo === '1.01')!.contabeis.length === 0, 'gerencial sem vínculo aparece sem contábil (sem linha fantasma)')
ok(r.pendentes.map((c) => c.codigo).join(' ') === '5.01.01.03.00008 5.01.01.06.00006', 'pendentes separadas e ordenadas, fora da árvore')
ok(soVinculadas(r.arvore).map((n) => n.codigo).join(' ') === '2 2.02', '"Só vinculadas" mantém o totalizador do caminho')

// 3) a tela: árvore primeiro, pendentes no fim, sem a frase por linha, sem cinza-claro/laranja no corpo, preto na impressão
const pg = readFileSync('src/app/dashboard/cadastros/plano-contas/relatorio/page.tsx', 'utf8')
const corpo = pg.slice(pg.indexOf('id="relatorio-plano"'))
ok(corpo.indexOf('relatorio-arvore') > 0 && corpo.indexOf('relatorio-pendentes') > corpo.indexOf('relatorio-arvore'), 'no relatório a árvore vem antes da seção de pendentes')
ok(pg.includes('Contas contábeis ainda sem conta gerencial: {rel.pendentes.length}'), 'título da seção com a contagem')
ok(!pg.includes('conta contábil sem conta gerencial</span>'), 'a frase não se repete em cada linha')
ok(!/laranjaAlerta/.test(pg), 'nada de laranja no relatório')
ok(!/rgba\(61,\s*35,\s*20,\s*0\.[0-6]\d*\)'\s*[,}]/.test(corpo.replace(/border[^,}]*/g, '')), 'nenhum texto em espresso translúcido (cinza-claro) no corpo')
ok(pg.includes('body *{color:#000!important}'), 'na impressão todo texto sai em preto')

if (falhas > 0) { console.error(`\n[check-relatorio-plano] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-relatorio-plano] relatório gerencial × contábil conferido.')
