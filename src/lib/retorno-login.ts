// returnTo seguro: só caminho interno (começa com "/" e não "//"), nunca URL externa.
export function retornoSeguro(valor: string | null | undefined): string | null {
  if (!valor) return null
  if (!valor.startsWith('/') || valor.startsWith('//') || valor.includes('\\')) return null
  return valor
}
