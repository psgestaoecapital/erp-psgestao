// DVI (Onda 2) · anotação vetorial da foto. Convenção do jsonb combinada com o backend
// (fn_os_foto_anotar, migration 20260912260000):
//   { v:1, tracos:[ { cor:"#hex", pontos:[[x,y],...] } ] }
// x,y NORMALIZADOS 0..1 (fração da largura/altura da imagem) → renderiza em qualquer tamanho.
// Nunca queima na imagem: o traço vive no jsonb e é desenhado por cima.

export type Ponto = [number, number]
export type Traco = { cor: string; pontos: Ponto[] }
export type Anotacao = { v: number; tracos: Traco[] }

// aceita jsonb solto (unknown) e devolve só traços válidos (defensivo — dado vem do banco)
export function parseTracos(a: unknown): Traco[] {
  if (!a || typeof a !== 'object') return []
  const raw = (a as { tracos?: unknown }).tracos
  if (!Array.isArray(raw)) return []
  const out: Traco[] = []
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue
    const pts = (t as { pontos?: unknown }).pontos
    if (!Array.isArray(pts) || pts.length === 0) continue
    const pontos = pts.filter(
      (p): p is Ponto => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number',
    )
    if (pontos.length === 0) continue
    const cor = typeof (t as { cor?: unknown }).cor === 'string' ? (t as { cor: string }).cor : '#A32D2D'
    out.push({ cor, pontos })
  }
  return out
}

export function temAnotacao(a: unknown): boolean {
  return parseTracos(a).length > 0
}

// cores oferecidas ao mecânico (vermelho = defeito, âmbar = atenção, branco = seta sobre foto escura)
export const CORES_ANOTACAO = ['#E23B3B', '#F5A623', '#FFFFFF'] as const
