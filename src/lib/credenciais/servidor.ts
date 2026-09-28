import { supabaseAdmin } from '@/lib/supabaseAdmin'

// PR E (CEO 28/09): segredo de integração (Omie/Nibo/ContaAzul) vive só no Vault — nunca em coluna, nunca no
// navegador. As rotas /api leem aqui, no servidor, com a chave de serviço, DEPOIS de conferir a empresa do usuário.
export async function credencialEmpresa(companyId: string, provider: string, chave: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc('fn_credencial_empresa_ler', { p_provider: provider, p_chave: chave, p_company_id: companyId })
  if (error) return null
  return typeof data === 'string' && data.length > 0 ? data : null
}

export async function gravarCredencialEmpresa(companyId: string, provider: string, chave: string, valor: string, label?: string): Promise<boolean> {
  if (!valor) return false
  const { data, error } = await supabaseAdmin.rpc('fn_credencial_empresa_gravar_servico', {
    p_provider: provider, p_chave: chave, p_valor: valor, p_company_id: companyId, p_label: label ?? null,
  })
  return !error && (data as { ok?: boolean } | null)?.ok === true
}
