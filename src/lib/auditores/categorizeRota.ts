// Mapeia rota → categoria de área para o Painel Auditores.
// Cobre os prefixos em uso no app; o que não bate cai em "Outras".

export type CategoriaArea =
  | 'Gestão Empresarial'
  | 'Oficina'
  | 'Hub Projetos'
  | 'Industrial'
  | 'P&M'
  | 'Compliance'
  | 'BPO'
  | 'Wealth'
  | 'Commerce'
  | 'Admin'
  | 'Cadastros'
  | 'Outras'

export function categorizeRota(rota: string): CategoriaArea {
  if (rota.startsWith('/dashboard/gestao-empresarial')) return 'Gestão Empresarial'
  if (rota.startsWith('/dashboard/oficina')) return 'Oficina'
  if (rota.startsWith('/dashboard/hub')) return 'Hub Projetos'
  if (rota.startsWith('/dashboard/industrial')) return 'Industrial'
  if (rota.startsWith('/dashboard/pm')) return 'P&M'
  if (rota.startsWith('/dashboard/compliance')) return 'Compliance'
  if (rota.startsWith('/dashboard/bpo')) return 'BPO'
  if (rota.startsWith('/dashboard/wealth') || rota.startsWith('/wealth')) return 'Wealth'
  if (rota.startsWith('/dashboard/commerce')) return 'Commerce'
  if (rota.startsWith('/dashboard/admin') || rota.startsWith('/admin')) return 'Admin'
  if (rota.startsWith('/dashboard/cadastros')) return 'Cadastros'
  return 'Outras'
}

// Verde/amarelo/vermelho EXCLUSIVOS de semáforo (lei psgc-tokens). Aqui o
// score É uma performance metric, então o uso semântico é correto.
export function colorForScore(score: number | null | undefined): { bg: string; text: string } {
  if (score == null) return { bg: 'rgba(61,35,20,0.04)', text: 'rgba(61,35,20,0.5)' }
  if (score >= 70) return { bg: '#EAF3DE', text: '#3B6D11' } // verde
  if (score >= 40) return { bg: '#FAEEDA', text: '#854F0B' } // amarelo
  return { bg: '#FCEBEB', text: '#A32D2D' } // vermelho
}
