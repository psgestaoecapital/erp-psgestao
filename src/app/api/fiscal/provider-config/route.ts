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
    } = body as Record<string, unknown>

    if (typeof companyId !== 'string' || typeof ambiente !== 'string') {
      return NextResponse.json({ ok: false, erro: 'companyId e ambiente são obrigatórios' }, { status: 400 })
    }

    const { data: existente } = await supabaseAdmin
      .from('erp_fiscal_provider_config')
      .select('id')
      .eq('company_id', companyId)
      .eq('provider', 'focusnfe')
      .eq('ativo', true)
      .maybeSingle()

    const payload: Record<string, unknown> = {
      company_id: companyId,
      provider: 'focusnfe',
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

    if (typeof apiKey === 'string' && apiKey.trim()) {
      // TODO: substituir por pgsodium/vault antes de produção (issue de hardening fiscal)
      payload.api_key_encrypted = Buffer.from(apiKey, 'utf-8').toString('base64')
      payload.api_key_hash = createHash('sha256').update(apiKey).digest('hex')
    } else if (!existente) {
      return NextResponse.json(
        { ok: false, erro: 'API key obrigatória na primeira configuração' },
        { status: 400 }
      )
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
