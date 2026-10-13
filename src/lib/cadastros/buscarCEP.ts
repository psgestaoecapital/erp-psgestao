// BrasilAPI v2 (com fallback v1) — lookup publico de CEP. Mesmo padrao do
// buscarCNPJ. Retorna null silenciosamente quando CEP nao for valido.

export interface DadosCEP {
  cep: string
  logradouro: string | null
  bairro: string | null
  cidade: string
  uf: string
}

export async function buscarCEP(cep: string): Promise<DadosCEP | null> {
  const clean = (cep ?? '').replace(/\D/g, '')
  if (clean.length !== 8) return null
  try {
    let res = await fetch(`https://brasilapi.com.br/api/cep/v2/${clean}`)
    if (!res.ok) res = await fetch(`https://brasilapi.com.br/api/cep/v1/${clean}`)
    if (!res.ok) return null
    const data = await res.json()
    if (!data?.city || !data?.state) return null
    return {
      cep: clean,
      logradouro: data.street ?? null,
      bairro: data.neighborhood ?? null,
      cidade: data.city ?? '',
      uf: data.state ?? '',
    }
  } catch {
    return null
  }
}
