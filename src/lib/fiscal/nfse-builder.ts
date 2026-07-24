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
    .select('cnae_padrao, serie_nfse_padrao, gov_nfse_municipio_codigo')
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
    codigo_ibge_municipio?: string | null
    complemento?: string | null
  } | null = null

  if (rec.cliente_id) {
    const { data } = await supabaseAdmin
      .from('erp_clientes')
      .select('razao_social, cnpj_cpf, cpf_cnpj, email, logradouro, numero, bairro, cidade, uf, cep, codigo_ibge_municipio, complemento')
      .eq('id', rec.cliente_id)
      .maybeSingle()
    cliente = data ?? null
  }

  // FIX-IBGE-TOMADOR (24/07/2026): o codigo IBGE do municipio do tomador e obrigatorio na NFS-e nacional.
  // Cadastros antigos / preenchimento por CNPJ deixavam CEP sem IBGE, e a emissao rejeitava pedindo um
  // dado que o usuario NAO controla (o campo e derivado). Em vez de rejeitar: resolve pelo CEP na hora e
  // AUTO-CURA (grava de volta no cliente) — backfill progressivo, cada emissao conserta aquele cliente.
  let ibgeTomador = (cliente?.codigo_ibge_municipio ?? '').trim() || null
  const cepTomador = (cliente?.cep ?? '').replace(/\D/g, '')
  if (!ibgeTomador && cepTomador.length === 8) {
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cepTomador}/json/`, { next: { revalidate: 86400 } })
      const d = await r.json()
      if (d?.ibge) {
        ibgeTomador = String(d.ibge)
        if (rec.cliente_id) {
          await supabaseAdmin.from('erp_clientes')
            .update({ codigo_ibge_municipio: ibgeTomador })
            .eq('id', rec.cliente_id)
        }
      }
    } catch { /* sem rede: segue; o guard abaixo dá a mensagem honesta */ }
  }

  // Guard com mensagem HONESTA (RD-51): nunca pedir o que o usuario ja fez.
  if (cliente?.logradouro && !ibgeTomador) {
    if (cepTomador.length === 8) {
      throw new FiscalError('PAYLOAD_INVALIDO',
        `Nao consegui resolver o codigo IBGE do municipio do tomador pelo CEP ${cepTomador}. ` +
        `O CEP ja esta preenchido — a falha e na resolucao (sistema/rede), nao no seu cadastro. ` +
        `Tente emitir de novo; se persistir, avise o suporte.`)
    } else {
      throw new FiscalError('PAYLOAD_INVALIDO',
        `O tomador "${cliente?.razao_social ?? rec.cliente_nome ?? ''}" esta sem CEP. ` +
        `Informe o CEP no cadastro do cliente para a NFS-e sair com o municipio correto.`)
    }
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
      // FIX-PRESTADOR-CODIGO-MUNICIPIO: o Focus exige prestador.codigo_municipio (IBGE).
      // Vem da config fiscal (gov_nfse_municipio_codigo). Antes nunca era enviado.
      codigoMunicipio: cfg?.gov_nfse_municipio_codigo ?? undefined,
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
            complemento: cliente.complemento ?? undefined,
            bairro: cliente.bairro ?? '',
            cidade: cliente.cidade ?? '',
            uf: cliente.uf ?? '',
            cep: (cliente.cep ?? '').replace(/\D/g, ''),
            codigoMunicipio: ibgeTomador ?? undefined,
          }
        : undefined,
    },
    observacoes: rec.observacoes ?? undefined,
  }
}
