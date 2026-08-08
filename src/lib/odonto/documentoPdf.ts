// OD-6 · Motor de PDF client-side (pdf-lib, mesmo padrão do gerador de boleto). Gera documento com
// cabeçalho da clínica + corpo (texto com quebras) + carimbo de assinatura eletrônica no rodapé.
// Reusado por Documentos (OD-6) e pelos botões Imprimir de Evolução (OD-3) e Anamnese (OD-4).
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import { supabase } from '@/lib/supabase'

// StandardFonts é WinAnsi — sanitiza codepoints > 0xFF (mesmo helper do gerarPdfBoleto).
function winAnsi(s: string): string {
  let out = ''
  for (const ch of (s ?? '')) { const cp = ch.codePointAt(0) ?? 0; out += cp > 0xff ? '?' : ch }
  return out
}

// quebra um parágrafo em linhas que cabem em maxW (largura em pt), na fonte/tamanho dados
function wrap(txt: string, font: PDFFont, size: number, maxW: number): string[] {
  const linhas: string[] = []
  for (const paragrafo of (txt ?? '').split('\n')) {
    if (paragrafo === '') { linhas.push(''); continue }
    let atual = ''
    for (const palavra of paragrafo.split(/\s+/)) {
      const tent = atual ? atual + ' ' + palavra : palavra
      if (font.widthOfTextAtSize(winAnsi(tent), size) > maxW && atual) { linhas.push(atual); atual = palavra }
      else atual = tent
    }
    if (atual) linhas.push(atual)
  }
  return linhas
}

export type DocPdfInput = {
  clinica: { nome: string; cnpj?: string | null }
  titulo: string
  corpo: string
  assinatura?: { profissional?: string | null; data?: string | null; hashCurto?: string | null } | null
}

export async function gerarDocumentoPdf(input: DocPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const W = 595, H = 842, margem = 50, maxW = W - margem * 2
  const preto = rgb(0.15, 0.09, 0.05), cinza = rgb(0.4, 0.4, 0.4)

  let page = doc.addPage([W, H])
  let y = H - margem
  const novaPagina = () => { page = doc.addPage([W, H]); y = H - margem }
  const linha = (txt: string, f: PDFFont, size: number, color = preto, gap = 15) => {
    if (y < margem + 60) novaPagina()
    page.drawText(winAnsi(txt), { x: margem, y, size, font: f, color }); y -= gap
  }

  // Cabeçalho da clínica
  linha(input.clinica.nome || 'Clínica', bold, 14)
  if (input.clinica.cnpj) linha(`CNPJ ${input.clinica.cnpj}`, font, 9, cinza, 12)
  y -= 4
  page.drawLine({ start: { x: margem, y }, end: { x: W - margem, y }, thickness: 0.7, color: cinza }); y -= 22

  // Título
  linha(input.titulo || 'Documento', bold, 13); y -= 6

  // Corpo
  for (const l of wrap(input.corpo || '', font, 11, maxW)) linha(l, font, 11, preto, 16)

  // Carimbo de assinatura eletrônica
  y -= 24
  if (y < margem + 70) novaPagina()
  page.drawLine({ start: { x: margem, y }, end: { x: margem + 240, y }, thickness: 0.7, color: preto }); y -= 14
  if (input.assinatura?.profissional || input.assinatura?.data) {
    linha('Assinado eletronicamente', bold, 9, preto, 12)
    linha([input.assinatura?.profissional, input.assinatura?.data].filter(Boolean).join(' · '), font, 9, cinza, 12)
    if (input.assinatura?.hashCurto) linha(`Verificação: ${input.assinatura.hashCurto}`, font, 8, cinza, 12)
  } else {
    linha('Assinatura', font, 9, cinza, 12)
  }

  return doc.save()
}

// Retrofit "Imprimir/PDF" (OD-3 Evolução, OD-4 Anamnese): busca a clínica, gera o PDF e abre numa aba.
export async function abrirPdfSimples(companyId: string, titulo: string, corpo: string, assinatura?: DocPdfInput['assinatura']) {
  const { data } = await supabase.from('companies').select('razao_social, nome_fantasia, cnpj').eq('id', companyId).maybeSingle()
  const c = data as { razao_social?: string; nome_fantasia?: string; cnpj?: string } | null
  const bytes = await gerarDocumentoPdf({ clinica: { nome: c?.razao_social || c?.nome_fantasia || 'Clínica', cnpj: c?.cnpj ?? null }, titulo, corpo, assinatura })
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
