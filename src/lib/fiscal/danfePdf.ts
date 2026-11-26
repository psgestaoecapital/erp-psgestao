// DANFE (Documento Auxiliar da Nota Fiscal Eletrônica, modelo 55) em PDF — chamado #11234.
//
// Um só gerador para o ESPELHO de conferência (sem protocolo) e para o DANFE da nota autorizada (com chave e protocolo):
// o que muda entre os dois é só a marca d'água e o código de barras. O leiaute segue o modelo oficial do DANFE
// (Ajuste SINIEF 07/05 · Manual de Orientação do Contribuinte): canhoto · cabeçalho em 3 colunas (emitente, DANFE,
// chave de acesso com código de barras) · natureza/protocolo · IE/CNPJ · destinatário · cálculo do imposto ·
// transportador/volumes · produtos/serviços · dados adicionais · rodapé.
//
// SÓ LEIAUTE: este módulo desenha o que recebe — não calcula imposto nem altera o XML. Os totais que faltam são apenas
// somados do que cada item traz (nunca recalculados). Puro: sem rede, sem Date.now interno (data de impressão vem de fora).
// Stack: pdf-lib (Helvetica built-in) + bwip-js (só para gerar as barras do Code 128 como vetores).

import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from 'pdf-lib'
import bwipjs from 'bwip-js/browser'

export type DanfeItem = {
  codigo: string | null
  descricao: string
  ncm: string | null
  /** origem (0-8) — junta com o CST/CSOSN na coluna O/CST */
  origem?: string | null
  /** CST (regime normal) ou CSOSN (Simples) */
  cst: string | null
  cfop: string | null
  un: string | null
  quantidade: number | null
  valorUnitario: number | null
  valorTotal: number
  baseIcms: number | null
  valorIcms: number | null
  valorIpi: number | null
  aliqIcms: number | null
  aliqIpi: number | null
  /** chassi (venda de veículo): vai junto da descrição */
  chassi?: string | null
}

export type DanfeDados = {
  emitente: {
    razaoSocial: string
    cnpj: string | null
    ie: string | null
    ieSt?: string | null
    /** logradouro, número, complemento */
    endereco?: string | null
    bairro?: string | null
    cep?: string | null
    municipio?: string | null
    uf?: string | null
    fone?: string | null
    /** logo já baixada (a rota converte): PNG ou JPEG em base64 */
    logo?: { base64: string; mime: 'image/png' | 'image/jpeg' } | null
  }
  numero?: string | null
  serie?: string | null
  /** 0 = entrada · 1 = saída (padrão 1) */
  tipoOperacao?: 0 | 1
  /** 44 dígitos; ausente no espelho */
  chave?: string | null
  /** presente = nota autorizada (sem marca d'água) */
  protocolo?: string | null
  protocoloDataISO?: string | null
  naturezaOperacao: string
  dataEmissaoISO?: string | null
  dataSaidaISO?: string | null
  horaSaida?: string | null
  destinatario: {
    nome: string
    documento: string | null
    ie?: string | null
    endereco?: string | null
    bairro?: string | null
    cep?: string | null
    municipio?: string | null
    uf?: string | null
    fone?: string | null
  }
  totais: {
    baseIcms?: number | null
    valorIcms?: number | null
    baseSt?: number | null
    valorSt?: number | null
    valorImpImportacao?: number | null
    valorPis?: number | null
    valorProdutos: number
    frete?: number | null
    seguro?: number | null
    desconto?: number | null
    outrasDespesas?: number | null
    valorIpi?: number | null
    valorCofins?: number | null
    valorNota?: number | null
  }
  transporte?: {
    /** 0 emitente · 1 destinatário · 2 terceiros · 3 próprio (remetente) · 4 próprio (destinatário) · 9 sem frete */
    modalidade?: number | null
    nome?: string | null
    documento?: string | null
    ie?: string | null
    endereco?: string | null
    municipio?: string | null
    uf?: string | null
    codigoAntt?: string | null
    placa?: string | null
    ufPlaca?: string | null
    quantidade?: string | null
    especie?: string | null
    marca?: string | null
    numeracao?: string | null
    pesoBruto?: string | null
    pesoLiquido?: string | null
  } | null
  itens: DanfeItem[]
  informacoesComplementares?: string | null
  reservadoFisco?: string | null
  /** Simples Nacional: a coluna O/CST vira O/CSOSN */
  simples?: boolean
}

