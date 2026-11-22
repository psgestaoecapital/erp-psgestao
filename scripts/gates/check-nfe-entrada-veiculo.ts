/**
 * Gate (#9787 marco 2): montagem PURA do item da NF-e de ENTRADA do veículo (compra PF/PJ, troca-entrada) em prévia.
 * CFOP/CST/natureza vêm do PERFIL fiscal aprovado (não hardcode); CST≠20 (ex.: compra PF 41) → sem ICMS calculado;
 * CST 20 → redução de base. Recusa sem valor/NCM/CFOP/natureza. A rota força apenasPrevia (não transmite) — provado
 * aqui que a rota recusa entrada sem apenasPrevia e que o builder tem o ramo entradaVeiculo.
 */
import { readFileSync } from 'node:fs'
import { montarItemVeiculoEntrada, OPERACOES_ENTRADA_PREVIA, type DadosEntradaVeiculo } from '../../src/lib/fiscal/nfe-veiculo'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const base: DadosEntradaVeiculo = {
  veiculoId: 'v1', operacao: 'compra_pf', valor: 50000,
  veiculo: { id: 'x', chassi: '9BWZZZ377VT004251', placa: 'ABC1D23', renavam: '999', marca: 'VW', modelo: 'Gol', versao: null,
    anoFabricacao: 2018, anoModelo: 2019, cor: 'Branco', combustivel: 'Flex', potenciaCv: 100, cilindradas: 1600, lugares: 5, kmAtual: 60000, ncm: '87032310' },
  remetente: { tipo: 'pf', nome: 'Joao Vendedor', documento: '52998224725',
    endereco: { logradouro: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'Criciuma', uf: 'SC', cep: '88800000' } },
  perfil: { veicprodObrigatorioUsado: false, ncmPadrao: '87032210',
    operacao: { cfopDentroUf: '1102', cfopForaUf: '2102', cstOuCsosn: '041', cbenef: null, reducaoBasePct: null,
      ibsCbsCst: null, ibsCbsCClassTrib: null, naturezaOperacao: 'Compra de veículo usado de pessoa física', infComplementar: null } },
  avisos: [],
}

ok(OPERACOES_ENTRADA_PREVIA.length === 3 && OPERACOES_ENTRADA_PREVIA.includes('compra_pf') && OPERACOES_ENTRADA_PREVIA.includes('compra_pj') && OPERACOES_ENTRADA_PREVIA.includes('troca_entrada'), 'operações de entrada da prévia = compra_pf, compra_pj, troca_entrada')

const m = montarItemVeiculoEntrada(base, 'SC', 'SC')
ok(m.item.cfop === '1102', 'CFOP dentro da UF vem do perfil (1102)')
ok(montarItemVeiculoEntrada(base, 'SC', 'PR').item.cfop === '2102', 'CFOP fora da UF vem do perfil (2102)')
ok(m.item.icms?.cst === '41' && m.item.icms?.base == null && m.item.icms?.valor == null, 'compra PF CST 41 → sem ICMS calculado (base/valor ausentes)')
ok(m.naturezaOperacao === 'Compra de veículo usado de pessoa física', 'natureza vem do perfil aprovado')
ok(m.item.ncm === '87032310' && m.item.valorTotal === 50000 && m.item.quantidade === 1, 'NCM do veículo, valor de aquisição e qtd 1')
ok(/Chassi: 9BWZZZ377VT004251/.test(m.observacoes) && /Placa: ABC1D23/.test(m.observacoes) && /RENAVAM: 999/.test(m.observacoes), 'dados do veículo nas informações complementares')

// CST 20 (caso raro de entrada com redução) → base/valor calculados a partir do perfil
const base20: DadosEntradaVeiculo = { ...base, perfil: { ...base.perfil, operacao: { ...base.perfil.operacao, cstOuCsosn: '020', reducaoBasePct: 95 } } }
const m20 = montarItemVeiculoEntrada(base20, 'SC', 'SC')
ok(m20.item.icms?.cst === '20' && m20.item.icms?.base === 2500 && m20.item.icms?.valor === 300, 'CST 20 do perfil → base reduzida 95% (2.500) e ICMS 12% (300)')

// veicProd quando o perfil exige
ok(montarItemVeiculoEntrada({ ...base, perfil: { ...base.perfil, veicprodObrigatorioUsado: true } }, 'SC', 'SC').item.veiculo?.chassi === '9BWZZZ377VT004251', 'perfil exige veicProd → bloco do veículo no item')

// recusas (nunca inventa)
const pega = (fn: () => unknown) => { try { fn(); return '' } catch (e) { return (e as Error).message } }
ok(/valor de aquisição/.test(pega(() => montarItemVeiculoEntrada({ ...base, valor: 0 }, 'SC', 'SC'))), 'entrada sem valor não monta')
ok(/NCM/.test(pega(() => montarItemVeiculoEntrada({ ...base, veiculo: { ...base.veiculo, ncm: null }, perfil: { ...base.perfil, ncmPadrao: null } }, 'SC', 'SC'))), 'sem NCM (nem padrão) não monta')
ok(/Natureza/.test(pega(() => montarItemVeiculoEntrada({ ...base, perfil: { ...base.perfil, operacao: { ...base.perfil.operacao, naturezaOperacao: '' } } }, 'SC', 'SC'))), 'sem natureza no perfil não monta')
ok(/CFOP/.test(pega(() => montarItemVeiculoEntrada({ ...base, perfil: { ...base.perfil, operacao: { ...base.perfil.operacao, cfopDentroUf: '' } } }, 'SC', 'SC'))), 'sem CFOP no perfil não monta')

// a rota força prévia (sem transmitir) e o builder tem o ramo da entrada
const rota = readFileSync('src/app/api/fiscal/nfe/emitir/route.ts', 'utf8')
const builder = readFileSync('src/lib/fiscal/nfe-builder.ts', 'utf8')
ok(/entradaVeiculoId/.test(rota) && /apenas PRÉVIA neste marco/.test(rota), 'rota: entrada só em prévia (recusa emissão real)')
ok(/input\.entradaVeiculo/.test(builder) && /montarItemVeiculoEntrada/.test(builder), 'builder: ramo entradaVeiculo monta pelo perfil')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nOK')
