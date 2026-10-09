// Aba "Codes" da Central de Desenvolvimento (CEO 07/10 14:30) — regras puras do painel (sem React, sem rede), para a
// tela e para o gate scripts/gates/check-aba-codes.ts.
//   • sessão ATIVA = lease renovado há menos de 12 min. fn_agente_sessao_encerrar marca o fim gravando
//     renovada_em = now() − 1 dia → quando renovada_em < iniciada_em, a hora real do fim é renovada_em + 1 dia.
//   • FILA = mensagens novas (e recebidas, ainda não iniciadas) não arquivadas, da mais antiga para a mais nova.
//   • EM TESTE = PR com evento aberta/pronta e sem publicada/fechada.
//   • faixa VERDE = houve publicação na última hora E nenhum Code parado com tarefa na fila; senão VERMELHA com a trava.

export const CODES_PRINCIPAIS = ['gilberto-desenv', 'gilberto-chamados', 'gilberto-produto', 'jordana-code', 'rodrigo-code'] as const
export const CODES_LINHA_FINAL = ['gilberto-revisor', 'eng-chefe-auto'] as const
// Quem acorda por agenda (hora cheia) e não pela caixa: nunca aparece como "Dormindo" (CEO 09/10)
export const CODES_COM_AGENDA: readonly string[] = ['eng-chefe-auto', 'gilberto-revisor']
export const CODES_PAINEL: readonly string[] = [...CODES_PRINCIPAIS, ...CODES_LINHA_FINAL]

export const LEASE_MIN = 12
export const STATUS_FILA = ['nova', 'recebida'] as const
const MIN = 60_000
const HORA = 60 * MIN
const DIA = 24 * HORA

export type Entrega = {
  id: number; pr_numero: number; titulo: string; code: string
  evento: 'aberta' | 'pronta' | 'publicada' | 'fechada'
  via: 'rapida' | 'revisada' | null; sha: string; url: string | null; ocorrido_em: string
}
export type Mensagem = {
  id: string; para: string; assunto: string | null; status: string; pr_numero: number | null
  resposta: string | null; enviado_por?: string | null; arquivada?: boolean | null; criado_em: string; atualizado_em: string | null
}
export type Lease = { agente: string; sessao_ref: string | null; iniciada_em: string; renovada_em: string }
export type Rotina = { agente: string; aciona: boolean }

export type EstadoSessao =
  | { ativa: true; desde: Date; sessaoRef: string | null }
  | { ativa: false; paradoDesde: Date | null }

export function estadoSessao(lease: Lease | undefined, agora: Date): EstadoSessao {
  if (!lease) return { ativa: false, paradoDesde: null }
  const ini = new Date(lease.iniciada_em), ren = new Date(lease.renovada_em)
  if (ren.getTime() >= ini.getTime() && ren.getTime() > agora.getTime() - LEASE_MIN * MIN) {
    return { ativa: true, desde: ini, sessaoRef: lease.sessao_ref }
  }
  // encerrada pela fn_agente_sessao_encerrar (renovada_em = fim − 1 dia) ou expirada (último sinal = renovada_em)
  return { ativa: false, paradoDesde: ren.getTime() < ini.getTime() ? new Date(ren.getTime() + DIA) : ren }
}

const t = (s: string | null | undefined) => (s ? new Date(s).getTime() : 0)

export function fila(msgs: Mensagem[], code: string): Mensagem[] {
  return msgs
    .filter((m) => m.para === code && !m.arquivada && (STATUS_FILA as readonly string[]).includes(m.status))
    .sort((a, b) => t(a.criado_em) - t(b.criado_em))
}

export function emAndamento(msgs: Mensagem[], code: string): Mensagem[] {
  return msgs
    .filter((m) => m.para === code && !m.arquivada && m.status === 'em_andamento')
    .sort((a, b) => t(b.atualizado_em ?? b.criado_em) - t(a.atualizado_em ?? a.criado_em))
}

export function ultimaResposta(msgs: Mensagem[], code: string): Mensagem | null {
  return msgs
    .filter((m) => m.para === code && !!m.resposta && (m.status === 'concluida' || m.status === 'recusada'))
    .sort((a, b) => t(b.atualizado_em ?? b.criado_em) - t(a.atualizado_em ?? a.criado_em))[0] ?? null
}

export function entregues(entregas: Entrega[], code: string | null, agora: Date, janelaMs = DIA): Entrega[] {
  return entregas
    .filter((e) => e.evento === 'publicada' && (code === null || e.code === code)
      && t(e.ocorrido_em) > agora.getTime() - janelaMs && t(e.ocorrido_em) <= agora.getTime() + MIN)
    .sort((a, b) => t(b.ocorrido_em) - t(a.ocorrido_em))
}