export type DanfeOpcoes = {
  /** data/hora da impressão (passada de fora) */
  impressoEmISO: string
}

export const MARCA_CONFERENCIA = ['NF-e CONFERÊNCIA — SEM VALOR FISCAL', 'FALTA PROTOCOLO DE APROVAÇÃO DA SEFAZ']

// pdf-lib (Helvetica/WinAnsi) só desenha Latin-1: normaliza os comuns e troca o resto por '?'.
const ansi = (s: string | null | undefined) => (s ?? '')
  .replace(/[‒–—―]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/•/g, '·').replace(/…/g, '...')
  .replace(/\r?\n/g, ' ').replace(/[^\x00-\xFF]/g, '?')

const so = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')
export function fmtNumero(v: string | null | undefined): string {
  const d = so(v)
  if (!d) return ''
  const p = d.padStart(9, '0')
  return `${p.slice(0, 3)}.${p.slice(3, 6)}.${p.slice(6, 9)}`
}
export function fmtChave(v: string | null | undefined): string {
  const d = so(v)
  return d.replace(/(\d{4})(?=\d)/g, '$1 ')
}
export function fmtDocumento(v: string | null | undefined): string {
  const d = so(v)
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return v ?? ''
}
const fmtCep = (v: string | null | undefined) => { const d = so(v); return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : (v ?? '') }
export const n2 = (v: number | null | undefined) => (v == null || Number.isNaN(v)) ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const n4 = (v: number | null | undefined) => (v == null || Number.isNaN(v)) ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const dataBR = (iso: string | null | undefined) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return y && m && d ? `${d}/${m}/${y}` : '' }
const horaBR = (iso: string | null | undefined) => (iso && iso.length >= 16 ? iso.slice(11, 16) : '')
const FRETE_TXT: Record<number, string> = { 0: '0-Emitente', 1: '1-Destinatário', 2: '2-Terceiros', 3: '3-Próprio rem.', 4: '4-Próprio dest.', 9: '9-Sem frete' }

const NEGRO = rgb(0, 0, 0)
const LABEL = rgb(0.25, 0.25, 0.25)
const MARCA_COR = rgb(0.86, 0.86, 0.86)

