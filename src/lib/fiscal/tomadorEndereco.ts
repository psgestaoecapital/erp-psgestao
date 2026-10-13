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

// ── Qual cadastro é o tomador (caixa jordana-code 3352399e — OS-2026-0198 Gean → FC Pisos) ─────────────────────────
// A Gean tinha DOIS cadastros com o CNPJ da FC Pisos: o ativo (só dígitos, endereço e IBGE completos) e um inativo
// (CNPJ com pontuação, sem endereço). A emissão avulsa procurava pelo documento com limit(1) e podia pegar o inativo:
// "falta o IBGE" com o cliente certo completo. Regra única para a rota e para a tela:
//   1) o cliente da OS/venda (clienteId) é SEMPRE o tomador — desde que o documento da nota seja o dele (se a pessoa
//      trocou o CNPJ na tela, a nota é para outro tomador e vale a busca do item 2);
//   2) sem ele, busca pelo documento só entre os ATIVOS (comparando só dígitos, as duas colunas);
//   3) mais de um ativo com o mesmo documento → não chuta: a tela pede para escolher (e unificar os cadastros).
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type CadastroTomador = ClienteEndereco & {
  id: string; ativo?: boolean | null; razao_social?: string | null; nome_fantasia?: string | null
  cnpj_cpf?: string | null; cpf_cnpj?: string | null
}

export type EscolhaTomador<T extends CadastroTomador = CadastroTomador> =
  | { tipo: 'cliente'; cliente: T; origem: 'cliente_da_operacao' | 'documento' }
  | { tipo: 'ambiguo'; candidatos: T[] }
  | { tipo: 'nenhum' }

export function documentoDoCadastro(c: Pick<CadastroTomador, 'cnpj_cpf' | 'cpf_cnpj'>): string[] {
  return [dig(c.cnpj_cpf), dig(c.cpf_cnpj)].filter((d) => d.length === 11 || d.length === 14)
}

export function escolherCadastroTomador<T extends CadastroTomador>(
  candidatos: T[], documento: string | null | undefined, clienteId?: string | null,
): EscolhaTomador<T> {
  const doc = dig(documento)
  const doDoc = (c: T) => documentoDoCadastro(c).includes(doc)
  if (clienteId) {
    const daOperacao = candidatos.find((c) => c.id === clienteId)
    if (daOperacao && (!doc || doDoc(daOperacao))) return { tipo: 'cliente', cliente: daOperacao, origem: 'cliente_da_operacao' }
  }
  if (doc.length !== 11 && doc.length !== 14) return { tipo: 'nenhum' }
  const ativos = candidatos.filter((c) => c.ativo !== false && doDoc(c))
  if (ativos.length === 1) return { tipo: 'cliente', cliente: ativos[0], origem: 'documento' }
  if (ativos.length > 1) return { tipo: 'ambiguo', candidatos: ativos }
  return { tipo: 'nenhum' }
}

// Filtro PostgREST (.or) que traz o cliente da operação (por id) E os cadastros com o documento — a escolha é feita
// depois por escolherCadastroTomador. Id fora do formato UUID é ignorado (nunca entra cru na sintaxe do filtro).
export function filtroCadastroTomador(documento: string | null | undefined, clienteId?: string | null): string | null {
  const partes: string[] = []
  if (clienteId && UUID_RE.test(clienteId)) partes.push(`id.eq.${clienteId}`)
  const porDoc = filtroDocumentoCliente(documento)
  if (porDoc) partes.push(porDoc)
  return partes.length ? partes.join(',') : null
}

export const CAMPOS_CADASTRO_TOMADOR =
  'id, ativo, razao_social, nome_fantasia, cnpj_cpf, cpf_cnpj, logradouro, endereco, numero, complemento, bairro, cidade, uf, cep, codigo_ibge_municipio'

export function nomeCadastro(c: Pick<CadastroTomador, 'razao_social' | 'nome_fantasia'>): string {
  return String(c.razao_social || c.nome_fantasia || 'Cliente sem nome').trim()
}
