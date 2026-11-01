// Regras puras da tela Clientes de obra (Hub). Sem React nem banco, para o gate provar.
// PDCA 23/10: o auditor viu "J" em todo cliente — a DEMO grava tipo_pessoa 'J'/'F' (legado) e a
// tela só conhecia 'PJ'/'PF'. O tipo agora sai normalizado; sem tipo, o documento decide.
import { tipoPessoaPorDocumento } from '@/lib/banco/documento'

export type TipoPF = 'PF' | 'PJ'

export function tipoPessoaNormal(tipo: string | null | undefined, documento?: string | null): TipoPF {
  const t = (tipo ?? '').trim().toUpperCase()
  if (t === 'PF' || t === 'F' || t === 'FISICA' || t === 'FÍSICA') return 'PF'
  if (t === 'PJ' || t === 'J' || t === 'JURIDICA' || t === 'JURÍDICA') return 'PJ'
  return tipoPessoaPorDocumento(documento) === 'FISICA' ? 'PF' : 'PJ'
}

// Iniciais do nome real (até 2 letras), ignorando conectivos: "Clínica Bem Viver" → "CB".
const CONECTIVOS = new Set(['da', 'de', 'do', 'das', 'dos', 'e', '&'])
export function iniciais(nome: string | null | undefined): string {
  const partes = (nome ?? '').trim().split(/\s+/).filter((p) => p && !CONECTIVOS.has(p.toLowerCase()))
  if (partes.length === 0) return '?'
  const letras = partes.slice(0, 2).map((p) => p.match(/[\p{L}\p{N}]/u)?.[0] ?? '').join('')
  return (letras || '?').toUpperCase()
}

// Conta obras por cliente a partir das linhas de projetos_obras (uma consulta por tela).
// PDCA 24/10 tarde: a tela lia erp_obra_planta (planta de takeoff), mostrava "Obra: Planta baixa – …" e abria o
// cockpit com o id da planta (link quebrado). A obra do Hub é projetos_obras — é ela que o cockpit abre.
export function obrasPorCliente(linhas: { cliente_id: string | null }[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const l of linhas) if (l.cliente_id) m[l.cliente_id] = (m[l.cliente_id] ?? 0) + 1
  return m
}

export const temContato = (c: { telefone?: string | null; celular?: string | null; email?: string | null }) =>
  !!((c.telefone ?? '').trim() || (c.celular ?? '').trim() || (c.email ?? '').trim())

// PDCA 24/10 (auditor: "funil/oportunidade, visita e orçamento ligados ao cliente"): resumo comercial por cliente,
// montado na tela a partir de 3 consultas (oportunidades, propostas, visitas) — sem uma consulta por cliente.
export const ETAPAS_FECHADAS = new Set(['ganho', 'perdido'])
export type OpLinha = { id: string; cliente_id: string | null; etapa: string | null; valor_estimado: number | null; valor_proposta: number | null }
export type OrcLinha = { cliente_id: string | null; status?: string | null; total?: number | null }
// Proposta em aberto = ainda negociando com o cliente (não convertida em obra nem cancelada).
export const STATUS_PROPOSTA_ABERTA = new Set(['rascunho', 'enviado', 'aberta', 'aberto', 'negociacao'])
export type VisitaLinha = { oportunidade_id: string | null }
export type Comercial = { abertas: number; valorAberto: number; ganhas: number; propostas: number; visitas: number }

// Valor de uma oportunidade: o da proposta, quando já existe; senão o estimado.
export const valorOportunidade = (o: Pick<OpLinha, 'valor_estimado' | 'valor_proposta'>) =>
  Number(o.valor_proposta ?? o.valor_estimado ?? 0) || 0

