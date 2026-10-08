// Pauta de Jobs (P&M · P2) — regras puras da tela, testadas no build (scripts/gates/check-pauta-p2.ts).
// A regra do filtro mora no banco (fn__pauta_filtrar): a lista (fn_pauta_listar) e os contadores das abas
// (fn_pauta_contadores) usam a MESMA função, então a aba sempre bate com a lista. Aqui só o que a tela monta.

export type Atalho = 'meus' | 'atrasados' | 'hoje' | 'esperando_cliente' | 'estourando_escopo' | 'margem_negativa'
export type Agrupar = 'prazo' | 'cliente' | 'responsavel' | 'sem'
export type DataTipo = 'prazo' | 'criacao' | 'entrega' | 'conclusao'

export interface FiltrosPauta {
  clientes?: string[]; responsaveis?: string[]; grupos?: string[]; campanhas?: string[]; fees?: string[]; servicos?: string[]
  situacao_cliente?: string[]; titulo?: string; codigo?: string; aguardando?: boolean; aguardando_de?: string[]
  data_tipo?: DataTipo; data_de?: string; data_ate?: string; atalho?: Atalho; lixeira?: boolean
}

export interface ItemPauta {
  id: string; numero: string; codigo: string; rodada: number; titulo: string | null; status: string; prioridade: string | null; nota: number | null
  data_prazo: string | null; atrasado: boolean; dias_atraso: number | null
  cliente_id: string | null; cliente: string | null; cliente_status: string | null
  responsavel_id: string | null; responsavel: string | null; servico: string | null; tipo: string | null
  tem_anexo: boolean; tem_link: boolean; comentarios_novos: number
  aguardando_de: string | null; aguardando_motivo: string | null; aguardando_dias: number | null
  ajustes_limite: number | null; escopo_estourou: boolean; excluido_em: string | null
  valor_job: number | null; custo: number | null; margem: number | null
}

// Atalhos de um toque (seção 5). "Margem negativa" só aparece para quem vê dinheiro (gestor/financeiro, seção 8).
export const ATALHOS: { id: Atalho; rotulo: string; so_margem?: boolean }[] = [
  { id: 'meus', rotulo: 'Meus' },
  { id: 'atrasados', rotulo: 'Atrasados' },
  { id: 'hoje', rotulo: 'Vence hoje' },
  { id: 'esperando_cliente', rotulo: 'Esperando o cliente' },
  { id: 'estourando_escopo', rotulo: 'Estourando o escopo' },
  { id: 'margem_negativa', rotulo: 'Margem negativa', so_margem: true },
]
export const atalhosVisiveis = (podeVerMargem: boolean) => ATALHOS.filter((a) => !a.so_margem || podeVerMargem)

// Letra da rodada de ajuste: rodada 1 = A, 2 = B… (seção 7.A). Rodada 0 não tem letra.
export function letraRodada(rodada: number | null | undefined): string {
  const r = Number(rodada ?? 0)
  if (!Number.isFinite(r) || r <= 0) return ''
  return r > 26 ? 'Z' : String.fromCharCode(64 + Math.floor(r))
}
export const codigoJob = (numero: string | number, rodada?: number | null) => `${numero}${letraRodada(rodada)}`

// Filtro limpo: tira campos vazios (o banco trata "chave presente" como filtro ativo).
export function limparFiltros(f: FiltrosPauta): FiltrosPauta {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    if (typeof v === 'string' && !v.trim()) continue
    out[k] = typeof v === 'string' ? v.trim() : v
  }
  if (!out.data_de && !out.data_ate) delete out.data_tipo
  return out as FiltrosPauta
}
// quantos campos do filtro estão em uso (fora o atalho e a lixeira) — mostra no botão "Filtro (3)"
export const contarFiltros = (f: FiltrosPauta) =>
  Object.keys(limparFiltros(f)).filter((k) => !['atalho', 'lixeira', 'data_tipo'].includes(k)).length

