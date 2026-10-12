// Paleta de identidade PS como tokens checáveis (CEO 12/10): a regra só vira critério de veredito se estiver implementada.
// Espresso #3D2314 (estrutura) + Off-white #FAF7F2 (fundos) + Dourado #C8941A (ícones).
// Verde/Amarelo/Vermelho SÓ como semáforo de performance — nunca decorativo.
export const PALETA_IDENTIDADE = {
  espresso: '#3D2314',
  offwhite: '#FAF7F2',
  dourado: '#C8941A',
} as const

// Semáforo de performance (único uso permitido de verde/amarelo/vermelho).
export const PALETA_SEMAFORO = {
  verde: ['#16A34A', '#15803D', '#22C55E', '#2E7D32', '#10B981'],
  amarelo: ['#EAB308', '#F59E0B', '#CA8A04', '#FACC15', '#D97706'],
  vermelho: ['#DC2626', '#EF4444', '#B91C1C', '#C62828'],
} as const

const norm = (h: string) => {
  const s = h.replace('#', '').toUpperCase()
  return '#' + (s.length === 3 ? s.split('').map((c) => c + c).join('') : s.slice(0, 6))
}
const SEMAFORO = new Set(Object.values(PALETA_SEMAFORO).flat().map(norm))
const IDENTIDADE = new Set(Object.values(PALETA_IDENTIDADE).map(norm))

export type ClasseCor = 'identidade' | 'semaforo' | 'neutra' | 'fora'

const rgb = (h: string) => { const n = norm(h).slice(1); return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) }

/** Neutros (branco, preto e cinzas) não contam como violação. */
export function ehNeutra(hex: string): boolean {
  const [r, g, b] = rgb(hex)
  return Math.max(r, g, b) - Math.min(r, g, b) <= 12
}

export function classificarCor(hex: string): ClasseCor {
  const h = norm(hex)
  if (IDENTIDADE.has(h)) return 'identidade'
  if (SEMAFORO.has(h)) return 'semaforo'
  if (ehNeutra(h)) return 'neutra'
  return 'fora'
}

const HEX = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g
const TW_SEMAFORO = /\b(?:bg|text|border|ring|fill|stroke)-(?:green|emerald|yellow|amber|red)-\d{2,3}\b/g
// Contexto em que verde/amarelo/vermelho é semáforo legítimo (status/performance).
const CTX_SEMAFORO = /semaf|status|sla|alerta|saude|score|meta|desempenho|performance|positivo|negativo|erro|sucesso|aviso|atras|vencid|ok\b/i

export interface AchadoCor { linha: number; tipo: 'cor_fora_da_paleta' | 'semaforo_decorativo'; cor: string }

/** Varre o texto de uma tela e devolve as violações de cor (insumo do Insight visual e do backlog). */
export function violacoesDeCor(texto: string): AchadoCor[] {
  const out: AchadoCor[] = []
  texto.split('\n').forEach((ln, i) => {
    for (const m of ln.matchAll(HEX)) {
      const c = classificarCor(m[0])
      if (c === 'fora') out.push({ linha: i + 1, tipo: 'cor_fora_da_paleta', cor: m[0] })
      else if (c === 'semaforo' && !CTX_SEMAFORO.test(ln)) out.push({ linha: i + 1, tipo: 'semaforo_decorativo', cor: m[0] })
    }
    for (const m of ln.matchAll(TW_SEMAFORO)) if (!CTX_SEMAFORO.test(ln)) out.push({ linha: i + 1, tipo: 'semaforo_decorativo', cor: m[0] })
  })
  return out
}
