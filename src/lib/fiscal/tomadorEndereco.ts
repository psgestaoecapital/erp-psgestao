// NFS-e avulsa (caminho 'manual' de /api/fiscal/nfse/emitir): a tela manda só nome + CNPJ/CPF do tomador. O leiaute
// nacional exige o endereço (cMun + número — guarda XSD da rota), então sem isto a emissão avulsa sempre parava em
// "Complete o cadastro fiscal do tomador". A rota passa a completar o ENDEREÇO a partir do cadastro de clientes da
// própria empresa, pelo documento. O e-mail NÃO é copiado (CEO 28/09): a nota só vai por e-mail se a tela mandar.

import type { EnderecoFiscal } from './types'

const dig = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '')

// O cadastro guarda o documento às vezes só com dígitos, às vezes formatado — procura pelas duas formas.
export function variantesDocumento(doc: string | null | undefined): string[] {
  const d = dig(doc)
  if (d.length === 14) return [d, `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`]
  if (d.length === 11) return [d, `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`]
  return []
}

// Filtro PostgREST (.or) para achar o cliente pelo documento nas duas colunas. Valores entre aspas: o CNPJ formatado
// tem '.', '/' e '-', e '.' é separador da sintaxe do filtro.
export function filtroDocumentoCliente(doc: string | null | undefined): string | null {
  const v = variantesDocumento(doc)
  if (!v.length) return null
  return v.flatMap((d) => [`cpf_cnpj.eq."${d}"`, `cnpj_cpf.eq."${d}"`]).join(',')
}

export interface ClienteEndereco {
  logradouro?: string | null; endereco?: string | null; numero?: string | null; complemento?: string | null
  bairro?: string | null; cidade?: string | null; uf?: string | null; cep?: string | null; codigo_ibge_municipio?: string | null
}

// Endereço fiscal do tomador a partir do cadastro. Sem município (IBGE, 7 díg.) ou sem número devolve null — a guarda
// da rota continua pedindo para completar o cadastro, em vez de mandar um endereço incompleto.
export function enderecoFiscalDoCliente(c: ClienteEndereco | null | undefined): EnderecoFiscal | null {
  if (!c) return null
  const ibge = dig(c.codigo_ibge_municipio)
  const numero = String(c.numero ?? '').trim()
  const logradouro = String(c.logradouro || c.endereco || '').trim()
  if (ibge.length !== 7 || !numero || !logradouro) return null
  const e: EnderecoFiscal = {
    logradouro, numero, bairro: String(c.bairro ?? '').trim(), cidade: String(c.cidade ?? '').trim(),
    uf: String(c.uf ?? '').trim().toUpperCase(), cep: dig(c.cep), codigoMunicipio: ibge,
  }
  const comp = String(c.complemento ?? '').trim()
  if (comp) e.complemento = comp
  return e
}

// O que falta no cadastro para o endereço fiscal do tomador (mesma regra de enderecoFiscalDoCliente). Lista vazia =
// cadastro pronto para a NFS-e nacional. A tela de emissão usa isto para pedir CEP/cidade ali mesmo e gravar no cliente.
export function pendenciasEnderecoTomador(c: ClienteEndereco | null | undefined): string[] {
  if (!c) return []
  const p: string[] = []
  if (dig(c.codigo_ibge_municipio).length !== 7) p.push('código IBGE do município')
  if (!String(c.logradouro || c.endereco || '').trim()) p.push('logradouro')
  if (!String(c.numero ?? '').trim()) p.push('número')
  return p
}
