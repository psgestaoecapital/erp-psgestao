// #1679 (Jordana · Gean): a NF-e manda o município do destinatário pelo NOME (municipio_destinatario) e a Focus o valida
// contra o cadastro oficial. Cadastro importado vem sem acento/caixa alta — "SAO MIGUEL DO OESTE", "IPORA DO OESTE" — e
// a nota voltava "Município do destinatário inválido" (4 rejeições da Gean, 28/09–02/10). Antes de enviar, o builder
// troca o nome digitado pelo nome OFICIAL do IBGE (fn_municipio_por_nome_uf: compara sem acento/caixa, na mesma UF) e
// leva junto o código. Não achou na tabela, ou a busca falhou → endereço sai como veio (nunca chuta município).

import type { EnderecoFiscal } from './types'

export interface MunicipioOficial { codigo_ibge: string; nome_municipio: string }
export type BuscaMunicipio = (nome: string, uf: string) => Promise<MunicipioOficial | null>

export async function enderecoComMunicipioOficial(
  end: EnderecoFiscal | undefined,
  busca: BuscaMunicipio,
): Promise<EnderecoFiscal | undefined> {
  if (!end) return end
  const nome = String(end.cidade ?? '').trim()
  const uf = String(end.uf ?? '').trim().toUpperCase()
  if (!nome || uf.length !== 2) return end
  let m: MunicipioOficial | null = null
  try { m = await busca(nome, uf) } catch { return end }
  const cod = String(m?.codigo_ibge ?? '').replace(/\D/g, '')
  if (!m || cod.length !== 7 || !m.nome_municipio) return end
  return { ...end, cidade: m.nome_municipio, uf, codigoMunicipio: cod }
}
