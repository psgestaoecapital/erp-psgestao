// Banco do Brasil · Cobrança v2 (#5404 parte b) — registrar, consultar e baixar boleto.
// Homologação primeiro: api.hm.bb.com.br; produção: api.bb.com.br. mTLS NÃO é exigido para registrar boleto
// (só para webhook), então o certificado é opcional aqui. Toda chamada leva ?gw-dev-app-key=<chave da aplicação>.
import { Buffer } from 'node:buffer'
import { bbRequest, obterToken, BB_HOSTS, type BbAmbiente, type BbCredencial } from './index'

export const BB_SCOPE_BOLETO_REQ = 'cobrancas.boletos-requisicao'
export const BB_SCOPE_BOLETO_INFO = 'cobrancas.boletos-info'
export const BB_SCOPE_CONVENIO_REQ = 'cobrancas.convenio-requisicao'

export const BB_COBRANCA_HOST: Record<BbAmbiente, string> = {
  producao: 'api.bb.com.br',
  homologacao: 'api.hm.bb.com.br',
}

export type BbCobrancaCfg = {
  convenio: string | null; carteira: string | null; variacao: string | null; modalidade: number | null
}

const digitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')
// Carteira aceita só o número ("17"), mesmo que a config antiga traga "17/01-9".
export const carteiraBb = (s: string | null | undefined) => digitos((s ?? '').split('/')[0])

// Diz o que falta antes de chamar o banco.
export function faltasCobrancaBb(c: BbCobrancaCfg): string[] {
  const f: string[] = []
  if (!digitos(c.convenio)) f.push('Convênio')
  if (!carteiraBb(c.carteira)) f.push('Carteira')
  if (!digitos(c.variacao)) f.push('Variação da carteira')
  if (!c.modalidade) f.push('Modalidade')
  return f
}

