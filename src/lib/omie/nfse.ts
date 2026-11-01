// Mapeamento NFS-e do OMIE (servicos/nfse · ListarNFSEs) -> erp_nfse_emitidas (#2712).
// O OMIE aninha os campos (Cabecalho, Emissao, Cancelamento, Tomador, Servicos...). Em vez de assumir um caminho
// fixo, procuramos a primeira chave com o nome em qualquer nível do item; o item inteiro vai em provider_raw
// para auditoria. Funções puras (testáveis sem rede).

export type NfseOmie = Record<string, unknown>

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function extrairLista(resp: Record<string, unknown>): NfseOmie[] {
  for (const k of ['nfseEncontradas', 'nfse_encontradas', 'nfseCadastro', 'lista']) {
    if (Array.isArray(resp[k])) return resp[k] as NfseOmie[]
  }
  for (const v of Object.values(resp)) if (Array.isArray(v) && v.every(isObj)) return v as NfseOmie[]
  return []
}

export function achar(o: unknown, nomes: string[], prof = 0): unknown {
  if (!isObj(o) || prof > 4) return undefined
  const baixo = nomes.map((n) => n.toLowerCase())
  for (const [k, v] of Object.entries(o)) {
    if (baixo.includes(k.toLowerCase()) && v !== null && v !== undefined && v !== '' && !isObj(v) && !Array.isArray(v)) return v
  }
  for (const v of Object.values(o)) {
    const r = Array.isArray(v) ? achar(v[0], nomes, prof + 1) : achar(v, nomes, prof + 1)
    if (r !== undefined) return r
  }
  return undefined
}

const txt = (o: unknown, nomes: string[]) => {
  const v = achar(o, nomes)
  return v === undefined ? null : String(v).trim() || null
}

// Aceita 1234.56 e "1.234,56"/"1234,56" (OMIE costuma mandar número, mas por segurança normaliza).
export function numero(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v !== 'string') return 0
  let s = v.trim().replace(/[^\d,.\-]/g, '')
  if (!s) return 0
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  else if (s.includes(',')) s = s.replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

// dd/mm/aaaa (OMIE) ou aaaa-mm-dd -> aaaa-mm-dd
export function dataIso(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(v.trim())
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim())
  return iso ? iso[1] : null
}

const soDigitos = (s: string | null) => (s ? s.replace(/\D/g, '') : '')

export interface NfseMapeada {
  row: Record<string, unknown> & { provider_reference: string }
  xmlUrl: string | null
}

export function mapearNfseOmie(
  item: NfseOmie,
  prestador: { cnpj: string; razao: string; im: string | null }
): NfseMapeada | null {
  const ref = txt(item, ['nCodNF', 'nCodNFSe', 'nIdNFSe', 'nIdNF'])
  const emissao = dataIso(achar(item, ['dEmissao', 'dDtEmissao', 'dEmiss']))
  if (!ref || !emissao) return null

  const hora = txt(item, ['hEmissao']) ?? '00:00:00'
  const cancelada = /^s/i.test(txt(item, ['cCancelada', 'cCancelado']) ?? '') || /cancel/i.test(txt(item, ['cStatusNFSe', 'cStatus', 'cStatusNF']) ?? '')
  const dtCancel = dataIso(achar(item, ['dCancelamento', 'dDtCancelamento']))
  const valor = numero(achar(item, ['nValorNFSe', 'nValorServicos', 'nValorTotal', 'nValorLiquido']))
  const tomadorDoc = soDigitos(txt(item, ['cCnpjCpf', 'cCNPJ_CPF', 'cCnpjTomador', 'cCpfCnpjTomador']))
  const iss = numero(achar(item, ['nValorISS', 'nValISS']))
  const aliq = numero(achar(item, ['nAliqISS', 'nAliquotaISS', 'nAliquota']))
  const issRetido = /^s/i.test(txt(item, ['cISSRetido', 'cRetemISS', 'cIssRetido']) ?? '')

  const row: NfseMapeada['row'] = {
    provider_reference: ref,
    ambiente: 'producao',
    numero: txt(item, ['nNumeroNFSe', 'nNumNFSe', 'cNumeroNFSe']),
    serie: txt(item, ['cSerie', 'cSerieNFSe']),
    codigo_verificacao: txt(item, ['cCodigoVerifNFSe', 'cCodVerificacao', 'cCodigoVerificacao']),
    data_emissao: `${emissao}T${hora.length === 5 ? `${hora}:00` : hora}-03:00`,
    data_competencia: dataIso(achar(item, ['dCompetencia'])) ?? emissao,
    valor_servicos: valor,
    valor_bruto: valor,
    valor_iss: iss,
    aliquota_iss: aliq,
    retem_iss: issRetido,
    codigo_servico: txt(item, ['cCodServMunic', 'cCodServico', 'cCodigoServico', 'cCodigoItemLC116']),
    descricao_servico: txt(item, ['cDescrServ', 'cDescricaoServico', 'cDiscriminacao', 'cDescricao']) ?? 'Serviço (importado do OMIE)',
    prestador_cnpj: soDigitos(prestador.cnpj),
    prestador_razao_social: prestador.razao || 'Prestador',
    prestador_im: prestador.im,
    tomador_cnpj: tomadorDoc.length === 14 ? tomadorDoc : null,
    tomador_cpf: tomadorDoc.length === 11 ? tomadorDoc : null,
    tomador_razao_social: txt(item, ['cRazaoSocial', 'cNomeTomador', 'cNome', 'cRazao']) ?? 'Tomador não informado',
    tomador_email: txt(item, ['cEmail', 'cEmailTomador']),
    status: cancelada ? 'cancelada' : 'autorizada',
    cancelado_em: cancelada ? (dtCancel ? `${dtCancel}T00:00:00-03:00` : new Date().toISOString()) : null,
    origem_tipo: 'avulsa',
    efetivacao_status: 'nao_aplicavel',
    financeiro_gerado: false,
    provider_raw: item,
  }
  const xmlUrl = txt(item, ['cLinkXml', 'cUrlXml', 'cXmlUrl', 'cLinkXML', 'cUrlXML'])
  return { row, xmlUrl: xmlUrl && /^https?:\/\//i.test(xmlUrl) ? xmlUrl : null }
}