export type PrEmTeste = { pr_numero: number; titulo: string; code: string; url: string | null; via: Entrega['via']; pronta: boolean; desde: string }

export function emTeste(entregas: Entrega[], code: string | null): PrEmTeste[] {
  const porPr = new Map<number, Entrega[]>()
  for (const e of entregas) porPr.set(e.pr_numero, [...(porPr.get(e.pr_numero) ?? []), e])
  const out: PrEmTeste[] = []
  for (const [n, evs] of porPr) {
    if (evs.some((e) => e.evento === 'publicada' || e.evento === 'fechada')) continue
    const ord = [...evs].sort((a, b) => t(b.ocorrido_em) - t(a.ocorrido_em))
    const ult = ord[0]
    if (code !== null && ult.code !== code) continue
    const aberta = [...evs].sort((a, b) => t(a.ocorrido_em) - t(b.ocorrido_em))[0]
    out.push({ pr_numero: n, titulo: ult.titulo, code: ult.code, url: ult.url, via: ult.via,
      pronta: evs.some((e) => e.evento === 'pronta'), desde: aberta.ocorrido_em })
  }
  return out.sort((a, b) => t(a.desde) - t(b.desde))
}

export function duracao(ms: number): string {
  const min = Math.max(0, Math.floor(ms / MIN))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} dias`
}

const fmtHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
const fmtDia = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
export const hora = (d: Date | string) => fmtHora.format(typeof d === 'string' ? new Date(d) : d)
export const diaMes = (d: Date | string) => fmtDia.format(typeof d === 'string' ? new Date(d) : d)
/** "HH:MM" se for hoje (São Paulo); senão "dd/mm HH:MM". */
export function quando(d: Date | string, agora: Date): string {
  return diaMes(d) === diaMes(agora) ? hora(d) : `${diaMes(d)} ${hora(d)}`
}
/** Dia (YYYY-MM-DD) em São Paulo e o intervalo UTC dele (São Paulo é UTC−3 fixo desde 2019). */
export function diaSP(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
export function intervaloDia(dia: string): { de: string; ate: string } {
  const de = new Date(`${dia}T00:00:00-03:00`)
  return { de: de.toISOString(), ate: new Date(de.getTime() + DIA).toISOString() }
}

export type Faixa = { cor: 'verde' | 'vermelha'; frase: string }

const plural = (n: number, s: string, p: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? s : p}`

export function faixa(p: { entregas: Entrega[]; msgs: Mensagem[]; leases: Lease[]; agora: Date; codes?: readonly string[] }): Faixa {
  const codes = p.codes ?? CODES_PAINEL
  const agora = p.agora.getTime()
  const pubs = p.entregas.filter((e) => e.evento === 'publicada' && t(e.ocorrido_em) <= agora + MIN)
  const ultimaPub = pubs.reduce((m, e) => Math.max(m, t(e.ocorrido_em)), 0)
  const publicouNaHora = ultimaPub > agora - HORA
  const prontas = emTeste(p.entregas, null).filter((x) => x.pronta).length
  const parados = codes
    .map((c) => ({ code: c, sessao: estadoSessao(p.leases.find((l) => l.agente === c), p.agora), fila: fila(p.msgs, c).length }))
    .filter((x) => !x.sessao.ativa && x.fila > 0)
    .sort((a, b) => b.fila - a.fila)

  if (publicouNaHora && parados.length === 0) {
    return { cor: 'verde', frase: `Publicado há ${duracao(agora - ultimaPub)} e nenhum Code parado com tarefa na fila` }
  }
  const trava = (x: (typeof parados)[number]) => {
    const desde = !x.sessao.ativa && x.sessao.paradoDesde ? ` desde ${quando(x.sessao.paradoDesde, p.agora)}` : ''
    return `${x.code} parado${desde} com ${plural(x.fila, 'tarefa', 'tarefas')} na fila`
  }
  if (!publicouNaHora) {
    const ha = ultimaPub ? `há ${duracao(agora - ultimaPub)}` : 'nos últimos 7 dias'
    const extra = parados.length === 1 ? `; ${trava(parados[0])}`
      : parados.length > 1 ? `; ${plural(parados.length, 'Code parado', 'Codes parados')} com tarefa na fila` : ''
    return { cor: 'vermelha', frase: `Nada publicado ${ha} com ${plural(prontas, 'PR pronta', 'PRs prontas')}${extra}` }
  }
  if (parados.length === 1) return { cor: 'vermelha', frase: trava(parados[0]) }
  return { cor: 'vermelha', frase: `${parados.length} Codes parados com tarefa na fila: ${parados.map((x) => x.code).join(', ')}` }
}

