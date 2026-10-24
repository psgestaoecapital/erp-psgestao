// HB0 (auditor F15 em /dashboard/projetos/propostas) — números do funil de propostas, numa regra só e sem rede.
// A tela e o gate usam estas funções: o contador é honesto (conta o que está na lista, sem estimar).

export type PropostaFunil = { status: string; total: number | null; data_validade: string | null }

export const ABERTAS = ['rascunho', 'enviado', 'visualizado'] as const
export const GANHAS = ['aprovado', 'convertido'] as const
export const PERDIDAS = ['recusado', 'expirado'] as const

const em = (lista: readonly string[], s: string) => lista.includes(s)
const soma = (ls: PropostaFunil[]) => ls.reduce((s, l) => s + Number(l.total ?? 0), 0)

// Dias entre hoje e a validade (data ISO AAAA-MM-DD). Negativo = já venceu. Sem validade → null.
export function diasParaVencer(validade: string | null, hoje: Date = new Date()): number | null {
  if (!validade || !/^\d{4}-\d{2}-\d{2}/.test(validade)) return null
  const [a, m, d] = validade.slice(0, 10).split('-').map(Number)
  const alvo = Date.UTC(a, m - 1, d)
  const base = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
  return Math.round((alvo - base) / 86400000)
}

export function resumoFunil(ls: PropostaFunil[], hoje: Date = new Date()) {
  const abertas = ls.filter(l => em(ABERTAS, l.status))
  const ganhas = ls.filter(l => em(GANHAS, l.status))
  const perdidas = ls.filter(l => em(PERDIDAS, l.status))
  const decididas = ganhas.length + perdidas.length
  const aVencer = abertas.filter(l => { const d = diasParaVencer(l.data_validade, hoje); return d !== null && d >= 0 && d <= 7 })
  const porStatus: Record<string, { n: number; valor: number }> = {}
  for (const l of ls) {
    const s = (porStatus[l.status] ??= { n: 0, valor: 0 })
    s.n++; s.valor += Number(l.total ?? 0)
  }
  return {
    total: ls.length,
    abertas: abertas.length, valorAberto: soma(abertas),
    ganhas: ganhas.length, valorGanho: soma(ganhas),
    // Taxa só sobre o que o cliente já decidiu; sem decisão nenhuma, não há taxa (null, a tela mostra "—").
    taxaAprovacao: decididas ? Math.round((ganhas.length / decididas) * 100) : null,
    aVencer: aVencer.length, valorAVencer: soma(aVencer),
    porStatus,
  }
}

// HB0 (auditor F15 · "orçamento com itens reais") — composição de cada proposta a partir dos itens dela
// (erp_orcamentos_itens): quantos itens, quantos vieram do catálogo (serviço ou produto cadastrado), custo e margem.
// A margem é sobre o preço dos itens: (preço − custo) ÷ preço. Item sem custo informado deixa a margem sem valor
// (null, a tela mostra "sem custo") — margem de 100% por custo zerado seria mentira na frente do cliente.
export type ItemProposta = {
  orcamento_id: string; quantidade: number | null; preco_custo: number | null; subtotal: number | null
  servico_id: string | null; produto_id: string | null; bdi_percentual?: number | null
}

// bdiPct: BDI aplicado na proposta, médio ponderado pelo custo dos itens (o BDI incide sobre o custo); sem custo em
// nenhum item, média simples. Item sem BDI gravado conta em semBdi; nenhum item com BDI → null ("sem BDI").
export type Composicao = {
  itens: number; doCatalogo: number; semCusto: number; preco: number; custo: number; margemPct: number | null
  bdiPct: number | null; semBdi: number
}

const centavos = (v: number) => Math.round(v * 100) / 100

export function composicaoProposta(itens: ItemProposta[]): Composicao {
  let preco = 0, custo = 0, semCusto = 0, doCatalogo = 0, semBdi = 0
  let bdiPeso = 0, bdiPond = 0, bdiN = 0, bdiSoma = 0
  for (const i of itens) {
    const q = Number(i.quantidade ?? 0), c = Number(i.preco_custo ?? 0)
    preco += Number(i.subtotal ?? 0)
    if (c > 0) custo += q * c; else semCusto++
    if (i.servico_id || i.produto_id) doCatalogo++
    if (i.bdi_percentual == null || !Number.isFinite(Number(i.bdi_percentual))) { semBdi++; continue }
    const b = Number(i.bdi_percentual), peso = q * c
    bdiN++; bdiSoma += b
    if (peso > 0) { bdiPeso += peso; bdiPond += peso * b }
  }
  preco = centavos(preco); custo = centavos(custo)
  const margemPct = itens.length && !semCusto && preco > 0 ? Math.round(((preco - custo) / preco) * 1000) / 10 : null
  const bdiPct = !bdiN ? null : Math.round((bdiPeso > 0 ? bdiPond / bdiPeso : bdiSoma / bdiN) * 100) / 100
  return { itens: itens.length, doCatalogo, semCusto, preco, custo, margemPct, bdiPct, semBdi }
}

// Agrupa os itens por proposta (uma consulta só para a lista inteira).
export function composicaoPorProposta(itens: ItemProposta[]): Record<string, Composicao> {
  const grupos: Record<string, ItemProposta[]> = {}
  for (const i of itens) (grupos[i.orcamento_id] ??= []).push(i)
  const out: Record<string, Composicao> = {}
  for (const [id, ls] of Object.entries(grupos)) out[id] = composicaoProposta(ls)
  return out
}

