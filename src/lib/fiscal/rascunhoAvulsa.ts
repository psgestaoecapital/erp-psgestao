// #6728 · NF-e avulsa: rascunho local (por empresa) + aviso ao sair.
// Só guarda o que o usuário digitou neste navegador; nada vai ao banco nem ao provedor fiscal.
export type RascunhoAvulsa = {
  v: 1
  salvoEm: string
  destTabela: 'erp_clientes' | 'erp_fornecedores'
  destinatarioId: string
  tipoId: string
  natureza: string
  cfop: string
  finalidade: string
  chaveRef: string
  icmsCodigo: string
  modalidadeFrete: number
  valorFrete: number
  observacoes: string
  itens: unknown[]
}

const chave = (companyId: string) => `nfe_avulsa_rascunho:${companyId}`

export function rascunhoVazio(r: Pick<RascunhoAvulsa, 'destinatarioId' | 'natureza' | 'cfop' | 'chaveRef' | 'observacoes' | 'itens' | 'valorFrete'>): boolean {
  return !r.destinatarioId && !r.natureza && !r.cfop && !r.chaveRef && !r.observacoes && r.itens.length === 0 && !r.valorFrete
}

export function lerRascunho(companyId: string): RascunhoAvulsa | null {
  try {
    const bruto = window.localStorage.getItem(chave(companyId))
    if (!bruto) return null
    const r = JSON.parse(bruto) as RascunhoAvulsa
    return r && r.v === 1 && Array.isArray(r.itens) ? r : null
  } catch { return null }
}

export function gravarRascunho(companyId: string, r: Omit<RascunhoAvulsa, 'v' | 'salvoEm'>): boolean {
  try {
    window.localStorage.setItem(chave(companyId), JSON.stringify({ ...r, v: 1, salvoEm: new Date().toISOString() }))
    return true
  } catch { return false }
}

export function apagarRascunho(companyId: string): void {
  try { window.localStorage.removeItem(chave(companyId)) } catch { /* sem armazenamento: nada a apagar */ }
}
