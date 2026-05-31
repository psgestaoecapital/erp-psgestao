// BrasilAPI — gratuita (RD-39 custo zero). Lookup público de CNPJ.

export interface DadosCNPJ {
  cnpj: string
  razao_social: string
  nome_fantasia: string | null
  email: string | null
  telefone: string | null
  endereco: string
  cidade: string
  uf: string
}

export async function buscarCNPJ(cnpj: string): Promise<DadosCNPJ | null> {
  const clean = cnpj.replace(/\D/g, '')
  if (clean.length !== 14) return null
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${clean}`)
    if (!res.ok) return null
    const data = await res.json()
    return {
      cnpj: clean,
      razao_social: data.razao_social,
      nome_fantasia: data.nome_fantasia ?? null,
      email: data.email ?? null,
      telefone: data.ddd_telefone_1 ? `${data.ddd_telefone_1}${data.telefone_1 ?? ''}` : null,
      endereco: `${data.logradouro ?? ''} ${data.numero ?? ''}`.trim(),
      cidade: data.municipio ?? '',
      uf: data.uf ?? '',
    }
  } catch {
    return null
  }
}
