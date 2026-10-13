// PM-D · Meu Dia (CEO 02/10): regras puras da tela — menções com @, cronômetro e "minhas últimas ações".
// Testadas no build (scripts/gates/check-pm-d-meu-dia.ts). Sem tabela nova: comentários (agency_job_comentarios.mencoes),
// cronômetro (agency_timesheet com fim_em vazio = rodando; o banco só deixa 1 aberto por pessoa) e anotações
// (agency_anotacoes, privadas do autor).

export type Pessoa = { id: string; nome: string }

// "@Ana Ribeiro" no texto → id da Ana Ribeiro. Só conta quem é da equipe e cujo nome aparece inteiro depois do @;
// com "Ana" e "Ana Ribeiro" na equipe, "@Ana Ribeiro" é só a Ana Ribeiro (o nome mais longo ganha).
export function extrairMencoes(texto: string, equipe: Pessoa[]): string[] {
  const t = texto.toLowerCase()
  const ocupado: [number, number][] = []
  const ids = new Set<string>()
  for (const p of [...equipe].filter((x) => x.nome).sort((a, b) => b.nome.length - a.nome.length)) {
    const alvo = `@${p.nome.toLowerCase()}`
    for (let i = t.indexOf(alvo); i >= 0; i = t.indexOf(alvo, i + 1)) {
      const fim = i + alvo.length
      if (/[\p{L}\p{N}]/u.test(t.charAt(fim))) continue
      if (ocupado.some(([a, b]) => i >= a && i < b)) continue
      ocupado.push([i, fim]); ids.add(p.id)
    }
  }
  return [...ids]
}

// Enquanto a pessoa digita: o trecho depois do último "@" (sem espaço duplo) vira a busca da lista de sugestões.
export function buscaMencao(texto: string, cursor: number): { termo: string; inicio: number } | null {
  const antes = texto.slice(0, cursor)
  const i = antes.lastIndexOf('@')
  if (i < 0) return null
  if (i > 0 && /[\p{L}\p{N}]/u.test(antes.charAt(i - 1))) return null // e-mail, não menção
  const termo = antes.slice(i + 1)
  if (termo.length > 30 || /\s{2}|\n/.test(termo)) return null
  return { termo, inicio: i }
}
export const sugerirPessoas = (termo: string, equipe: Pessoa[], max = 6) =>
  equipe.filter((p) => p.nome.toLowerCase().includes(termo.toLowerCase())).slice(0, max)
export function inserirMencao(texto: string, inicio: number, cursor: number, p: Pessoa): string {
  return `${texto.slice(0, inicio)}@${p.nome} ${texto.slice(cursor)}`
}
// Divide o texto para destacar as menções na tela.
export function partesComMencao(texto: string, equipe: Pessoa[]): { texto: string; mencao: boolean }[] {
  const nomes = equipe.map((p) => p.nome).filter(Boolean).sort((a, b) => b.length - a.length)
  if (!nomes.length) return [{ texto, mencao: false }]
  const esc = nomes.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const corta = new RegExp(`(@(?:${esc}))`, 'gi')
  const inteira = new RegExp(`^@(?:${esc})$`, 'i')
  return texto.split(corta).filter((x) => x !== '').map((x) => ({ texto: x, mencao: inteira.test(x) }))
}

// Cronômetro: segundos → "01:05:09"; horas gravadas com 2 casas e mínimo de 0,01 h (36 s).
export const relogio = (seg: number) => {
  const s = Math.max(0, Math.floor(seg))
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
export const horasDoCronometro = (inicioIso: string, fim: Date = new Date()) =>
  Math.max(0.01, Number(((fim.getTime() - new Date(inicioIso).getTime()) / 3_600_000).toFixed(2)))
export const horasTexto = (h: number) => {
  const min = Math.round(h * 60)
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}`
}

// Minhas últimas ações: junta comentários/ações no feed, horas apontadas e edições em massa, mais recente primeiro.
export type Acao = { quando: string; tipo: 'comentario' | 'acao' | 'horas' | 'massa'; texto: string; job_id?: string | null }
const ACAO_FEED = /^(Ajuste [A-Z] pedido|Aguardando |Retomado |Enviado para aprovação|Aprovado pelo cliente)/
export function juntarAcoes(
  comentarios: { criado_em: string; texto: string; job_id: string }[],
  horas: { inicio_em: string | null; created_at: string; horas: number; job_id: string | null; fim_em: string | null }[],
  lotes: { criado_em: string; acao: string; job_ids: string[] | null; desfeito_em: string | null }[],
  max = 12,
): Acao[] {
  const out: Acao[] = [
    ...comentarios.map((c) => ({ quando: c.criado_em, tipo: (ACAO_FEED.test(c.texto) ? 'acao' : 'comentario') as Acao['tipo'], texto: c.texto, job_id: c.job_id })),
    ...horas.filter((h) => h.fim_em).map((h) => ({ quando: h.fim_em ?? h.created_at, tipo: 'horas' as const, texto: `Apontou ${horasTexto(Number(h.horas))}`, job_id: h.job_id })),
    ...lotes.map((l) => ({ quando: l.criado_em, tipo: 'massa' as const,
      texto: `${l.acao === 'excluir' ? 'Mandou para a lixeira' : l.acao === 'restaurar' ? 'Restaurou' : 'Editou em massa'} ${l.job_ids?.length ?? 0} job(s)${l.desfeito_em ? ' (desfeito)' : ''}`, job_id: null })),
  ]
  return out.sort((a, b) => b.quando.localeCompare(a.quando)).slice(0, max)
}
