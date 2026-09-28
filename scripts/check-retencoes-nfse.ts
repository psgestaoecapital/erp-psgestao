/**
 * Gate de build (#286): a conta das retenções federais da NFS-e Nacional e o JSON que vai para a Focus
 * respeitam as regras de rejeição do leiaute oficial (ANEXO_I-SEFIN_ADN-DPS_NFSe-SNNFSe-v1.01-20260209,
 * aba "RN DPS_NFS-e"). Se alguma regra quebrar, sai com código 1 e QUEBRA O BUILD.
 *
 *   tsx scripts/check-retencoes-nfse.ts
 *
 * Regras cobertas:
 *   E0699  vRetCP > 0 e menor que o valor do serviço
 *   E0700  vRetIRRF > 0 e menor que o valor do serviço
 *   E0720  tpRetPisCofins = 0 proíbe informar vRetCSLL
 *   E0694/E0696  vPis e vCofins = base × alíquota informadas
 *   E0901  cIndOp tem de existir (6 dígitos, Anexo C) — sem ele o grupo IBS/CBS não vai
 *   Linha 314  o grupo piscofins (tpRetPisCofins/vRetCSLL) exige o CST
 */
import { calcularRetencoesFederais, codigoIndicadorOperacaoValido, reformaIbsCbsDoServico, tipoRetencaoPisCofins } from '../src/lib/fiscal/retencoesFederaisNfse'
import { buildNacionalNFSePayload } from '../src/lib/fiscal/providers/focusnfe'
import type { NFSeRequest } from '../src/lib/fiscal/types'

