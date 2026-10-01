// Gate (#297 Bradesco · CEO 01/10): consulta de liquidação na API Cobrança — corpo das chamadas igual ao da collection
// oficial (produção) e nenhuma credencial no código. Sem rede.
import { readFileSync } from 'node:fs'
import { identificacaoListagem, dataListagem } from '../../src/lib/banco/bradesco'
import { lerListaLiquidados, lerListaBaixados, lerConsultaTitulo, ddmmaaaaParaIso, chaveNossoNumero } from '../../src/lib/banco/bradesco/leituraCobranca'
import { modoDoHorario } from '../../src/lib/banco/bradesco/executarLiquidacao'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const id = identificacaoListagem({ cnpjBeneficiario: '11.438.390/0001-07', agencia: '2856', conta: '0230114-5', carteira: '09' })
ok(id.cpfCnpj.cpfCnpj === 11438390 && id.cpfCnpj.filial === 1 && id.cpfCnpj.controle === 7, 'cpfCnpj = raiz + filial + controle do CNPJ do beneficiário')
ok(id.negociacao === 28560230114, 'negociação = agência (4) + conta sem dígito (7)')
ok(id.produto === 9, 'produto = carteira')
ok(dataListagem('2026-09-25') === 25092026, 'datas das listagens em DDMMAAAA')

const src = readFileSync('src/lib/banco/bradesco/index.ts', 'utf8')
for (const p of ['/boleto/cobranca-lista/v1/listar', '/boleto/cobranca-consulta/v1/consultar', '/boleto/cobranca-baixado-consulta/v1/listar']) {
  ok(src.includes(`'${p}'`), `serviço ${p}`)
}
ok(/'authorization': token/.test(src) && !/Bearer/.test(src.slice(src.indexOf('consulta de liquidação'))), 'mesmo token do registro, no header Authorization (sem "Bearer")')
ok(!/client_secret\s*[:=]\s*['"][^'"]+['"]/.test(src) && !/senha\s*[:=]\s*['"][^'"]+['"]/i.test(src), 'nenhuma credencial escrita no código (vem do cofre)')

// ── leitura das respostas (exemplos do manual v1.6.3) ──
const liq = lerListaLiquidados({ status: 200, causa: 'CBTT0005 - FIM DE CONSULTA', pagina: 1, indMaisPagina: 'N', titulos: [
  { nossoNumero: 17080004198, dataPagamento: '14062017', valorTitulo: 211398, valorPagamento: 214387, valorOscilacao: 2989, sinalValorOscilacao: '+' }] })
ok(liq.itens[0].nossoNumero === '17080004198' && liq.itens[0].dataPagamento === '2017-06-14', 'liquidados: nosso número e data de pagamento (DDMMAAAA)')
ok(liq.itens[0].valorPago === 2143.87 && liq.itens[0].valorTitulo === 2113.98, 'liquidados: valores em centavos → reais (pago 2.143,87 com juros)')
ok(!liq.maisPaginas && lerListaLiquidados({ pagina: 1, IndicadorMaisPaginas: 'S', titulos: [] }).maisPaginas, 'paginação: indMaisPagina / IndicadorMaisPaginas')
ok(ddmmaaaaParaIso(1062017) === '2017-06-01' && ddmmaaaaParaIso(0) === null, 'data DDMMAAAA sem zero à esquerda e 0 = sem data')
ok(chaveNossoNumero('00062670000004') === chaveNossoNumero(62670000004), 'nosso número casa com ou sem zeros à esquerda')
const bx = lerListaBaixados({ status: 200, pagina: 1, indMaisPagina: 'N', titulos: [
  { nossoNumero: '00000000006', statusTitulo: 57, descricaoStatusTitulo: 'CONFORME SEU PEDIDO', dataBaixa: '20180818', valorPago: 0 },
  { nossoNumero: '00000000007', statusTitulo: 61, descricaoStatusTitulo: 'PAGO', dataBaixa: '20180818', valorPago: 1000 }] })