// ── Topo da aba (CEO 08/10): faixa da esteira + resumo por Code ─────────────────────────────────────────────────────
export const TRAVADO_MIN = 15
export const FILA_ANTIGA_H = 24

export type Esteira = { cor: 'verde' | 'amarela' | 'vermelha'; ultimaPub: Date | null; prontas: number; mainVerde: boolean | null; filaTestes: number | null }

/** verde = publicou na última hora e main não vermelha; amarela = sem publicação há > 1 h; vermelha = main vermelha ou teste parado > 90 min.
 *  mainVerde/filaTestes vêm de fora (null = sem dado ainda: a aba não lê esse dado hoje). */
export function esteira(p: { entregas: Entrega[]; agora: Date; mainVerde?: boolean | null; filaTestes?: number | null; testeParadoMin?: number | null }): Esteira {
  const agora = p.agora.getTime()
  const pubs = p.entregas.filter((e) => e.evento === 'publicada' && t(e.ocorrido_em) <= agora + MIN)
  const ult = pubs.reduce((m, e) => Math.max(m, t(e.ocorrido_em)), 0)
  const mainVerde = p.mainVerde ?? null
  const vermelha = mainVerde === false || (p.testeParadoMin ?? 0) > 90
  const cor = vermelha ? 'vermelha' : ult > agora - HORA ? 'verde' : 'amarela'
  return { cor, ultimaPub: ult ? new Date(ult) : null, prontas: emTeste(p.entregas, null).filter((x) => x.pronta).length, mainVerde, filaTestes: p.filaTestes ?? null }
}

export type StatusCode = 'trabalhando' | 'travado' | 'esperando' | 'agendado' | 'dormindo'
export type ResumoCode = {
  code: string; status: StatusCode; desde: Date | null; fazendo: string
  fila: number; filaAntiga: number; emTeste: number; entreguesHoje: number; rotinaLigada: boolean | null
}

export function resumoCode(p: { code: string; entregas: Entrega[]; msgs: Mensagem[]; leases: Lease[]; rotinas?: Rotina[]; agora: Date }): ResumoCode {
  const { code, agora } = p
  const ag = agora.getTime()
  const sessao = estadoSessao(p.leases.find((l) => l.agente === code), agora)
  const todas = fila(p.msgs, code)
  const filaAntiga = todas.filter((m) => t(m.criado_em) < ag - FILA_ANTIGA_H * HORA).length
  // Travado = mensagem NOVA (não lida) há mais de 15 min; "recebida" antiga é fila antiga, nunca Travado
  const travada = todas.some((m) => m.status === 'nova' && t(m.criado_em) < ag - TRAVADO_MIN * MIN)
  const teste = emTeste(p.entregas, code)
  const andando = emAndamento(p.msgs, code)[0]
  const status: StatusCode = sessao.ativa ? 'trabalhando' : travada ? 'travado' : teste.length > 0 ? 'esperando' : CODES_COM_AGENDA.includes(code) ? 'agendado' : 'dormindo'
  const ultEntrega = entregues(p.entregas, code, agora, 30 * DIA)[0]
  const fazendo = andando?.assunto
    || (teste[0] ? `PR #${teste[0].pr_numero} · ${teste[0].titulo}` : ultEntrega ? `entregou #${ultEntrega.pr_numero} · ${ultEntrega.titulo}` : 'sem atividade recente')
  const hoje = diaSP(agora)
  return {
    code, status, desde: sessao.ativa ? sessao.desde : null, fazendo,
    fila: todas.length - filaAntiga, filaAntiga, emTeste: teste.length,
    entreguesHoje: p.entregas.filter((e) => e.evento === 'publicada' && e.code === code && diaSP(new Date(e.ocorrido_em)) === hoje).length,
    rotinaLigada: p.rotinas?.find((r) => r.agente === code)?.aciona ?? null,
  }
}

/** Mensagens de coordenação enviadas pelo eng-chefe-auto (ele escreve na caixa dos outros, não recebe), últimas 24 h. */
export function enviadasPorAuto(msgs: Mensagem[], agora: Date): Mensagem[] {
  return msgs.filter((m) => (m.enviado_por ?? '').startsWith('eng-chefe-auto') && t(m.criado_em) > agora.getTime() - DIA)
    .sort((a, b) => t(b.criado_em) - t(a.criado_em))
}