type Barra = { x: number; w: number }
/** Code 128 (modo C para dígitos) como barras vetoriais normalizadas (0..1) — sem imagem, nítido em qualquer zoom. */
export function barrasCode128(texto: string): { barras: Barra[]; largura: number } {
  const svg = bwipjs.toSVG({ bcid: 'code128', text: texto, includetext: false, height: 10, scale: 1 })
  const vb = Number(svg.match(/viewBox="0 0 ([\d.]+) /)?.[1] ?? 0)
  const barras: Barra[] = []
  for (const p of svg.matchAll(/<path[^>]*stroke-width="([\d.]+)"[^>]*d="([^"]+)"/g)) {
    const sw = Number(p[1])
    for (const m of p[2].matchAll(/M([\d.]+)\s+[\d.]+L/g)) barras.push({ x: Number(m[1]) - sw / 2, w: sw })
  }
  return { barras: barras.sort((a, b) => a.x - b.x), largura: vb }
}

/** Quebra o texto em linhas que cabem em `maxW`. */
function quebra(txt: string, font: PDFFont, size: number, maxW: number, maxLinhas = 99): string[] {
  const palavras = ansi(txt).split(/\s+/).filter(Boolean)
  const linhas: string[] = []
  let atual = ''
  for (const p of palavras) {
    let pal = p
    // palavra maior que a linha: corta
    while (font.widthOfTextAtSize(pal, size) > maxW && pal.length > 1) {
      let i = pal.length - 1
      while (i > 1 && font.widthOfTextAtSize(pal.slice(0, i), size) > maxW) i--
      if (atual) { linhas.push(atual); atual = '' }
      linhas.push(pal.slice(0, i)); pal = pal.slice(i)
    }
    const tent = atual ? `${atual} ${pal}` : pal
    if (font.widthOfTextAtSize(tent, size) > maxW && atual) { linhas.push(atual); atual = pal } else atual = tent
  }
  if (atual) linhas.push(atual)
  if (linhas.length > maxLinhas) {
    const cortadas = linhas.slice(0, maxLinhas)
    cortadas[maxLinhas - 1] = cortadas[maxLinhas - 1].replace(/.{0,3}$/, '...')
    return cortadas
  }
  return linhas
}

const W = 595.28
const H = 841.89
const M = 14
const CW = W - M * 2 // 567.28
const RODAPE = 14

function soma(itens: DanfeItem[], f: (i: DanfeItem) => number | null | undefined): number {
  return itens.reduce((a, i) => a + (f(i) ?? 0), 0)
}

/** Completa só o que falta SOMANDO o que os itens já trazem (nunca recalcula imposto). */
export function totaisCompletos(d: DanfeDados) {
  const t = d.totais
  const baseIcms = t.baseIcms ?? soma(d.itens, (i) => i.baseIcms)
  const valorIcms = t.valorIcms ?? soma(d.itens, (i) => i.valorIcms)
  const valorIpi = t.valorIpi ?? soma(d.itens, (i) => i.valorIpi)
  const valorNota = t.valorNota ?? (t.valorProdutos + (t.frete ?? 0) + (t.seguro ?? 0) + (t.outrasDespesas ?? 0) - (t.desconto ?? 0) + valorIpi + (t.valorSt ?? 0))
  return { ...t, baseIcms, valorIcms, valorIpi, valorNota }
}

type Ctx = { page: PDFPage; font: PDFFont; bold: PDFFont }

function caixa(c: Ctx, x: number, yTop: number, w: number, h: number) {
  c.page.drawRectangle({ x, y: H - yTop - h, width: w, height: h, borderColor: NEGRO, borderWidth: 0.5 })
}
function texto(c: Ctx, s: string, x: number, yBase: number, size: number, bold = false, cor = NEGRO) {
  c.page.drawText(ansi(s), { x, y: H - yBase, size, font: bold ? c.bold : c.font, color: cor })
}
/** Campo padrão do DANFE: caixa com rótulo pequeno em cima e valor embaixo. */
function campo(c: Ctx, x: number, yTop: number, w: number, h: number, rotulo: string, valor: string, o: { align?: 'left' | 'right' | 'center'; bold?: boolean; size?: number; linhas?: number } = {}) {
  caixa(c, x, yTop, w, h)
  texto(c, rotulo, x + 2, yTop + 6.2, 5.2, false, LABEL)
  const size = o.size ?? 8
  const f = o.bold ? c.bold : c.font
  const linhas = quebra(valor, f, size, w - 5, o.linhas ?? 1)
  linhas.forEach((ln, i) => {
    const tw = f.widthOfTextAtSize(ln, size)
    const px = o.align === 'right' ? x + w - 2.5 - tw : o.align === 'center' ? x + (w - tw) / 2 : x + 2.5
    texto(c, ln, px, yTop + 14.5 + i * (size + 1), size, !!o.bold)
  })
}
function titulo(c: Ctx, t: string, x: number, yTop: number) {
  texto(c, t, x, yTop + 7, 6.5, true)
}

function linhaTracejada(page: PDFPage, y: number) {
  page.drawLine({ start: { x: M, y: H - y }, end: { x: W - M, y: H - y }, thickness: 0.5, color: NEGRO, dashArray: [3, 2] })
}

async function logoImg(doc: PDFDocument, logo: DanfeDados['emitente']['logo']) {
  if (!logo?.base64) return null
  try {
    const bin = atob(logo.base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return logo.mime === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
  } catch { return null }
}

type Layout = { paginas: Array<{ itens: number[] }>; alturasLinha: number[]; alturaAdicionais: number; adicionaisNaUltima: boolean }

const COLS = [
  { k: 'cod', t: 'CÓDIGO', w: 44, a: 'left' }, { k: 'desc', t: 'DESCRIÇÃO DO PRODUTO / SERVIÇO', w: 117, a: 'left' },
  { k: 'ncm', t: 'NCM/SH', w: 40, a: 'center' }, { k: 'cst', t: 'O/CST', w: 28, a: 'center' }, { k: 'cfop', t: 'CFOP', w: 28, a: 'center' },
  { k: 'un', t: 'UN', w: 20, a: 'center' }, { k: 'qtd', t: 'QUANT.', w: 38, a: 'right' }, { k: 'vun', t: 'VALOR UNIT.', w: 42, a: 'right' },
  { k: 'vt', t: 'VALOR TOTAL', w: 44, a: 'right' }, { k: 'bc', t: 'B.CÁLC ICMS', w: 42, a: 'right' }, { k: 'vi', t: 'VALOR ICMS', w: 38, a: 'right' },
  { k: 'vipi', t: 'VALOR IPI', w: 34, a: 'right' }, { k: 'ai', t: 'ALÍQ. ICMS', w: 26, a: 'right' }, { k: 'aipi', t: 'ALÍQ. IPI', w: 26, a: 'right' },
] as const

/** Gera o DANFE e devolve os bytes do PDF. Sem protocolo → marca d'água de conferência. */
export async function gerarDanfePdf(d: DanfeDados, o: DanfeOpcoes): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const logo = await logoImg(doc, d.emitente.logo)
  const tot = totaisCompletos(d)
  const autorizada = !!so(d.protocolo)
  const chave = so(d.chave)
  const infoTxt = (d.informacoesComplementares ?? '').trim()
  const colDesc = COLS[1].w - 4

  // ---- paginação (alturas conhecidas antes de desenhar, para "Folha x/y") ----
  const alturasLinha = d.itens.map((it) => {
    const desc = `${it.descricao}${it.chassi ? ` - CHASSI ${it.chassi}` : ''}`
    const n = Math.min(6, quebra(desc, font, 6.2, colDesc).length)
    return Math.max(11, n * 7 + 4)
  })
  const FIXO_P1 = 14 + 62 + 88 + 22 + 22 + 75 + 53 + 75 + 9 + 14 // até o cabeçalho da tabela de produtos (pág. 1)
  const FIXO_PN = 14 + 88 + 9 + 14
  const linhasInfo = quebra(infoTxt, font, 6.5, CW * 0.7 - 6).length
  const alturaAdicionais = 9 + Math.max(62, linhasInfo * 7.4 + 12)
  const fim = H - RODAPE - 4
  const paginas: Layout['paginas'] = [{ itens: [] }]
  let usado = FIXO_P1
  alturasLinha.forEach((h, i) => {
    if (usado + h > fim) { paginas.push({ itens: [] }); usado = FIXO_PN }
    paginas[paginas.length - 1].itens.push(i); usado += h
  })
  let adicionaisNaUltima = true
  if (usado + 4 + alturaAdicionais > fim) { paginas.push({ itens: [] }); adicionaisNaUltima = false }
  const total = paginas.length

  const marca = (page: PDFPage) => {
    // GRANDE marca diagonal (45°) centralizada no corpo da nota, leiaute oficial do DANFE de conferência.
    // Cada linha é auto-dimensionada para ocupar a diagonal da folha; empilhadas na PERPENDICULAR, centradas no meio.
    const ang = Math.PI / 4
    const dir = { x: Math.cos(ang), y: Math.sin(ang) }     // direção do texto
    const perp = { x: -Math.sin(ang), y: Math.cos(ang) }   // perpendicular (empilha as linhas)
    const maxW = Math.sqrt(W * W + H * H) * 0.70            // 70% da diagonal (não sangra nas margens)
    const sized = MARCA_CONFERENCIA.map((ln) => {
      const t = ansi(ln)
      const size = Math.min(46, maxW / (bold.widthOfTextAtSize(t, 1) || 1))
      return { t, size }
    })
    const gap = Math.max(...sized.map((s) => s.size)) * 1.18
    sized.forEach((s, i) => {
      const off = (i - (sized.length - 1) / 2) * gap
      const cx = W / 2 + perp.x * off, cy = H / 2 + perp.y * off
      const tw = bold.widthOfTextAtSize(s.t, s.size)
      page.drawText(s.t, { x: cx - dir.x * tw / 2, y: cy - dir.y * tw / 2, size: s.size, font: bold, color: MARCA_COR, rotate: degrees(45) })
    })
  }

  const cabecalho = (c: Ctx, yTop: number, folha: number): number => {
    const e = d.emitente
    const wE = 205, wD = 112, wC = CW - wE - wD
    // 1) emitente
    caixa(c, M, yTop, wE, 88)
    texto(c, 'IDENTIFICAÇÃO DO EMITENTE', M + 3, yTop + 7, 5.4, false, LABEL)
    const xTxt = logo ? M + 56 : M + 4
    if (logo) {
      const esc = Math.min(48 / logo.width, 48 / logo.height)
      c.page.drawImage(logo, { x: M + 4, y: H - yTop - 14 - logo.height * esc - (48 - logo.height * esc) / 2, width: logo.width * esc, height: logo.height * esc })
    }
    let yy = yTop + 18
    quebra(e.razaoSocial.toUpperCase(), bold, 8.6, wE - (xTxt - M) - 4, 3).forEach((ln) => { texto(c, ln, xTxt, yy, 8.6, true); yy += 9.6 })
    const end = [e.endereco, e.bairro].filter(Boolean).join(' - ')
    const cid = [e.cep ? `CEP ${fmtCep(e.cep)}` : '', [e.municipio, e.uf].filter(Boolean).join(' - ')].filter(Boolean).join(' · ')
    for (const ln of [end, cid, e.fone ? `Fone: ${e.fone}` : '', `CNPJ ${fmtDocumento(e.cnpj)}${e.ie ? ` · IE ${e.ie}` : ''}`]) {
      if (!ln) continue
      quebra(ln, c.font, 6.6, wE - (xTxt - M) - 4, 2).forEach((l) => { texto(c, l, xTxt, yy, 6.6); yy += 7.6 })
    }
    // 2) DANFE
    const xC = M + wE
    caixa(c, xC, yTop, wC, 88)
    const cx = xC + wC / 2
    const ctr = (s: string, y: number, size: number, b = false) => texto(c, s, cx - (b ? c.bold : c.font).widthOfTextAtSize(ansi(s), size) / 2, y, size, b)
    // #11234 · pilha ÚNICA centralizada verticalmente no quadro (padrão OMIE/Tryo): título → tipo → Nº/Série/Folha
    // juntos, sem o vão morto no meio. O bloco Nº/Série/Folha NÃO fica mais ancorado ao rodapé do quadro.
    ctr('DANFE', yTop + 19, 15, true)
    ctr('Documento Auxiliar da', yTop + 28, 6.3); ctr('Nota Fiscal Eletrônica', yTop + 35, 6.3)
    texto(c, '0 - ENTRADA', xC + 6, yTop + 46, 6.3); texto(c, '1 - SAÍDA', xC + 6, yTop + 53.5, 6.3)
    caixa(c, xC + wC - 26, yTop + 40, 18, 16)
    texto(c, String(d.tipoOperacao ?? 1), xC + wC - 26 + 9 - c.bold.widthOfTextAtSize(String(d.tipoOperacao ?? 1), 10) / 2, yTop + 51.5, 10, true)
    ctr(`Nº ${fmtNumero(d.numero) || '—'}`, yTop + 63, 8.2, true)
    ctr(`SÉRIE ${d.serie ?? '—'}`, yTop + 71, 8.2, true)
    ctr(`Folha ${folha}/${total}`, yTop + 79, 7.2, true)
    // 3) chave + barras
    const xD = xC + wC
    caixa(c, xD, yTop, wD, 88)
    const wDr = wD
    if (chave.length === 44) {
      const { barras, largura } = barrasCode128(chave)
      const bw = wDr - 10, esc = bw / largura
      for (const b of barras) c.page.drawRectangle({ x: xD + 5 + b.x * esc, y: H - yTop - 4 - 33, width: b.w * esc, height: 33, color: NEGRO })
    } else {
      texto(c, 'SEM CHAVE DE ACESSO', xD + 8, yTop + 22, 6.2, true)
      texto(c, '(nota ainda não transmitida)', xD + 8, yTop + 30, 5.6, false, LABEL)
    }
    texto(c, 'CHAVE DE ACESSO', xD + 3, yTop + 44, 5.2, false, LABEL)
    if (chave.length === 44) {
      const f = fmtChave(chave).split(' ')
      const l1 = f.slice(0, 6).join(' '), l2 = f.slice(6).join(' ')
      texto(c, l1, xD + 3, yTop + 52, 5.6, true); texto(c, l2, xD + 3, yTop + 59, 5.6, true)
    } else texto(c, '—', xD + 3, yTop + 53, 7, true)
    quebra('Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora', c.font, 5.2, wD - 6, 5).forEach((l, i) => texto(c, l, xD + 3, yTop + 68 + i * 5.8, 5.2, false, LABEL))
    return yTop + 88
  }

  const tabelaCab = (c: Ctx, yTop: number) => {
    titulo(c, 'DADOS DOS PRODUTOS / SERVIÇOS', M, yTop)
    let x = M
    const y0 = yTop + 9
    for (const col of COLS) {
      caixa(c, x, y0, col.w, 14)
      const t = col.k === 'cst' && d.simples ? 'O/CSOSN' : col.t
      const linhas = quebra(t, c.font, 4.8, col.w - 3, 2)
      linhas.forEach((l, i) => {
        const tw = c.font.widthOfTextAtSize(l, 4.8)
        texto(c, l, x + (col.w - tw) / 2, y0 + (linhas.length === 1 ? 8.8 : 6.3 + i * 5.2), 4.8, false, LABEL)
      })
      x += col.w
    }
    return y0 + 14
  }

  const desenhaItem = (c: Ctx, it: DanfeItem, yTop: number, h: number) => {
    const cst = `${it.origem ?? ''}${it.cst ?? ''}`
    const vals: Record<string, string> = {
      cod: it.codigo ?? '', desc: '', ncm: it.ncm ?? '', cst, cfop: it.cfop ?? '', un: it.un ?? '',
      qtd: n4(it.quantidade), vun: n4(it.valorUnitario), vt: n2(it.valorTotal), bc: n2(it.baseIcms), vi: n2(it.valorIcms),
      vipi: n2(it.valorIpi), ai: n2(it.aliqIcms), aipi: n2(it.aliqIpi),
    }
    let x = M
    for (const col of COLS) {
      caixa(c, x, yTop, col.w, h)
      if (col.k === 'desc') {
        const desc = `${it.descricao}${it.chassi ? ` - CHASSI ${it.chassi}` : ''}`
        quebra(desc, c.font, 6.2, col.w - 4, 6).forEach((l, i) => texto(c, l, x + 2, yTop + 7.5 + i * 7, 6.2))
      } else {
        const v = ansi(vals[col.k])
        const f = c.font, size = 6.4
        const tw = f.widthOfTextAtSize(v, size)
        const px = col.a === 'right' ? x + col.w - 2 - tw : col.a === 'center' ? x + (col.w - tw) / 2 : x + 2
        texto(c, v, px, yTop + 7.5, size)
      }
      x += col.w
    }
  }

  // Completa a área de produtos com linhas vazias: as colunas (verticais) continuam até o fim, como no DANFE oficial —
  // a folha A4 fica inteira ocupada mesmo com poucos itens, em vez de parar no meio.
  const linhasVazias = (c: Ctx, yStart: number, yEnd: number) => {
    const h = yEnd - yStart
    if (h < 2) return
    caixa(c, M, yStart, CW, h)
    let x = M
    for (const col of COLS) {
      x += col.w
      if (x < W - M - 0.5) c.page.drawLine({ start: { x, y: H - yStart }, end: { x, y: H - yEnd }, thickness: 0.4, color: NEGRO })
    }
  }

  const blocosAdicionais = (c: Ctx, yTop: number) => {
    titulo(c, 'DADOS ADICIONAIS', M, yTop)
    const h = alturaAdicionais - 9, y0 = yTop + 9
    const wI = CW * 0.7
    caixa(c, M, y0, wI, h); texto(c, 'INFORMAÇÕES COMPLEMENTARES', M + 2, y0 + 6.2, 5.2, false, LABEL)
    quebra(infoTxt, c.font, 6.5, wI - 6).forEach((l, i) => texto(c, l, M + 3, y0 + 15 + i * 7.4, 6.5))
    caixa(c, M + wI, y0, CW - wI, h); texto(c, 'RESERVADO AO FISCO', M + wI + 2, y0 + 6.2, 5.2, false, LABEL)
    if (d.reservadoFisco) quebra(d.reservadoFisco, c.font, 6.5, CW - wI - 6).forEach((l, i) => texto(c, l, M + wI + 3, y0 + 15 + i * 7.4, 6.5))
  }

  for (let p = 0; p < total; p++) {
    const page = doc.addPage([W, H])
    const c: Ctx = { page, font, bold }
    if (!autorizada) marca(page)
    let y = M
    if (p === 0) {
      // 1) canhoto
      const wNF = 104
      campo(c, M, y, CW - wNF, 22, 'RECEBEMOS DE', `${d.emitente.razaoSocial.toUpperCase()} OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA AO LADO`, { size: 6.4, linhas: 2 })
      caixa(c, M + CW - wNF, y, wNF, 40)
      texto(c, 'NF-e', M + CW - wNF + wNF / 2 - bold.widthOfTextAtSize('NF-e', 11) / 2, y + 13, 11, true)
      const nn = `Nº ${fmtNumero(d.numero) || '—'}`
      texto(c, nn, M + CW - wNF + wNF / 2 - bold.widthOfTextAtSize(nn, 8.2) / 2, y + 24, 8.2, true)
      const ss = `SÉRIE ${d.serie ?? '—'}`
      texto(c, ss, M + CW - wNF + wNF / 2 - bold.widthOfTextAtSize(ss, 8.2) / 2, y + 34, 8.2, true)
      campo(c, M, y + 22, 112, 18, 'DATA DE RECEBIMENTO', '')
      campo(c, M + 112, y + 22, CW - wNF - 112, 18, 'IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR', '')
      y += 40 + 8
      linhaTracejada(page, y - 4)
      y += 14
    }
    y = cabecalho(c, y, p + 1)

    if (p === 0) {
      // 3) natureza | protocolo
      const wP = 190
      campo(c, M, y, CW - wP, 22, 'NATUREZA DA OPERAÇÃO', d.naturezaOperacao, { bold: true })
      const prot = autorizada ? `${d.protocolo}${d.protocoloDataISO ? ` - ${dataBR(d.protocoloDataISO)} ${horaBR(d.protocoloDataISO)}` : ''}` : ''
      campo(c, M + CW - wP, y, wP, 22, 'PROTOCOLO DE AUTORIZAÇÃO DE USO', prot, { bold: true })
      y += 22
      // 4) IE | IE ST | CNPJ
      const w3 = CW / 3
      campo(c, M, y, w3, 22, 'INSCRIÇÃO ESTADUAL', d.emitente.ie ?? '')
      campo(c, M + w3, y, w3, 22, 'INSCRIÇÃO ESTADUAL DO SUBST. TRIBUT.', d.emitente.ieSt ?? '')
      campo(c, M + 2 * w3, y, CW - 2 * w3, 22, 'CNPJ', fmtDocumento(d.emitente.cnpj))
      y += 22 + 0
      // 5) destinatário
      y += 0
      titulo(c, 'DESTINATÁRIO / REMETENTE', M, y); y += 9
      const dt = d.destinatario
      const wData = 80, wDoc = 118
      campo(c, M, y, CW - wDoc - wData, 22, 'NOME / RAZÃO SOCIAL', dt.nome, { bold: true })
      campo(c, M + CW - wDoc - wData, y, wDoc, 22, 'CNPJ / CPF', fmtDocumento(dt.documento))
      campo(c, M + CW - wData, y, wData, 22, 'DATA DA EMISSÃO', dataBR(d.dataEmissaoISO), { align: 'center' })
      y += 22
      const wB = 140, wCep = 70
      campo(c, M, y, CW - wB - wCep - wData, 22, 'ENDEREÇO', dt.endereco ?? '', { linhas: 1 })
      campo(c, M + CW - wB - wCep - wData, y, wB, 22, 'BAIRRO / DISTRITO', dt.bairro ?? '')
      campo(c, M + CW - wCep - wData, y, wCep, 22, 'CEP', fmtCep(dt.cep), { align: 'center' })
      campo(c, M + CW - wData, y, wData, 22, 'DATA DA SAÍDA/ENTRADA', dataBR(d.dataSaidaISO), { align: 'center' })
      y += 22
      const wF = 90, wUf = 28, wIe = 118
      campo(c, M, y, CW - wF - wUf - wIe - wData, 22, 'MUNICÍPIO', dt.municipio ?? '')
      campo(c, M + CW - wF - wUf - wIe - wData, y, wF, 22, 'FONE / FAX', dt.fone ?? '')
      campo(c, M + CW - wUf - wIe - wData, y, wUf, 22, 'UF', dt.uf ?? '', { align: 'center' })
      campo(c, M + CW - wIe - wData, y, wIe, 22, 'INSCRIÇÃO ESTADUAL', dt.ie ?? '')
      campo(c, M + CW - wData, y, wData, 22, 'HORA DA SAÍDA', d.horaSaida ?? '', { align: 'center' })
      y += 22
      // 6) cálculo do imposto
      titulo(c, 'CÁLCULO DO IMPOSTO', M, y); y += 9
      const r1: Array<[string, number | null | undefined]> = [
        ['BASE DE CÁLC. DO ICMS', tot.baseIcms], ['VALOR DO ICMS', tot.valorIcms], ['BASE DE CÁLC. ICMS ST', tot.baseSt], ['VALOR DO ICMS SUBST.', tot.valorSt],
        ['V. IMP. IMPORTAÇÃO', tot.valorImpImportacao], ['VALOR DO PIS', tot.valorPis], ['VALOR TOTAL DOS PRODUTOS', tot.valorProdutos],
      ]
      const r2: Array<[string, number | null | undefined]> = [
        ['VALOR DO FRETE', tot.frete], ['VALOR DO SEGURO', tot.seguro], ['DESCONTO', tot.desconto], ['OUTRAS DESP. ACESSÓRIAS', tot.outrasDespesas],
        ['VALOR TOTAL DO IPI', tot.valorIpi], ['VALOR DA COFINS', tot.valorCofins], ['VALOR TOTAL DA NOTA', tot.valorNota],
      ]
      for (const linha of [r1, r2]) {
        const wc = CW / 7
        linha.forEach(([r, v], i) => campo(c, M + i * wc, y, wc, 22, r, n2(v ?? 0), { align: 'right', bold: r === 'VALOR TOTAL DA NOTA' }))
        y += 22
      }
      // 7) transportador / volumes
      titulo(c, 'TRANSPORTADOR / VOLUMES TRANSPORTADOS', M, y); y += 9
      const tr = d.transporte ?? {}
      const wFr = 100, wAn = 66, wPl = 66, wUf2 = 26, wCj = 116
      campo(c, M, y, CW - wFr - wAn - wPl - wUf2 - wCj, 22, 'NOME / RAZÃO SOCIAL', tr.nome ?? '')
      campo(c, M + CW - wFr - wAn - wPl - wUf2 - wCj, y, wFr, 22, 'FRETE POR CONTA', FRETE_TXT[tr.modalidade ?? 9] ?? '')
      campo(c, M + CW - wAn - wPl - wUf2 - wCj, y, wAn, 22, 'CÓDIGO ANTT', tr.codigoAntt ?? '')
      campo(c, M + CW - wPl - wUf2 - wCj, y, wPl, 22, 'PLACA DO VEÍCULO', tr.placa ?? '')
      campo(c, M + CW - wUf2 - wCj, y, wUf2, 22, 'UF', tr.ufPlaca ?? '', { align: 'center' })
      campo(c, M + CW - wCj, y, wCj, 22, 'CNPJ / CPF', fmtDocumento(tr.documento))
      y += 22
      const wMu = 150, wUf3 = 28, wIe3 = 130
      campo(c, M, y, CW - wMu - wUf3 - wIe3, 22, 'ENDEREÇO', tr.endereco ?? '')
      campo(c, M + CW - wMu - wUf3 - wIe3, y, wMu, 22, 'MUNICÍPIO', tr.municipio ?? '')
      campo(c, M + CW - wUf3 - wIe3, y, wUf3, 22, 'UF', tr.uf ?? '', { align: 'center' })
      campo(c, M + CW - wIe3, y, wIe3, 22, 'INSCRIÇÃO ESTADUAL', tr.ie ?? '')
      y += 22
      const v6: Array<[string, string | null | undefined]> = [['QUANTIDADE', tr.quantidade], ['ESPÉCIE', tr.especie], ['MARCA', tr.marca], ['NUMERAÇÃO', tr.numeracao], ['PESO BRUTO', tr.pesoBruto], ['PESO LÍQUIDO', tr.pesoLiquido]]
      v6.forEach(([r, v], i) => campo(c, M + i * (CW / 6), y, CW / 6, 22, r, v ?? ''))
      y += 22
    }
    // 8) produtos — a tabela ESTICA até os dados adicionais/rodapé (folha A4 inteira, leiaute oficial do DANFE)
    y = tabelaCab(c, y)
    for (const idx of paginas[p].itens) {
      desenhaItem(c, d.itens[idx], y, alturasLinha[idx]); y += alturasLinha[idx]
    }
    const ultima = p === total - 1
    const adicionaisAqui = ultima && (adicionaisNaUltima || paginas[p].itens.length === 0)
    const yAdicTop = fim - alturaAdicionais
    // a área de produtos vai até os dados adicionais (na última folha) ou até o rodapé (nas demais)
    const yProdutosFim = adicionaisAqui ? yAdicTop - 4 : fim
    if (y < yProdutosFim) linhasVazias(c, y, yProdutosFim)
    // 9) dados adicionais — ancorados no rodapé
    if (adicionaisAqui) blocosAdicionais(c, yAdicTop)
    // 10) rodapé
    const imp = `Impresso em ${dataBR(o.impressoEmISO)} às ${horaBR(o.impressoEmISO)}${autorizada ? '' : ' · documento de conferência — sem valor fiscal'}`
    texto(c, imp, M, H - 5, 6, false, LABEL)
    const fl = `Folha ${p + 1}/${total}`
    texto(c, fl, W - M - font.widthOfTextAtSize(fl, 6), H - 5, 6, false, LABEL)
  }
  return await doc.save()
}
