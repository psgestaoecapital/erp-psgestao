// Ponto ÚNICO de aplicação do tema (CEO 10/10). Põe no <html>: data-modo (claro|escuro, resolvido) e a cor de destaque
// (--gold e derivados) do preset. Recolore tudo que usa var(--gold*)/tokens de superfície; o semáforo e os campos de
// dados (--input-*) NÃO são tocados (ficam fixos na marca — ver globals.css). Usado pelo ThemeApplier (no load) e pela
// tela Aparência (prévia ao vivo).
import { type ModoTema, corDestaque, presetPorId, resolverModo } from './theme-presets'

let mql: MediaQueryList | null = null
let ouvinte: ((e?: MediaQueryListEvent) => void) | null = null

export function aplicarTema(temaId: string, modo: ModoTema): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const preset = presetPorId(temaId)
  const prefereEscuro = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
  const efetivo = resolverModo(modo, prefereEscuro)
  root.setAttribute('data-modo', efetivo)
  const base = corDestaque(preset, efetivo)
  root.style.setProperty('--gold', base)
  root.style.setProperty('--gold-light', `color-mix(in srgb, ${base}, #ffffff 30%)`)
  root.style.setProperty('--gold-dark', `color-mix(in srgb, ${base}, #000000 30%)`)
  root.style.setProperty('--gold-glow', `color-mix(in srgb, ${base} 15%, transparent)`)
  root.style.setProperty('--gold-subtle', `color-mix(in srgb, ${base} 6%, transparent)`)

  // 'automatico': re-aplica quando o aparelho troca claro/escuro (sem acumular ouvintes)
  if (ouvinte && mql) { mql.removeEventListener('change', ouvinte); ouvinte = null }
  if (modo === 'automatico' && typeof window !== 'undefined' && window.matchMedia) {
    mql = window.matchMedia('(prefers-color-scheme: dark)')
    ouvinte = () => aplicarTema(temaId, modo)
    mql.addEventListener('change', ouvinte)
  }
}
