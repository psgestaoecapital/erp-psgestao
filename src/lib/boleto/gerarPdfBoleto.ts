// Gerador FEBRABAN de boleto bancario — agnostico de banco. Le um objeto
// padronizado e devolve o PDF (Uint8Array). Reusavel pra Sicoob, Bradesco,
// Sicredi, etc. — basta passar codigo do banco + dados.
//
// Stack pure-JS (Vercel serverless-friendly):
//  - pdf-lib (desenho do PDF, fontes Helvetica built-in)
//  - bwip-js (codigo de barras Interleaved 2 of 5 — padrao boleto)
//  - qrcode (Pix copia-e-cola → PNG)
//
// Layout: 2 partes (Recibo do Pagador + Ficha de Compensacao) com linha
// pontilhada de corte, banco header com banda 756 + nome, linha digitavel
// grande, blocos de Beneficiario / Pagador / dados, instrucoes, QR Pix se
// houver, e o codigo de barras ITF embaixo da Ficha.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import bwipjs from 'bwip-js/node'
import QRCode from 'qrcode'

export type BoletoDados = {
  banco: { codigo: string; nome: string }
  linhaDigitavel: string
  codigoBarras: string // 44 digitos
  qrCodePix?: string | null
  beneficiario: {
    nome: string
    cnpj: string
    agencia: string | null
    conta: string | null
    codigo: string | null
  }
  pagador: {
    nome: string
    cpfCnpj: string
    endereco: {
      logradouro: string | null
      bairro: string | null
      cidade: string | null
      uf: string | null
      cep: string | null
    }
  }
  nossoNumero: string
  numeroDocumento: string
  especieDocumento: string
  aceite: boolean
  dataDocumento: string // YYYY-MM-DD
  dataVencimento: string
  valor: number
  instrucoes: string[]
}

const onlyDigits = (s: string) => (s ?? '').replace(/\D/g, '')
const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })
const fmtDataBR = (iso: string) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
const fmtCpfCnpj = (s: string) => {
  const d = onlyDigits(s)
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return s
}
const fmtCep = (s: string) => {
  const d = onlyDigits(s)
  return d.length === 8 ? d.replace(/^(\d{5})(\d{3})$/, '$1-$2') : s
}

// bwip-js Interleaved 2 of 5 (ITF) — padrao do codigo de barras de boleto.
async function gerarBarcodeITF(codigo44: string): Promise<Uint8Array> {
  const png = await bwipjs.toBuffer({
    bcid: 'interleaved2of5',
    text: onlyDigits(codigo44),
    scale: 2,
    height: 14, // mm
    includetext: false,
    backgroundcolor: 'FFFFFF',
  })
  return new Uint8Array(png)
}

async function gerarQrCode(payload: string): Promise<Uint8Array> {
  const buf = await QRCode.toBuffer(payload, { type: 'png', margin: 0, scale: 4 })
  return new Uint8Array(buf)
}

// Helpers de desenho
function drawLine(page: PDFPage, x1: number, y1: number, x2: number, y2: number, opts?: { dashed?: boolean; color?: { r: number; g: number; b: number } }) {
  const c = opts?.color ?? { r: 0, g: 0, b: 0 }
  if (opts?.dashed) {
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.5, color: rgb(c.r, c.g, c.b), dashArray: [3, 3] })
  } else {
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.5, color: rgb(c.r, c.g, c.b) })
  }
}

// pdf-lib StandardFonts (WinAnsi) nao codifica caracteres fora do
// WinAnsi-1252 — emojis, smbolos unicode, etc. Sanitizamos antes de
// desenhar pra nunca quebrar por nome de cliente / instrucao com algum
// caractere exotico. Acentos PT-BR (a, c, ã) estao no WinAnsi e passam.
function sanitizeWinAnsi(s: string): string {
  // Remove qualquer codepoint > 0xFF (fora do WinAnsi). Substitui por '?'.
  let out = ''
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    out += cp > 0xff ? '?' : ch
  }
  return out
}
function drawText(page: PDFPage, txt: string, x: number, y: number, font: PDFFont, size: number, color = rgb(0, 0, 0)) {
  if (txt == null) return
  page.drawText(sanitizeWinAnsi(String(txt)), { x, y, size, font, color })
}

// Caixa rotulada — label pequena no topo, valor LOGO abaixo (pra liberar
// o resto da caixa pra linhas extras desenhadas por drawText).
function drawCampo(page: PDFPage, x: number, y: number, w: number, h: number, label: string, valor: string | null, font: PDFFont, bold: PDFFont) {
  // moldura
  drawLine(page, x, y, x + w, y) // topo
  drawLine(page, x, y - h, x + w, y - h) // base
  drawLine(page, x, y, x, y - h) // esq
  drawLine(page, x + w, y, x + w, y - h) // dir
  drawText(page, label.toUpperCase(), x + 3, y - 8, font, 6)
  if (valor) drawText(page, valor, x + 3, y - 20, bold, 9)
}

