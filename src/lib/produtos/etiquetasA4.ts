// Etiquetas de produto em folha A4 (CEO 30/09 · Diego/FC: identificar material no almoxarifado).
// Cada etiqueta: nome, código, local de armazenagem (erp_produtos.localizacao) e, se pedido, código de barras.
// Ajuste da FC (30/09, 1ª impressão real): letra maior, nome inteiro em até 3 linhas, barras opcionais e linha em
// branco quando o local não está cadastrado.
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

// Tamanhos (pt) — ajuste da FC depois da 1ª impressão real (30/09): nome legível a ~1 m na prateleira; sem código
// de barras, o espaço das barras vai para o texto. O nome nunca é cortado: quebra em até 3 linhas e só então a letra
// diminui, até caber.
export const LAYOUT = {
  entrelinha: 1.12,
  barrasAltura: 18,        // ~6,4 mm de barras + o texto legível embaixo
  comBarras: { nomeMax: 18, nomeMin: 6, codigo: 10, local: 10 },
  semBarras: { nomeMax: 26, nomeMin: 7, codigo: 13, local: 13 },
  maxLinhasNome: 3,
} as const

/** Quebra por palavras; palavra maior que a linha é partida em pedaços (nenhuma letra some). */
export function quebrarLinhas(texto: string, font: PDFFont, tam: number, largura: number): string[] {
  const pedacos: string[] = []
  for (const p of winAnsi(texto).split(/\s+/).filter(Boolean)) {
    if (font.widthOfTextAtSize(p, tam) <= largura) { pedacos.push(p); continue }
    let resto = p
    while (resto) {
      let n = resto.length
      while (n > 1 && font.widthOfTextAtSize(resto.slice(0, n), tam) > largura) n--
      pedacos.push(resto.slice(0, n))
      resto = resto.slice(n)
    }
  }
  const linhas: string[] = []
  let atual = ''
  for (const p of pedacos) {
    const tentativa = atual ? `${atual} ${p}` : p
    if (!atual || font.widthOfTextAtSize(tentativa, tam) <= largura) { atual = tentativa; continue }
    linhas.push(atual)
    atual = p
  }
  if (atual) linhas.push(atual)
  return linhas
}

export interface AjusteNome { linhas: string[]; tamanho: number; cortado: boolean }

/** Altura ocupada por n linhas de tamanho t (do topo da 1ª letra ao pé da última). */
const alturaLinhas = (n: number, t: number) => t * (0.99 + LAYOUT.entrelinha * (n - 1))

/** Maior letra em que o nome inteiro cabe em até 3 linhas e na altura disponível. Corte com "…" só como último
 *  recurso, abaixo do tamanho mínimo (nome absurdo de longo). */
export function ajustarNome(texto: string, font: PDFFont, largura: number, alturaMax: number, tamMax: number, tamMin: number): AjusteNome {
  const nome = texto.trim() || '(sem nome)'
  for (let t = tamMax; t >= tamMin - 1e-9; t -= 0.5) {
    const l = quebrarLinhas(nome, font, t, largura)
    if (l.length <= LAYOUT.maxLinhasNome && alturaLinhas(l.length, t) <= alturaMax) return { linhas: l, tamanho: t, cortado: false }
  }
  const l = quebrarLinhas(nome, font, tamMin, largura)
  const res = l.slice(0, LAYOUT.maxLinhasNome)
  const cortado = l.length > LAYOUT.maxLinhasNome
  if (cortado) res[res.length - 1] = cortar(`${res[res.length - 1]}…`, font, tamMin, largura, true)
  return { linhas: res, tamanho: tamMin, cortado }
}

/** Tamanho que faz o texto caber numa linha (sem passar de tamMax nem descer de tamMin). */
function tamanhoQueCabe(s: string, font: PDFFont, tamMax: number, tamMin: number, largura: number): number {
  const w = font.widthOfTextAtSize(s, tamMax)
  return w <= largura ? tamMax : Math.max(tamMin, Math.floor(((tamMax * largura) / w) * 4) / 4)
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
  /** Imprimir o código de barras (padrão: sim). Sem ele, o espaço vai para o texto. */
  codigoBarras?: boolean
  renderBarcode: RenderBarcode
}