let falhas = 0
function ok(cond: boolean, msg: string) {
  if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`)
}
const c2 = (n: number) => Math.round(n * 100) / 100

// ── Caso FC Pisos NF 421: INSS 11% retido; PIS 0,65% / COFINS 3% de apuração própria (sem CST no cadastro) ──
const fc = calcularRetencoesFederais(98165.70, {
  retem_inss: true, aliquota_inss: 11, retem_pis: false, aliquota_pis: 0.65, retem_cofins: false, aliquota_cofins: 3,
})
ok(fc.valorCp === 10798.23, `FC: INSS 11% de R$ 98.165,70 = R$ 10.798,23 (veio ${fc.valorCp})`)
ok(fc.valorCp > 0 && fc.valorCp < 98165.70, 'E0699: vRetCP > 0 e < valor do serviço')
ok(fc.tipoRetencaoPisCofins === 0 && fc.valorRetCsllAgrupado === 0, 'E0720: nada retido de PIS/COFINS/CSLL → tipo 0 e sem vRetCSLL')
ok(fc.erros.length === 0, 'FC: sem erro (INSS não depende do CST)')
ok(fc.apuracaoPropria === null && fc.avisos.some((a) => /CST do PIS\/COFINS/.test(a)), 'FC sem CST: apuração própria NÃO vai e avisa')

// ── Tabela tpRetPisCofins (0..9) ──
ok(tipoRetencaoPisCofins(false, false, false) === 0, 'tpRet 0 = nenhum')
ok(tipoRetencaoPisCofins(true, true, true) === 3, 'tpRet 3 = PIS/COFINS/CSLL')
ok(tipoRetencaoPisCofins(true, true, false) === 4, 'tpRet 4 = PIS/COFINS, CSLL não')
ok(tipoRetencaoPisCofins(true, false, false) === 5, 'tpRet 5 = só PIS')
ok(tipoRetencaoPisCofins(false, true, false) === 6, 'tpRet 6 = só COFINS')
ok(tipoRetencaoPisCofins(false, true, true) === 7, 'tpRet 7 = COFINS/CSLL')
ok(tipoRetencaoPisCofins(false, false, true) === 8, 'tpRet 8 = só CSLL')
ok(tipoRetencaoPisCofins(true, false, true) === 9, 'tpRet 9 = PIS/CSLL')

// ── PIS+COFINS+CSLL retidos com CST: vRetCSLL = soma; vPis/vCofins = base × alíquota (E0694/E0696) ──
const ret = calcularRetencoesFederais(1000, {
  retem_pis: true, aliquota_pis: 0.65, retem_cofins: true, aliquota_cofins: 3, retem_csll: true, aliquota_csll: 1,
  retem_ir: true, aliquota_ir: 1.5, cst_pis_cofins: '01',
})
ok(ret.valorRetCsllAgrupado === c2(6.5 + 30 + 10), `vRetCSLL = PIS+COFINS+CSLL retidos (46,50; veio ${ret.valorRetCsllAgrupado})`)
ok(ret.tipoRetencaoPisCofins === 3, 'tpRet 3 quando os três são retidos')
ok(ret.valorIrrf === 15 && ret.valorIrrf < 1000, 'E0700: vRetIRRF > 0 e < valor do serviço')
ok(!!ret.apuracaoPropria && ret.apuracaoPropria.valorPis === c2(1000 * 0.65 / 100) && ret.apuracaoPropria.valorCofins === c2(1000 * 3 / 100),
  'E0694/E0696: vPis/vCofins = base × alíquota')

// ── Retenção de PIS/COFINS/CSLL SEM CST → bloqueia (grupo piscofins exige CST, linha 314) ──
const semCst = calcularRetencoesFederais(1000, { retem_pis: true, aliquota_pis: 0.65 })
ok(semCst.erros.some((e) => /CST do PIS\/COFINS/.test(e)), 'retenção de PIS sem CST → erro (não emite pela metade)')

// ── E0699/E0700: retenção >= valor do serviço → erro ──
ok(calcularRetencoesFederais(100, { retem_inss: true, aliquota_inss: 100 }).erros.some((e) => /INSS retido/.test(e)), 'E0699: INSS >= valor → erro')
ok(calcularRetencoesFederais(100, { retem_ir: true, aliquota_ir: 100 }).erros.some((e) => /IR retido/.test(e)), 'E0700: IR >= valor → erro')
ok(calcularRetencoesFederais(100, { retem_inss: true, aliquota_inss: 0 }).erros.length > 0, 'retém INSS sem alíquota → erro')

// ── E0901: cIndOp ──
ok(codigoIndicadorOperacaoValido('020201') && !codigoIndicadorOperacaoValido('') && !codigoIndicadorOperacaoValido('2020') && !codigoIndicadorOperacaoValido(null),
  'E0901: cIndOp só com 6 dígitos (vazio/curto não vai)')

// ── JSON que vai para a Focus ──
const base: NFSeRequest = {
  serie: '1', cnaeServico: '4330405', codigoServico: '070501', descricaoServico: 'Teste', valorServicos: 98165.70,
  prestador: { cnpj: '00000000000191', razaoSocial: 'X', codigoMunicipio: '4209300' },
  tomador: { cnpj: '00000000000272', razaoSocial: 'Y' },
  padraoNacional: true, opcaoSimplesNacional: 3, percentualTribSN: 6,
}
const pFc = buildNacionalNFSePayload({ ...base, retencoesFederais: { valorCp: fc.valorCp, valorIrrf: 0, valorRetCsllAgrupado: 0, tipoRetencaoPisCofins: 0 } })
ok(pFc.valor_cp === 10798.23, 'JSON FC: valor_cp = 10.798,23')
ok(!('valor_csll' in pFc) && !('tipo_retencao_pis_cofins' in pFc), 'JSON FC: sem valor_csll/tipo (E0720 e grupo piscofins sem CST)')
ok(!('valor_irrf' in pFc), 'JSON FC: sem valor_irrf quando não há IR')

const pRet = buildNacionalNFSePayload({
  ...base, valorServicos: 1000,
  retencoesFederais: { valorCp: 0, valorIrrf: ret.valorIrrf, valorRetCsllAgrupado: ret.valorRetCsllAgrupado, tipoRetencaoPisCofins: ret.tipoRetencaoPisCofins },
  apuracaoPisCofins: ret.apuracaoPropria!,
})
ok(pRet.valor_csll === 46.5 && pRet.tipo_retencao_pis_cofins === 3 && pRet.valor_irrf === 15, 'JSON: valor_csll=46,50 · tipo 3 · valor_irrf 15')
ok(pRet.situacao_tributaria_pis_cofins === '01' && pRet.valor_pis === 6.5 && pRet.valor_cofins === 30 && pRet.base_calculo_pis_cofins === 1000,
  'JSON: grupo piscofins com CST, base e vPis/vCofins')

const pIbs = buildNacionalNFSePayload({ ...base, reforma: { finalidadeEmissao: 0, consumidorFinal: 0, indicadorDestinatario: 0, ibsCbsCst: '200', ibsCbsClassifTrib: '200046', codigoIndicadorOperacao: '020201' } })
ok(pIbs.codigo_indicador_operacao === '020201' && pIbs.ibs_cbs_situacao_tributaria === '200', 'JSON: IBS/CBS com cIndOp quando informado')

// ── GABARITO: nota autorizada de referência (NFS-e Nacional cStat 100, 21/09, emitida no Portal Nacional) ──
// Prova do #286 (CEO 28/09): o JSON montado A PARTIR DO CADASTRO DO SERVIÇO, pela MESMA conta da rota, tem de bater
// campo a campo com a nota autorizada. Sem emitir nada (RD-92). Só números — sem identificação do cliente.
// Fonte dos valores: XML autorizado (contexto 675339f1). Mapa JSON → tag pela Focus (campos.focusnfe.com.br/nfse_nacional).
{
  const V = 98165.70
  const cadastro = {   // cadastro do serviço como deve estar: 07.05, INSS 11% retido, PIS 0,65/COFINS 3 próprios, ISS retido
    retem_inss: true, aliquota_inss: 11, retem_ir: false, aliquota_ir: 0,
    retem_pis: false, aliquota_pis: 0.65, retem_cofins: false, aliquota_cofins: 3, retem_csll: false, aliquota_csll: 0,
    cst_pis_cofins: '01', iss_retido: true,
    rt_cst: '000', rt_classificacao_tributaria: '000001', rt_indicador_operacao: '020201',
  }
  const r = calcularRetencoesFederais(V, cadastro)
  const req: NFSeRequest = {
    serie: '1', cnaeServico: '4330405', codigoServico: '070501', descricaoServico: 'Teste', valorServicos: V,
    prestador: { cnpj: '00000000000191', razaoSocial: 'X', codigoMunicipio: '4207650' },
    tomador: { cnpj: '00000000000272', razaoSocial: 'Y' },
    padraoNacional: true, opcaoSimplesNacional: 1, regimeTributario: 'lucro_presumido',
    retemIss: cadastro.iss_retido, codigoNbs: '1.0101.29.00',
    tributosAproxPct: { federal: 13.45, estadual: 0, municipal: 3.15, fonte: 'IBPT 26.2.B' },   // tabela IBPT LC 0705 × SC
  }
  if (r.totalRetido > 0 || r.apuracaoPropria) {   // igual à rota
    req.retencoesFederais = { valorCp: r.valorCp, valorIrrf: r.valorIrrf, valorRetCsllAgrupado: r.valorRetCsllAgrupado, tipoRetencaoPisCofins: r.tipoRetencaoPisCofins }
  }
  if (r.apuracaoPropria) req.apuracaoPisCofins = r.apuracaoPropria
  const ib = reformaIbsCbsDoServico(req.reforma, cadastro)
  req.reforma = ib.reforma
  const p = buildNacionalNFSePayload(req)

  const gabarito: Array<[string, unknown, unknown]> = [
    // [tag da nota autorizada, esperado, JSON montado]
    ['opSimpNac', 1, p.codigo_opcao_simples_nacional],
    ['tribISSQN', 1, p.tributacao_iss],
    ['tpRetISSQN (ISS retido pelo tomador)', 2, p.tipo_retencao_iss],
    ['cNBS', '101012900', String(p.codigo_nbs ?? '').replace(/\D/g, '')],
    ['piscofins/CST', '01', p.situacao_tributaria_pis_cofins],
    ['vBCPisCofins', 98165.70, p.base_calculo_pis_cofins],
    ['pAliqPis', 0.65, p.aliquota_pis],
    ['vPis', 638.08, p.valor_pis],
    ['pAliqCofins', 3, p.aliquota_cofins],
    ['vCofins', 2944.97, p.valor_cofins],
    ['tpRetPisCofins (nada retido)', 0, p.tipo_retencao_pis_cofins],
    ['vRetCP (INSS 11%)', 10798.23, p.valor_cp],
    ['pTotTribFed', 13.45, p.percentual_total_tributos_federais],
    ['pTotTribEst', 0, p.percentual_total_tributos_estaduais],
    ['pTotTribMun', 3.15, p.percentual_total_tributos_municipais],
    ['finNFSe', 0, p.finalidade_emissao],
    ['indFinal', 0, p.consumidor_final],
    ['indDest', 0, p.indicador_destinatario],
    ['cIndOp', '020201', p.codigo_indicador_operacao],
    ['gIBSCBS/CST', '000', p.ibs_cbs_situacao_tributaria],
    ['cClassTrib', '000001', p.ibs_cbs_classificacao_tributaria],
  ]
  for (const [tag, esperado, veio] of gabarito) ok(veio === esperado, `gabarito ${tag}: ${String(esperado)} (veio ${String(veio)})`)
  ok(!('valor_csll' in p) && !('valor_irrf' in p), 'gabarito: sem vRetCSLL (E0720) e sem vRetIRRF — como na nota autorizada')
  ok(!('percentual_aliquota_relativa_municipio' in p), 'gabarito: pAliq não vai — município do Sistema Nacional, a alíquota (3,00) vem parametrizada')
  ok(ib.aviso === null && r.erros.length === 0 && r.avisos.length === 0, 'gabarito: cadastro completo → nenhum erro nem aviso')

  // Totais que o Ambiente Nacional calcula (não vão na DPS) — mesma fórmula que se lê no XML da NF 421 (ISS retido:
  // vTotalRet = vISSQN; vLiq = vServ − vTotalRet): ISS = vBC × 3,00 (alíquota parametrizada de Lages).
  const vIss = c2(V * 3 / 100)
  const vTotalRet = c2(Number(p.valor_cp ?? 0) + Number(p.valor_irrf ?? 0) + Number(p.valor_csll ?? 0) + (p.tipo_retencao_iss === 2 ? vIss : 0))
  ok(vIss === 2944.97, `gabarito vISSQN 2.944,97 (veio ${vIss})`)
  ok(vTotalRet === 13743.20, `gabarito vTotalRet 13.743,20 = INSS + ISS (veio ${vTotalRet})`)
  ok(c2(V - vTotalRet) === 84422.50, `gabarito vLiq 84.422,50 (veio ${c2(V - vTotalRet)})`)
  ok(c2(V - vIss - Number(p.valor_pis) - Number(p.valor_cofins)) === 91637.68, 'gabarito vBC IBS/CBS 91.637,68 = serviço − ISS − PIS − COFINS')
}

if (falhas > 0) { console.error(`\n[check-retencoes-nfse] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-retencoes-nfse] todas as regras de retenção da NFS-e conferidas.')