// Agrupamento da lista (seção 6): por dia do prazo ("Segunda, 14/09") com "Atrasados" sempre no topo; ou por cliente,
// por responsável, ou sem agrupar.
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
export function rotuloDia(iso: string | null): string {
  if (!iso) return 'Sem prazo'
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(d.getTime())) return 'Sem prazo'
  return `${DIAS[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}
export function chaveGrupo(it: ItemPauta, agrupar: Agrupar): string {
  if (agrupar === 'sem') return ''
  if (agrupar === 'cliente') return it.cliente || 'Sem cliente'
  if (agrupar === 'responsavel') return it.responsavel || 'Sem responsável'
  return it.atrasado ? 'Atrasados' : rotuloDia(it.data_prazo)
}
// Mantém a ordem que veio do banco (ele já ordena para o agrupamento) e só corta em grupos consecutivos.
export function agrupar(itens: ItemPauta[], modo: Agrupar): { grupo: string; itens: ItemPauta[] }[] {
  const out: { grupo: string; itens: ItemPauta[] }[] = []
  for (const it of itens) {
    const g = chaveGrupo(it, modo)
    const ult = out[out.length - 1]
    if (ult && ult.grupo === g) ult.itens.push(it)
    else out.push({ grupo: g, itens: [it] })
  }
  return out
}

// Selo de escopo: "2/3 ajustes" quando o contrato limita; "estourou" quando passou (o selo aparece para todos).
export function seloEscopo(it: Pick<ItemPauta, 'rodada' | 'ajustes_limite' | 'escopo_estourou'>): string | null {
  if (it.ajustes_limite == null) return null
  if (it.escopo_estourou) return 'estourou'
  return `${it.rodada}/${it.ajustes_limite} ajustes`
}
export const textoAtraso = (dias: number | null) => (dias == null || dias <= 0 ? '' : dias === 1 ? 'há 1 dia' : `há ${dias} dias`)
export const QUEM_AGUARDA: Record<string, string> = { cliente: 'cliente', planejamento: 'planejamento', fornecedor: 'fornecedor', interno: 'interno' }
export function textoAguardando(de: string | null, dias: number | null, motivo?: string | null): string {
  if (!de) return 'aguardando'
  const sep = motivo ? ' · ' : ' '
  const tempo = dias == null ? '' : dias === 0 ? `${sep}desde hoje` : `${sep}há ${dias} dia${dias === 1 ? '' : 's'}`
  return `aguardando ${QUEM_AGUARDA[de] ?? de}${motivo ? ` · ${motivo.toLowerCase()}` : ''}${tempo}`
}

// PM-C · prazo da aprovação do cliente: "vence hoje às 18h", "vencida há 2 dias", "até 05/10 às 18h".
// nivel: 'vencida' (vermelho), 'hoje' (âmbar), 'ok'. Datas comparadas no fuso de São Paulo.
export type NivelPrazo = 'vencida' | 'hoje' | 'ok'
const FUSO = 'America/Sao_Paulo'
const diaSP = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const horaSP = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' }).format(d).replace(':00', 'h').replace(':', 'h')
const ddmmSP = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' }).format(d)
export function prazoAprovacao(prazoIso: string, agora: Date = new Date()): { texto: string; nivel: NivelPrazo } {
  const p = new Date(prazoIso)
  if (Number.isNaN(p.getTime())) return { texto: 'sem prazo', nivel: 'ok' }
  if (p.getTime() < agora.getTime()) {
    const horas = Math.floor((agora.getTime() - p.getTime()) / 3_600_000)
    if (horas < 24) return { texto: `vencida há ${Math.max(horas, 1)} h`, nivel: 'vencida' }
    const dias = Math.floor(horas / 24)
    return { texto: `vencida há ${dias} dia${dias === 1 ? '' : 's'}`, nivel: 'vencida' }
  }
  if (diaSP(p) === diaSP(agora)) return { texto: `vence hoje às ${horaSP(p)}`, nivel: 'hoje' }
  return { texto: `até ${ddmmSP(p)} às ${horaSP(p)}`, nivel: 'ok' }
}
// tempo parado no "Aguardando": "há 3 h", "há 2 dias"
export function tempoParado(desdeIso: string | null, agora: Date = new Date()): string {
  if (!desdeIso) return ''
  const ms = agora.getTime() - new Date(desdeIso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return 'há menos de 1 h'
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  return `há ${d} dia${d === 1 ? '' : 's'}`
}

// Filtro por frase (IA, seção 5): a IA só pode devolver filtros conhecidos, apontando para ids que EXISTEM nas listas da
// empresa — qualquer outra coisa é descartada aqui antes de a pessoa conferir.
export function validarFiltroIA(bruto: unknown, ids: { clientes: Set<string>; responsaveis: Set<string>; servicos: Set<string> }): FiltrosPauta {
  if (!bruto || typeof bruto !== 'object') return {}
  const b = bruto as Record<string, unknown>
  const lista = (v: unknown, ok: Set<string>) => (Array.isArray(v) ? v.map(String).filter((x) => ok.has(x)) : [])
  const f: FiltrosPauta = {
    clientes: lista(b.clientes, ids.clientes),
    responsaveis: lista(b.responsaveis, ids.responsaveis),
    servicos: lista(b.servicos, ids.servicos),
  }
  if (typeof b.titulo === 'string') f.titulo = b.titulo.slice(0, 80)
  const atalhos = ATALHOS.map((a) => a.id) as string[]
  if (typeof b.atalho === 'string' && atalhos.includes(b.atalho)) f.atalho = b.atalho as Atalho
  if (Array.isArray(b.aguardando_de)) f.aguardando_de = b.aguardando_de.map(String).filter((x) => x in QUEM_AGUARDA)
  const data = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : undefined)
  if (data(b.data_de) || data(b.data_ate)) {
    f.data_tipo = (['prazo', 'criacao', 'entrega', 'conclusao'] as const).includes(b.data_tipo as DataTipo) ? (b.data_tipo as DataTipo) : 'prazo'
    f.data_de = data(b.data_de); f.data_ate = data(b.data_ate)
  }
  return limparFiltros(f)
}

// PM-B · link da visão salva: /dashboard/pm/pauta?visao=<id>. Só aceita um uuid (o resto da URL é ignorado).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function visaoDaUrl(search: string): string | null {
  const v = new URLSearchParams(search).get('visao')?.trim() ?? ''
  return UUID.test(v) ? v.toLowerCase() : null
}
export const linkVisao = (origem: string, id: string) => `${origem.replace(/\/$/, '')}/dashboard/pm/pauta?visao=${id}`

export const AGRUPAMENTOS: { id: Agrupar; rotulo: string }[] = [
  { id: 'prazo', rotulo: 'Por prazo' }, { id: 'cliente', rotulo: 'Por cliente' }, { id: 'responsavel', rotulo: 'Por responsável' }, { id: 'sem', rotulo: 'Sem agrupar' },
]
export const PRIORIDADES = ['baixa', 'media', 'alta', 'critica']
export const POR_PAGINA = 50

// RD-51 (Pdois/Marciana 07/10): a Pauta abre com o filtro salvo da última visita. Quando ele esconde jobs, a tela
// DIZ qual filtro está aplicado (em palavras) e oferece "Mostrar todos" — nunca uma lista vazia calada.
export type NomesFiltro = Partial<Record<'clientes' | 'responsaveis' | 'grupos' | 'campanhas' | 'fees' | 'servicos', Record<string, string>>>
const ROTULO_LISTA: Record<keyof NomesFiltro, [string, string]> = {
  clientes: ['Cliente', 'Clientes'], responsaveis: ['Responsável', 'Responsáveis'], grupos: ['Grupo', 'Grupos'],
  campanhas: ['Campanha', 'Campanhas'], fees: ['Fee', 'Fees'], servicos: ['Serviço', 'Serviços'],
}
const ROTULO_DATA: Record<DataTipo, string> = { prazo: 'Prazo', criacao: 'Criação', entrega: 'Entrega', conclusao: 'Conclusão' }
const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
export function descreverFiltros(f: FiltrosPauta, nomes: NomesFiltro = {}, abaRotulo?: string | null): string[] {
  const l = limparFiltros(f)
  const out: string[] = []
  if (l.atalho) out.push(`Atalho: ${ATALHOS.find((a) => a.id === l.atalho)?.rotulo ?? l.atalho}`)
  for (const k of Object.keys(ROTULO_LISTA) as (keyof NomesFiltro)[]) {
    const ids = l[k] as string[] | undefined
    if (!ids?.length) continue
    const [um, varios] = ROTULO_LISTA[k]
    const ns = ids.map((id) => nomes[k]?.[id] ?? 'item não encontrado')
    out.push(`${ids.length === 1 ? um : varios}: ${ns.join(', ')}`)
  }
  if (l.situacao_cliente?.length) out.push(`Situação do cliente: ${l.situacao_cliente.join(', ')}`)
  if (l.titulo) out.push(`Título contém "${l.titulo}"`)
  if (l.codigo) out.push(`Código ${l.codigo}`)
  if (l.aguardando) out.push('Só os que aguardam alguém')
  if (l.aguardando_de?.length) out.push(`Aguardando: ${l.aguardando_de.join(', ')}`)
  if (l.data_de || l.data_ate) {
    out.push(`${ROTULO_DATA[l.data_tipo ?? 'prazo']}${l.data_de ? ` de ${dataBR(l.data_de)}` : ''}${l.data_ate ? ` até ${dataBR(l.data_ate)}` : ''}`)
  }
  if (l.lixeira) out.push('Lixeira')
  if (abaRotulo) out.push(`Aba: ${abaRotulo}`)
  return out
}
