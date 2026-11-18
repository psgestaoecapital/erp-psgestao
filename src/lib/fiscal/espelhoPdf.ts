// Gerador do ESPELHO (prévia) da nota fiscal em PDF — chamado #9724 (decisão B).
//
// Recebe a NOTA JÁ MONTADA (o mesmo objeto que /api/fiscal/nfe/emitir devolve em
// `previa.nota` quando chamado com apenasPrevia=true) e devolve/baixa um PDF de
// conferência, marcado de forma inequívoca como "PRÉVIA — SEM VALOR FISCAL".
//
// REGRAS (do chamado):
//  - O espelho NÃO transmite nada, NÃO consome numeração nem série — é só conferência.
//  - Reflete exatamente o que SERIA transmitido (destinatário, itens, impostos, totais),
//    reaproveitando o payload do emissor do GE — sem cálculo paralelo.
//
// Renderer puro e reutilizável: cada ponto de emissão (OS, venda/pedido, faturamento,
// nota avulsa, revenda, NFS-e) chama `baixarEspelhoNFePdf` com a nota montada daquele ponto.
// Stack: pdf-lib (fontes Helvetica built-in, serverless-friendly), igual ao resto do repo.

import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from 'pdf-lib'

// Mesmo formato do `previa.nota` do emissor (NF-e 55). Mantido estrutural para que
// qualquer ponto de emissão possa passar o objeto que já recebe, sem adaptar.
export type EspelhoItem = {
  descricao: string
  ncm: string | null
  cfop: string | null
  cst: string | null
  cBenef: string | null
  chassi: string | null
  icmsBase: number | null
  icmsValor: number | null
  ibsCbs?: { base: number; cbs: number; ibs: number } | null
  valorTotal: number
}
// Contraparte da nota: na SAÍDA é o destinatário; na ENTRADA é o remetente.
// série/finalidade/consumidorFinal/ibsCbs são opcionais — a nota de entrada não os traz.
export type EspelhoNota = {
  naturezaOperacao: string
  serie?: string
  finalidade?: string
  consumidorFinal?: boolean | null
  destinatario: {
    razaoSocial: string
    documento: string | null
    tipoDocumento: string | null
    email?: string | null
    endereco: string | null
  }
  itens: EspelhoItem[]
  totais: { produtos: number; ibsCbs?: { base: number; cbs: number; ibs: number } | null }
}
export type EspelhoMeta = {
  empresa?: string | null   // razão social / nome do emitente (cabeçalho); ausente → rótulo neutro
  emitidoEmISO: string      // data de geração do espelho (passada de fora, sem Date.now interno)
  modelo?: 'nfe55' | 'nfse' // rótulo do documento (default nfe55)
  placa?: string | null     // revenda: placa do veículo (quando houver)
  papelContraparte?: 'destinatario' | 'remetente' // título da seção (default 'destinatario'; entrada = 'remetente')
  informacoesComplementares?: string | null
}

const MARCA = 'PRÉVIA — SEM VALOR FISCAL'

// pdf-lib (Helvetica/WinAnsi) só desenha Latin-1: normaliza os comuns e troca o resto por '?'.
const ansi = (s: string) => (s ?? '')
  .replace(/[‒–—―]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/•/g, '·').replace(/…/g, '...')
  .replace(/[^\x00-\xFF]/g, '?')
