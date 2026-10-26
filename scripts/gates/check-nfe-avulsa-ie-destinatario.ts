/**
 * Gate (#3861, Gean → HUTSONTURBO): a NF-e avulsa manda a IE do destinatário (cliente OU fornecedor) e não chama
 * "Falha ao emitir" a nota que a Focus ainda está processando.
 * Antes: a rota da remessa não lia `ie`/`contribuinte_icms` do cadastro → indIEDest 9 sem IE → SEFAZ "IE do
 * destinatário não informada"; e a tela tratava ok=false ('processando_autorizacao') como falha, induzindo reenvio.
 */
import { readFileSync } from 'node:fs'
import { ieDestinatario, validarNFeAvulsa } from '../../src/lib/fiscal/nfeAvulsa'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const cnpj = '08779649000164'
const hutson = ieDestinatario({ doc: cnpj, ie: '255379200', contribuinteIcms: 'contribuinte' })
ok(hutson.indicadorIE === 1 && hutson.inscricaoEstadual === '255379200' && !hutson.erro, 'contribuinte com IE → indicador 1 + IE')
const semDecl = ieDestinatario({ doc: cnpj, ie: '255.379.200', contribuinteIcms: null })
ok(semDecl.indicadorIE === 1 && semDecl.inscricaoEstadual === '255379200', 'contribuinte_icms nulo + IE → contribuinte (1), IE só dígitos')
const contribSemIe = ieDestinatario({ doc: cnpj, ie: '', contribuinteIcms: 'contribuinte' })
ok(!!contribSemIe.erro, 'contribuinte declarado sem IE → barra antes de enviar')
const pjSemIe = ieDestinatario({ doc: cnpj, ie: null, contribuinteIcms: null })
ok(pjSemIe.indicadorIE === 9 && !pjSemIe.inscricaoEstadual && !!pjSemIe.aviso && !pjSemIe.erro, 'CNPJ sem IE e sem declaração → 9 com aviso')
const isento = ieDestinatario({ doc: cnpj, ie: '', contribuinteIcms: 'isento' })
ok(isento.indicadorIE === 2 && !isento.inscricaoEstadual && !isento.erro, 'isento declarado → 2 sem IE')
const naoContrib = ieDestinatario({ doc: cnpj, ie: '123', contribuinteIcms: 'nao_contribuinte' })
ok(naoContrib.indicadorIE === 9 && !naoContrib.inscricaoEstadual && !!naoContrib.aviso, 'não contribuinte declarado com IE → 9, IE não vai, aviso')
const cpf = ieDestinatario({ doc: '12345678909', ie: null, contribuinteIcms: null })
ok(cpf.indicadorIE === 9 && !cpf.aviso, 'pessoa física sem IE → 9 sem aviso')

const base = { cfop: '5915', finalidade: 'normal' as const, simples: true, icmsCodigo: '400', ufEmitente: 'SC', ufDestino: 'SC', catalogo: [] }
const r = validarNFeAvulsa({ ...base, destinatario: { doc: cnpj, ie: '255379200', contribuinteIcms: null } })
ok(r.ie?.indicadorIE === 1 && r.ie.inscricaoEstadual === '255379200', 'validarNFeAvulsa devolve a IE do destinatário')
ok(validarNFeAvulsa({ ...base, destinatario: { doc: cnpj, ie: '', contribuinteIcms: 'contribuinte' } }).erros.length > 0, 'validarNFeAvulsa reprova contribuinte sem IE')
ok(validarNFeAvulsa(base).ie === undefined, 'sem destinatário informado, nada muda')

const rota = readFileSync('src/app/api/fiscal/nfe/remessa/route.ts', 'utf8')
ok(/const cols = '[^']*\bie, contribuinte_icms\b/.test(rota), 'rota lê ie + contribuinte_icms (cliente e fornecedor)')
ok(rota.includes('inscricaoEstadual: avulsa.ie?.inscricaoEstadual') && rota.includes('indicadorIE: avulsa.ie?.indicadorIE'), 'rota passa IE + indicador ao builder')
ok(rota.includes("'nota_em_processamento'") && rota.includes(".eq('status', 'processando')"), 'rota barra novo envio com nota do mesmo destinatário em processamento')

const tela = readFileSync('src/app/dashboard/fiscal/nfe/remessa/RemessaClient.tsx', 'utf8')
ok(!/json\?\.ok === false/.test(tela), 'tela não trata ok=false (processando) como falha')
ok(tela.includes('Nota enviada, aguardando SEFAZ') && tela.includes('/api/fiscal/nfe/consultar/'), 'tela mostra "aguardando SEFAZ" e consulta até a resposta')
ok(tela.includes('!aguardando && !!previa'), 'botão travado enquanto aguarda a SEFAZ')
ok(tela.includes('ie, contribuinte_icms') && tela.includes('contribuinteIcms: destinatario.contribuinte_icms'), 'tela valida a IE antes de enviar (mesma regra da rota)')

if (falhas) { console.error(`\n${falhas} falha(s) no gate da IE do destinatário da NF-e avulsa`); process.exit(1) }
console.log('\nGate IE do destinatário da NF-e avulsa: ok')
