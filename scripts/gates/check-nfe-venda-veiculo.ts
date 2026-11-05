/**
 * Gate (#5684): NF-e da venda de veículo (Revenda · Caminho A). Cálculo puro do item (ICMS CST 20 com redução de base,
 * cBenef, IBS/CBS, bloco do veículo só quando o perfil exige) + amarras do emissor do GE (sem emissor paralelo, sem
 * fn_faturar, grava veic_venda.nfe_id, campos opcionais que não mudam o fluxo atual).
 */
import { readFileSync } from 'node:fs'
import { montarItemVeiculo, cstRegimeNormal, codigoCombustivel, type DadosVendaVeiculo } from '../../src/lib/fiscal/nfe-veiculo'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const base: DadosVendaVeiculo = {
  vendaId: 'v1', nfeIdAtual: null, nfeStatusAtual: null, valorVenda: 100000, numeroVenda: '1', clienteId: 'c1', receberId: 'r1',
  veiculo: { id: 'x', chassi: '9BWZZZ377VT004251', placa: 'TST1A23', renavam: '123456789', marca: 'TESTE', modelo: 'HOMOLOGACAO', versao: null,
    anoFabricacao: 2020, anoModelo: 2021, cor: 'Preto', combustivel: 'Flex', potenciaCv: 120, cilindradas: 1600, lugares: 5, kmAtual: 40000, ncm: '87032310' },
  perfil: { veicprodObrigatorioUsado: false, ncmPadrao: '87032210', pisPct: null, cofinsPct: null, icmsSaidaPct: null,
    operacao: { cfopDentroUf: '5102', cfopForaUf: '6102', cstOuCsosn: '020', cbenef: 'SC820019', reducaoBasePct: 95,
      ibsCbsCst: '000', ibsCbsCClassTrib: '000001', naturezaOperacao: '', infComplementar: null } },
}

const m = montarItemVeiculo(base, 'SC', 'SC', false)
ok(m.item.icms?.cst === '20' && cstRegimeNormal('020') === '20', 'CST 020 do perfil vira 20 (regime normal)')
ok(m.item.icms?.base === 5000 && m.item.icms?.valor === 600 && m.item.icms?.aliquota === 12, 'R$ 100.000 · redução 95% · 12% → base 5.000, ICMS 600')
ok(m.item.icms?.reducaoBase === 95 && m.item.icms?.cBenef === 'SC820019' && m.item.icms?.modBc === '3', 'pRedBC 95, cBenef SC820019, modBC 3')
ok(m.item.cfop === '5102' && montarItemVeiculo(base, 'SC', 'PR', false).item.cfop === '6102', 'CFOP 5102 dentro da UF, 6102 fora')
ok(m.item.ncm === '87032310', 'NCM do veículo tem prioridade sobre o padrão do perfil')
ok(montarItemVeiculo({ ...base, veiculo: { ...base.veiculo, ncm: null } }, 'SC', 'SC', false).item.ncm === '87032210', 'sem NCM no veículo → padrão do perfil aprovado')
ok(m.item.ibsCbs?.cst === '000' && m.item.ibsCbs?.cClassTrib === '000001' && m.item.ibsCbs?.cbsValor === 900 && m.item.ibsCbs?.ibsUfValor === 100, 'IBS/CBS 000/000001 com alíquotas de teste 2026')
ok(m.naturezaOperacao === 'Venda de veículo usado', 'natureza em branco → "Venda de veículo usado"')
ok(m.item.veiculo === undefined && /RENAVAM: 123456789/.test(m.observacoes) && /Placa: TST1A23/.test(m.observacoes) && /Chassi: 9BWZZZ377VT004251/.test(m.observacoes), 'perfil não exige veicProd: RENAVAM/placa/chassi vão nas informações complementares')
const exig = montarItemVeiculo({ ...base, perfil: { ...base.perfil, veicprodObrigatorioUsado: true } }, 'SC', 'SC', false)
ok(exig.item.veiculo?.chassi === '9BWZZZ377VT004251' && exig.item.veiculo?.tipoCombustivel === '16' && exig.avisos.length > 0, 'perfil exige veicProd: envia o que existe e avisa o que falta')
ok(codigoCombustivel('Gasolina') === '02' && codigoCombustivel('Diesel') === '03' && codigoCombustivel('Elétrico') === null, 'combustível: só mapeia o que é exato')
let erro = ''
try { montarItemVeiculo({ ...base, valorVenda: 0 }, 'SC', 'SC', false) } catch (e) { erro = (e as Error).message }
ok(/sem valor/.test(erro), 'venda sem valor não emite')
erro = ''
try { montarItemVeiculo({ ...base, veiculo: { ...base.veiculo, ncm: null }, perfil: { ...base.perfil, ncmPadrao: null } }, 'SC', 'SC', false) } catch (e) { erro = (e as Error).message }
ok(/NCM/.test(erro), 'sem NCM (nem padrão) não emite — nunca inventa')

const rota = readFileSync('src/app/api/fiscal/nfe/emitir/route.ts', 'utf8')
const builder = readFileSync('src/lib/fiscal/nfe-builder.ts', 'utf8')
const focus = readFileSync('src/lib/fiscal/providers/focusnfe.ts', 'utf8')
const loader = readFileSync('src/lib/fiscal/nfe-veiculo.ts', 'utf8')
const tela = readFileSync('src/app/dashboard/revenda/vendas/page.tsx', 'utf8')
ok(/\.update\(\{ nfe_id: registroId \}\)/.test(rota) && /vendaVeic\.vendaId/.test(rota), 'rota grava veic_venda.nfe_id')
ok(/nfeStatusAtual === 'autorizada'/.test(rota), 'rota recusa venda que já tem NF-e autorizada/processando (sem duplicar)')
const loaderCodigo = loader.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
ok(!/fn_faturar|baixar_estoque|erp_pedidos/.test(loaderCodigo), 'caminho A: sem fn_faturar, sem pedido paralelo, sem baixa de estoque')
ok(/veic_venda_recebimento/.test(loader) && /body\.erpReceberId = vendaVeic\.receberId/.test(rota), 'nota ligada ao título que a venda já criou (erp_receber)')
ok(/input\.vendaVeiculo/.test(builder) && /veiculoMontado \? \[veiculoMontado\.item\] : itensNFe/.test(builder), 'builder: modo novo opcional; itens atuais intocados')
ok(/\.\.\.\(item\.veiculo \?/.test(focus) && /\.\.\.\(item\.ibsCbs \?/.test(focus) && /item\.icms\?\.reducaoBase != null/.test(focus) && !/veiculo_renavam/.test(focus), 'provider: campos opcionais da Focus, sem campo RENAVAM')
ok(/emitirNfe\(v\)/.test(tela) && /revenda\.vendas\.emitir_nfe/.test(tela), 'tela: botão Emitir NF-e com "?"')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nOK')
