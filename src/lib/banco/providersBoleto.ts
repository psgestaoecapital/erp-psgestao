// #88 (FC Pisos) · empresa com MAIS DE UM banco emitindo boleto (FC: Sicoob e Sicredi). A tela pegava "o
// primeiro" config ativo sem ordem (limit 1) — o boleto ia para um banco que a operadora não escolheu. Aqui:
// lista todos, o mais recentemente configurado primeiro, e lembra (por empresa, neste navegador) a escolha.
import { supabase } from '@/lib/supabase'

export type BoletoProvider = 'sicoob' | 'sicredi' | 'bradesco'
export const NOME_BANCO: Record<BoletoProvider, string> = { sicoob: 'Sicoob', sicredi: 'Sicredi', bradesco: 'Bradesco' }

const valido = (p: string): p is BoletoProvider => p === 'sicoob' || p === 'sicredi' || p === 'bradesco'
const chave = (companyId: string) => `ps_boleto_banco:${companyId}`

// #1673: banco marcado como RESPONSÁVEL pelos boletos da empresa (Conexões Bancárias) — vence a escolha lembrada.
const responsavelDaEmpresa = new Map<string, BoletoProvider>()

export async function listarProvidersBoleto(companyId: string): Promise<BoletoProvider[]> {
  const { data } = await supabase.from('erp_banco_provider_config')
    .select('provider, updated_at, boleto_responsavel').eq('company_id', companyId).eq('ativo', true).eq('cap_boleto', true)
    .order('updated_at', { ascending: false })
  const out: BoletoProvider[] = []
  responsavelDaEmpresa.delete(companyId)
  for (const r of (data ?? []) as { provider: string | null; boleto_responsavel: boolean | null }[]) {
    const p = String(r.provider ?? '').toLowerCase()
    if (!valido(p)) continue
    if (r.boleto_responsavel) responsavelDaEmpresa.set(companyId, p)
    if (!out.includes(p)) out.push(p)
  }
  return out
}

export function escolherProviderBoleto(companyId: string, lista: BoletoProvider[]): BoletoProvider | null {
  if (lista.length === 0) return null
  const resp = responsavelDaEmpresa.get(companyId)
  if (resp && lista.includes(resp)) return resp
  try {
    const salvo = window.localStorage.getItem(chave(companyId)) ?? ''
    if (valido(salvo) && lista.includes(salvo)) return salvo
  } catch { /* sem storage: usa o padrão */ }
  return lista[0]
}

export function lembrarProviderBoleto(companyId: string, p: BoletoProvider): void {
  try { window.localStorage.setItem(chave(companyId), p) } catch { /* noop */ }
}
