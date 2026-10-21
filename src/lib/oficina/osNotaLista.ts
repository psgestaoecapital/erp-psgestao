// Chamado #2167 (complemento · Gean, vale para todas as mecânicas): etiquetas da nota fiscal em cada OS da LISTA,
// a partir de fn_os_nf_situacao (uma chamada agregada por empresa).
// Verde = NF-e/NFS-e autorizada ligada à OS (abre o PDF) · azul = "NF fora da OS" · amarelo = NF pendente ·
// vermelho = rejeitada · cinza = processando ou "anterior ao controle" (concluída antes da data de corte da empresa).

export type NotaRef = { id: string; numero: string | null }

export type NFForaOS = {
  tipo: 'nfe' | 'nfse' | null
  numero: string | null
  data_nota: string | null
  chave: string | null
  pdf_url: string | null
  observacao: string | null
  nfe_id: string | null
  nfse_id: string | null
  marcado_em: string | null
}

export type SituacaoNFItem = {
  os_id: string
  data_ref: string | null
  tem_valor: boolean
  nfe: NotaRef[]
  nfse: NotaRef[]
  processando: boolean
  rejeitada: boolean
  fora: NFForaOS | null
}

export type CorEtiquetaNF = 'verde' | 'azul' | 'amarelo' | 'vermelho' | 'cinza'

export type EtiquetaNF = {
  chave: string
  texto: string
  cor: CorEtiquetaNF
  /** nota do sistema que o toque abre (PDF) */
  abrir?: { tipo: 'nfe' | 'nfse'; id: string }
  /** link do PDF informado na marcação "NF fora da OS" */
  link?: string
}

export const STATUS_CONTROLE_NF = ['pronta', 'entregue']

export const FILTROS_NF_LISTA = ['todas', 'pendente', 'emitida', 'fora'] as const
export type FiltroNFLista = typeof FILTROS_NF_LISTA[number]

export function mapaSituacaoNF(itens: SituacaoNFItem[] | null | undefined): Map<string, SituacaoNFItem> {
  return new Map((itens ?? []).map((i) => [i.os_id, i]))
}

/** OS concluída antes da data de corte da empresa: fora do controle (sem alerta). Sem corte → tudo controlado. */
export function anteriorAoControle(item: SituacaoNFItem | undefined, corte: string | null): boolean {
  if (!corte || !item?.data_ref) return false
  return item.data_ref.slice(0, 10) < corte.slice(0, 10)
}

function temAutorizada(item: SituacaoNFItem | undefined): boolean {
  return !!item && item.nfe.length + item.nfse.length > 0
}

/** "NF pendente": OS pronta/entregue, com valor, sem nota autorizada ligada, sem "NF fora da OS", depois do corte. */
export function nfPendente(status: string, item: SituacaoNFItem | undefined, corte: string | null): boolean {
  if (!STATUS_CONTROLE_NF.includes(status) || !item) return false
  if (!item.tem_valor || temAutorizada(item) || item.fora) return false
  if (item.processando && !item.rejeitada) return false
  return !anteriorAoControle(item, corte)
}

export function passaFiltroNF(filtro: FiltroNFLista, status: string, item: SituacaoNFItem | undefined, corte: string | null): boolean {
  if (filtro === 'todas') return true
  if (filtro === 'pendente') return nfPendente(status, item, corte)
  if (filtro === 'emitida') return temAutorizada(item)
  return !!item?.fora
}

const nro = (n: string | null | undefined) => (n != null && String(n).trim() !== '' ? String(n) : 's/ nº')

export function etiquetasNF(status: string, item: SituacaoNFItem | undefined, corte: string | null): EtiquetaNF[] {
  if (!item) return []
  const out: EtiquetaNF[] = []
  for (const n of item.nfe) out.push({ chave: `nfe-${n.id}`, texto: `NF-e ${nro(n.numero)} ✓`, cor: 'verde', abrir: { tipo: 'nfe', id: n.id } })
  for (const n of item.nfse) out.push({ chave: `nfse-${n.id}`, texto: `NFS-e ${nro(n.numero)} ✓`, cor: 'verde', abrir: { tipo: 'nfse', id: n.id } })
  if (item.fora) {
    const f = item.fora
    const abrir = f.nfe_id ? { tipo: 'nfe' as const, id: f.nfe_id } : f.nfse_id ? { tipo: 'nfse' as const, id: f.nfse_id } : undefined
    out.push({
      chave: 'fora', cor: 'azul', texto: f.numero ? `NF fora da OS · nº ${f.numero}` : 'NF fora da OS',
      ...(abrir ? { abrir } : {}), ...(!abrir && f.pdf_url ? { link: f.pdf_url } : {}),
    })
  }
  if (out.length) return out
  if (item.processando) return [{ chave: 'processando', texto: 'NF processando', cor: 'cinza' }]
  if (!STATUS_CONTROLE_NF.includes(status) || !item.tem_valor) return item.rejeitada ? [{ chave: 'rejeitada', texto: 'NF rejeitada', cor: 'vermelho' }] : []
  if (anteriorAoControle(item, corte)) return [{ chave: 'anterior', texto: 'anterior ao controle', cor: 'cinza' }]
  if (item.rejeitada) return [{ chave: 'rejeitada', texto: 'NF rejeitada', cor: 'vermelho' }]
  return [{ chave: 'pendente', texto: 'NF pendente', cor: 'amarelo' }]
}
