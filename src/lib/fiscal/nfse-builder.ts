import type { NFSeRequest } from './types'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { FiscalError } from './errors'

export async function buildNFSeFromReceber(opts: {
  companyId: string
  erpReceberId: string
  overrides?: Partial<{
    descricaoServico: string
    cnae: string
    codigoServico: string
    aliquotaIss: number
    retemIss: boolean
  }>
}): Promise<NFSeRequest> {
  const { data: rec, error: recErr } = await supabaseAdmin
    .from('erp_receber')
    .select('id, company_id, cliente_id, cliente_nome, descricao, valor, data_vencimento, observacoes')
    .eq('id', opts.erpReceberId)
    .eq('company_id', opts.companyId)
    .maybeSingle()
  if (recErr || !rec) {
    throw new FiscalError('PAYLOAD_INVALIDO', 'Lancamento a receber nao encontrado')
  }

  const { data: emp, error: empErr } = await supabaseAdmin
    .from('companies')
    .select('cnpj, razao_social, inscricao_municipal')
    .eq('id', opts.companyId)
    .maybeSingle()
  if (empErr || !emp) {
    throw new FiscalError('PAYLOAD_INVALIDO', 'Empresa prestadora nao encontrada')
  }

  const { data: cfg } = await supabaseAdmin
    .from('erp_fiscal_provider_config')
    .select('cnae_padrao, serie_nfse_padrao')
    .eq('company_id', opts.companyId)
    .eq('provider', 'focusnfe')
    .eq('ativo', true)
    .maybeSingle()

  let cliente: {
    razao_social?: string | null
    cnpj_cpf?: string | null
    cpf_cnpj?: string | null
    email?: string | null
    logradouro?: string | null
    numero?: string | null
    bairro?: string | null
    cidade?: string | null
    uf?: string | null
    cep?: string | null
  } | null = null

  if (rec.cliente_id) {
    const { data } = await supabaseAdmin
      .from('erp_clientes')
      .select('razao_social, cnpj_cpf, cpf_cnpj, email, logradouro, numero, bairro, cidade, uf, cep')
      .eq('id', rec.cliente_id)
      .maybeSingle()
    cliente = data ?? null
  }

  const tomadorRazao = cliente?.razao_social ?? rec.cliente_nome ?? 'Consumidor nao identificado'
  const docLimpo = (cliente?.cnpj_cpf ?? cliente?.cpf_cnpj ?? '').replace(/\D/g, '')
  const isCnpj = docLimpo.length === 14
  const isCpf = docLimpo.length === 11

  return {
    serie: cfg?.serie_nfse_padrao ?? '1',
    dataEmissao: new Date().toISOString(),
    cnaeServico: opts.overrides?.cnae ?? cfg?.cnae_padrao ?? '',
    codigoServico: opts.overrides?.codigoServico ?? '',
    descricaoServico:
      opts.overrides?.descricaoServico ?? rec.descricao ?? 'Prestacao de servicos',
    valorServicos: Number(rec.valor),
    aliquotaIss: opts.overrides?.aliquotaIss,
    retemIss: opts.overrides?.retemIss ?? false,
    prestador: {
      cnpj: String(emp.cnpj ?? '').replace(/\D/g, ''),
      razaoSocial: emp.razao_social,
      inscricaoMunicipal: emp.inscricao_municipal ?? undefined,
    },
    tomador: {
      cnpj: isCnpj ? docLimpo : undefined,
      cpf: isCpf ? docLimpo : undefined,
      razaoSocial: tomadorRazao,
      email: cliente?.email ?? undefined,
      endereco: cliente?.logradouro
        ? {
            logradouro: cliente.logradouro,
            numero: cliente.numero ?? undefined,
            bairro: cliente.bairro ?? '',
            cidade: cliente.cidade ?? '',
            uf: cliente.uf ?? '',
            cep: (cliente.cep ?? '').replace(/\D/g, ''),
          }
        : undefined,
    },
    observacoes: rec.observacoes ?? undefined,
  }
}
