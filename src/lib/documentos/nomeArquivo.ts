// #2167 (Gean, item 2): arquivo de nota fiscal e de boleto sai com o nome do cliente, não com um código aleatório.
// Ex.: "NF-e 394 - GEAN AUTO MECANICA.pdf", "Boleto 000123 - FC PISOS.pdf".
// Um só lugar para o nome (telas de notas emitidas, boletos e a rota que serve o PDF do boleto).

export type TipoDocumentoArquivo = 'NF-e' | 'NFS-e' | 'Boleto'

// tira acento e o que o Windows/macOS não aceitam em nome de arquivo; junta espaços
function limpar(s: string): string {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function nomeArquivoDocumento(
  tipo: TipoDocumentoArquivo,
  numero: string | number | null | undefined,
  cliente: string | null | undefined,
  ext: 'pdf' | 'xml',
): string {
  const num = limpar(String(numero ?? ''))
  const nome = limpar(cliente ?? '').slice(0, 80).trim()
  const base = [tipo, num].filter(Boolean).join(' ')
  return `${nome ? `${base} - ${nome}` : base}.${ext}`
}

// cabeçalho content-disposition com o nome (ASCII em filename, UTF-8 em filename*)
export function contentDisposition(nome: string, modo: 'inline' | 'attachment' = 'inline'): string {
  const ascii = nome.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `${modo}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`
}

// nome que a rota mandou no content-disposition (para salvar o blob com ele)
export function nomeDoContentDisposition(cd: string | null | undefined): string | null {
  if (!cd) return null
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(cd)
  if (utf) { try { return decodeURIComponent(utf[1].trim()) } catch { /* cai no filename= */ } }
  const simples = /filename="?([^";]+)"?/i.exec(cd)
  return simples ? simples[1].trim() : null
}

// salva um blob no computador com o nome dado
export function salvarBlob(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nome
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// URL do provedor (outra origem): tenta baixar com o nome; se o provedor não deixar (CORS), abre numa aba.
export async function baixarUrlComNome(url: string, nome: string): Promise<void> {
  try {
    const r = await fetch(url)
    if (!r.ok) throw new Error(String(r.status))
    salvarBlob(await r.blob(), nome)
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
