import { supabaseAdmin } from '@/lib/supabaseAdmin'

// #9726 · A IM do prestador na NFS-e Nacional (DPS) é POR MUNICÍPIO:
//   • Guarujá do Sul (IBGE 4206603) rejeita E0120 quando a IM é informada (sem informações complementares no CNC
//     NFS-e do município emissor);
//   • outros municípios rejeitam E0116 quando a IM NÃO vai.
// A decisão vem de erp_gov_nfse_municipios.informa_im do município EMISSOR (gov_nfse_municipio_codigo).
// Resiliente: qualquer erro, ausência de linha ou código inválido → true (mantém o comportamento atual = manda a IM),
// então nenhum município de E0116 regride por falha de leitura.
export async function municipioInformaIm(codigoMunicipioIbge: string | null | undefined): Promise<boolean> {
  const cod = String(codigoMunicipioIbge ?? '').replace(/\D/g, '')
  if (cod.length !== 7) return true
  try {
    const { data, error } = await supabaseAdmin
      .from('erp_gov_nfse_municipios')
      .select('informa_im')
      .eq('codigo_ibge', cod)
      .maybeSingle()
    if (error) return true
    return (data as { informa_im?: boolean } | null)?.informa_im ?? true
  } catch {
    return true
  }
}