ok(bx.itens[0].semPagamento && bx.itens[0].dataBaixa === '2018-08-18' && bx.itens[0].nossoNumero === '6', 'baixado "conforme seu pedido" (57) = baixa SEM pagamento')
ok(!bx.itens[1].semPagamento, 'baixado como PAGO (61) não vira "baixado sem pagamento" (a lista de liquidados é que baixa)')
const aberto = lerConsultaTitulo({ status: 200, titulo: { codStatus: 1, status: 'A VENCER / VENCIDO', valMoeda: 509, dtPagto: 0, vlrPagto: 0.0, baixa: { codigo: 0, descricao: '', data: 0 } } })
ok(aberto.ok && !aberto.pago && !aberto.baixaSemPagamento && !aberto.pagoSemValor, 'consulta individual: a vencer/vencido = nada a fazer')
const pagoDia = lerConsultaTitulo({ status: 200, titulo: { codStatus: 13, status: 'PAGO NO DIA', valMoeda: 150, dtPagto: 1102026, vlrPagto: 150 } })
ok(pagoDia.pago && pagoDia.dataPagamento === '2026-10-01' && pagoDia.valorPago === 1.5, 'consulta individual: 13 PAGO NO DIA com data e valor → baixa (R$ 1,50)')
const pagoSemValor = lerConsultaTitulo({ status: 200, titulo: { codStatus: 13, valMoeda: 150, dtPagto: 0, vlrPagto: 0 } })
ok(!pagoSemValor.pago && pagoSemValor.pagoSemValor, 'PAGO NO DIA sem valor ainda não baixa (vai pela lista das 7h)')
const baixadoPedido = lerConsultaTitulo({ status: 200, titulo: { codStatus: 57, status: 'CONFORME SEU PEDIDO', valMoeda: 150, dtPagto: 0, vlrPagto: 0, baixa: { codigo: 57, descricao: 'CONFORME SEU PEDIDO', data: 30092026 } } })
ok(!baixadoPedido.pago && baixadoPedido.baixaSemPagamento?.codigo === 57 && baixadoPedido.baixaSemPagamento.data === '2026-09-30', 'baixado no banco sem pagamento → marca o boleto, não paga o título')
ok(!lerConsultaTitulo({ status: 412, causa: 'CBTT0552 - TITULO INEXISTENTE' }).ok, 'erro do banco vira erro registrado (não baixa nada)')
ok(modoDoHorario(new Date('2026-10-01T10:00:00Z')) === 'lista' && modoDoHorario(new Date('2026-10-01T16:00:00Z')) === 'individual', '7h de Brasília = lista; 13h = consulta individual')

// ── banco ──
const mig = readFileSync('supabase/migrations/20261002120000_boleto_bradesco_liquidacao.sql', 'utf8').replace(/--[^\n]*/g, '')
ok(mig.includes('public.fn_boleto_liquidar(p_company_id, p_nosso_numero, p_data_pagamento, p_valor_pago'), 'baixa pelo caminho de sempre (fn_boleto_liquidar: idempotente, conta do banco do boleto)')
ok(/IF v_dif > 0\.01 THEN\s+UPDATE erp_receber SET juros = v_dif/.test(mig), 'pago acima do valor → juros registrados')
ok(mig.includes("'pago_a_menor'"), 'pago abaixo do valor → sinalizado (não vira desconto por conta própria)')
ok(/SET boleto_status = 'baixado_banco'/.test(mig) && !/fn_receber_baixar_pagamento/.test(mig.slice(mig.indexOf('fn_boleto_marcar_baixado_banco'))), 'baixado no banco: marca o boleto e NÃO baixa o título como pago')
ok(!/DELETE\s+FROM/i.test(mig), 'nada é apagado')
const rota = readFileSync('src/app/api/boleto/sync-liquidacao/route.ts', 'utf8')
ok(rota.includes("[...BANCOS_COM_CONSULTA, BANCO_BRADESCO]") && rota.includes('executarBradesco(alvo.company_id'), 'Bradesco entra na rotina das 7h/13h e no botão')
const exec = readFileSync('src/lib/banco/bradesco/executarLiquidacao.ts', 'utf8')
ok(exec.includes("from('erp_certificados_a1')") && exec.includes("fn_banco_obter_credencial"), 'mesma credencial do registro (cofre + A1 da empresa)')

if (falhas) { console.error(`\ncheck-bradesco-liquidacao: ${falhas} falha(s)`); process.exit(1) }
console.log('\nBradesco · consulta de liquidação: ok')
