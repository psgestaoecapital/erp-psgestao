// Gate · #1944 (Pdois · NFS-e Nacional, IBS/CBS e fuso) — OK do CEO 07/10 16:55: "IBS/CBS só quando cadastrado + fuso
// + configurar NFS-e da Pdois antes de 01/11". Sem rede. Fontes (RD-72): Resolução CGSN 191/2026 (Simples no Emissor
// Nacional desde 01/11/2026); cronograma RFB/CGIBS e cartilha do Portal da NFS-e (IBS/CBS do Simples obrigatórios desde
// 01/01/2027; até 31/12/2026 a ausência do grupo não impede a autorização).
// Mantém:
//  a) serviço SEM cadastro → a nota sai SEM nenhuma chave de IBS/CBS (mesmo com CST na Configuração Fiscal da empresa);
//  b) serviço COM cadastro → grupo completo (CST, cClassTrib, cIndOp de 6 dígitos — "100301.0" vira 100301);
//  c) validação do Simples a partir de 01/01/2027 pronta e DESLIGADA;
//  d) nota às 22h de Brasília sai com a data do dia (emissão e competência) — NFS-e Nacional, municipal, NF-e e NFC-e;
//  e) token do Focus só no cofre (nunca em texto na tabela nem na tela) e validação do certificado NA Focus gravada.
import { readFileSync } from 'node:fs'
import {
  normalizarCIndOp, codigoIndicadorOperacaoValido, reformaIbsCbsDoServico, validarIbsCbsObrigatorio,
  EXIGIR_IBS_CBS_SIMPLES, IBS_CBS_SIMPLES_OBRIGATORIO_DESDE,
} from '../../src/lib/fiscal/retencoesFederaisNfse'
import { buildNacionalNFSePayload } from '../../src/lib/fiscal/providers/focusnfe'
import { dataBrasil, isoBrasilia } from '../../src/lib/fiscal/dataBrasil'
import { avaliarCertificadoFocus } from '../../src/lib/fiscal/focusConferencia'
import type { NFSeRequest } from '../../src/lib/fiscal/types'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const ler = (p: string) => readFileSync(p, 'utf8')
const CHAVES_RT = ['finalidade_emissao', 'consumidor_final', 'indicador_destinatario', 'ibs_cbs_situacao_tributaria', 'ibs_cbs_classificacao_tributaria', 'codigo_indicador_operacao']

// Pdois de verdade: Configuração Fiscal com CST 000 / cClassTrib 000001 e finNFSe/indFinal/indDest 0; Simples ME/EPP.
const EMPRESA_PDOIS = { finalidadeEmissao: 0, consumidorFinal: 0, indicadorDestinatario: 0, ibsCbsCst: '000', ibsCbsClassifTrib: '000001' }
const reqBase = (): NFSeRequest => ({
  serie: '1', cnaeServico: '7311400', codigoServico: '170601', descricaoServico: 'Campanha', valorServicos: 1000,
  prestador: { cnpj: '15585855000107', razaoSocial: 'Pdois', codigoMunicipio: '4217204' },
  tomador: { cnpj: '00000000000272', razaoSocial: 'Cliente' },
  padraoNacional: true, opcaoSimplesNacional: 3, regimeTributario: 'simples_nacional', percentualTribSN: 12.63,
  codigoNbs: '1.1406.11.00',
})

// ── cIndOp ──
ok(normalizarCIndOp('100301') === '100301' && normalizarCIndOp('100301.0') === '100301' && normalizarCIndOp('20201.0') === '020201',
  'cIndOp: 6 dígitos; "100301.0" → 100301; "20201.0" → 020201 (zero da frente)')
ok(normalizarCIndOp('2020') === null && normalizarCIndOp('') === null && normalizarCIndOp(null) === null && normalizarCIndOp('10030A') === null,
  'cIndOp: curto, vazio ou com letra não vai')
ok(codigoIndicadorOperacaoValido('100301.0') && !codigoIndicadorOperacaoValido('2020'), 'cIndOp: a emissão aceita o valor da correlação antiga')

