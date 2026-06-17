// GE-F10 · adapter pra emissao via NFSe Nacional gov.br
// Backend: Edge Function gov-nfse-emitir (deployada ACTIVE · verify_jwt=true)
// RPC: fn_gov_nfse_municipio_aderiu (cache local · v_gov_nfse_dps_pendentes)
//
// Uso server-side: chamado pelo /api/fiscal/nfse/emitir quando provider='gov_nfse_nacional'
// Uso client-side: verificarMunicipioAderido() no FocusNFeConfigCard
//
// Fase 1: NAO faz mTLS real · so registra DPS via Edge Function
// Fase 2 (futuro): mTLS com cert A1 + envio sefin.nfse.gov.br/sefinnacional/dps

import { supabase } from '@/lib/supabase'

export interface GovNFSeMunicipioStatus {
  codigo_ibge: string
  nome?: string
  uf?: string
  aderido: boolean
  data_adesao?: string | null
}

export async function verificarMunicipioAderido(
  codigoIbge: string
): Promise<GovNFSeMunicipioStatus | null> {
  const codigo = codigoIbge.replace(/\D/g, '')
  if (codigo.length !== 7) {
    throw new Error('Código IBGE deve ter 7 dígitos')
  }
  const { data, error } = await supabase.rpc('fn_gov_nfse_municipio_aderiu', {
    p_codigo_ibge: codigo,
  })
  if (error) throw error
  return (data ?? null) as GovNFSeMunicipioStatus | null
}

// Server-side: chamado pelo /api/fiscal/nfse/emitir
// Recebe authorization (Bearer user JWT) pra passthrough na Edge Function
export interface GovNFSeEmitirInput {
  companyId: string
  ambiente?: 'homologacao' | 'producao'
  prestador: {
    cnpj: string
    razaoSocial: string
    inscricaoMunicipal?: string | null
    municipioIbge: string
  }
  tomador: {
    cnpj?: string
    cpf?: string
    razaoSocial: string
    email?: string
    municipioIbge?: string
    uf?: string
  }
  servico: {
    codigoTributacaoNacional?: string | null
    descricao: string
    valorServico: number
    aliquotaIss?: number | null
    issRetido?: boolean
  }
  erpReceberId?: string | null
}

export interface GovNFSeEmitirResultado {
  ok: boolean
  dpsId?: string
  numeroDps?: number
  status?: string
  mensagem?: string
  erro?: string
}

export async function emitirNFSeViaGovServer(
  input: GovNFSeEmitirInput,
  authorizationHeader: string
): Promise<GovNFSeEmitirResultado> {
  const baseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
  const url = `${baseUrl}/functions/v1/gov-nfse-emitir`

  // nfse-edge-payload-shape-v1: a edge gov-nfse-emitir valida payload em
  // snake_case ({ company_id, servico:{ descricao, valor,
  // codigo_tributacao_nacional_iss, aliquota_iss }, tomador:{ cpf_cnpj,
  // razao_social } }). Transforma o input camelCase antes de enviar.
  const cpfCnpjTomador = (input.tomador.cnpj ?? input.tomador.cpf ?? '').replace(/\D/g, '')
  const codigoServico = (input.servico.codigoTributacaoNacional ?? '').toString()
  const edgePayload: Record<string, unknown> = {
    company_id: input.companyId,
    teste_homologacao: input.ambiente === 'homologacao',
    servico: {
      descricao: input.servico.descricao,
      valor: input.servico.valorServico,
      codigo_tributacao_nacional_iss: codigoServico,
      aliquota_iss: input.servico.aliquotaIss ?? undefined,
    },
    tomador: {
      cpf_cnpj: cpfCnpjTomador || undefined,
      razao_social: input.tomador.razaoSocial,
    },
  }

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authorizationHeader,
      },
      body: JSON.stringify(edgePayload),
    })
    const text = await resp.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { raw: text }
    }
    if (!resp.ok) {
      const err = data as { erro?: string; mensagem?: string } | null
      return {
        ok: false,
        erro: err?.erro ?? err?.mensagem ?? `HTTP ${resp.status} na Edge Function gov-nfse-emitir`,
      }
    }
    return data as GovNFSeEmitirResultado
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Erro de rede' }
  }
}
