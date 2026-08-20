import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  try {
    const body = await req.json()
    const {
      companyId, apiKey, ambiente,
      serieNfsePadrao, proximaNumeracaoNfse,
      serieNfePadrao, proximaNumeracaoNfe,
      cnaePadrao, regimeTributario,
      provider,
      govNfseMunicipioCodigo,
      govNfseMunicipioAderido,
    } = body as Record<string, unknown>

    if (typeof companyId !== 'string' || typeof ambiente !== 'string') {
      return NextResponse.json({ ok: false, erro: 'companyId e ambiente são obrigatórios' }, { status: 400 })
    }

    const providerFinal =
      typeof provider === 'string' && provider.length > 0 ? provider : 'focusnfe'

    // Só pode existir 1 config ATIVA por empresa (índice uq_fiscal_uma_config_ativa =
    // UNIQUE(company_id) WHERE ativo). Ao trocar de provider/ambiente (ex.: gov homologação →
    // Focus produção) o certo é ATUALIZAR a config ativa da empresa na mesma linha — nunca inserir
    // uma segunda ativa (era o que estourava "duplicate key uq_fiscal_uma_config_ativa").
    const { data: existente } = await supabaseAdmin
      .from('erp_fiscal_provider_config')
      .select('id, provider, api_key_encrypted')
      .eq('company_id', companyId)
      .eq('ativo', true)
      .maybeSingle()

    const payload: Record<string, unknown> = {
      company_id: companyId,
      provider: providerFinal,
      ambiente,
      serie_nfse_padrao: typeof serieNfsePadrao === 'string' ? serieNfsePadrao : '1',
      proxima_numeracao_nfse: typeof proximaNumeracaoNfse === 'number' ? proximaNumeracaoNfse : 1,
      serie_nfe_padrao: typeof serieNfePadrao === 'string' ? serieNfePadrao : '1',
      proxima_numeracao_nfe: typeof proximaNumeracaoNfe === 'number' ? proximaNumeracaoNfe : 1,
      cnae_padrao: typeof cnaePadrao === 'string' ? cnaePadrao : null,
      regime_tributario: typeof regimeTributario === 'string' ? regimeTributario : null,
      ativo: true,
      atualizado_por: userId,
    }

    if (providerFinal === 'gov_nfse_nacional') {
      const codigo =
        typeof govNfseMunicipioCodigo === 'string' ? govNfseMunicipioCodigo.replace(/\D/g, '') : null
      if (!codigo || codigo.length !== 7) {
        return NextResponse.json(
          { ok: false, erro: 'Código IBGE do município (7 dígitos) obrigatório pra gov.br NFSe' },
          { status: 400 }
        )
      }
      payload.gov_nfse_municipio_codigo = codigo
      payload.gov_nfse_municipio_aderido =
        typeof govNfseMunicipioAderido === 'boolean' ? govNfseMunicipioAderido : false
      // gov.br NÃO precisa api_key · ignora campo
    } else {
      // Trocando gov → Focus na mesma linha: zera os campos do gov (a linha vira Focus).
      payload.gov_nfse_municipio_codigo = null
      payload.gov_nfse_municipio_aderido = false
      if (typeof apiKey === 'string' && apiKey.trim()) {
        payload.api_key_encrypted = Buffer.from(apiKey, 'utf-8').toString('base64')
        payload.api_key_hash = createHash('sha256').update(apiKey).digest('hex')
      } else if (!existente || existente.provider !== providerFinal || !existente.api_key_encrypted) {
        // Sem config ainda, ou trocando de provider (ex.: gov → Focus), ou a config atual não tem
        // API key salva pra este provider → precisa informar a API key agora.
        return NextResponse.json(
          { ok: false, erro: 'API key obrigatória para o Focus NFe (informe a chave para ativar a produção).' },
          { status: 400 }
        )
      }
      // Mesmo provider Focus e chave já salva: mantém a api_key existente (não precisa re-digitar).
    }

    if (existente) {
      const { data, error } = await supabaseAdmin
        .from('erp_fiscal_provider_config')
        .update(payload)
        .eq('id', existente.id)
        .select('id')
        .single()
      if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, configId: data.id })
    }

    payload.criado_por = userId
    const { data, error } = await supabaseAdmin
      .from('erp_fiscal_provider_config')
      .insert(payload)
      .select('id')
      .single()
    if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, configId: data.id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro'
    return NextResponse.json({ ok: false, erro: msg }, { status: 500 })
  }
})
