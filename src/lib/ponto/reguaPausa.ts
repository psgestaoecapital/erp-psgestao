// #76 (Frioeste · CEO 03/10) · Régua das pausas térmicas: cada desvio diz o MOTIVO pela régua da empresa, com segundos.
// A classificação no banco (fn_nr36_classificar_eventos) compara em segundos: abaixo do limite inferior (hoje = a pausa,
// 20:00) é insuficiente; abaixo de tolerancia_excesso_min (24:00) é normal; até limite_esquecimento_min é excesso.
// A tela mostrava os minutos ARREDONDADOS: no dado da Frioeste (ago–set) 38 pausas insuficientes apareciam como
// "20 min — o mínimo é 20 min" e 25 normais como "24 min". Aqui o motivo sai com mm:ss, o mesmo número que decide.

export type Regua = {
  pausa_min: number
  tolerancia_excesso_min: number
  limite_esquecimento_min?: number | null
  // limite inferior definido pela empresa; vazio = vale a própria pausa (abaixo de pausa_min é desvio, sem tolerância)
  limite_inferior_min?: number | null
}

export function reguaDe(param: Record<string, unknown> | null | undefined): Regua {
  const n = (v: unknown, d: number) => (v == null || v === '' || Number.isNaN(Number(v)) ? d : Number(v))
  const inf = param?.limite_inferior_min
  return {
    pausa_min: n(param?.pausa_min, 20),
    tolerancia_excesso_min: n(param?.tolerancia_excesso_min, 23),
    limite_esquecimento_min: n(param?.limite_esquecimento_min, 45),
    limite_inferior_min: inf == null || inf === '' ? null : Number(inf),
  }
}

export const limiteInferior = (r: Regua) => (r.limite_inferior_min ?? r.pausa_min)

// segundos → "19:57" (minutos:segundos)
export function mmss(seg: number): string {
  const s = Math.max(0, Math.round(seg))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
// minutos (pode ter fração) → "19:30"
export const minParaMmss = (min: number) => mmss(min * 60)

// Motivo do desvio pela régua, com o número que decide (segundos quando houver; senão os minutos inteiros).
export function motivoRegua(p: { seg?: number | null; min?: number | null; classe?: string | null }, r: Regua): string | null {
  const dur = p.seg != null ? mmss(p.seg) : p.min != null ? `${p.min}:00` : null
  if (!dur) return null
  if (p.classe === 'pausa_insuficiente') return `abaixo do mínimo: ${dur} < ${minParaMmss(limiteInferior(r))}`
  if (p.classe === 'pausa_excesso') return `acima do máximo: ${dur} ≥ ${minParaMmss(r.tolerancia_excesso_min)}`
  return null
}

// A régua em uma linha, para o time de supervisão saber o que é desvio.
export function textoRegua(r: Regua): string {
  const inf = limiteInferior(r)
  const partes = [
    `pausa de ${r.pausa_min} min`,
    `normal de ${minParaMmss(inf)} a ${mmss(r.tolerancia_excesso_min * 60 - 1)}`,
    `excesso a partir de ${minParaMmss(r.tolerancia_excesso_min)}`,
    `abaixo de ${minParaMmss(inf)} é desvio`,
  ]
  return `Régua da empresa: ${partes.join(' · ')}${r.limite_inferior_min == null ? ' (limite inferior ainda não definido pela empresa: vale a própria pausa, sem tolerância)' : ''}`
}
