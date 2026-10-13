// PS EHS — tokens visuais próprios. Verde/amarelo/vermelho SÓ para status.
export const EHS = {
  fundo: '#F6F8F7',
  superficie: '#FFFFFF',
  borda: '#DCE4E0',
  tinta: '#14211C',
  suave: '#5B6B64',
  marca: '#0F5C4A',
  marcaClara: '#E3F1EC',
  ok: '#1E7A46',
  okBg: '#E4F4EA',
  atencao: '#8A6100',
  atencaoBg: '#FFF3D6',
  critico: '#B3261E',
  criticoBg: '#FDE7E5',
  neutro: '#5B6B64',
  neutroBg: '#EDF0EE',
  // mobile/campo: alvo de toque mínimo (px)
  alvoToque: 56,
} as const

export type EhsStatus = 'ok' | 'atencao' | 'critico' | 'neutro'
