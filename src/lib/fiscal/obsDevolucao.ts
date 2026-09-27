// #94/#142 · observação da NF-e de DEVOLUÇÃO DE COMPRA: a nota de origem precisa aparecer nos dados adicionais
// da DANFE ("Referente à NF X emitida em DD/MM/AAAA"), não só no grupo NFref estrutural.
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { textoObsDevolucaoCompra, type NotaOrigem } from '@/lib/fiscal/obsDevolucaoTexto'

export async function montarObsDevolucaoCompra(companyId: string, chaveCompra: string): Promise<string> {
  const { data: nota } = await supabaseAdmin
    .from('erp_nfe_recebidas')
    .select('numero, serie, data_emissao')
    .eq('company_id', companyId)
    .eq('chave_acesso', chaveCompra)
    .maybeSingle()
  return textoObsDevolucaoCompra(chaveCompra, (nota as NotaOrigem | null) ?? null)
}