// ── a) sem cadastro ──
{
  const r = reformaIbsCbsDoServico(EMPRESA_PDOIS, { rt_cst: null, rt_classificacao_tributaria: null, rt_indicador_operacao: null })
  const req = reqBase(); req.reforma = r.reforma
  const p = buildNacionalNFSePayload(req)
  ok(r.reforma === undefined && CHAVES_RT.every((k) => !(k in p)),
    'a) serviço SEM cadastro (Pdois, com CST só na empresa) → nenhuma chave de IBS/CBS vai (antes ia o CST sem cIndOp → E0901)')
  ok(!!r.aviso && /cIndOp/.test(r.aviso), 'a) e a tela recebe o aviso do que falta (sem bloquear a nota)')
  const nada = reformaIbsCbsDoServico(undefined, null)
  ok(nada.reforma === undefined && nada.aviso === null, 'a) empresa e serviço sem nada → como antes da Reforma, sem aviso')
}
// ── b) com cadastro ──
{
  const r = reformaIbsCbsDoServico(EMPRESA_PDOIS, { rt_cst: '000', rt_classificacao_tributaria: '000001', rt_indicador_operacao: '100301.0' })
  const req = reqBase(); req.reforma = r.reforma
  const p = buildNacionalNFSePayload(req)
  ok(p.ibs_cbs_situacao_tributaria === '000' && p.ibs_cbs_classificacao_tributaria === '000001' && p.codigo_indicador_operacao === '100301',
    'b) serviço COM cadastro → grupo IBS/CBS completo (CST 000, cClassTrib 000001, cIndOp 100301)')
  ok(p.indicador_destinatario === 0 && p.finalidade_emissao === 0 && p.consumidor_final === 0, 'b) finNFSe/indFinal/indDest da empresa (0)')
  const soServico = reformaIbsCbsDoServico(undefined, { rt_cst: '000', rt_classificacao_tributaria: '000001', rt_indicador_operacao: '100101' })
  ok(soServico.reforma?.codigoIndicadorOperacao === '100101' && soServico.reforma?.indicadorDestinatario === 0, 'b) só o serviço cadastrado também basta (empresa 0/0/0)')
  const cstDaEmpresa = reformaIbsCbsDoServico(EMPRESA_PDOIS, { rt_cst: null, rt_classificacao_tributaria: '000001', rt_indicador_operacao: '100301' })
  ok(cstDaEmpresa.reforma?.ibsCbsCst === '000', 'b) CST ausente no serviço usa o da Configuração Fiscal da empresa')
  const servicoManda = reformaIbsCbsDoServico({ ...EMPRESA_PDOIS, ibsCbsCst: '200' }, { rt_cst: '000', rt_classificacao_tributaria: '000001', rt_indicador_operacao: '100301' })
  ok(servicoManda.reforma?.ibsCbsCst === '000', 'b) o CST do serviço prevalece sobre o da empresa')
}
// ── c) validação 2027 desligada ──
ok(EXIGIR_IBS_CBS_SIMPLES === false && IBS_CBS_SIMPLES_OBRIGATORIO_DESDE === '2027-01-01', 'c) validação do Simples (01/01/2027) pronta e DESLIGADA')
ok(validarIbsCbsObrigatorio({ optanteSimples: true, dataEmissaoBR: '2027-03-01', reforma: undefined }) === null, 'c) desligada: nada bloqueia')
ok(/IBS\/CBS/.test(validarIbsCbsObrigatorio({ optanteSimples: true, dataEmissaoBR: '2027-01-01', reforma: undefined, ligada: true }) ?? ''),
  'c) ligada: Simples em 01/01/2027 sem o grupo → bloqueia com o que falta')
ok(validarIbsCbsObrigatorio({ optanteSimples: true, dataEmissaoBR: '2026-12-31', reforma: undefined, ligada: true }) === null, 'c) ligada: 31/12/2026 não exige')
ok(validarIbsCbsObrigatorio({ optanteSimples: false, dataEmissaoBR: '2027-02-01', reforma: undefined, ligada: true }) === null, 'c) ligada: não optante não é afetado')
ok(validarIbsCbsObrigatorio({ optanteSimples: true, dataEmissaoBR: '2027-02-01', ligada: true,
  reforma: { ibsCbsCst: '000', ibsCbsClassifTrib: '000001', codigoIndicadorOperacao: '100301' } }) === null, 'c) ligada: grupo completo passa')

