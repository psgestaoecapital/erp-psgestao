// P&M · Social mínimo (CEO 03/10) — regras puras do planejamento, dos posts e do calendário, testadas no build
// (scripts/gates/check-pm-social.ts). A regra que vale é a do banco (gatilhos da migration 20261003120000); aqui fica
// a mesma conta para a tela mostrar antes de gravar (prazo do job) e para montar semana/mês no fuso de São Paulo.

export const FUSO = 'America/Sao_Paulo'
// São Paulo não tem horário de verão desde 2019: o deslocamento é fixo.
const OFFSET_SP = '-03:00'

export type StatusPost = 'rascunho' | 'em_aprovacao' | 'aprovado' | 'publicado'
export type StatusPlanejamento = 'rascunho' | 'em_aprovacao' | 'aprovado'

export const STATUS_POST: { v: StatusPost; l: string; cls: string }[] = [
  { v: 'rascunho', l: 'Rascunho', cls: 'bg-[#3D2314]/8 text-[#3D2314]/75' },
  { v: 'em_aprovacao', l: 'Em aprovação', cls: 'bg-[#FCE9C2] text-[#6B4A0E]' },
  { v: 'aprovado', l: 'Aprovado', cls: 'bg-[#DCEFD7] text-[#2F5A1F]' },
  { v: 'publicado', l: 'Publicado', cls: 'bg-[#3D2314] text-[#F5E6C8]' },
]
export const STATUS_PLANEJAMENTO: { v: StatusPlanejamento; l: string; cls: string }[] = [
  { v: 'rascunho', l: 'Rascunho', cls: 'bg-[#3D2314]/8 text-[#3D2314]/75' },
  { v: 'em_aprovacao', l: 'Em aprovação', cls: 'bg-[#FCE9C2] text-[#6B4A0E]' },
  { v: 'aprovado', l: 'Aprovado', cls: 'bg-[#DCEFD7] text-[#2F5A1F]' },
]
export const statusPost = (v: string) => STATUS_POST.find((s) => s.v === v) ?? STATUS_POST[0]
export const statusPlanejamento = (v: string) => STATUS_PLANEJAMENTO.find((s) => s.v === v) ?? STATUS_PLANEJAMENTO[0]

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
export const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const partesFmt = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

// data (AAAA-MM-DD) e hora (HH:MM) de um instante, no fuso de São Paulo
export function partesSP(iso: string): { data: string; hora: string } {
  const p = Object.fromEntries(partesFmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return { data: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` }
}
export const diaSP = (iso: string) => partesSP(iso).data
export const hojeSP = () => diaSP(new Date().toISOString())

// valor do <input type="datetime-local"> (hora de São Paulo) ⇄ instante ISO
export function paraInputLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  const { data, hora } = partesSP(iso)
  return `${data}T${hora}`
}
export function deInputLocal(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return null
  const d = new Date(`${v.slice(0, 16)}:00${OFFSET_SP}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// aritmética de datas AAAA-MM-DD (sem fuso: meio-dia UTC)
const dt = (d: string) => new Date(`${d}T12:00:00Z`)
const iso = (x: Date) => x.toISOString().slice(0, 10)
export function somarDias(d: string, n: number): string { const x = dt(d); x.setUTCDate(x.getUTCDate() + n); return iso(x) }
export function somarMeses(d: string, n: number): string { const x = dt(`${d.slice(0, 7)}-01`); x.setUTCMonth(x.getUTCMonth() + n); return iso(x) }
export const diaDaSemana = (d: string) => dt(d).getUTCDay()
export const inicioDoMes = (d: string) => `${d.slice(0, 7)}-01`
export const inicioDaSemana = (d: string) => somarDias(d, -diaDaSemana(d))   // semana de domingo a sábado

// Prazo do job do post: data de publicação (em São Paulo) − antecedência da peça (padrão 2). Igual ao gatilho do banco.
export function prazoDoPost(publicarEm: string | null | undefined, antecedencia: number | null | undefined): string | null {
  if (!publicarEm) return null
  return somarDias(diaSP(publicarEm), -(antecedencia ?? 2))
}

export const rotuloMes = (d: string) => `${MESES[Number(d.slice(5, 7)) - 1]} de ${d.slice(0, 4)}`
export const dataBR = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—')
export function quandoBR(isoPub: string | null | undefined): string {
  if (!isoPub) return 'sem data'
  const { data, hora } = partesSP(isoPub)
  return `${DIAS_SEMANA[diaDaSemana(data)].toLowerCase()} ${data.slice(8, 10)}/${data.slice(5, 7)} às ${hora}`
}

// as 7 datas da semana (domingo a sábado) que contém o dia
export const diasDaSemana = (ref: string) => Array.from({ length: 7 }, (_, i) => somarDias(inicioDaSemana(ref), i))

// semanas (domingo a sábado) que cobrem o mês inteiro do dia de referência
export function gradeDoMes(ref: string): string[][] {
  const ini = inicioDoMes(ref)
  const fim = somarDias(somarMeses(ini, 1), -1)
  const semanas: string[][] = []
  for (let d = inicioDaSemana(ini); d <= fim; d = somarDias(d, 7)) semanas.push(diasDaSemana(d))
  return semanas
}

// intervalo [de, ate) em ISO para a consulta (limites do dia em São Paulo)
export function intervaloISO(primeiroDia: string, ultimoDia: string): { de: string; ate: string } {
  return { de: new Date(`${primeiroDia}T00:00:00${OFFSET_SP}`).toISOString(), ate: new Date(`${somarDias(ultimoDia, 1)}T00:00:00${OFFSET_SP}`).toISOString() }
}

// redes que não estão entre as ativas da empresa (o banco recusa; a tela avisa antes)
export const redesInvalidas = (redes: string[], ativas: string[]) => redes.filter((r) => !ativas.includes(r))

// sigla curta da rede para o calendário (Instagram → IG); rede criada pela empresa → 2 primeiras letras
const SIGLAS: Record<string, string> = { instagram: 'IG', facebook: 'FB', linkedin: 'IN', tiktok: 'TT', youtube: 'YT', google: 'GO' }
export const siglaRede = (valor: string) => SIGLAS[valor] ?? valor.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase()

// mensagem amigável para o erro do banco ao gravar
export function mensagemErro(e: { code?: string; message?: string } | null | undefined): string {
  if (!e) return 'Não foi possível salvar.'
  if (e.code === '23505' && !/planejamento deste cliente/.test(e.message ?? '')) return 'Já existe um planejamento deste cliente neste mês com essa campanha.'
  return e.message ?? 'Não foi possível salvar.'
}
