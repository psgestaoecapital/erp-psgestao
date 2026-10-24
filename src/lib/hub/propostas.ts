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
  servico_id: string | null; produto_id: string | null
}

export type Composicao = { itens: number; doCatalogo: number; semCusto: number; preco: number; custo: number; margemPct: number | null }

const centavos = (v: number) => Math.round(v * 100) / 100

export function composicaoProposta(itens: ItemProposta[]): Composicao {
  let preco = 0, custo = 0, semCusto = 0, doCatalogo = 0
  for (const i of itens) {
    const q = Number(i.quantidade ?? 0), c = Number(i.preco_custo ?? 0)
    preco += Number(i.subtotal ?? 0)
    if (c > 0) custo += q * c; else semCusto++
    if (i.servico_id || i.produto_id) doCatalogo++
  }
  preco = centavos(preco); custo = centavos(custo)
  const margemPct = itens.length && !semCusto && preco > 0 ? Math.round(((preco - custo) / preco) * 1000) / 10 : null
  return { itens: itens.length, doCatalogo, semCusto, preco, custo, margemPct }
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
