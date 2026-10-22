// #2936 etapa 3 · PDF assinado = PDF original + página(s) de evidências no fim.
// Parte pura (sem rede): monta as linhas da página e o PDF a partir dos bytes do original. A gravação no bucket e o
// registro no banco ficam em pdfAssinadoServidor.ts (só rota do servidor, service_role).
// LGPD: CPF e e-mail saem mascarados na página; CNPJ (empresa) sai inteiro; localização só com consentimento.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

export interface SignatarioEvidencia {
  nome: string; papel: string; documento: string; email: string | null; status: string
  visualizado_em: string | null; assinado_em: string | null; metodo: string | null
  ip: string | null; user_agent: string | null; geo_consentido: boolean
  geolocalizacao: { latitude?: number; longitude?: number; lat?: number; lng?: number; precisao?: number; accuracy?: number } | null
  documento_hash_assinado: string | null
}

export interface Evidencias {
  envio_id: string; company_id: string; contrato_id: string; status: string; versao: number
  documento_hash: string; documento_path: string | null; documento_assinado_path: string | null
  codigo_verificacao: string; criado_em: string; concluido_em: string | null
  contrato_numero: string | null; contrato_nome: string | null; empresa: string | null; empresa_cnpj: string | null
  signatarios: SignatarioEvidencia[]
  // etapa 4: endereço da conferência pública (/verificar/contrato?c=CÓDIGO), preenchido pelo servidor
  url_verificacao?: string | null
}

export interface Bloco { titulo: string; linhas: string[] }

const PAPEL: Record<string, string> = { cliente: 'Cliente', empresa: 'Pela empresa', testemunha: 'Testemunha' }

export function dataHoraBR(s: string | null | undefined): string {
  if (!s) return '-'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '-'
  return `${d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })} (horário de Brasília)`
}

// CPF "12345678909" → "***.456.789-**"; CNPJ (14) sai formatado e inteiro (é de empresa, não de pessoa).
export function documentoMascarado(doc: string | null | undefined): string {
  const d = (doc ?? '').replace(/\D/g, '')
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  return '-'
}

export function emailMascarado(email: string | null | undefined): string {
  if (!email) return '-'
  const [u, dom] = email.split('@')
  if (!dom) return '***'
  return `${u.slice(0, 2)}***@${dom}`
}

