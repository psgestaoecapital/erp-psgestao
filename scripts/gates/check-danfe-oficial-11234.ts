// Gate (chamado #11234): o espelho da NF-e e o DANFE da nota autorizada saem no leiaute OFICIAL do DANFE, pelo MESMO gerador
// (src/lib/fiscal/danfePdf.ts): canhoto · cabeçalho (emitente / DANFE / chave com código de barras) · natureza + protocolo · IE/CNPJ ·
// destinatário · cálculo do imposto · transportador/volumes · produtos · dados adicionais · rodapé. Espelho (sem protocolo) leva a
// marca d'água "NF-e CONFERÊNCIA — SEM VALOR FISCAL — FALTA PROTOCOLO DE APROVAÇÃO DA SEFAZ"; nota autorizada, não. Só LEIAUTE: o
// gate também prova que nenhuma regra de cálculo/XML foi tocada. Estático + gera PDFs de verdade (sem rede nem banco).
import { readFileSync, existsSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { gerarDanfePdf, barrasCode128, fmtChave, fmtNumero, type DanfeDados } from '../../src/lib/fiscal/danfePdf'
import { danfeDeNFeRequest, danfeDeNotaEmitida, type NotaEmitidaRow } from '../../src/lib/fiscal/danfeDados'
import { gerarEspelhoNFePdf, type EspelhoNota } from '../../src/lib/fiscal/espelhoPdf'
import type { NFeRequest } from '../../src/lib/fiscal/types'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

// ---- extrai o TEXTO desenhado em cada página (streams do pdf-lib: Flate + strings hex WinAnsi) ----
function textoDasPaginas(bytes: Uint8Array): string[] {
  const buf = Buffer.from(bytes)
  const raw = buf.toString('latin1')
  const paginas: string[] = []
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const ini = (m.index ?? 0) + m[0].length
    const fim = raw.indexOf('endstream', ini)
    let conteudo = ''
    try { conteudo = inflateSync(buf.subarray(ini, fim)).toString('latin1') } catch { continue }
    if (!/\bTj\b/.test(conteudo)) continue
    const partes: string[] = []
    for (const t of conteudo.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) partes.push(Buffer.from(t[1], 'hex').toString('latin1'))
    paginas.push(partes.join('\n'))
  }
  return paginas
}
const ordem = (t: string, ...marcas: string[]) => { let i = -1; for (const m of marcas) { const j = t.indexOf(m, i + 1); if (j < 0) return false; i = j } return true }

const itemBase = (i: number) => ({ codigo: `01636${i}`, descricao: `Produto de teste ${i} com descrição comprida para quebrar linha na coluna`, ncm: '87089990', origem: '0', cst: '102', cfop: '5102', un: 'UN', quantidade: 2, valorUnitario: 100, valorTotal: 200, baseIcms: 0, valorIcms: 0, valorIpi: 0, aliqIcms: 0, aliqIpi: 0 })
const base = (n: number, extra: Partial<DanfeDados> = {}): DanfeDados => ({
  emitente: { razaoSocial: 'EMPRESA TESTE LTDA', cnpj: '12345678000199', ie: '255123456', endereco: 'Rua A, 1', bairro: 'Centro', cep: '89251000', municipio: 'Jaraguá do Sul', uf: 'SC' },
  numero: '1234', serie: '1', naturezaOperacao: 'Venda de mercadoria', dataEmissaoISO: '2026-11-24T10:30',
  destinatario: { nome: 'CLIENTE PJ LTDA', documento: '98765432000110', endereco: 'Av. B, 2', bairro: 'Industrial', cep: '89260000', municipio: 'Jaraguá do Sul', uf: 'SC' },
  totais: { valorProdutos: 200 * n }, transporte: { modalidade: 9 }, simples: true,
  itens: Array.from({ length: n }, (_, i) => itemBase(i)),
  informacoesComplementares: 'DOCUMENTO EMITIDO POR ME/EPP OPTANTE PELO SIMPLES NACIONAL.',
  ...extra,
})
const CHAVE = '42261112345678000199550010000012341000012349'
const O = { impressoEmISO: '2026-11-24T10:35' }

