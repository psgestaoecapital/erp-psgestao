// #297 · leitura das respostas da API Cobrança do Bradesco (manual v1.6.3). Funções puras — testadas no gate
// scripts/gates/check-bradesco-liquidacao.ts. Valores das LISTAS vêm em centavos (formato 9(n)V99); datas da lista de
// liquidados em DDMMAAAA; da lista de baixados em AAAAMMDD; da consulta individual dtPagto em DDMMAAAA (0 = não pago).

/** Status/código de baixa que NÃO são pagamento: o boleto sai da cobrança no banco, mas o título não foi pago. */
export const BAIXA_SEM_PAGAMENTO: ReadonlySet<number> = new Set([51, 52, 53, 54, 55, 57, 58, 59, 60, 63, 64, 65, 70, 71, 72, 73, 98])
/** Status da consulta individual que indicam pagamento (13 = PAGO NO DIA; 61 PAGO; 62 PAGO EM CARTÓRIO). */
export const STATUS_PAGO: ReadonlySet<number> = new Set([13, 61, 62])

const num = (v: unknown): number => { const n = Number(String(v ?? '').trim()); return Number.isFinite(n) ? n : 0 }
const digitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')
/** Nosso número sem zeros à esquerda — a API devolve número (11 posições) e o ERP guarda texto. */
export const chaveNossoNumero = (v: unknown) => digitos(v).replace(/^0+/, '') || '0'

/** DDMMAAAA (número ou texto; pode vir sem o zero à esquerda, ex. 1062017) → AAAA-MM-DD. Zero/vazio → null. */
export function ddmmaaaaParaIso(v: unknown): string | null {
  const s = digitos(v)
  if (!s || /^0+$/.test(s)) return null
  const p = s.padStart(8, '0')
  const d = p.slice(0, 2), m = p.slice(2, 4), a = p.slice(4, 8)
  if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null
  return `${a}-${m}-${d}`
}
/** AAAAMMDD → AAAA-MM-DD. Zero/vazio → null. */
export function aaaammddParaIso(v: unknown): string | null {
  const s = digitos(v)
  if (s.length !== 8 || /^0+$/.test(s)) return null
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

export type Pagina = { pagina: number; maisPaginas: boolean; status: number; causa: string }
function pagina(b: Record<string, unknown>): Pagina {
  const mais = String(b.indMaisPagina ?? b.IndicadorMaisPaginas ?? b.indicadorMaisPaginas ?? 'N').trim().toUpperCase() === 'S'
  return { pagina: num(b.pagina ?? b.Pagina), maisPaginas: mais, status: num(b.status), causa: String(b.causa ?? b.Causa ?? '') }
}

export type Liquidado = { nossoNumero: string; dataPagamento: string | null; valorPago: number; valorTitulo: number; raw: unknown }
/** cobranca-lista/v1/listar → títulos liquidados. */
export function lerListaLiquidados(body: unknown): Pagina & { itens: Liquidado[] } {
  const b = (body ?? {}) as Record<string, unknown>
  const titulos = Array.isArray(b.titulos) ? b.titulos as Record<string, unknown>[] : []
  return {
    ...pagina(b),
    itens: titulos.map((t) => ({
      nossoNumero: chaveNossoNumero(t.nossoNumero),
      dataPagamento: ddmmaaaaParaIso(t.dataPagamento),
      valorPago: Math.round(num(t.valorPagamento)) / 100,
      valorTitulo: Math.round(num(t.valorTitulo)) / 100,
      raw: t,
    })),
  }
}

export type Baixado = { nossoNumero: string; codigo: number; descricao: string; dataBaixa: string | null; semPagamento: boolean; raw: unknown }
/** cobranca-baixado-consulta/v1/listar → títulos baixados (pagos ou não; só os SEM pagamento viram "baixado no banco"). */
export function lerListaBaixados(body: unknown): Pagina & { itens: Baixado[] } {
  const b = (body ?? {}) as Record<string, unknown>
  const titulos = Array.isArray(b.titulos) ? b.titulos as Record<string, unknown>[] : []
  return {
    ...pagina(b),
    itens: titulos.map((t) => {
      const codigo = num(t.statusTitulo)
      return { nossoNumero: chaveNossoNumero(t.nossoNumero), codigo, descricao: String(t.descricaoStatusTitulo ?? '').trim(),
        dataBaixa: aaaammddParaIso(t.dataBaixa), semPagamento: BAIXA_SEM_PAGAMENTO.has(codigo) && num(t.valorPago) === 0, raw: t }
    }),
  }
}

export type ConsultaTitulo = {
  ok: boolean; erro: string | null; codStatus: number; descricao: string
  pago: boolean; dataPagamento: string | null; valorPago: number | null
  baixaSemPagamento: { codigo: number; descricao: string; data: string | null } | null
  pagoSemValor: boolean
}
/**
 * cobranca-consulta/v1/consultar → situação de UM título. Pago = status de pagamento (13/61/62) COM data e valor pagos.
 * "PAGO NO DIA" sem valor ainda (pagoSemValor) não baixa: a lista das 7h traz o valor exato no dia seguinte.
 * vlrPagto: o manual não fixa a escala (o exemplo traz 0.00); usa a leitura (reais ou centavos) mais perto do valor do
 * título no banco (valMoeda, em centavos) — e a resposta crua vai para o log.
 */
export function lerConsultaTitulo(body: unknown): ConsultaTitulo {
  const b = (body ?? {}) as Record<string, unknown>
  const status = num(b.status)
  const t = (b.titulo ?? {}) as Record<string, unknown>
  if (status !== 200 || !b.titulo) {
    return { ok: false, erro: String(b.causa ?? b.mensagem ?? `status ${status}`).slice(0, 200), codStatus: 0, descricao: '', pago: false,
      dataPagamento: null, valorPago: null, baixaSemPagamento: null, pagoSemValor: false }
  }
  const codStatus = num(t.codStatus)
  const dt = ddmmaaaaParaIso(t.dtPagto)
  const bruto = num(t.vlrPagto)
  const valorTitulo = num(t.valMoeda ?? t.valorMoedaBol) / 100
  let valorPago: number | null = null
  if (bruto > 0) {
    const emReais = bruto, emCentavos = bruto / 100
    valorPago = valorTitulo > 0 && Math.abs(emCentavos - valorTitulo) < Math.abs(emReais - valorTitulo) ? emCentavos : emReais
    valorPago = Math.round(valorPago * 100) / 100
  }
  const statusPago = STATUS_PAGO.has(codStatus)
  const baixa = (t.baixa ?? {}) as Record<string, unknown>
  const codBaixa = num(baixa.codigo)
  const semPag = BAIXA_SEM_PAGAMENTO.has(codBaixa) ? codBaixa : (BAIXA_SEM_PAGAMENTO.has(codStatus) ? codStatus : 0)
  return {
    ok: true, erro: null, codStatus, descricao: String(t.status ?? '').trim(),
    pago: !!dt && valorPago !== null,
    dataPagamento: dt, valorPago,
    baixaSemPagamento: semPag && !dt ? { codigo: semPag, descricao: String(baixa.descricao ?? t.status ?? '').trim(), data: ddmmaaaaParaIso(baixa.data) } : null,
    pagoSemValor: statusPago && (!dt || valorPago === null),
  }
}
