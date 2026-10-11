// #1881 · URL dos arquivos da Focus (XML/PDF de NFS-e e NF-e). Fonte ÚNICA para o webhook e o fiscal-storage-worker
// (RD-65/RD-71: uma regra só). Sem APIs do Deno — o gate do build importa e testa este arquivo.
//
// A Focus manda os caminhos RELATIVOS ("/arquivos/..."). A base depende do AMBIENTE DA NOTA
// (erp_nfse_emitidas.ambiente / erp_nfe_emitidas.ambiente). Ambiente desconhecido → NÃO adivinha: devolve null
// (o webhook grava o caminho como veio; o worker absolutiza na hora de baixar, lendo o ambiente da nota).

export function focusBase(ambiente: string | null | undefined): string | null {
  if (ambiente === "producao") return "https://api.focusnfe.com.br"
  if (ambiente === "homologacao") return "https://homologacao.focusnfe.com.br"
  return null
}

export function ehCaminhoRelativo(u: string | null | undefined): boolean {
  return !!u && u.startsWith("/") && !u.startsWith("//")
}

// Caminho relativo + ambiente conhecido → URL completa. Já absoluta → como veio. Ambiente desconhecido → como veio.
export function focusUrlAbsoluta(u: string | null | undefined, ambiente: string | null | undefined): string | null {
  if (!u) return null
  if (!ehCaminhoRelativo(u)) return u
  const base = focusBase(ambiente)
  return base ? `${base}${u}` : u
}