// ── d) fuso: 22h de Brasília = 01h UTC do dia seguinte ──
const NOITE = new Date('2026-10-08T01:00:00Z')   // 07/10/2026 22:00 em Brasília
ok(dataBrasil(NOITE) === '2026-10-07' && isoBrasilia(NOITE) === '2026-10-07T22:00:00-03:00' && new Date(isoBrasilia(NOITE)).getTime() === NOITE.getTime(),
  'd) 22h de Brasília: data 07/10, hora 22:00-03:00, mesmo instante')
{
  const RealDate = Date
  class Relogio22h extends RealDate {
    constructor(...a: unknown[]) { if (a.length) super(...(a as [string])); else super(NOITE.getTime()) }
    static now() { return NOITE.getTime() }
  }
  ;(globalThis as { Date: DateConstructor }).Date = Relogio22h as unknown as DateConstructor
  try {
    const p = buildNacionalNFSePayload(reqBase())
    ok(p.data_competencia === '2026-10-07' && String(p.data_emissao).startsWith('2026-10-07T22:00'), 'd) NFS-e emitida às 22h sai com a data do dia (competência e emissão)')
  } finally { (globalThis as { Date: DateConstructor }).Date = RealDate }
}
const fnfe = ler('src/lib/fiscal/providers/focusnfe.ts')
ok(!/data_emissao:\s*(req\.dataEmissao \?\? )?new Date\(\)\.toISOString\(\)/.test(fnfe) && (fnfe.match(/data_emissao: isoBrasilia\(/g) ?? []).length >= 4,
  'd) Focus: NFS-e Nacional, municipal, NF-e e NFC-e com data/hora de Brasília (nenhum data_emissao em UTC)')
ok(!/function isoBrasilia/.test(fnfe) && /from '\.\.\/dataBrasil'/.test(fnfe), 'd) uma regra só de fuso (src/lib/fiscal/dataBrasil.ts)')
const rota = ler('src/app/api/fiscal/nfse/emitir/route.ts')
ok(!/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(rota) && !/Date\.now\(\) - 3 \* 60 \* 60 \* 1000/.test(rota), 'd) rota: vigência e competência do dia de Brasília')
ok(/timeZone: "America\/Sao_Paulo"/.test(ler('supabase/functions/gov-nfse-emitir/index.ts')), 'd) edge gov-nfse-emitir (inalcançável) com a competência de Brasília')

// ── rota de emissão ──
ok(/const reformaEmpresa = nfseReq\.reforma\s*\n\s*nfseReq\.reforma = undefined/.test(rota) && /reformaIbsCbsDoServico\(reformaEmpresa, sv as ServicoIbsCbs\)/.test(rota),
  'rota: a config da empresa sozinha não vai — só via a regra com o cadastro do serviço')
ok(/validarIbsCbsObrigatorio\(\{ optanteSimples: optanteSN, dataEmissaoBR: dataBrasil\(\), reforma: nfseReq\.reforma \}\)/.test(rota), 'rota: validação 2027 ligada ao fluxo (desligada pela constante)')

// ── e) token e certificado ──
const pc = ler('src/app/api/fiscal/provider-config/route.ts')
ok(!/api_key_encrypted\s*=/.test(pc) && !/Buffer\.from\(apiKey/.test(pc), 'e) provider-config não grava mais o token em texto (base64)')
const card = ler('src/components/fiscal/FocusNFeConfigCard.tsx')
ok(/rpc\('fn_fiscal_salvar_token'/.test(card) && !/payload\.apiKey/.test(card), 'e) a tela grava o token no cofre, como o usuário')
ok(!/api_key_encrypted/.test(ler('src/app/dashboard/configuracoes/fiscal/FiscalConfigClient.tsx')), 'e) o token (nem o legado) não vem para o navegador')
const svc = ler('src/lib/fiscal/service.ts')
ok(svc.indexOf("rpc('fn_fiscal_obter_token'") > 0 && svc.indexOf("rpc('fn_fiscal_obter_token'") < svc.indexOf('decryptApiKey(configRow.api_key_encrypted)'), 'e) emissão: o cofre manda; o legado só se o cofre estiver vazio')
ok(avaliarCertificadoFocus(null, '15585855000107', '2026-10-07').ok === false, 'e) certificado: empresa fora da Focus → reprovado')
ok(avaliarCertificadoFocus({ cnpj: '15585855000107' }, '15585855000107', '2026-10-07').ok === null, 'e) certificado: Focus não informou → desconhecido (nunca verde)')
ok(avaliarCertificadoFocus({ certificado_valido_ate: '2027-07-20' }, '15585855000107', '2026-10-07').ok === true, 'e) certificado: válido até 20/07/2027 → ok')
ok(avaliarCertificadoFocus({ certificado_valido_ate: '2026-10-01' }, '15585855000107', '2026-10-07').ok === false, 'e) certificado: vencido → reprovado')
ok(avaliarCertificadoFocus({ certificado_valido_ate: '2027-07-20', certificado_cnpj: '11222333000181' }, '15585855000107', '2026-10-07').ok === false, 'e) certificado de outro CNPJ → reprovado')
const tc = ler('src/app/api/fiscal/testar-conexao/route.ts')
ok(/avaliarCertificadoFocus\(/.test(tc) && /ultima_validacao_em: agora/.test(tc) && /ultima_validacao_focus_ok: cert\.ok/.test(tc), 'e) "Testar conexão" confere o certificado NA Focus e grava o resultado')
ok(!/certificado valido/.test(fnfe) && /certificadoOk: false/.test(fnfe), 'e) o teste da API sozinho não diz mais "certificado válido"')
ok(/normalizarCIndOp\(indOp\)/.test(ler('src/components/cadastros/ServicoForm.tsx')), 'cadastro de serviço grava o cIndOp com 6 dígitos')

if (falhas) { console.error(`\ncheck-nfse-ibs-cbs-fuso-1944: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-nfse-ibs-cbs-fuso-1944: ok')
