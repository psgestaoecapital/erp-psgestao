// Baixa um arquivo no navegador com o nome escolhido (chamado #2957). Só roda no cliente.

/** Dispara o download de um Blob com o nome dado. */
export function baixarBlob(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Baixa uma URL (de outro domínio, ex.: link do provedor fiscal) com o nome dado: busca o conteúdo e salva como Blob.
 * Se o domínio não deixar ler o arquivo (CORS) ou a busca falhar, abre a URL numa aba nova, como era antes.
 */
export async function baixarUrlComNome(url: string, nome: string): Promise<void> {
  try {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    baixarBlob(await r.blob(), nome)
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