export async function gerarPdfBoleto(d: BoletoDados): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([595, 842]) // A4

  const margem = 28
  const w = 595 - margem * 2 // 539
  // Linha de corte mais alta — o Recibo cabe em ~270pt no topo; assim a
  // Ficha ganha 570pt embaixo (cabe Local Pagamento + Beneficiario +
  // bloco de instrucoes + Pagador + QR + barras + autenticacao).
  const meio = 540

  // Banner do banco (reutilizavel para Recibo e Ficha)
  function drawBancoHeader(yTop: number) {
    const h = 20
    // banda esquerda com codigo do banco
    page.drawRectangle({ x: margem, y: yTop - h, width: 70, height: h, color: rgb(0, 0, 0) })
    drawText(page, d.banco.codigo + '-0', margem + 8, yTop - 14, bold, 12, rgb(1, 1, 1))
    drawText(page, d.banco.nome.toUpperCase(), margem + 78, yTop - 14, bold, 11)
    // linha digitavel a direita
    const ld = d.linhaDigitavel
    const ldWidth = bold.widthOfTextAtSize(ld, 10)
    drawText(page, ld, margem + w - ldWidth - 4, yTop - 14, bold, 10)
    // linha horizontal abaixo do header
    drawLine(page, margem, yTop - h, margem + w, yTop - h)
  }

  // ============ RECIBO DO PAGADOR (top) ============
  let y = 810
  drawText(page, 'Recibo do Pagador', margem, y, bold, 9)
  y -= 6
  drawBancoHeader(y)
  y -= 30

  // Bloco Beneficiario
  const benefLinha = `${d.beneficiario.nome} - CNPJ ${fmtCpfCnpj(d.beneficiario.cnpj)}`
  drawCampo(page, margem, y, w * 0.7, 24, 'Beneficiário', benefLinha, font, bold)
  const agConta = [
    d.beneficiario.agencia ? `Ag ${d.beneficiario.agencia}` : null,
    d.beneficiario.conta ? `C/C ${d.beneficiario.conta}` : null,
    d.beneficiario.codigo ? `Cód ${d.beneficiario.codigo}` : null,
  ].filter(Boolean).join(' / ')
  drawCampo(page, margem + w * 0.7, y, w * 0.3, 24, 'Agência / Conta / Código', agConta, font, bold)
  y -= 24

  drawCampo(page, margem, y, w * 0.4, 22, 'Nosso Número', d.nossoNumero, font, bold)
  drawCampo(page, margem + w * 0.4, y, w * 0.3, 22, 'Nº Documento', d.numeroDocumento, font, bold)
  drawCampo(page, margem + w * 0.7, y, w * 0.3, 22, 'Espécie / Aceite', `${d.especieDocumento} / ${d.aceite ? 'S' : 'N'}`, font, bold)
  y -= 22

  drawCampo(page, margem, y, w * 0.4, 22, 'Data Documento', fmtDataBR(d.dataDocumento), font, bold)
  drawCampo(page, margem + w * 0.4, y, w * 0.3, 22, 'Vencimento', fmtDataBR(d.dataVencimento), font, bold)
  drawCampo(page, margem + w * 0.7, y, w * 0.3, 22, 'Valor', fmtBRL(d.valor), font, bold)
  y -= 22

  // Pagador
  const enderecoLinha = [
    d.pagador.endereco.logradouro,
    d.pagador.endereco.bairro,
    d.pagador.endereco.cidade && d.pagador.endereco.uf ? `${d.pagador.endereco.cidade}/${d.pagador.endereco.uf}` : null,
    d.pagador.endereco.cep ? fmtCep(d.pagador.endereco.cep) : null,
  ].filter(Boolean).join(' - ')
  // Bloco Pagador (2 linhas: nome+doc na 1a, endereco na 2a). drawCampo
  // escreve so a 1a linha (em y - 20); a 2a linha (endereco) vai em y -
  // 32 por drawText separado, dentro da mesma caixa de h=40.
  drawCampo(page, margem, y, w, 40, 'Pagador',
    `${d.pagador.nome} - ${fmtCpfCnpj(d.pagador.cpfCnpj)}`,
    font, bold)
  drawText(page, enderecoLinha, margem + 3, y - 32, font, 8)
  y -= 40

  drawText(page, 'Autenticação mecânica - Recibo do Pagador', margem, y - 10, font, 7, rgb(0.4, 0.4, 0.4))

  // ============ Linha de corte (sem emoji — pdf-lib WinAnsi nao codifica ✂) ============
  drawLine(page, margem, meio + 16, margem + w, meio + 16, { dashed: true, color: { r: 0.5, g: 0.5, b: 0.5 } })
  drawText(page, 'RECORTE AQUI', margem, meio + 18, font, 7, rgb(0.5, 0.5, 0.5))

  // ============ FICHA DE COMPENSACAO (bottom) ============
  y = meio
  drawBancoHeader(y)
  y -= 30

  drawCampo(page, margem, y, w * 0.7, 22, 'Local de Pagamento', 'Pagável em qualquer banco até o vencimento - ou via Pix (QR Code abaixo).', font, bold)
  drawCampo(page, margem + w * 0.7, y, w * 0.3, 22, 'Vencimento', fmtDataBR(d.dataVencimento), font, bold)
  y -= 22

  // Beneficiario Ficha (2 linhas): nome+cnpj via drawCampo em y - 20,
  // agencia/conta por drawText em y - 32, dentro da mesma caixa h=40.
  drawCampo(page, margem, y, w * 0.7, 40, 'Beneficiário',
    `${d.beneficiario.nome} - ${fmtCpfCnpj(d.beneficiario.cnpj)}`, font, bold)
  drawText(page, agConta, margem + 3, y - 32, font, 8)
  drawCampo(page, margem + w * 0.7, y, w * 0.3, 40, 'Agência / Código', agConta || '-', font, bold)
  y -= 40

  drawCampo(page, margem, y, w * 0.25, 22, 'Data Documento', fmtDataBR(d.dataDocumento), font, bold)
  drawCampo(page, margem + w * 0.25, y, w * 0.25, 22, 'Nº Documento', d.numeroDocumento, font, bold)
  drawCampo(page, margem + w * 0.5, y, w * 0.2, 22, 'Espécie/Aceite', `${d.especieDocumento}/${d.aceite ? 'S' : 'N'}`, font, bold)
  drawCampo(page, margem + w * 0.7, y, w * 0.3, 22, 'Nosso Número', d.nossoNumero, font, bold)
  y -= 22

  // Instrucoes (esq) + Valor (dir)
  const blocoInstrH = 80
  drawCampo(page, margem, y, w * 0.7, blocoInstrH, 'Instruções (texto de responsabilidade do beneficiário)', null, font, bold)
  let yInstr = y - 18
  const linhasInstrucoes: string[] = []
  if (d.instrucoes && d.instrucoes.length > 0) linhasInstrucoes.push(...d.instrucoes)
  else linhasInstrucoes.push('Pagar até o vencimento. Após, sujeito a juros e multa conforme política.')
  if (d.qrCodePix) linhasInstrucoes.push('Pix copia-e-cola disponível no QR ao lado.')
  for (const l of linhasInstrucoes.slice(0, 5)) {
    drawText(page, '- ' + l, margem + 6, yInstr, font, 8)
    yInstr -= 10
  }
  drawCampo(page, margem + w * 0.7, y, w * 0.3, blocoInstrH, 'Valor do Documento', fmtBRL(d.valor), font, bold)
  y -= blocoInstrH

  // Pagador (Ficha) — 1a linha nome+doc (y - 20), 2a linha endereco
  // (y - 32), caixa h=40.
  const enderecoPagFichaH = 40
  drawCampo(page, margem, y, w, enderecoPagFichaH, 'Pagador',
    `${d.pagador.nome} - ${fmtCpfCnpj(d.pagador.cpfCnpj)}`,
    font, bold)
  drawText(page, enderecoLinha, margem + 3, y - 32, font, 8)
  y -= enderecoPagFichaH

  // QR Pix (se houver) ao lado/direita do bloco de barras
  let qrXEnd = margem + w
  if (d.qrCodePix) {
    try {
      const qrPngBytes = await gerarQrCode(d.qrCodePix)
      const qrImg = await doc.embedPng(qrPngBytes)
      const qrSize = 70
      page.drawImage(qrImg, { x: margem + w - qrSize, y: y - qrSize - 8, width: qrSize, height: qrSize })
      drawText(page, 'PIX', margem + w - qrSize, y - qrSize - 16, bold, 8)
      qrXEnd = margem + w - qrSize - 8
    } catch { /* QR opcional */ }
  }

  // Codigo de barras ITF (44 digitos)
  try {
    const barPngBytes = await gerarBarcodeITF(d.codigoBarras)
    const barImg = await doc.embedPng(barPngBytes)
    const barWidth = Math.max(280, qrXEnd - margem - 8)
    const barHeight = 50
    page.drawImage(barImg, { x: margem, y: y - barHeight - 8, width: barWidth, height: barHeight })
  } catch {
    // Sem barras, deixamos so a linha digitavel ja desenhada no header
  }

  drawText(page, 'Autenticação mecânica - Ficha de Compensação', margem, 30, font, 7, rgb(0.4, 0.4, 0.4))

  return await doc.save()
}
