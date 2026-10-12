// Lookup de CNPJ via rota interna /api/cnpj-lookup (BrasilAPI com fallback ReceitaWS — RD-39 custo zero).

export interface DadosCNPJ {
  cnpj: string
  razao_social: string
  nome_fantasia: string | null
  email: string | null
  telefone: string | null
  // Endereco estruturado (preenche o form direto, sem concatenar)
  cep: string | null
  logradouro: string | null
  numero: string | null
  bairro: string | null
  complemento: string | null
  cidade: string
  uf: string
}

export type ResultadoCNPJ =
  | { status: 'ok'; dados: DadosCNPJ }
  | { status: 'nao_encontrado' }
  | { status: 'indisponivel' }

const soDigitos = (v: unknown) => (v ? String(v).replace(/\D/g, '') : '')

// Consulta pela rota interna /api/cnpj-lookup (servidor: BrasilAPI → ReceitaWS), sem CORS/limite do navegador.
export async function consultarCNPJ(cnpj: string): Promise<ResultadoCNPJ> {
  const clean = soDigitos(cnpj)
  if (clean.length !== 14) return { status: 'nao_encontrado' }
  try {
    const res = await fetch(`/api/cnpj-lookup?cnpj=${clean}`)
    if (res.status === 404 || res.status === 400) return { status: 'nao_encontrado' }
    if (!res.ok) return { status: 'indisponivel' }
    const data = await res.json()
    const cep = soDigitos(data.cep)
    const tel = soDigitos(data.telefone)
    return {
      status: 'ok',
      dados: {
        cnpj: clean,
        razao_social: data.razao_social ?? '',
        nome_fantasia: data.nome_fantasia || null,
        email: data.email || null,
        telefone: tel || null,
        cep: cep.length === 8 ? cep : null,
        logradouro: data.logradouro || null,
        numero: data.numero ? String(data.numero) : null,
        bairro: data.bairro || null,
        complemento: data.complemento || null,
        cidade: data.cidade ?? '',
        uf: data.uf ?? '',
      },
    }
  } catch {
    return { status: 'indisponivel' }
  }
}

// Compat: null quando não achou OU quando a consulta está indisponível.
export async function buscarCNPJ(cnpj: string): Promise<DadosCNPJ | null> {
  const r = await consultarCNPJ(cnpj)
  return r.status === 'ok' ? r.dados : null
}