const brl = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })
const dataBR = (iso: string) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}` }

const ESP = rgb(0.16, 0.19, 0.25)
const MUT = rgb(0.45, 0.48, 0.55)
const GOLD = rgb(0.52, 0.38, 0.05)
const LINE = rgb(0.85, 0.86, 0.9)
const BANDBG = rgb(0.98, 0.95, 0.86)
const BANDTXT = rgb(0.46, 0.27, 0.02)

function corta(s: string, font: PDFFont, size: number, maxW: number): string {
  const t = ansi(s ?? '')
  if (font.widthOfTextAtSize(t, size) <= maxW) return t
  let out = t
  while (out.length > 1 && font.widthOfTextAtSize(out + '...', size) > maxW) out = out.slice(0, -1)
  return out + '...'
}

/** Monta o PDF do espelho e devolve os bytes (Uint8Array). Não baixa nada. */
export async function gerarEspelhoNFePdf(nota: EspelhoNota, meta: EspelhoMeta): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const W = 595.28, H = 841.89, M = 40 // A4 retrato
  const contentW = W - M * 2

  let page: PDFPage = doc.addPage([W, H])
  let y = H - M

  // marca d'água diagonal, repetida, bem clara — reforça "sem valor fiscal" em qualquer impressão.
  const marcaDagua = (p: PDFPage) => {
    const faint = rgb(0.93, 0.9, 0.82)
    for (let yy = 80; yy < H; yy += 170) {
      p.drawText(MARCA, { x: 60, y: yy, size: 26, font: bold, color: faint, rotate: degrees(35) })
    }
  }
  const rodape = (p: PDFPage) => {
    p.drawText(ansi(`${MARCA} · documento apenas para conferência — não substitui a nota fiscal`), { x: M, y: 26, size: 7.5, font, color: MUT })
  }
  const novaPagina = () => { rodape(page); page = doc.addPage([W, H]); marcaDagua(page); y = H - M }

  marcaDagua(page)

  // Banda superior "PRÉVIA — SEM VALOR FISCAL"
  page.drawRectangle({ x: M, y: y - 22, width: contentW, height: 26, color: BANDBG })
  page.drawText(MARCA, { x: M + 10, y: y - 15, size: 13, font: bold, color: BANDTXT })
  const modeloRot = meta.modelo === 'nfse' ? 'NFS-e' : 'NF-e (modelo 55)'
  const rotW = bold.widthOfTextAtSize(modeloRot, 10)
  page.drawText(modeloRot, { x: W - M - 10 - rotW, y: y - 14, size: 10, font: bold, color: BANDTXT })
  y -= 36

  // Emitente + data
  const emitenteRot = (meta.empresa || '').trim() || 'Emitente — espelho de conferência'
  page.drawText(corta(emitenteRot, bold, 13, contentW), { x: M, y: y - 12, size: 13, font: bold, color: ESP }); y -= 18
  page.drawText(ansi(`Espelho de conferência gerado em ${dataBR(meta.emitidoEmISO)}`), { x: M, y: y - 10, size: 9, font, color: MUT }); y -= 18
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LINE }); y -= 8

  const sec = (t: string) => { page.drawText(t, { x: M, y: y - 10, size: 10, font: bold, color: GOLD }); y -= 16 }
  const kv = (rot: string, val: string | null) => {
    if (y < M + 60) novaPagina()
    page.drawText(ansi(rot), { x: M, y: y - 9, size: 8.5, font, color: MUT })
    page.drawText(corta(val || '—', font, 9.5, contentW - 150), { x: M + 150, y: y - 9, size: 9.5, font, color: ESP })
    y -= 14
  }

  sec('Operação')
  kv('Natureza', nota.naturezaOperacao)
  if (nota.serie != null || nota.finalidade != null) kv('Série / Finalidade', `${nota.serie || '—'} · ${nota.finalidade || '—'}`)
  if (nota.consumidorFinal !== undefined) kv('Consumidor final', nota.consumidorFinal == null ? '—' : (nota.consumidorFinal ? 'Sim' : 'Não'))
  if (meta.placa) kv('Placa do veículo', meta.placa)
  y -= 4

  sec(meta.papelContraparte === 'remetente' ? 'Remetente' : 'Destinatário')
  kv('Nome', nota.destinatario.razaoSocial)
  kv(nota.destinatario.tipoDocumento || 'Documento', nota.destinatario.documento)
  if (nota.destinatario.email !== undefined) kv('E-mail', nota.destinatario.email ?? null)
  kv('Endereço', nota.destinatario.endereco)
  y -= 4

  sec('Itens e tributos')
  nota.itens.forEach((it, i) => {
    if (y < M + 80) novaPagina()
    page.drawText(corta(`${i + 1}. ${it.descricao}`, bold, 9.5, contentW), { x: M, y: y - 10, size: 9.5, font: bold, color: ESP }); y -= 14
    if (it.chassi) kv('Chassi', it.chassi)
    kv('NCM / CFOP', `${it.ncm || '—'} · CFOP ${it.cfop || '—'}`)
    kv('CST / cBenef', `${it.cst || '—'}${it.cBenef ? ` · benef. ${it.cBenef}` : ''}`)
    kv('Base / ICMS', `${it.icmsBase != null ? brl(it.icmsBase) : '—'} · ${it.icmsValor != null ? brl(it.icmsValor) : '—'}`)
    if (it.ibsCbs) kv('IBS/CBS', `base ${brl(it.ibsCbs.base)} · CBS ${brl(it.ibsCbs.cbs)} · IBS ${brl(it.ibsCbs.ibs)}`)
    kv('Valor do item', brl(it.valorTotal))
    y -= 2
  })
  y -= 2
  if (y < M + 60) novaPagina()
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LINE }); y -= 6
  const totTxt = `Total dos produtos: ${brl(nota.totais.produtos)}`
  page.drawText(totTxt, { x: W - M - bold.widthOfTextAtSize(totTxt, 11), y: y - 10, size: 11, font: bold, color: ESP }); y -= 16
  if (nota.totais.ibsCbs) {
    const t = `IBS/CBS — base ${brl(nota.totais.ibsCbs.base)} · CBS ${brl(nota.totais.ibsCbs.cbs)} · IBS ${brl(nota.totais.ibsCbs.ibs)}`
    page.drawText(corta(t, font, 9, contentW), { x: W - M - font.widthOfTextAtSize(corta(t, font, 9, contentW), 9), y: y - 9, size: 9, font, color: MUT }); y -= 14
  }

  const info = (meta.informacoesComplementares || '').trim()
  if (info) {
    y -= 6
    sec('Informações complementares')
    // quebra simples por largura
    const palavras = ansi(info).split(/\s+/)
    let linha = ''
    const flush = () => { if (!linha) return; if (y < M + 40) novaPagina(); page.drawText(linha, { x: M, y: y - 9, size: 8.5, font, color: ESP }); y -= 12; linha = '' }
    for (const p of palavras) {
      const tent = linha ? `${linha} ${p}` : p
      if (font.widthOfTextAtSize(tent, 8.5) > contentW) { flush(); linha = p } else linha = tent
    }
    flush()
  }

  rodape(page)
  return await doc.save()
}

/** Gera o espelho e baixa o PDF no navegador. Nome de arquivo determinístico (sem Date.now interno). */
export async function baixarEspelhoNFePdf(nota: EspelhoNota, meta: EspelhoMeta): Promise<string> {
  const bytes = await gerarEspelhoNFePdf(nota, meta)
  const slug = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
  const nome = `espelho_${meta.modelo === 'nfse' ? 'nfse' : 'nfe'}_${slug(meta.empresa || '') || 'empresa'}_${meta.emitidoEmISO.slice(0, 10)}.pdf`
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nome
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return nome
}
