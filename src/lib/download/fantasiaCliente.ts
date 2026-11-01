// Nome fantasia do cliente de uma nota, para o nome do arquivo baixado (chamado #2957). A nota guarda só a razão social
// do tomador/destinatário; o fantasia vem do cadastro de clientes da empresa, pelo CPF/CNPJ (com ou sem pontuação).
// Melhor esforço: qualquer falha devolve null e o nome usa a razão social da nota.
import { supabase } from '@/lib/supabase'

function formatarDoc(d: string): string {
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  return d
}

export async function fantasiaClientePorDoc(companyId: string | null | undefined, doc: string | null | undefined): Promise<string | null> {
  const dig = (doc ?? '').replace(/\D/g, '')
  if (!companyId || (dig.length !== 11 && dig.length !== 14)) return null
  try {
    const vs = [dig, formatarDoc(dig)].map((v) => `"${v}"`).join(',')
    const { data } = await supabase.from('erp_clientes')
      .select('nome_fantasia')
      .eq('company_id', companyId)
      .or(`cnpj_cpf.in.(${vs}),cpf_cnpj.in.(${vs})`)
      .not('nome_fantasia', 'is', null)
      .limit(1)
    const f = (data?.[0] as { nome_fantasia?: string | null } | undefined)?.nome_fantasia?.trim()
    return f || null
  } catch {
    return null
  }
}
