// PM-T (6) · "lançar falando": transforma a frase ditada em horas + job + descrição (regra pura, sem rede, sem IA paga).
// A pessoa SEMPRE confere e ajusta antes de gravar (RD-51): aqui só se sugere.
export type JobBusca = { id: string; codigo: string; titulo: string | null }
export type Sugestao = { horas: number | null; jobId: string | null; descricao: string }

const NUM: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8 }
const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// "2h30", "2 horas e meia", "uma hora", "45 minutos", "1,5 h" → horas decimais (0,01–24).
export function extrairHoras(texto: string): number | null {
  const t = sem(texto).replace(/(\d),(\d)/g, '$1.$2')
  const n = '(\\d+(?:\\.\\d+)?|' + Object.keys(NUM).join('|') + ')'
  const val = (x: string) => (x in NUM ? NUM[x] : Number(x))
  let m = t.match(new RegExp(`${n}\\s*(?:horas?\\b|h)\\s*(?:e\\s*)?(?:(\\d{1,2})\\s*(?:min\\w*)?|(meia))?`))
  let h: number | null = null
  if (m) h = val(m[1]) + (m[2] ? Number(m[2]) / 60 : m[3] ? 0.5 : 0)
  else if ((m = t.match(/(\d{1,3})\s*(?:min|minutos?)\b/))) h = Number(m[1]) / 60
  else if ((m = t.match(/\bmeia hora\b/))) h = 0.5
  if (h == null || !isFinite(h) || h <= 0 || h > 24) return null
  return Number(h.toFixed(2))
}

// Escolhe o job pelo código ("JOB-0123", "0123") ou por palavras do título; só devolve se for inequívoco.
export function acharJob(texto: string, jobs: JobBusca[]): string | null {
  const t = sem(texto)
  const porCodigo = jobs.filter((j) => j.codigo && t.includes(sem(j.codigo)))
  if (porCodigo.length === 1) return porCodigo[0].id
  const palavras = new Set(t.split(/[^a-z0-9]+/).filter((p) => p.length >= 4))
  const pontos = jobs.map((j) => ({ id: j.id, p: sem(j.titulo ?? '').split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && palavras.has(w)).length })).filter((x) => x.p > 0).sort((a, b) => b.p - a.p)
  if (pontos.length && (pontos.length === 1 || pontos[0].p > pontos[1].p)) return pontos[0].id
  return null
}

export function sugerirLancamento(texto: string, jobs: JobBusca[]): Sugestao {
  return { horas: extrairHoras(texto), jobId: acharJob(texto, jobs), descricao: texto.trim().replace(/\s+/g, ' ').slice(0, 500) }
}