export function comercialPorCliente(ops: OpLinha[], orcs: OrcLinha[], visitas: VisitaLinha[]): Record<string, Comercial> {
  const m: Record<string, Comercial> = {}
  const de = (id: string) => (m[id] ??= { abertas: 0, valorAberto: 0, ganhas: 0, propostas: 0, visitas: 0 })
  const clienteDaOp = new Map<string, string>()
  for (const o of ops) {
    if (!o.cliente_id) continue
    clienteDaOp.set(o.id, o.cliente_id)
    const c = de(o.cliente_id)
    if (o.etapa === 'ganho') c.ganhas++
    else if (!ETAPAS_FECHADAS.has(o.etapa ?? '')) { c.abertas++; c.valorAberto += valorOportunidade(o) }
  }
  for (const x of orcs) {
    if (!x.cliente_id) continue
    const c = de(x.cliente_id)
    c.propostas++
    // "Em negociação" soma também as propostas abertas do cliente (antes só contava oportunidades com valor).
    if (STATUS_PROPOSTA_ABERTA.has(x.status ?? '')) c.valorAberto += Number(x.total ?? 0) || 0
  }
  for (const v of visitas) {
    const cli = v.oportunidade_id ? clienteDaOp.get(v.oportunidade_id) : undefined
    if (cli) de(cli).visitas++
  }
  return m
}