const ddmmaaaa = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}.${m}.${y}` }

export type BbPagador = {
  documento: string; nome: string
  logradouro?: string | null; numero?: string | null; bairro?: string | null
  cidade?: string | null; uf?: string | null; cep?: string | null
}

export function montarCorpoRegistroBb(i: {
  cfg: BbCobrancaCfg; seuNumero: string; nossoNumeroSeq: string
  emissaoISO: string; vencimentoISO: string; valor: number; pagador: BbPagador
  jurosPct?: number | null; multaPct?: number | null
}): Record<string, unknown> {
  const conv = digitos(i.cfg.convenio)
  const doc = digitos(i.pagador.documento)
  const end = [i.pagador.logradouro, i.pagador.numero].filter(Boolean).join(', ')
  const corpo: Record<string, unknown> = {
    numeroConvenio: Number(conv),
    numeroCarteira: Number(carteiraBb(i.cfg.carteira)),
    numeroVariacaoCarteira: Number(digitos(i.cfg.variacao)),
    codigoModalidade: Number(i.cfg.modalidade),
    dataEmissao: ddmmaaaa(i.emissaoISO),
    dataVencimento: ddmmaaaa(i.vencimentoISO),
    valorOriginal: Number(i.valor.toFixed(2)),
    codigoAceite: 'N',
    codigoTipoTitulo: 2,
    descricaoTipoTitulo: 'DM',
    indicadorPermissaoRecebimentoParcial: 'N',
    textoNumeroTituloBeneficiario: i.seuNumero.slice(0, 15),
    // nosso número do convênio de 7 dígitos: "000" + convênio(7) + sequencial(10) = 20 dígitos
    numeroTituloCliente: `000${conv.padStart(7, '0')}${digitos(i.nossoNumeroSeq).padStart(10, '0')}`,
    indicadorPix: 'N',
    pagador: {
      tipoInscricao: doc.length === 11 ? 1 : 2,
      numeroInscricao: Number(doc),
      nome: i.pagador.nome.slice(0, 60),
      endereco: end.slice(0, 60),
      cep: Number(digitos(i.pagador.cep)) || 0,
      cidade: (i.pagador.cidade ?? '').slice(0, 30),
      bairro: (i.pagador.bairro ?? '').slice(0, 30),
      uf: (i.pagador.uf ?? '').slice(0, 2),
    },
  }
  if (i.jurosPct && i.jurosPct > 0) corpo.jurosMora = { tipo: 2, porcentagem: i.jurosPct }
  if (i.multaPct && i.multaPct > 0) corpo.multa = { tipo: 2, data: ddmmaaaa(i.vencimentoISO), porcentagem: i.multaPct }
  return corpo
}

type Http = { status: number; body: unknown; raw: string }

async function chamar(cred: BbCredencial, scope: string, method: 'GET' | 'POST', path: string, corpo?: unknown): Promise<Http> {
  const token = await obterToken(cred, scope)
  const sep = path.includes('?') ? '&' : '?'
  const body = corpo === undefined ? undefined : JSON.stringify(corpo)
  return bbRequest({
    host: BB_COBRANCA_HOST[cred.ambiente], method,
    path: `/cobrancas/v2${path}${sep}gw-dev-app-key=${encodeURIComponent(cred.app_key.trim())}`,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) } : {}),
    },
    body,
  })
}

export type BbRegistro = { status: number; raw: string; numero?: string; linhaDigitavel?: string; codigoBarras?: string }

export async function registrarBoletoBb(cred: BbCredencial, corpo: Record<string, unknown>): Promise<BbRegistro> {
  const r = await chamar(cred, BB_SCOPE_BOLETO_REQ, 'POST', '/boletos', corpo)
  const j = (r.body ?? {}) as { numero?: string; linhaDigitavel?: string; codigoBarraNumerico?: string }
  return { status: r.status, raw: r.raw, numero: j.numero, linhaDigitavel: j.linhaDigitavel, codigoBarras: j.codigoBarraNumerico }
}

export async function consultarBoletoBb(cred: BbCredencial, id: string, convenio: string) {
  const r = await chamar(cred, BB_SCOPE_BOLETO_INFO, 'GET', `/boletos/${encodeURIComponent(id)}?numeroConvenio=${digitos(convenio)}`)
  const j = (r.body ?? {}) as { codigoEstadoTituloCobranca?: number; dataHoraRecebimentoTitulo?: string; valorPagoSacado?: number }
  return { status: r.status, raw: r.raw, estado: j.codigoEstadoTituloCobranca ?? null, valorPago: j.valorPagoSacado ?? null }
}

export async function baixarBoletoBb(cred: BbCredencial, id: string, convenio: string) {
  const r = await chamar(cred, BB_SCOPE_BOLETO_REQ, 'POST', `/boletos/${encodeURIComponent(id)}/baixar`, { numeroConvenio: Number(digitos(convenio)) })
  return { status: r.status, raw: r.raw }
}

// Mensagem clara quando o banco acusa falta de escopo/permissão (a aplicação do Portal Developers não tem a API).
export function erroBb(status: number, raw: string): string {
  if (status === 401 || status === 403) return `O Banco do Brasil recusou o acesso (${status}): confira, no Portal Developers, se a aplicação tem os escopos ${BB_SCOPE_BOLETO_INFO}, ${BB_SCOPE_BOLETO_REQ} e ${BB_SCOPE_CONVENIO_REQ}. Resposta: ${raw.slice(0, 300)}`
  try {
    const j = JSON.parse(raw) as { erros?: { mensagem?: string; codigo?: string }[]; message?: string }
    const m = j.erros?.map((e) => e.mensagem || e.codigo).filter(Boolean).join('; ') || j.message
    if (m) return `Banco do Brasil: ${m}`
  } catch { /* sem JSON */ }
  return `Banco do Brasil recusou o registro (${status}): ${raw.slice(0, 300)}`
}

export { BB_HOSTS }
