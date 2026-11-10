// Painel Comercial v6 — formatação e cores compartilhadas entre as abas (Visão geral, Vendedores, …).
// Só helpers puros; nenhum acesso a rede/DOM.

export const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', bd: '#E7DED3', m: '#6B5D4F', d: '#9C8E80' }
export const ROTA = '/dashboard/comercial/meu-painel-v6'

const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
export const brl0 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
export const brl2 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
export const int = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v)
export const pct = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'percent', maximumFractionDigits: 1 }).format(v)
export const ton = (kg: number | null | undefined) => kg == null ? '—' : nf({ maximumFractionDigits: 1 }).format(kg / 1000) + ' t'

export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const diaISO = (base: string, n: number) => {
  const [y, m, d] = base.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000)
  return t.toISOString().slice(0, 10)
}
export const dataBR = (isoDia: string) => { const [y, m, d] = isoDia.split('-'); return `${d}/${m}/${y}` }
export const diaDaSemana = (isoDia: string) => { const [y, m, d] = isoDia.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
