// Tokens compartilhados da tela DRE Divisional.
// Paleta espresso/off-white/dourado inviolavel.
'use client'

export const C = {
  espresso: '#3D2314',
  espressoLt: '#5C3923',
  offwhite: '#FAF7F2',
  gold: '#C8941A',
  goldLt: '#E5B658',
  beigeLt: '#f5f0e8',
  borderLt: '#ece3d2',
  ink: '#1a1a1a',
  muted: 'rgba(61, 35, 20, 0.55)',
  // Semáforo (uso restrito a indicadores de performance)
  green: '#2d6a3e',
  greenBg: '#e8f3ec',
  amber: '#8a6a10',
  amberBg: '#fdf4e0',
  red: '#a02020',
  redBg: '#fce8e8',
  // Neutros
  gray: '#6b6b6b',
  grayBg: '#efece6',
}

export const METODO_LABEL: Record<string, string> = {
  receita: 'por Receita',
  margem: 'por Margem de Contribuição',
  fisico_m2: 'por Área (m²)',
  fisico_headcount: 'por Headcount',
  fisico_transacoes: 'por Transações',
  igualitario: 'Igualitário',
}

export const MESES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

export const fmtBRL = (v: number) => {
  if (!Number.isFinite(v)) return 'R$ 0'
  const negativo = v < 0
  const abs = Math.abs(v)
  const fmt = `R$ ${abs.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  return negativo ? `(${fmt})` : fmt
}

export const fmtPct = (v: number, casas = 1) => {
  if (!Number.isFinite(v)) return '0%'
  return `${v.toFixed(casas)}%`
}
