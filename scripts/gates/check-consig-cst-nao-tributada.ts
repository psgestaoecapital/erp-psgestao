/**
 * Gate · Consignação CST 41 (spec 26/11 · Code: rodrigo-manual): o grupo ICMS do item é montado ESTRITAMENTE pelo CST.
 * pRedBC (redução) e cBenef só saem na CST 20; numa CST não tributada (40/41/50/60) o grupo leva só o CST — mesmo que
 * o perfil traga redução/cBenef sobrando (pacote do CST 20). Assim o XML da consignação (5949, CST 041) sai limpo.
 * Também: a aprovação do perfil bloqueia redução em CST não tributada; a venda CST 20 NÃO regride.
 */
import { readFileSync } from 'node:fs'
import { icmsVeiculoPorCst, cstIcmsNaoTributada, montarItemVeiculo, montarItemVeiculoEntrada, type DadosVendaVeiculo, type DadosEntradaVeiculo } from '../../src/lib/fiscal/nfe-veiculo'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }
const read = (p: string) => readFileSync(p, 'utf8')

// ── helper puro ──────────────────────────────────────────────────────────────────────────────────────────
ok(cstIcmsNaoTributada('41') && cstIcmsNaoTributada('40') && cstIcmsNaoTributada('50') && cstIcmsNaoTributada('60'), 'cstIcmsNaoTributada: 40/41/50/60 = não tributada')
ok(!cstIcmsNaoTributada('20') && !cstIcmsNaoTributada('00'), 'cstIcmsNaoTributada: 20 e 00 = tributadas')

const icms20 = icmsVeiculoPorCst('20', 100000, 12, 95, 'SC820019')
ok(icms20.cst === '20' && icms20.base === 5000 && icms20.valor === 600 && icms20.reducaoBase === 95 && icms20.cBenef === 'SC820019' && icms20.modBc === '3', 'CST 20: base reduzida 95% (5.000), ICMS 600, reducaoBase 95, cBenef SC820019, modBC 3')
const icms41 = icmsVeiculoPorCst('41', 100000, 12, 95, 'SC820019')
ok(icms41.cst === '41' && icms41.cBenef === undefined && icms41.reducaoBase === undefined && icms41.base === undefined && icms41.valor === undefined && icms41.aliquota === undefined, 'CST 41: grupo só com o CST — sem cBenef, sem redução, sem base/valor (mesmo com redução/cBenef sobrando)')

// ── integração: consignação (CST 041) via os dois montadores ──────────────────────────────────────────────
const vendaBase: DadosVendaVeiculo = {
  vendaId: 'v1', nfeIdAtual: null, nfeStatusAtual: null, valorVenda: 100000, numeroVenda: '1', clienteId: 'c1', receberId: 'r1', operacaoNome: 'consignacao_venda',
  veiculo: { id: 'x', chassi: '9BWZZZ377VT004251', placa: 'TST1A23', renavam: '123', marca: 'T', modelo: 'H', versao: null,
    anoFabricacao: 2020, anoModelo: 2021, cor: 'Preto', combustivel: 'Flex', potenciaCv: 120, cilindradas: 1600, lugares: 5, kmAtual: 40000, ncm: '87032310' },
  perfil: { veicprodObrigatorioUsado: false, ncmPadrao: '87032210', pisPct: 0.65, cofinsPct: 3, icmsSaidaPct: null,
    operacao: { cfopDentroUf: '5949', cfopForaUf: '6949', cstOuCsosn: '041', cbenef: 'SC820019', reducaoBasePct: 95,
      ibsCbsCst: null, ibsCbsCClassTrib: null, naturezaOperacao: 'Venda de veículo em consignação', infComplementar: null } },
}
const mv = montarItemVeiculo(vendaBase, 'SC', 'SC', false)
ok(mv.item.icms?.cst === '41' && mv.item.icms?.cBenef === undefined && mv.item.icms?.reducaoBase === undefined && mv.item.icms?.base === undefined, 'consignacao_venda (CST 041): item sai sem cBenef nem redução')

const entradaBase: DadosEntradaVeiculo = {
  veiculoId: 'v1', operacao: 'compra_pf', valor: 50000,
  veiculo: { id: 'x', chassi: '9BWZZZ377VT004251', placa: 'ABC1D23', renavam: '9', marca: 'VW', modelo: 'Gol', versao: null,
    anoFabricacao: 2018, anoModelo: 2019, cor: 'Branco', combustivel: 'Flex', potenciaCv: 100, cilindradas: 1600, lugares: 5, kmAtual: 60000, ncm: '87032310' },
  remetente: { tipo: 'pf', nome: 'Joao', documento: '52998224725', endereco: { logradouro: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'Criciuma', uf: 'SC', cep: '88800000' } },
  perfil: { veicprodObrigatorioUsado: false, ncmPadrao: '87032210',
    operacao: { cfopDentroUf: '1949', cfopForaUf: '2949', cstOuCsosn: '041', cbenef: 'SC820019', reducaoBasePct: 95,
      ibsCbsCst: null, ibsCbsCClassTrib: null, naturezaOperacao: 'Retorno de consignação', infComplementar: null } },
  avisos: [],
}
const me = montarItemVeiculoEntrada(entradaBase, 'SC', 'SC')
ok(me.item.icms?.cst === '41' && me.item.icms?.cBenef === undefined && me.item.icms?.reducaoBase === undefined && me.item.icms?.base === undefined, 'consignacao_retorno/entrada (CST 041): item sai sem cBenef nem redução')

// não regride: CST 20 continua com cBenef + redução
const venda20 = montarItemVeiculo({ ...vendaBase, operacaoNome: 'venda', perfil: { ...vendaBase.perfil, operacao: { ...vendaBase.perfil.operacao, cfopDentroUf: '5102', cfopForaUf: '6102', cstOuCsosn: '020' } } }, 'SC', 'SC', false)
ok(venda20.item.icms?.cst === '20' && venda20.item.icms?.cBenef === 'SC820019' && venda20.item.icms?.reducaoBase === 95, 'venda CST 20 não regride: mantém cBenef SC820019 + redução 95')

// ── migration: só a guarda na aprovação (ajuste 27/11: NÃO altera dado de perfil) ───────────────────────────
const mig = read('supabase/migrations/20261128134230_consig_cst41_cbenef_reducao.sql')
ok(/CREATE OR REPLACE FUNCTION public\.fn_veic_perfil_fiscal_aprovar/.test(mig), 'migration: reescreve fn_veic_perfil_fiscal_aprovar')
ok(/cst_nao_tributada_com_reducao/.test(mig) && /reducao_base_icms_pct, 0\) <> 0/.test(mig), 'migration: aprovação bloqueia redução em CST não tributada')
// decisão do sócio: nenhuma alteração de cadastro/dado de perfil nesta PR.
ok(!/UPDATE public\.veic_perfil_fiscal_operacao/.test(mig) && !/SET cbenef = NULL/.test(mig) && !/perfil_fiscal_op_corrigida_cst41/.test(mig), 'migration: NÃO limpa/altera dado de perfil (só a guarda na aprovação)')
ok(!/9e012009-2058-4fff-b1c8-0f0cefa23db8/.test(mig), 'migration: não referencia o perfil de nenhuma empresa específica')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nOK')