// HB0 (auditor F15 · "Oportunidade → Proposta, Visita → Proposta, Take-off → Proposta") — de onde veio cada proposta,
// pelos vínculos que já existem no banco: erp_crm_oportunidade.orcamento_id, erp_crm_visita.gerou_orcamento_id (ou a
// visita da oportunidade da proposta) e erp_obra_planta.orcamento_id. Sem vínculo = sem origem (a tela diz "avulsa").
export type OportunidadeVinculo = { id: string; titulo: string | null; orcamento_id: string | null }
export type VisitaVinculo = { id: string; oportunidade_id: string | null; gerou_orcamento_id: string | null }
export type PlantaVinculo = { id: string; nome: string | null; orcamento_id: string | null }
export type Origem = { oportunidade: { id: string; titulo: string } | null; visitas: number; plantas: { id: string; nome: string }[] }

export function origemPorProposta(ops: OportunidadeVinculo[], visitas: VisitaVinculo[], plantas: PlantaVinculo[]): Record<string, Origem> {
  const out: Record<string, Origem> = {}
  const de = (id: string) => (out[id] ??= { oportunidade: null, visitas: 0, plantas: [] })
  const propostaDaOp: Record<string, string> = {}
  for (const o of ops) {
    if (!o.orcamento_id) continue
    propostaDaOp[o.id] = o.orcamento_id
    const d = de(o.orcamento_id)
    if (!d.oportunidade) d.oportunidade = { id: o.id, titulo: o.titulo?.trim() || 'Oportunidade' }
  }
  for (const v of visitas) {
    // A visita conta uma vez: vale o vínculo direto; senão, a proposta da oportunidade visitada.
    const alvo = v.gerou_orcamento_id ?? (v.oportunidade_id ? propostaDaOp[v.oportunidade_id] : undefined)
    if (alvo) de(alvo).visitas++
  }
  for (const p of plantas) if (p.orcamento_id) de(p.orcamento_id).plantas.push({ id: p.id, nome: p.nome?.trim() || 'Planta' })
  return out
}

export const temOrigem = (o: Origem | undefined) => !!o && (!!o.oportunidade || o.visitas > 0 || o.plantas.length > 0)

// HB0 (auditor F15 · "Proposta → Obra visível") — a obra que nasceu de cada proposta. O banco cria a obra sozinho quando
// a proposta é aprovada (tg_orcamento_gera_obra); o vínculo vale pelos dois lados: erp_orcamentos.obra_id ou
// projetos_obras.orcamento_id. Proposta ganha sem obra é sinalizada (nunca escondida); eh_obra=false = não é obra.
export type ObraVinculo = { id: string; numero: string | null; nome: string | null; status: string | null; orcamento_id: string | null }
export type PropostaObra = { id: string; status: string; obra_id: string | null; eh_obra?: boolean | null }
export type SituacaoObra =
  | { tipo: 'obra'; obra: { id: string; numero: string; nome: string; status: string | null } }
  | { tipo: 'sem_obra' } | { tipo: 'nao_e_obra' } | { tipo: 'aberta' }

export function obraPorProposta(propostas: PropostaObra[], obras: ObraVinculo[]): Record<string, SituacaoObra> {
  const porId: Record<string, ObraVinculo> = {}, porOrc: Record<string, ObraVinculo> = {}
  for (const o of obras) { porId[o.id] = o; if (o.orcamento_id) porOrc[o.orcamento_id] ??= o }
  const out: Record<string, SituacaoObra> = {}
  for (const p of propostas) {
    const o = (p.obra_id ? porId[p.obra_id] : undefined) ?? porOrc[p.id]
    if (o) out[p.id] = { tipo: 'obra', obra: { id: o.id, numero: o.numero?.trim() || 'Obra', nome: o.nome?.trim() || '', status: o.status } }
    else if (p.obra_id) out[p.id] = { tipo: 'obra', obra: { id: p.obra_id, numero: 'Obra', nome: '', status: null } }
    else if (!em(GANHAS, p.status)) out[p.id] = { tipo: 'aberta' }
    else out[p.id] = p.eh_obra === false ? { tipo: 'nao_e_obra' } : { tipo: 'sem_obra' }
  }
  return out
}

// Ganhas que viraram obra, sobre as ganhas que são obra (eh_obra=false fica fora da conta).
export function ganhasComObra(sit: Record<string, SituacaoObra>, propostas: PropostaObra[]) {
  const ganhas = propostas.filter(p => em(GANHAS, p.status) && sit[p.id]?.tipo !== 'nao_e_obra')
  return { comObra: ganhas.filter(p => sit[p.id]?.tipo === 'obra').length, ganhas: ganhas.length }
}

// HB0 (auditor F15 · "BDI visível na proposta") — o BDI aplicado na proposta comparado com o BDI padrão da empresa
// (projetos_modulo_config.bdi_total_pct, o mesmo que o editor usa ao incluir item). Tolerância de 0,05 ponto para
// arredondamento. Sem BDI na proposta ou sem padrão configurado → null (a tela não acusa o que não sabe).
export type BdiSituacao = 'no_padrao' | 'abaixo' | 'acima'
export function situacaoBdi(bdiPct: number | null, padrao: number | null | undefined): BdiSituacao | null {
  if (bdiPct === null || padrao == null || !Number.isFinite(Number(padrao)) || Number(padrao) <= 0) return null
  const d = bdiPct - Number(padrao)
  return d < -0.05 ? 'abaixo' : d > 0.05 ? 'acima' : 'no_padrao'
}
