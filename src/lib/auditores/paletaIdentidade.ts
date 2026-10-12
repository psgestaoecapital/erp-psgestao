// Paleta de identidade PS como regra CHECÁVEL (CEO 12/10): o Auditor Completo de Tela usa estes tokens
// para derrubar a tela a BLOQUEADO quando a cor viola a identidade.
// Estrutura = Espresso, fundos = Off-white, ícones = Dourado. Verde/amarelo/vermelho SÓ como semáforo de performance.

export const PALETA_IDENTIDADE = {
  espresso: '#3D2314',
  offWhite: '#FAF7F2',
  dourado: '#C8941A',
} as const

export type PapelCor = keyof typeof PALETA_IDENTIDADE

// Neutros que nunca contam como violação (texto/linha/sombra).
const NEUTROS = new Set(['#FFFFFF', '#000000', '#FFF', '#000'])

export function normalizarHex(h: string): string {
  let x = h.trim().toUpperCase()
  if (/^#[0-9A-F]{3}$/.test(x)) x = '#' + x[1] + x[1] + x[2] + x[2] + x[3] + x[3]
  return x
}

export function ehNeutro(h: string): boolean {
  const x = normalizarHex(h)
  if (NEUTROS.has(x)) return true
  const m = /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/.exec(x)
  if (!m) return false
  const [r, g, b] = [m[1], m[2], m[3]].map(p => parseInt(p, 16))
  return Math.max(r, g, b) - Math.min(r, g, b) <= 12 // cinza
}

export function ehIdentidade(h: string): boolean {
  const x = normalizarHex(h)
  return Object.values(PALETA_IDENTIDADE).some(c => c === x)
}

/** Família de matiz de semáforo (verde/amarelo/vermelho), ou null. */
export function familiaSemaforo(h: string): 'verde' | 'amarelo' | 'vermelho' | null {
  const m = /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/.exec(normalizarHex(h))
  if (!m) return null
  const [r, g, b] = [m[1], m[2], m[3]].map(p => parseInt(p, 16) / 255)
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  if (d < 0.2 || mx < 0.25) return null
  let hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  hh = (hh * 60 + 360) % 360
  if (hh < 15 || hh >= 345) return 'vermelho'
  if (hh >= 40 && hh < 70) return 'amarelo'
  if (hh >= 90 && hh < 165) return 'verde'
  return null
}

export type ViolacaoCor = { cor: string; tipo: 'fora_da_paleta' | 'semaforo_decorativo'; linha: number }

/**
 * Varre o fonte de uma tela. Cor de semáforo só é aceita na mesma linha de um marcador de performance
 * (`semaforo`, `status`, `performance`, `kpi`, `alerta`); fora disso é uso decorativo.
 */
export function auditarCoresFonte(fonte: string): ViolacaoCor[] {
  const out: ViolacaoCor[] = []
  fonte.split('\n').forEach((ln, i) => {
    for (const m of ln.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) {
      const cor = normalizarHex(m[0])
      if (ehIdentidade(cor) || ehNeutro(cor)) continue
      const fam = familiaSemaforo(cor)
      if (fam) {
        if (!/semaforo|sem[aá]foro|status|performance|kpi|alerta/i.test(ln)) out.push({ cor, tipo: 'semaforo_decorativo', linha: i + 1 })
      } else out.push({ cor, tipo: 'fora_da_paleta', linha: i + 1 })
    }
  })
  return out
}
