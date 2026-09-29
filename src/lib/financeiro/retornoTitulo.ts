// #287 (Gean) · retorno de remessa: quando o banco não confirma um pagamento (código não reconhecido ou rejeitado),
// a pessoa precisa saber QUAL título é — fornecedor, valor e vencimento —, não só a descrição. Uma linha só, a
// mesma na fila de revisão e no resultado da importação.

export interface TituloRetorno {
  fornecedor?: string | null
  descricao?: string | null
  valor?: number | null
  vencimento?: string | null   // AAAA-MM-DD
  remessa?: number | null
  ocorrencia?: string | null
}

const brl = (n: number) => 'R$ ' + (Math.round(n * 100) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dataBR = (iso: string) => { const [a, m, d] = iso.slice(0, 10).split('-'); return a && m && d ? `${d}/${m}/${a}` : iso }

/** Partes do título para a linha: fornecedor, valor, vencimento, remessa e código do banco (o que existir). */
export function partesTituloRetorno(t: TituloRetorno): string[] {
  const nome = (t.fornecedor || '').trim() || (t.descricao || '').trim() || 'Título sem fornecedor'
  const partes = [nome]
  if (t.valor != null && Number.isFinite(Number(t.valor))) partes.push(brl(Number(t.valor)))
  if (t.vencimento) partes.push(`vence ${dataBR(t.vencimento)}`)
  if (t.remessa != null) partes.push(`remessa Nº ${t.remessa}`)
  if (t.ocorrencia) partes.push(`código do banco ${t.ocorrencia}`)
  return partes
}
export const linhaTituloRetorno = (t: TituloRetorno) => partesTituloRetorno(t).join(' · ')
