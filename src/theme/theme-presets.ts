// Tema por usuário (CEO 10/10) — FONTE ÚNICA dos presets de cor de destaque. Cresce aqui, não espalhado pelo código.
// Cada preset tem o hex da cor de destaque no modo CLARO (dia) e ESCURO (noite), validados nos dois modos.
// Só a cor de DESTAQUE muda (títulos, ícones de destaque, séries de gráfico). NUNCA o semáforo (verde/amarelo/vermelho
// são fixos — ver globals.css) nem a estrutura da marca (barra espresso, fundo off-white/escuro).
// Verde e vinho ficam de fora até o CEO mudar a regra (conflito com o semáforo).

export type ModoTema = 'claro' | 'escuro' | 'automatico'

export type TemaPreset = {
  id: string        // chave estável (gravada na preferência do usuário)
  nome: string      // rótulo na galeria
  dia: string       // hex da cor de destaque no modo claro
  noite: string     // hex da cor de destaque no modo escuro
}

// 1ª leva curada. Ordem = ordem da galeria; o primeiro é o default.
export const TEMA_PRESETS: TemaPreset[] = [
  { id: 'dourado', nome: 'Dourado', dia: '#C8941A', noite: '#E6B64E' },
  { id: 'ambar', nome: 'Âmbar', dia: '#BA7517', noite: '#EF9F27' },
  { id: 'espresso', nome: 'Espresso', dia: '#5A3A24', noite: '#E0C9B4' },
  { id: 'roxo', nome: 'Roxo', dia: '#534AB7', noite: '#AFA9EC' },
  { id: 'teal', nome: 'Teal', dia: '#0F6E56', noite: '#5DCAA5' },
  { id: 'azul', nome: 'Azul', dia: '#185FA5', noite: '#85B7EB' },
  { id: 'grafite', nome: 'Grafite', dia: '#555550', noite: '#B4B2A9' },
]

export const TEMA_DEFAULT = 'dourado'
export const MODO_DEFAULT: ModoTema = 'automatico'
export const MODOS: { id: ModoTema; nome: string }[] = [
  { id: 'claro', nome: 'Claro' },
  { id: 'escuro', nome: 'Escuro' },
  { id: 'automatico', nome: 'Automático' },
]

export function presetPorId(id: string | null | undefined): TemaPreset {
  return TEMA_PRESETS.find((p) => p.id === id) ?? TEMA_PRESETS[0]
}

// Modo efetivo: 'automatico' vira claro/escuro pelo aparelho (prefers-color-scheme).
export function resolverModo(modo: ModoTema, prefereEscuro: boolean): 'claro' | 'escuro' {
  if (modo === 'claro' || modo === 'escuro') return modo
  return prefereEscuro ? 'escuro' : 'claro'
}

// Cor de destaque efetiva do preset no modo resolvido.
export function corDestaque(preset: TemaPreset, modoEfetivo: 'claro' | 'escuro'): string {
  return modoEfetivo === 'escuro' ? preset.noite : preset.dia
}