export async function gerarEtiquetasA4(produtos: EtiquetaProduto[], op: OpcoesEtiquetas): Promise<Uint8Array> {
  const itens = expandirCopias(produtos, op.copias ?? 1)
  if (itens.length === 0) throw new Error('Selecione ao menos um produto.')
  if (itens.length > MAX_ETIQUETAS) throw new Error(`Máximo de ${MAX_ETIQUETAS} etiquetas por vez (${MAX_ETIQUETAS / POR_FOLHA} folhas).`)
  const comBarras = op.codigoBarras !== false
  const tam = comBarras ? LAYOUT.comBarras : LAYOUT.semBarras

  const pdf = await PDFDocument.create()
  pdf.setTitle('Etiquetas de produtos')
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold)
  const preto = rgb(0, 0, 0)

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
    const topo = yTopo - PAD
    const base = yTopo - H + PAD

    // rodapé: código de barras + texto legível (só com a opção ligada)
    const sim = comBarras ? simboloDoProduto(p) : null
    let pisoTexto = base
    if (comBarras) {
      pisoTexto = base + 7.5 + LAYOUT.barrasAltura + 2.5
      if (sim) {
        const chave = `${sim.bcid}:${sim.texto}`
        let img = cacheBarras.get(chave)
        if (!img) {
          img = await pdf.embedPng(await op.renderBarcode(sim))
          cacheBarras.set(chave, img)
        }
        const escala = LAYOUT.barrasAltura / img.height
        const largura = Math.min(img.width * escala, larguraUtil)
        page.drawImage(img, { x: x0 + (W - largura) / 2, y: base + 7.5, width: largura, height: LAYOUT.barrasAltura })
        centro(page, sim.texto, regular, 6, x0, W, base + 0.5)
      }
    }

    // local (linha de baixo) e código (acima dela), com a largura toda — o código nunca sai cortado
    const local = winAnsi((p.localizacao ?? '').trim())
    const yLocal = pisoTexto + tam.local * 0.25
    if (local) {
      const s = `Local: ${local}`
      const t = tamanhoQueCabe(s, negrito, tam.local, 6, larguraUtil)
      page.drawText(cortar(s, negrito, t, larguraUtil), { x: x0 + PAD, y: yLocal, size: t, font: negrito, color: preto })
    } else {
      // sem local cadastrado: "Local:" + linha em branco para escrever à mão
      page.drawText('Local:', { x: x0 + PAD, y: yLocal, size: tam.local, font: negrito, color: preto })
      const xLinha = x0 + PAD + negrito.widthOfTextAtSize('Local:', tam.local) + 3
      page.drawLine({ start: { x: xLinha, y: yLocal - 1.5 }, end: { x: x0 + W - PAD, y: yLocal - 1.5 }, thickness: 0.7, color: preto })
    }
    const cod = winAnsi(`Cód. ${p.codigo ?? '—'}`)
    const tCod = tamanhoQueCabe(cod, regular, tam.codigo, 6, larguraUtil)
    const yCod = yLocal + tam.local * 1.2
    page.drawText(cortar(cod, regular, tCod, larguraUtil), { x: x0 + PAD, y: yCod, size: tCod, font: regular, color: preto })

    // nome no topo: a maior letra em que ele cabe inteiro (até 3 linhas) no espaço que sobra
    const alturaNome = topo - (yCod + tam.codigo * 0.8 + 3)
    const aj = ajustarNome(p.nome, negrito, larguraUtil, alturaNome, tam.nomeMax, tam.nomeMin)
    let y = topo - aj.tamanho * 0.78
    for (const l of aj.linhas) {
      page.drawText(l, { x: x0 + PAD, y, size: aj.tamanho, font: negrito, color: preto })
      y -= aj.tamanho * LAYOUT.entrelinha
    }
  }
  return pdf.save()
}

/** Opções do bwip-js para cada símbolo (mesmas no navegador e no gate). */
export function opcoesBwip(s: SimboloBarras) {
  return { bcid: s.bcid, text: s.texto, scale: 3, height: 10, includetext: false, backgroundcolor: 'FFFFFF' }
}
