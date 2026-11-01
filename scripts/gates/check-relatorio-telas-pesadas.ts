/**
 * Gate (#3281, etapa 4): botão "Gerar em segundo plano" nas telas pesadas + gerador de Contas a pagar/receber.
 * - o botão usa a MESMA RPC com guarda da tela Meus relatórios (fn_relatorio_pedir), só tipos que o gerador monta, e tem "?";
 * - Contas a pagar/receber (listagem) e Extrato mostram o botão com o período da própria tela;
 * - o gerador monta pagar/receber pelo recorte da listagem (empresa do pedido, sem excluídos, vencimento no período);
 * - a planilha de títulos soma valor/pago/em aberto por mês e NÃO conta cancelado/renegociado nem quitado como aberto
 *   (montada de verdade aqui).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { montarPlanilhaTitulos, resumoTitulos, situacao, type LinhaTitulo } from '../../src/lib/relatorios/titulosExcel'
import { mesesNoPeriodo } from '../../src/lib/relatorios/periodo'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }
const ler = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : '')

async function main() {
  const botao = ler('src/components/relatorios/GerarSegundoPlanoButton.tsx')
  ok(/supabase\.rpc\('fn_relatorio_pedir'/.test(botao), 'botão pede pela fn_relatorio_pedir (guarda por empresa)')
  ok(/fetch\('\/api\/relatorios\/fila'/.test(botao), 'botão acorda o gerador logo após o pedido')
  ok(/<AjudaCampo chave=\{chaveAjuda\}/.test(botao), 'botão tem o "?" (RD-95)')
  ok(/'financeiro_movimentacao' \| 'financeiro_pagar' \| 'financeiro_receber'/.test(botao), 'botão só oferece tipos que o gerador monta')
  ok(/href="\/dashboard\/financeiro\/meus-relatorios"/.test(botao), 'aviso leva a Meus relatórios')

  const lista = ler('src/components/financeiro/ListagemPagarReceberView.tsx')
  ok(/<GerarSegundoPlanoButton[\s\S]{0,400}dataInicio=\{dataInicio\}[\s\S]{0,80}dataFim=\{dataFim\}/.test(lista), 'pagar/receber: botão com o período da tela')
  ok(/tipo === 'pagar' \? 'financeiro_pagar' : 'financeiro_receber'/.test(lista), 'pagar/receber: tipo certo por tela')
  const extrato = ler('src/app/dashboard/financeiro/extrato/page.tsx')
  ok(/<GerarSegundoPlanoButton companyId=\{empresaUnica\} tipo="financeiro_movimentacao" dataInicio=\{dataInicio\} dataFim=\{dataFim\}/.test(extrato), 'extrato: movimentação do período da tela')

  const rota = ler('src/app/api/relatorios/fila/route.ts')
  ok(/const GERADOS = new Set\(\['financeiro_movimentacao', 'financeiro_pagar', 'financeiro_receber'\]\)/.test(rota), 'gerador conhece pagar e receber')
  const tit = /async function gerarTitulos[\s\S]*?\n\}/.exec(rota)?.[0] ?? ''
  ok(/\.eq\('company_id', p\.company_id\)/.test(tit), 'títulos: só da empresa do pedido')
  ok(/\.is\('deleted_at', null\)/.test(tit), 'títulos: excluídos ficam fora')
  ok(/\.gte\('data_vencimento', ini\)/.test(tit) && /\.lte\('data_vencimento', fim\)/.test(tit), 'títulos: vencimento no período (recorte da listagem)')
  ok(/await gravar\(supa, p, buf\)/.test(tit), 'títulos: grava na pasta {empresa}/{solicitante}')
  ok(!/req\.json\(\)/.test(rota), 'rota não aceita empresa/solicitante do corpo')

  const dir = join(process.cwd(), 'supabase', 'migrations')
  const arq = readdirSync(dir).find((f) => f.endsWith('_relatorio_segundo_plano_telas_ajuda.sql'))
  const sql = arq ? readFileSync(join(dir, arq), 'utf8') : ''
  for (const k of ['pagar', 'receber', 'extrato']) ok(sql.includes(`'relatorio.segundo_plano.${k}', '/dashboard/financeiro/${k}'`), `"?" relatorio.segundo_plano.${k} cadastrado na rota da tela`)
  ok(!/\b(DELETE FROM|TRUNCATE|DROP |ALTER TABLE|CREATE OR REPLACE)\b/i.test(sql.replace(/--[^\n]*/g, '')), 'migration aditiva (só o "?")')

  ok(mesesNoPeriodo('2026-01-01', '2026-12-31') > 3 && mesesNoPeriodo('2026-10-01', '2026-10-31') <= 3, 'destaque só para período longo (> 3 meses)')

  // planilha de verdade: quitado, parcial vencido, aberto a vencer, cancelado e renegociado
  const hoje = '2026-10-17'
  const T = (o: Partial<LinhaTitulo>): LinhaTitulo => ({ id: '', pessoa: null, descricao: null, categoria: null, documento: null, numero_nf: null,
    parcela: null, data_emissao: null, data_vencimento: '', data_pagamento: null, status: 'aberto', forma_pagamento: null, valor: 0, valor_pago: 0, ...o })
  const linhas = [
    T({ id: 'a', data_vencimento: '2026-09-10', status: 'pago', valor: 1000, valor_pago: 1000 }),
    T({ id: 'b', data_vencimento: '2026-09-20', status: 'parcial', valor: 500.5, valor_pago: 200.25 }),
    T({ id: 'c', data_vencimento: '2026-10-30', status: 'aberto', valor: 300, valor_pago: null }),
    T({ id: 'd', data_vencimento: '2026-10-05', status: 'cancelado', valor: 999, valor_pago: 0 }),
    T({ id: 'e', data_vencimento: '2026-10-06', status: 'renegociado', valor: 50, valor_pago: 0 }),
  ]
  ok(situacao(linhas[0], hoje) === 'Quitado' && situacao(linhas[1], hoje) === 'Parcial (vencido)' && situacao(linhas[2], hoje) === 'Em aberto'
    && situacao(linhas[3], hoje) === 'Cancelado' && situacao(T({ data_vencimento: '2026-10-01' }), hoje) === 'Vencido', 'situação de cada título')
  const r = resumoTitulos(linhas, hoje)
  ok(r.length === 2 && r[0].mes === '2026-09' && r[0].valor === 1500.5 && r[0].pago === 1200.25 && r[0].em_aberto === 300.25 && r[0].vencido === 300.25,
    'resumo setembro: quitado fora do aberto; parcial vencido = 300,25')
  ok(r[1].titulos === 3 && r[1].valor === 300 && r[1].em_aberto === 300 && r[1].vencido === 0, 'resumo outubro: cancelado/renegociado não somam; a vencer não é vencido')
  const buf = await montarPlanilhaTitulos(linhas, { tipo: 'receber', empresa: 'Teste', titulo: 'Contas a receber', dataInicio: '2026-09-01', dataFim: '2026-10-31', geradoEm: new Date('2026-10-17T12:00:00Z'), hoje })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as unknown as ArrayBuffer)
  const wt = wb.getWorksheet('Títulos')
  const wr = wb.getWorksheet('Resumo')
  ok(!!wt && wt.rowCount === 1 + linhas.length && wt.getRow(1).getCell(2).value === 'Cliente', 'aba Títulos: um título por linha, coluna Cliente no receber')
  ok(!!wt && wt.getRow(2).getCell(1).value === '10/09/2026', 'aba Títulos: em ordem de vencimento')
  const total = wr?.getRow(4)
  ok(!!total && total.getCell(1).value === 'Total' && total.getCell(3).value === 1800.5 && total.getCell(5).value === 600.25, 'aba Resumo: total 1.800,50 e em aberto 600,25')

  if (falhas) { console.error(`\n[check-relatorio-telas-pesadas] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
  console.log('\n[check-relatorio-telas-pesadas] botão nas telas pesadas e gerador de pagar/receber conferidos.')
}

main().catch((e) => { console.error(e); process.exit(1) })
