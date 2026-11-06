// Banco do Brasil · Cobrança v2 — parte PURA (sem rede nem dependências de certificado), provada em
// scripts/gates/check-bb-cobranca.ts. Chamado #5404.
import { onlyDigitsDoc, tipoPessoaPorDocumento } from '@/lib/banco/documento'

export type BbCobrancaConfig = {
  convenio: string            // numeroConvenio (7 dígitos)
  carteira: string            // numeroCarteira — só o número (17), nunca "17/01-9"
  variacao: string            // numeroVariacaoCarteira (ex.: 35)
  modalidade: number          // codigoModalidade: 1 simples · 4 vinculada
}

// "17/01-9" → 17 · "17" → 17 · "17/35" → carteira 17, variação 35 (compatível com o formato antigo da tela).
export function normalizarCarteiraBb(carteira: string | null | undefined, variacao: string | null | undefined): { carteira: string; variacao: string } {
  const partes = String(carteira ?? '').split('/')
  const cart = onlyDigitsDoc(partes[0]).replace(/^0+(?=\d)/, '')
  const varExplicita = onlyDigitsDoc(variacao).replace(/^0+(?=\d)/, '')
  // só o formato simples "17/35" vale como variação; "17/01-9" (com dígito/texto) NÃO é inferido — a variação é campo próprio
  const varDaCarteira = /^\s*\d+\s*\/\s*\d+\s*$/.test(String(carteira ?? '')) ? onlyDigitsDoc(partes[1]).replace(/^0+(?=\d)/, '') : ''
  return { carteira: cart, variacao: varExplicita || varDaCarteira }
}

export function modalidadeBb(m: string | null | undefined): number {
  return String(m ?? '').trim() === '4' ? 4 : 1
}

// O que falta na configuração antes de chamar o banco (regra: dizer o que falta).
export function faltasCobrancaBb(c: { convenio?: string | null; carteira?: string | null; variacao_carteira?: string | null }): string[] {
  const f: string[] = []
  const n = normalizarCarteiraBb(c.carteira, c.variacao_carteira)
  if (onlyDigitsDoc(c.convenio).length === 0) f.push('Convênio de cobrança')
  if (!n.carteira) f.push('Carteira')
  if (!n.variacao) f.push('Variação da carteira')
  return f
}

// Nosso número do BB (numeroTituloCliente): "000" + convênio com 7 dígitos + sequencial de 10 dígitos = 20 posições.
export function nossoNumeroBb(convenio: string, sequencial10: string): string {
  const conv = onlyDigitsDoc(convenio).padStart(7, '0').slice(-7)
  const seq = onlyDigitsDoc(sequencial10).padStart(10, '0').slice(-10)
  return `000${conv}${seq}`
}

// "Nosso Número já incluído anteriormente" (código 4874915 do BB; chamado #5404, 05/11): o número já existe no banco.
// O convênio de homologação do BB é COMPARTILHADO entre todos os desenvolvedores, então colide fácil; em produção
// só colide se um registro anterior não voltou para o sistema. Em ambos, o certo é tentar OUTRO nosso número.
export function nossoNumeroJaIncluidoBb(raw: string | null | undefined): boolean {
  const t = String(raw ?? '')
  return /4874915/.test(t) || /nosso\s+n[uú]mero\s+j[aá]\s+inclu[ií]do/i.test(t)
}

// Homologação: sequencial de 10 posições ("YY" + 8 dígitos) espalhado ao acaso para não bater nos números que outros
// testadores já usaram no convênio compartilhado. `rnd` (0..1) é injetável para teste. Produção NÃO usa isto (contador atômico).
export function sequencialHomologacaoBb(yy: string, rnd: () => number = Math.random): string {
  const n = 10_000_000 + Math.floor(rnd() * 89_999_999) // 8 dígitos, nunca começa com 0
  return `${onlyDigitsDoc(yy).padStart(2, '0').slice(-2)}${n}`
}