export const brlCurto = (v: number) =>
  v >= 1_000_000 ? `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  : v >= 1000 ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// PDCA 24/10 06:03 (auditor: "só contador de obra na linha" e "ganhar não abre obra"): a linha mostra a obra
// mais recente (nome · cidade/UF) e avisa quando o cliente tem mais vendas ganhas do que obras abertas.
export type ObraLinha = { id?: string | null; cliente_id: string | null; nome: string | null; projeto_nome?: string | null; obra_cidade: string | null; obra_uf: string | null; created_at: string | null }
export const rotuloObra = (o: Pick<ObraLinha, 'nome' | 'projeto_nome' | 'obra_cidade' | 'obra_uf'>) =>
  [o.nome || o.projeto_nome || '(obra sem nome)', o.obra_cidade ? `${o.obra_cidade}${o.obra_uf ? '/' + o.obra_uf : ''}` : ''].filter(Boolean).join(' · ')
export function obraRecentePorCliente(linhas: ObraLinha[]): Record<string, string> {
  const m: Record<string, ObraLinha> = {}
  for (const l of linhas) {
    if (!l.cliente_id) continue
    const atual = m[l.cliente_id]
    if (!atual || (l.created_at ?? '') > (atual.created_at ?? '')) m[l.cliente_id] = l
  }
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, rotuloObra(v)]))
}
// Id da obra mais recente de cada cliente — para ligar o card do cliente direto ao Resultado da obra (cockpit),
// na mesma linha em que hoje só mostra o nome. Só entra cliente cuja obra recente tem id.
export function obraRecenteIdPorCliente(linhas: ObraLinha[]): Record<string, string> {
  const m: Record<string, ObraLinha> = {}
  for (const l of linhas) {
    if (!l.cliente_id || !l.id) continue
    const atual = m[l.cliente_id]
    if (!atual || (l.created_at ?? '') > (atual.created_at ?? '')) m[l.cliente_id] = l
  }
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.id as string]))
}
// Nome da obra mais recente (sem a cidade) — para a hierarquia do card: nome em cima, cidade embaixo (auditor FC 27/10).
export function obraRecenteNomePorCliente(linhas: ObraLinha[]): Record<string, string> {
  const m: Record<string, ObraLinha> = {}
  for (const l of linhas) {
    if (!l.cliente_id) continue
    const atual = m[l.cliente_id]
    if (!atual || (l.created_at ?? '') > (atual.created_at ?? '')) m[l.cliente_id] = l
  }
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.nome || v.projeto_nome || '(obra sem nome)']))
}

// Cidade/UF da obra mais recente do cliente — separada do nome para a hierarquia do card (auditor FC 27/10:
// "obra / cidade / resultado concatenados num texto longo truncado, sem hierarquia"). Vazio quando não há cidade.
export function obraRecenteCidadePorCliente(linhas: ObraLinha[]): Record<string, string> {
  const m: Record<string, ObraLinha> = {}
  for (const l of linhas) {
    if (!l.cliente_id) continue
    const atual = m[l.cliente_id]
    if (!atual || (l.created_at ?? '') > (atual.created_at ?? '')) m[l.cliente_id] = l
  }
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.obra_cidade ? `${v.obra_cidade}${v.obra_uf ? '/' + v.obra_uf : ''}` : '']))
}

// Resultado/margem por cliente a partir de v_obra_resultado (auditor FC 27/10, gap 3: "indicador de margem/resultado por
// obra do cliente, reaproveitar v_obra_resultado" — e desfaz a suspeita de "Com obra = Clientes" ser coincidência: cada
// cliente ganha um número próprio). A margem PREVISTA (receita_prevista − custo_previsto) é a do orçamento da obra — o que
// o comercial decide; a REALIZADA soma margem_realizada (receita − custo já lançados), que começa negativa/zero. Agregado
// por cliente somando as obras dele (uma consulta por tela). Base: as MESMAS obras do card (RD-38, fecham entre si).
export type ObraResultadoLinha = { obra_id: string; cliente_id?: string | null; receita_prevista: number | null; custo_previsto: number | null; margem_realizada: number | null }
export type ResultadoCliente = { receitaPrevista: number; custoPrevisto: number; margemPrevista: number; margemPct: number | null; margemRealizada: number; obras: number }
export function resultadoPorCliente(obras: { id?: string | null; cliente_id: string | null }[], resultados: ObraResultadoLinha[]): Record<string, ResultadoCliente> {
  const clienteDaObra = new Map<string, string>()
  for (const o of obras) if (o.id && o.cliente_id) clienteDaObra.set(o.id, o.cliente_id)
  const m: Record<string, ResultadoCliente> = {}
  for (const r of resultados) {
    const cli = clienteDaObra.get(r.obra_id) ?? r.cliente_id ?? null
    if (!cli) continue
    const a = (m[cli] ??= { receitaPrevista: 0, custoPrevisto: 0, margemPrevista: 0, margemPct: null, margemRealizada: 0, obras: 0 })
    a.receitaPrevista += Number(r.receita_prevista ?? 0)
    a.custoPrevisto += Number(r.custo_previsto ?? 0)
    a.margemRealizada += Number(r.margem_realizada ?? 0)
    a.obras++
  }
  for (const a of Object.values(m)) {
    a.margemPrevista = a.receitaPrevista - a.custoPrevisto
    a.margemPct = a.receitaPrevista > 0 ? (a.margemPrevista / a.receitaPrevista) * 100 : null
  }
  return m
}

export const ganhasSemObra = (ganhas: number, obras: number) => Math.max(0, ganhas - obras)
// Vendas que já viraram obra (projetos_obras.oportunidade_id): "Abrir obra desta venda" some nelas, para não duplicar.
export function oportunidadesComObra(linhas: { oportunidade_id?: string | null }[]): Set<string> {
  return new Set(linhas.map((l) => l.oportunidade_id).filter((x): x is string => !!x))
}
const STATUS_OBRA: Record<string, string> = { rascunho: 'Rascunho', planejada: 'Planejada', em_andamento: 'Em andamento', pausada: 'Pausada', concluida: 'Concluída', cancelada: 'Cancelada' }
export const rotuloStatusObra = (s: string | null | undefined) => (s ? STATUS_OBRA[s] ?? s : 'Rascunho')

// PDCA 24/10 06:03 (auditor: "funil/CRM mostrando etapa real da oportunidade por cliente"): a linha mostra a etapa
// mais avançada entre as oportunidades ABERTAS do cliente (ganha/perdida não contam — já têm pílula própria).
export const ORDEM_FUNIL = ['prospeccao', 'visita_agendada', 'visita_feita', 'orcando', 'proposta_enviada', 'negociacao'] as const
export function etapaPorCliente(ops: Pick<OpLinha, 'cliente_id' | 'etapa'>[]): Record<string, string> {
  const m: Record<string, string> = {}
  for (const o of ops) {
    const i = ORDEM_FUNIL.indexOf((o.etapa ?? '') as (typeof ORDEM_FUNIL)[number])
    if (!o.cliente_id || i < 0) continue
    const atual = m[o.cliente_id]
    if (atual === undefined || i > ORDEM_FUNIL.indexOf(atual as (typeof ORDEM_FUNIL)[number])) m[o.cliente_id] = ORDEM_FUNIL[i]
  }
  return m
}

// PDCA 24/10 06:03 (auditor: "nenhum CEP automático no cadastro"): o CEP achado preenche cidade/UF (o CEP manda) e
// só completa logradouro/bairro vazios — não apaga o que a pessoa já digitou.
export type EnderecoForm = { cep?: string | null; logradouro?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null }
export function aplicarCEP<T extends EnderecoForm>(form: T, d: { logradouro: string | null; bairro: string | null; cidade: string; uf: string }): T {
  const vazio = (v: string | null | undefined) => !(v ?? '').trim()
  return {
    ...form,
    logradouro: vazio(form.logradouro) && d.logradouro ? d.logradouro : form.logradouro,
    bairro: vazio(form.bairro) && d.bairro ? d.bairro : form.bairro,
    cidade: d.cidade || form.cidade,
    uf: (d.uf || form.uf || '').toUpperCase(),
  }
}
export const cepCompleto = (cep: string | null | undefined) => (cep ?? '').replace(/\D/g, '').length === 8

// Preenche o cadastro com os dados do CNPJ (BrasilAPI/Receita) SÓ nos campos ainda vazios — o que a pessoa já
// digitou prevalece sobre a consulta (RD-38: a consulta completa, nunca sobrescreve o cadastro manual). Mesmo
// princípio do aplicarCEP; aqui vem também razão social, contato e número do endereço. nome_fantasia cai para a
// razão social quando a Receita não traz o fantasia. Devolve um form novo (imutável), sem tocar no documento.
export type ClienteDocForm = EnderecoForm & { nome_fantasia?: string | null; razao_social?: string | null; telefone?: string | null; email?: string | null; numero?: string | null }
export function aplicarCNPJ<T extends ClienteDocForm>(form: T, d: { razao_social: string | null; nome_fantasia: string | null; email: string | null; telefone: string | null; cep: string | null; logradouro: string | null; numero: string | null; bairro: string | null; cidade: string; uf: string }): T {
  const vazio = (v: string | null | undefined) => !(v ?? '').trim()
  const preferir = (atual: string | null | undefined, novo: string | null | undefined) => (vazio(atual) && (novo ?? '').trim() ? novo : atual)
  return {
    ...form,
    nome_fantasia: preferir(form.nome_fantasia, d.nome_fantasia || d.razao_social),
    razao_social: preferir(form.razao_social, d.razao_social),
    telefone: preferir(form.telefone, d.telefone),
    email: preferir(form.email, d.email),
    cep: preferir(form.cep, d.cep),
    logradouro: preferir(form.logradouro, d.logradouro),
    numero: preferir(form.numero, d.numero),
    bairro: preferir(form.bairro, d.bairro),
    cidade: preferir(form.cidade, d.cidade),
    uf: (preferir(form.uf, d.uf) ?? '').toUpperCase(),
  }
}
export const cnpjCompleto = (doc: string | null | undefined) => (doc ?? '').replace(/\D/g, '').length === 14

// PDCA 24/10 · "Nova oportunidade" a partir do cliente já leva o cliente: a tela de oportunidades lê ?cliente=<uuid>
// e abre o formulário com ele escolhido. Só aceita UUID (parâmetro de URL é entrada livre).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function linkNovaOportunidade(clienteId: string): string {
  return `/dashboard/projetos/oportunidades?cliente=${encodeURIComponent(clienteId)}`
}
export function clienteDaUrl(search: string | null | undefined): string | null {
  const v = new URLSearchParams(search ?? '').get('cliente')?.trim() ?? ''
  return UUID.test(v) ? v.toLowerCase() : null
}
