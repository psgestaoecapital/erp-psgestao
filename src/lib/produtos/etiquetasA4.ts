// Etiquetas de produto em folha A4 (CEO 30/09 · Diego/FC: identificar material no almoxarifado).
// Cada etiqueta: nome, código, local de armazenagem (erp_produtos.localizacao) e código de barras.
// Código de barras: o EAN do produto quando for um EAN-13/EAN-8 válido; senão Code128 do código_barras
// informado; sem nenhum dos dois, Code128 do código interno (é o que o leitor vai bipar no estoque).
// Folha padrão 3×8 (70×37 mm, compatível com as folhas A4 de 24 etiquetas). O desenho do código de barras é
// injetado (renderBarcode) para o mesmo gerador rodar no navegador (canvas) e no gate do build (bwip-js/node).

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

export interface EtiquetaProduto {
  codigo: string | null
  nome: string
  codigo_barras?: string | null
  localizacao?: string | null
}

export interface SimboloBarras {
  bcid: 'ean13' | 'ean8' | 'code128'
  texto: string
}

export type RenderBarcode = (s: SimboloBarras) => Promise<Uint8Array>

export const FOLHA_A4 = {
  colunas: 3,
  linhas: 8,
  larguraMm: 70,
  alturaMm: 37,
  margemTopoMm: 4.5,
  margemEsqMm: 0,
  rotulo: '3 × 8 (70 × 37 mm · 24 por folha)',
} as const

export const POR_FOLHA = FOLHA_A4.colunas * FOLHA_A4.linhas
export const MAX_ETIQUETAS = 2400 // 100 folhas por geração

const MM = 72 / 25.4
const A4 = { w: 595.28, h: 841.89 }

const soDigitos = (s: string) => s.replace(/\D/g, '')

/** Dígito verificador GS1 (EAN-8/EAN-13): pesos 3/1 da direita para a esquerda, sem o próprio dígito. */
export function eanValido(s: string): boolean {
  if (!/^\d+$/.test(s) || (s.length !== 13 && s.length !== 8)) return false
  const corpo = s.slice(0, -1)
  let soma = 0
  for (let i = 0; i < corpo.length; i++) {
    const d = Number(corpo[corpo.length - 1 - i])
    soma += i % 2 === 0 ? d * 3 : d
  }
  return (10 - (soma % 10)) % 10 === Number(s[s.length - 1])
}

/** Code128 só codifica ASCII: tira acento e troca o resto por '-'. */
export function textoCode128(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '-')
    .trim()
    .slice(0, 40)
}

export function simboloDoProduto(p: EtiquetaProduto): SimboloBarras | null {
  const barras = (p.codigo_barras ?? '').trim()
  if (barras) {
    const d = soDigitos(barras)
    if (d === barras && eanValido(d)) return { bcid: d.length === 13 ? 'ean13' : 'ean8', texto: d }
    const t = textoCode128(barras)
    if (t) return { bcid: 'code128', texto: t }
  }
  const t = textoCode128(p.codigo ?? '')
  return t ? { bcid: 'code128', texto: t } : null
}

export interface Posicao { pagina: number; coluna: number; linha: number }

/** Posição de cada etiqueta na folha; `inicio` (1..24) pula as já usadas da primeira folha. */
export function posicoesEtiquetas(total: number, inicio = 1): Posicao[] {
  const pular = Math.min(Math.max(Math.floor(inicio) || 1, 1), POR_FOLHA) - 1
  const out: Posicao[] = []
  for (let i = 0; i < total; i++) {
    const slot = pular + i
    const pagina = Math.floor(slot / POR_FOLHA)
    const n = slot % POR_FOLHA
    out.push({ pagina, linha: Math.floor(n / FOLHA_A4.colunas), coluna: n % FOLHA_A4.colunas })
  }
  return out
}

/** Repete cada produto `copias` vezes, na ordem da seleção. */
export function expandirCopias<T>(itens: T[], copias: number): T[] {
  const c = Math.min(Math.max(Math.floor(copias) || 1, 1), 100)
  return itens.flatMap((p) => Array.from({ length: c }, () => p))
}

// pdf-lib com fonte padrão só desenha WinAnsi (Latin-1 + os extras do cp1252: — – … • “ ” ‘ ’ €…); o resto vira '?'.
const EXTRAS_CP1252 = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
export function winAnsi(s: string): string {
  let out = ''
  for (const ch of s) out += (ch.codePointAt(0) ?? 0) > 0xff && !EXTRAS_CP1252.has(ch) ? '?' : ch
  return out
}