// Seu número (numeroTituloBeneficiario): a homologação do BB recusa ("dados inválidos") o identificador alfanumérico
// (uuid do título). Vai SÓ NÚMERO (até 15 dígitos): os dígitos do nº do documento; sem nº, o sequencial do nosso número.
export function seuNumeroBb(seuNumero: string | null | undefined, nossoNumero: string): string {
  const d = onlyDigitsDoc(seuNumero).replace(/^0+(?=\d)/, '').slice(0, 15)
  if (d) return d
  return onlyDigitsDoc(nossoNumero).slice(-10).replace(/^0+(?=\d)/, '') || '1'
}

// ISO (yyyy-mm-dd) → dd.mm.aaaa (formato de data da Cobrança v2)
export function dataBb(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const limpar = (s: string | null | undefined, max: number) => semAcento((s ?? '').trim()).replace(/\s+/g, ' ').slice(0, max)

export type PagadorBb = {
  documento: string; nome: string
  logradouro: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null
}

export type RegistrarBbInput = {
  cfg: BbCobrancaConfig
  nossoNumero: string          // numeroTituloCliente (20 posições)
  seuNumero: string            // numeroTituloBeneficiario (até 15)
  valor: number
  emissaoISO: string
  vencimentoISO: string
  pagador: PagadorBb
  juros_pct?: number | null
  multa_pct?: number | null
  mensagem?: string | null
  pix?: boolean
}

// Corpo do POST /boletos. Pagador: 1 = pessoa física · 2 = pessoa jurídica (tipo vem do documento, como nos demais bancos).
export function montarCorpoRegistroBb(i: RegistrarBbInput): Record<string, unknown> {
  const doc = onlyDigitsDoc(i.pagador.documento)
  const pessoa = tipoPessoaPorDocumento(doc)
  if (!pessoa) throw new Error(`BB: CPF/CNPJ do pagador incompleto (${doc.length} dígito(s)).`)
  const corpo: Record<string, unknown> = {
    numeroConvenio: Number(onlyDigitsDoc(i.cfg.convenio)),
    numeroCarteira: Number(i.cfg.carteira),
    numeroVariacaoCarteira: Number(i.cfg.variacao),
    codigoModalidade: i.cfg.modalidade,
    dataEmissao: dataBb(i.emissaoISO),
    dataVencimento: dataBb(i.vencimentoISO),
    valorOriginal: Number(i.valor.toFixed(2)),
    codigoAceite: 'N',
    codigoTipoTitulo: 2,
    descricaoTipoTitulo: 'DM',
    indicadorPermissaoRecebimentoParcial: 'N',
    numeroTituloBeneficiario: seuNumeroBb(i.seuNumero, i.nossoNumero),
    numeroTituloCliente: i.nossoNumero,
    pagador: {
      tipoInscricao: pessoa === 'FISICA' ? 1 : 2,
      numeroInscricao: Number(doc),
      nome: limpar(i.pagador.nome, 60) || 'PAGADOR',
      endereco: limpar(i.pagador.logradouro, 60) || 'NAO INFORMADO',
      cep: Number(onlyDigitsDoc(i.pagador.cep)) || 0,
      cidade: limpar(i.pagador.cidade, 30) || 'NAO INFORMADA',
      bairro: limpar(i.pagador.bairro, 30) || 'NAO INFORMADO',
      uf: limpar(i.pagador.uf, 2).toUpperCase() || 'SC',
    },
    indicadorPix: i.pix ? 'S' : 'N',
  }
  if (i.multa_pct && i.multa_pct > 0) corpo.multa = { tipo: 2, data: dataBb(i.vencimentoISO), porcentagem: Number(i.multa_pct) }
  if (i.juros_pct && i.juros_pct > 0) corpo.jurosMora = { tipo: 2, porcentagem: Number(i.juros_pct) }
  if (i.mensagem?.trim()) corpo.textoMensagemBloquetoOcorrencia = limpar(i.mensagem, 30)
  return corpo
}

