import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { decryptApiKey } from '@/lib/fiscal/decrypt'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function buildWebhookUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return `${url.replace(/\/$/, '')}/functions/v1/focus-nfe-webhook`
}

// GET · retorna URL pública do webhook + secret pra exibicao na tela de config
export const GET = withAuth(async (req: NextRequest) => {
  const url = new URL(req.url)
  const companyId = url.searchParams.get('companyId')

  if (!companyId || typeof companyId !== 'string') {
    return NextResponse.json({ ok: false, mensagem: 'companyId obrigatorio' }, { status: 400 })
  }
  if (companyId === 'consolidado' || companyId.startsWith('group_')) {
    return NextResponse.json(
      { ok: false, mensagem: 'Selecione 1 empresa especifica' },
      { status: 400 }
    )
  }

  const { data: config, error } = await supabaseAdmin
    .from('erp_fiscal_provider_config')
    .select('webhook_secret')
    .eq('company_id', companyId)
    .eq('provider', 'focusnfe')
    .eq('ativo', true)
    .maybeSingle()

  if (error || !config) {
    return NextResponse.json(
      { ok: false, mensagem: 'Config Focus NFe nao encontrada' },
      { status: 404 }
    )
  }

  return NextResponse.json({
    ok: true,
    webhookUrl: buildWebhookUrl(),
    webhookSecret: config.webhook_secret ?? null,
  })
})

// POST · configura webhook no painel Focus NFe via /v2/hooks
export const POST = withAuth(async (req: NextRequest) => {
  try {
    const { companyId } = (await req.json()) as { companyId?: string }
    if (!companyId) {
      return NextResponse.json({ ok: false, mensagem: 'companyId obrigatorio' }, { status: 400 })
    }
    if (companyId === 'consolidado' || companyId.startsWith('group_')) {
      return NextResponse.json(
        { ok: false, mensagem: 'Selecione 1 empresa especifica' },
        { status: 400 }
      )
    }

    const { data: config, error } = await supabaseAdmin
      .from('erp_fiscal_provider_config')
      .select('api_key_encrypted, ambiente')
      .eq('company_id', companyId)
      .eq('provider', 'focusnfe')
      .eq('ativo', true)
      .maybeSingle()

    if (error || !config?.api_key_encrypted) {
      return NextResponse.json(
        { ok: false, mensagem: 'Config Focus NFe nao encontrada ou sem api_key' },
        { status: 404 }
      )
    }

    const apiKey = decryptApiKey(config.api_key_encrypted)
    const baseUrl =
      config.ambiente === 'producao'
        ? 'https://api.focusnfe.com.br'
        : 'https://homologacao.focusnfe.com.br'
    const webhookUrl = buildWebhookUrl()

    const resp = await fetch(`${baseUrl}/v2/hooks`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: webhookUrl,
        eventos: ['nfe.status', 'nfse.status', 'mde.disponivel'],
      }),
    })

    const text = await resp.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { raw: text }
    }

    if (!resp.ok) {
      const errPayload = data as { mensagem?: string; codigo?: string } | null
      return NextResponse.json(
        {
          ok: false,
          mensagem: errPayload?.mensagem ?? `HTTP ${resp.status} ao configurar webhook no Focus NFe`,
          status: resp.status,
          detalhes: data,
        },
        { status: 502 }
      )
    }

    const respData = data as { id?: string; hook_id?: string } | null
    return NextResponse.json({
      ok: true,
      webhookId: respData?.id ?? respData?.hook_id ?? null,
      webhookUrl,
      ambiente: config.ambiente,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, mensagem: err instanceof Error ? err.message : 'Erro' },
      { status: 500 }
    )
  }
})
