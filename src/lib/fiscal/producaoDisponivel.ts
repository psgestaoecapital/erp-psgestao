import { supabase } from '@/lib/supabase'

// producaoDisponivel — o modal de emissão de NFS-e só libera o botão "Produção" quando a config fiscal
// ATIVA da empresa está em ambiente='producao'.
//
// UMA fonte (RD-52): antes, dois lugares (fiscal/nfse e commerce/otc) traziam esta lógica copiada, e OS
// DOIS filtravam por provider='gov_nfse_nacional' — que hoje está TODO inativo (o gateway real é
// 'focusnfe'). Resultado: o filtro não achava nada, producaoDisponivel ficava false, e o toggle
// Produção travava para TODAS as empresas. Quem tinha config em produção (ex.: RR Serviços, focusnfe,
// producao, ativo) emitia em Homologação achando que valeu — erro silencioso em nota fiscal (chamado
// #16 do Rodrigo). Correção: ler a config ATIVA da empresa, sem amarrar num nome de provider legado.
export async function carregarProducaoDisponivel(companyId: string): Promise<boolean> {
  const { data } = await supabase
    .from('erp_fiscal_provider_config')
    .select('ambiente')
    .eq('company_id', companyId)
    .eq('ativo', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as { ambiente?: string | null } | null)?.ambiente === 'producao'
}