function localizacao(s: SignatarioEvidencia): string {
  if (!s.geo_consentido || !s.geolocalizacao) return 'não autorizada pelo signatário'
  const g = s.geolocalizacao
  const lat = g.latitude ?? g.lat
  const lng = g.longitude ?? g.lng
  if (typeof lat !== 'number' || typeof lng !== 'number') return 'autorizada, sem coordenadas'
  const prec = g.precisao ?? g.accuracy
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}${typeof prec === 'number' ? ` (precisão ~${Math.round(prec)} m)` : ''}`
}

// Linhas da página de evidências (pura, testada no gate).
export function blocosEvidencias(e: Evidencias): Bloco[] {
  const doc: Bloco = {
    titulo: 'Documento',
    linhas: [
      `Contrato: ${[e.contrato_numero, e.contrato_nome].filter(Boolean).join(' - ') || '-'}`,
      `Empresa: ${e.empresa ?? '-'}${e.empresa_cnpj ? ` - CNPJ ${documentoMascarado(e.empresa_cnpj)}` : ''}`,
      `Versão enviada: ${e.versao} - enviada em ${dataHoraBR(e.criado_em)}`,
      `Concluído em: ${dataHoraBR(e.concluido_em)}`,
      `Código de verificação: ${e.codigo_verificacao}`,
      ...(e.url_verificacao ? [`Confira a autenticidade em: ${e.url_verificacao}`] : []),
      `Hash SHA-256 do documento original (páginas antes desta): ${e.documento_hash}`,
    ],
  }
  const sigs = e.signatarios.map((s, i) => ({
    titulo: `Signatário ${i + 1}: ${s.nome} (${PAPEL[s.papel] ?? s.papel})`,
    linhas: [
      `CPF/CNPJ: ${documentoMascarado(s.documento)} - e-mail: ${emailMascarado(s.email)}`,
      `Abriu o link em: ${dataHoraBR(s.visualizado_em)}`,
      `Assinou em: ${dataHoraBR(s.assinado_em)}`,
      `Como: link pessoal + confirmação do CPF/CNPJ + código de 6 números enviado ao e-mail + aceite dos termos${s.metodo === 'desenho' ? ' + assinatura desenhada' : ''}`,
      `IP: ${s.ip ?? '-'}`,
      `Aparelho: ${(s.user_agent ?? '-').slice(0, 160)}`,
      `Localização: ${localizacao(s)}`,
      `Hash do documento que assinou: ${s.documento_hash_assinado ?? '-'}${s.documento_hash_assinado && s.documento_hash_assinado !== e.documento_hash ? ' (DIFERENTE do original)' : ''}`,
    ],
  }))
  const legal: Bloco = {
    titulo: 'Validade',
    linhas: [
      'Assinatura eletrônica avançada (Lei 14.063/2020, art. 4º, II; MP 2.200-2/2001, art. 10, § 2º): cada signatário foi identificado por link pessoal, '
        + 'confirmação do CPF/CNPJ e código de uso único enviado ao seu e-mail, e assinou exatamente o arquivo cujo hash SHA-256 está acima.',
      'Qualquer alteração no documento original muda o hash e invalida a conferência. Guarde este arquivo eletrônico.',
    ],
  }
  return [doc, ...sigs, legal]
}

// A fonte padrão do PDF (Helvetica, WinAnsi) não desenha tudo: troca o que não é latin-1 por equivalente simples.
export function textoSeguro(s: string): string {
  return s
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/[•·]/g, '-').replace(/[^\x20-\x7E -ÿ]/g, '?')
}

function quebrar(texto: string, fonte: PDFFont, tamanho: number, largura: number): string[] {
  const saida: string[] = []
  let atual = ''
  for (const palavra of textoSeguro(texto).split(/\s+/)) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra
    if (fonte.widthOfTextAtSize(tentativa, tamanho) <= largura) { atual = tentativa; continue }
    if (atual) saida.push(atual)
    // palavra maior que a linha (hash, user agent): corta em pedaços
    let resto = palavra
    while (fonte.widthOfTextAtSize(resto, tamanho) > largura) {
      let n = resto.length
      while (n > 1 && fonte.widthOfTextAtSize(resto.slice(0, n), tamanho) > largura) n--
      saida.push(resto.slice(0, n)); resto = resto.slice(n)
    }
    atual = resto
  }
  if (atual) saida.push(atual)
  return saida
}

const A4: [number, number] = [595.28, 841.89]
const MARGEM = 48

export async function gerarPdfAssinado(original: Uint8Array | ArrayBuffer, e: Evidencias): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(original, { ignoreEncryption: true, updateMetadata: false })
  const normal = await pdf.embedFont(StandardFonts.Helvetica)
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold)
  const largura = A4[0] - MARGEM * 2
  const cor = rgb(0.24, 0.14, 0.08)
  const primeiraEvidencia = pdf.getPageCount()

  let pagina: PDFPage = pdf.addPage(A4)
  let y = A4[1] - MARGEM
  const novaPaginaSePreciso = (altura: number) => {
    if (y - altura >= MARGEM + 20) return
    pagina = pdf.addPage(A4); y = A4[1] - MARGEM
  }
  const escrever = (texto: string, fonte: PDFFont, tamanho: number, espaco = 3) => {
    for (const l of quebrar(texto, fonte, tamanho, largura)) {
      novaPaginaSePreciso(tamanho + espaco)
      pagina.drawText(l, { x: MARGEM, y: y - tamanho, size: tamanho, font: fonte, color: cor })
      y -= tamanho + espaco
    }
  }

  escrever('Página de evidências da assinatura eletrônica', negrito, 15, 6)
  escrever(`Gerada pelo PS Gestão em ${dataHoraBR(new Date().toISOString())}`, normal, 8, 10)
  for (const b of blocosEvidencias(e)) {
    novaPaginaSePreciso(40)
    y -= 6
    escrever(b.titulo, negrito, 10.5, 4)
    for (const l of b.linhas) escrever(l, normal, 9, 3)
  }
  // rodapé com o código em todas as páginas de evidências
  const total = pdf.getPageCount()
  for (let i = primeiraEvidencia; i < total; i++) {
    pdf.getPage(i).drawText(textoSeguro(`Código de verificação ${e.codigo_verificacao} - evidências ${i - primeiraEvidencia + 1}/${total - primeiraEvidencia}`),
      { x: MARGEM, y: MARGEM - 20, size: 7.5, font: normal, color: rgb(0.45, 0.4, 0.35) })
  }
  pdf.setSubject(textoSeguro(`Contrato assinado eletronicamente - código ${e.codigo_verificacao} - SHA-256 original ${e.documento_hash}`))
  pdf.setProducer('PS Gestão')
  pdf.setModificationDate(new Date())
  return pdf.save()
}