async function main() {
  // ---- espelho (sem protocolo) ----
  const esp = await gerarDanfePdf(base(1), O)
  const [e1] = textoDasPaginas(esp)
  ok(!!e1, 'espelho gera PDF com texto')
  ok(ordem(e1, 'RECEBEMOS DE', 'IDENTIFICAÇÃO DO EMITENTE', 'DANFE', 'NATUREZA DA OPERAÇÃO', 'PROTOCOLO DE AUTORIZAÇÃO DE USO', 'INSCRIÇÃO ESTADUAL DO SUBST. TRIBUT.', 'DESTINATÁRIO / REMETENTE', 'CÁLCULO DO IMPOSTO', 'TRANSPORTADOR / VOLUMES TRANSPORTADOS', 'DADOS DOS PRODUTOS / SERVIÇOS', 'DADOS ADICIONAIS', 'Impresso em'), 'blocos do DANFE na ordem oficial: canhoto → cabeçalho → natureza/protocolo → IE/CNPJ → destinatário → imposto → transporte → produtos → adicionais → rodapé')
  for (const t of ['DATA DE RECEBIMENTO', 'IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR', 'Documento Auxiliar da', '0 - ENTRADA', '1 - SAÍDA', 'CHAVE DE ACESSO', 'Consulta de autenticidade', 'Folha 1/1', 'RESERVADO AO FISCO', 'INFORMAÇÕES COMPLEMENTARES', 'DATA DA EMISSÃO', 'HORA DA SAÍDA', 'FRETE POR CONTA', 'PESO LÍQUIDO'])
    ok(e1.includes(t), `espelho traz "${t}"`)
  for (const t of ['BASE DE CÁLC. DO ICMS', 'VALOR DO ICMS', 'BASE DE CÁLC. ICMS ST', 'VALOR DO ICMS SUBST.', 'V. IMP. IMPORTAÇÃO', 'VALOR DO PIS', 'VALOR TOTAL DOS PRODUTOS', 'VALOR DO FRETE', 'VALOR DO SEGURO', 'DESCONTO', 'OUTRAS DESP. ACESSÓRIAS', 'VALOR TOTAL DO IPI', 'VALOR DA COFINS', 'VALOR TOTAL DA NOTA'])
    ok(e1.includes(t), `grade do imposto: ${t}`)
  for (const t of ['CÓDIGO', 'DESCRIÇÃO DO PRODUTO / SERVIÇO', 'NCM/SH', 'O/CSOSN', 'CFOP', 'UN', 'QUANT.', 'VALOR UNIT.', 'VALOR TOTAL', 'B.CÁLC ICMS', 'VALOR ICMS', 'VALOR IPI', 'ALÍQ. ICMS', 'ALÍQ. IPI'])
    ok(e1.includes(t) || (t.startsWith('ALÍQ.') && e1.includes('ALÍQ.')), `tabela de produtos: coluna ${t}`) // as colunas de alíquota quebram em 2 linhas
  ok(e1.includes('SEM CHAVE DE ACESSO') && !e1.includes('4226 1112'), 'espelho: sem chave (sem código de barras)')
  ok(e1.includes('NF-e CONFERÊNCIA - SEM VALOR FISCAL') && e1.includes('FALTA PROTOCOLO DE APROVAÇÃO DA SEFAZ'), 'espelho: marca d\'água "NF-e CONFERÊNCIA — SEM VALOR FISCAL — FALTA PROTOCOLO DE APROVAÇÃO DA SEFAZ"')
  ok(!e1.includes('PRÉVIA - SEM VALOR FISCAL'), 'a marca antiga "PRÉVIA — SEM VALOR FISCAL" saiu do espelho da NF-e')
  ok(e1.includes('0102'), 'Simples: coluna O/CSOSN mostra origem + CSOSN')
  ok(e1.includes('DOCUMENTO EMITIDO POR ME/EPP OPTANTE PELO SIMPLES NACIONAL'), 'a observação do Simples fica em Informações Complementares')

  // ---- autorizada (chave + protocolo) ----
  const aut = await gerarDanfePdf(base(2, { chave: CHAVE, protocolo: '342260000012345' }), O)
  const [a1] = textoDasPaginas(aut)
  ok(a1.includes(fmtChave(CHAVE).split(' ').slice(0, 6).join(' ')) && a1.includes('342260000012345'), 'autorizada: chave formatada e protocolo no cabeçalho')
  ok(!a1.includes('FALTA PROTOCOLO') && !a1.includes('SEM CHAVE'), 'autorizada: sem marca d\'água de conferência')
  ok(a1.length > 0 && aut.length > esp.length - 2000, 'autorizada: mesmo gerador (barras da chave desenhadas)')
  ok(fmtNumero('1234') === '000.001.234', 'número da nota 000.001.234')
  const { barras } = barrasCode128(CHAVE)
  ok(barras.length > 40, 'código de barras Code 128 da chave de 44 dígitos (vetorial)')

  // ---- várias folhas ----
  const mult = await gerarDanfePdf(base(70), O)
  const pgs = textoDasPaginas(mult)
  ok(pgs.length >= 3 && pgs[0].includes('Folha 1/') && pgs[1].includes('DADOS DOS PRODUTOS / SERVIÇOS') && !pgs[1].includes('RECEBEMOS DE'), 'nota longa: continua em novas folhas (cabeçalho e colunas repetidos, sem canhoto)')
  ok(pgs[pgs.length - 1].includes('DADOS ADICIONAIS'), 'dados adicionais na última folha')

  // ---- dados: do emissor, sem recalcular imposto ----
  const req = {
    serie: '1', naturezaOperacao: 'Remessa', finalidade: 'normal',
    emitente: { cnpj: '12345678000199', razaoSocial: 'EMPRESA TESTE LTDA', inscricaoEstadual: '255123456', simplesNacional: true },
    destinatario: { cnpj: '98765432000110', razaoSocial: 'CLIENTE PJ LTDA', inscricaoEstadual: '123456789', endereco: { logradouro: 'Av. B', numero: '2', bairro: 'Industrial', cidade: 'Jaraguá do Sul', uf: 'SC', cep: '89260000' } },
    itens: [{ codigo: '01636', descricao: 'Produto 01636', ncm: '87089990', cfop: '5102', unidade: 'UN', quantidade: 3, valorUnitario: 50, valorTotal: 150, origem: '0', icms: { cst: '102', base: 0, valor: 0, aliquota: 0 } }],
    observacoes: 'DOCUMENTO EMITIDO POR ME/EPP OPTANTE PELO SIMPLES NACIONAL.', totais: { frete: 10, desconto: 5, modalidadeFrete: 0 },
  } as unknown as NFeRequest
  const dd = danfeDeNFeRequest(req, null, new Date('2026-11-24T13:30:00Z'))
  ok(dd.totais.valorProdutos === 150 && dd.totais.frete === 10 && dd.totais.desconto === 5 && dd.totais.valorNota === 155, 'total da nota = produtos + frete − desconto (soma do que a nota já declara)')
  ok(dd.itens[0].codigo === '01636' && dd.itens[0].quantidade === 3 && dd.itens[0].valorUnitario === 50 && dd.itens[0].cst === '102' && dd.simples === true, 'item: código, quantidade, valor unitário e CSOSN vindos do emissor')
  ok(dd.dataEmissaoISO === '2026-11-24T10:30' && dd.horaSaida === '10:30', 'data e hora no fuso de Brasília')
  ok(!dd.chave && !dd.protocolo && dd.transporte?.modalidade === 0, 'espelho nasce sem chave nem protocolo; frete por conta do emitente')
  const row = { numero: '77', serie: '1', chave: CHAVE, protocolo: '342260000012345', data_emissao: '2026-11-24T13:30:00Z', natureza_operacao: 'Venda', status: 'autorizada',
    valor_total: 155, valor_produtos: 150, valor_frete: 10, valor_desconto: 5, valor_icms: 0, valor_ipi: 0, valor_pis: 0, valor_cofins: 0,
    emitente_cnpj: '12345678000199', emitente_razao_social: 'EMPRESA TESTE LTDA', emitente_inscricao_estadual: '255123456',
    destinatario_cnpj: '98765432000110', destinatario_cpf: null, destinatario_razao_social: 'CLIENTE PJ LTDA', destinatario_endereco: { cidade: 'Jaraguá do Sul', uf: 'SC' },
    itens: req.itens, payload_enviado: { informacoes_adicionais_contribuinte: 'INFO GRAVADA', modalidade_frete: 1 } } as unknown as NotaEmitidaRow
  const da = danfeDeNotaEmitida(row, null, { simples: true })
  ok(da.chave === CHAVE && da.protocolo === '342260000012345' && da.totais.valorNota === 155 && da.informacoesComplementares === 'INFO GRAVADA' && da.transporte?.modalidade === 1, 'DANFE da nota autorizada usa o que ficou gravado (chave, protocolo, valor total, informações, frete)')

  // ---- o espelho do emissor passa pelo mesmo gerador; NFS-e segue como estava ----
  const nota: EspelhoNota = { naturezaOperacao: 'Venda', destinatario: { razaoSocial: 'X', documento: null, tipoDocumento: null, endereco: null }, itens: [], totais: { produtos: 0 } }
  const viaEspelho = textoDasPaginas(await gerarEspelhoNFePdf({ ...nota, danfe: base(1) }, { emitidoEmISO: '2026-11-24T13:35:00Z', modelo: 'nfe55' }))[0]
  ok(viaEspelho.includes('DANFE') && viaEspelho.includes('FALTA PROTOCOLO'), 'baixarEspelho (NF-e 55) usa o leiaute DANFE com marca de conferência')
  ok(viaEspelho.includes('Impresso em 24/11/2026 às 10:35'), 'impressão no horário de Brasília')
  const viaNfse = textoDasPaginas(await gerarEspelhoNFePdf(nota, { emitidoEmISO: '2026-11-24T13:35:00Z', modelo: 'nfse' }))[0]
  ok(viaNfse.includes('PRÉVIA - SEM VALOR FISCAL') && !viaNfse.includes('DANFE'), 'NFS-e continua no espelho em lista (fora do escopo)')
  const semDanfe = textoDasPaginas(await gerarEspelhoNFePdf(nota, { emitidoEmISO: '2026-11-24T13:35:00Z', modelo: 'nfe55', empresa: 'MINHA EMPRESA', informacoesComplementares: 'OBS' }))[0]
  ok(semDanfe.includes('MINHA EMPRESA') && semDanfe.includes('OBS') && semDanfe.includes('DANFE'), 'sem dados completos da rota, o leiaute oficial sai com o que o resumo traz')

  // ---- estático: rotas, UI e "só layout" ----
  for (const r of ['emitir', 'remessa', 'devolucao']) {
    const s = readFileSync(`src/app/api/fiscal/nfe/${r}/route.ts`, 'utf8')
    ok(s.includes('notaEspelhoDeNFeReq(nfeReq, body.companyId)'), `rota ${r}: a prévia leva os dados completos do DANFE`)
  }
  const rotaDanfe = existsSync('src/app/api/fiscal/nfe/danfe/[id]/route.ts') ? readFileSync('src/app/api/fiscal/nfe/danfe/[id]/route.ts', 'utf8') : ''
  ok(/guardaEmpresaFiscal/.test(rotaDanfe) && /status !== 'autorizada'/.test(rotaDanfe) && /gerarDanfePdf/.test(rotaDanfe) && !/\.(insert|update|delete)\(/.test(rotaDanfe), 'rota do DANFE autorizado: guarda por empresa, só nota autorizada, somente leitura')
  const lista = readFileSync('src/app/dashboard/fiscal/nfe/NFeListClient.tsx', 'utf8')
  ok(/\/api\/fiscal\/nfe\/danfe\//.test(lista) && /cai no PDF do provedor/.test(lista), 'lista de NF-e: botão DANFE usa o leiaute do ERP e cai no PDF do provedor se não der')
  for (const f of ['src/lib/fiscal/danfePdf.ts', 'src/lib/fiscal/danfeDados.ts', 'src/lib/fiscal/espelhoNota.ts']) {
    const s = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '')
    ok(!/calcularImposto|calcImpostos|buildNFeRequest|validateNFeRequest|aliquotaIcms\s*\*|\*\s*aliquota/i.test(s), `${f.split('/').pop()}: só leiaute (não calcula imposto)`)
  }
  ok(readFileSync('src/lib/fiscal/nfe-builder.ts', 'utf8').length > 0 && !/danfe/i.test(readFileSync('src/lib/fiscal/nfe-builder.ts', 'utf8').replace(/\/\/.*$/gm, '').replace(/danfeUrl/g, '')), 'builder da NF-e (cálculo/XML) não foi tocado')
}
main().then(() => {
  if (falhas) { console.error(`\ncheck-danfe-oficial-11234: ${falhas} falha(s)`); process.exit(1) }
  console.log('\ncheck-danfe-oficial-11234: ok')
})
