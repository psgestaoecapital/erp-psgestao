// Banco do Brasil · apoio das rotas de boleto (server only): credencial do Vault + log. Chamado #5404.
import { Buffer } from 'node:buffer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { BbAmbiente, BbCredencial } from '@/lib/banco/bb'
import { modalidadeBb, normalizarCarteiraBb, type BbCobrancaConfig } from '@/lib/banco/bb/cobranca'

export const BB_BANCO = '001'

export type CredBbCobranca = {
  cred: BbCredencial
  cfg: BbCobrancaConfig
  faltantes: { convenio: string | null; carteira: string | null; variacao_carteira: string | null }
  juros_pct: number | null
  multa_pct: number | null
  instrucao: string | null
}

// Produção quando existe config ativa; senão homologação. Cada ambiente é uma linha própria (dados de teste não tocam os reais).
export async function carregarCredBb(companyId: string): Promise<CredBbCobranca | null> {
  for (const ambiente of ['producao', 'homologacao'] as BbAmbiente[]) {
    const { data } = await supabaseAdmin.rpc('fn_banco_obter_credencial', { p_company_id: companyId, p_banco_codigo: BB_BANCO, p_ambiente: ambiente })
    const r = data as Record<string, unknown> | null
    if (!r || r.ok === false) continue
    const n = normalizarCarteiraBb(r.carteira as string | null, r.variacao_carteira as string | null)
    return {
      cred: {
        client_id: String(r.client_id ?? ''), client_secret: String(r.client_secret ?? ''), app_key: String(r.api_key ?? ''), ambiente,
        pfx: r.cert_base64 ? Buffer.from(String(r.cert_base64), 'base64') : null, passphrase: (r.cert_senha as string | null) ?? null,
      },
      cfg: { convenio: String(r.convenio ?? ''), carteira: n.carteira, variacao: n.variacao, modalidade: modalidadeBb(r.modalidade_boleto as string | null) },
      faltantes: { convenio: (r.convenio as string | null) ?? null, carteira: (r.carteira as string | null) ?? null, variacao_carteira: (r.variacao_carteira as string | null) ?? null },
      juros_pct: (r.juros_pct as number | null) ?? null,
      multa_pct: (r.multa_pct as number | null) ?? null,
      instrucao: (r.instrucao_linha1 as string | null) ?? null,
    }
  }
  return null
}

export async function logSyncBb(company_id: string, tipo: string, status: 'ok' | 'erro', mensagem: string, payload: unknown) {
  await supabaseAdmin.from('erp_banco_sync_log').insert({
    company_id, banco_codigo: BB_BANCO, provider: 'bb', tipo, status, qtd: 1, mensagem, payload_resumo: payload,
  })
}
