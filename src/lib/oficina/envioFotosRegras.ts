// #135 item 6 · regras puras do envio de várias fotos (sem navegador nem banco — o gate as roda direto).
export const PARALELO_FOTOS = 3

export type EstadoFoto = 'fila' | 'comprimindo' | 'enviando' | 'salva' | 'falhou'
export type ProgressoFoto = { idx: number; nome: string; estado: EstadoFoto; pct: number; erro?: string }
export type FotoEnviada = { idx: number; nome: string; path: string; url: string | null; registroId?: string | null }
export type ResultadoEnvio = { enviadas: FotoEnviada[]; falhas: { idx: number; nome: string; erro: string }[] }

export const PCT_ESTADO: Record<EstadoFoto, number> = { fila: 10, comprimindo: 35, enviando: 70, salva: 100, falhou: 100 }

// Roda `tarefa` em cada item com no máximo `limite` ao mesmo tempo; nunca rejeita (a tarefa trata o próprio erro).
export async function emParalelo<T>(itens: T[], limite: number, tarefa: (item: T, idx: number) => Promise<void>): Promise<void> {
  let proximo = 0
  const n = Math.max(1, Math.min(limite, itens.length))
  await Promise.all(Array.from({ length: n }, async () => {
    while (proximo < itens.length) {
      const i = proximo++
      try { await tarefa(itens[i], i) } catch { /* a tarefa registra a própria falha */ }
    }
  }))
}

export function soImagens(files: FileList | File[] | null | undefined): File[] {
  return Array.from(files ?? []).filter((f) => f.type.startsWith('image/'))
}

// Texto do aviso quando alguma foto não subiu (as outras ficam salvas).
export function avisoFalhas(r: ResultadoEnvio): string | null {
  if (!r.falhas.length) return null
  const nomes = r.falhas.map((f) => f.nome || `foto ${f.idx + 1}`).join(', ')
  return `${r.enviadas.length} de ${r.enviadas.length + r.falhas.length} foto(s) salvas. Não subiu: ${nomes}. Tente de novo só essa(s).`
}