function quebrar(texto: string, font: PDFFont, tam: number, largura: number, maxLinhas: number): string[] {
  const palavras = winAnsi(texto).split(/\s+/).filter(Boolean)
  const linhas: string[] = []
  let atual = ''
  for (const p of palavras) {
    const tentativa = atual ? `${atual} ${p}` : p
    if (!atual || font.widthOfTextAtSize(tentativa, tam) <= largura) { atual = tentativa; continue }
    linhas.push(atual)
    atual = p
  }
  if (atual) linhas.push(atual)
  const res = linhas.slice(0, maxLinhas).map((l) => cortar(l, font, tam, largura))
  if (linhas.length > maxLinhas) res[maxLinhas - 1] = cortar(`${res[maxLinhas - 1]}…`, font, tam, largura, true)
  return res
}

function cortar(s: string, font: PDFFont, tam: number, largura: number, reticencias = false): string {
  if (font.widthOfTextAtSize(s, tam) <= largura) return s
  let t = reticencias ? s.replace(/…$/, '') : s
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, tam) > largura) t = t.slice(0, -1)
  return `${t}…`
}

function centro(page: PDFPage, s: string, font: PDFFont, tam: number, xIni: number, largura: number, y: number) {
  const w = font.widthOfTextAtSize(s, tam)
  page.drawText(s, { x: xIni + (largura - w) / 2, y, size: tam, font, color: rgb(0, 0, 0) })
}

export interface OpcoesEtiquetas {
  copias?: number
  inicio?: number
  renderBarcode: RenderBarcode
}

export async function gerarEtiquetasA4(produtos: EtiquetaProduto[], op: OpcoesEtiquetas): Promise<Uint8Array> {
  const itens = expandirCopias(produtos, op.copias ?? 1)
  if (itens.length === 0) throw new Error('Selecione ao menos um produto.')
  if (itens.length > MAX_ETIQUETAS) throw new Error(`Máximo de ${MAX_ETIQUETAS} etiquetas por vez (${MAX_ETIQUETAS / POR_FOLHA} folhas).`)

  const pdf = await PDFDocument.create()
  pdf.setTitle('Etiquetas de produtos')
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold)

  const W = FOLHA_A4.larguraMm * MM
  const H = FOLHA_A4.alturaMm * MM
  const PAD = 3 * MM
  const larguraUtil = W - 2 * PAD
  const pos = posicoesEtiquetas(itens.length, op.inicio)
  const paginas: PDFPage[] = []
  const cacheBarras = new Map<string, Awaited<ReturnType<PDFDocument['embedPng']>>>()

  for (let i = 0; i < itens.length; i++) {
    const p = itens[i]
    const { pagina, coluna, linha } = pos[i]
    while (paginas.length <= pagina) paginas.push(pdf.addPage([A4.w, A4.h]))
    const page = paginas[pagina]
    const x0 = FOLHA_A4.margemEsqMm * MM + coluna * W
    const yTopo = A4.h - FOLHA_A4.margemTopoMm * MM - linha * H
    let y = yTopo - PAD

    // nome (até 2 linhas)
    for (const l of quebrar(p.nome || '(sem nome)', negrito, 9, larguraUtil, 2)) {
      y -= 9.5
      page.drawText(l, { x: x0 + PAD, y, size: 9, font: negrito, color: rgb(0, 0, 0) })
    }
    // código · local
    y -= 10.5
    const cod = winAnsi(`Cód. ${p.codigo ?? '—'}`)
    page.drawText(cortar(cod, regular, 8, larguraUtil * 0.45), { x: x0 + PAD, y, size: 8, font: regular, color: rgb(0, 0, 0) })
    const local = (p.localizacao ?? '').trim()
    const txtLocal = cortar(winAnsi(local ? `Local: ${local}` : 'Local: —'), negrito, 8, larguraUtil * 0.55)
    page.drawText(txtLocal, {
      x: x0 + W - PAD - negrito.widthOfTextAtSize(txtLocal, 8), y, size: 8, font: negrito, color: rgb(0, 0, 0),
    })

    // código de barras + texto legível
    const sim = simboloDoProduto(p)
    if (sim) {
      const chave = `${sim.bcid}:${sim.texto}`
      let img = cacheBarras.get(chave)
      if (!img) {
        img = await pdf.embedPng(await op.renderBarcode(sim))
        cacheBarras.set(chave, img)
      }
      const yBase = yTopo - H + PAD + 8
      const altura = Math.max(Math.min(y - 3 - yBase, 34), 16)
      const escala = altura / img.height
      const largura = Math.min(img.width * escala, larguraUtil)
      page.drawImage(img, { x: x0 + (W - largura) / 2, y: yBase, width: largura, height: altura })
      centro(page, sim.texto, regular, 7, x0, W, yBase - 7.5)
    }
  }
  return pdf.save()
}

/** Opções do bwip-js para cada símbolo (mesmas no navegador e no gate). */
export function opcoesBwip(s: SimboloBarras) {
  return { bcid: s.bcid, text: s.texto, scale: 3, height: 10, includetext: false, backgroundcolor: 'FFFFFF' }
}
