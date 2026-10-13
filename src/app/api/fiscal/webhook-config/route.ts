import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { decryptApiKey } from '@/lib/fiscal/decrypt'
import { guardaEmpresaFiscal } from '@/lib/auth/assertAcessoEmpresa'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function buildWebhookUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return `${url.replace(/\/$/, '')}/functions/v1/focus-nfe-webhook`
}

// GET · retorna URL pública do webhook + secret pra exibicao na tela de config
export const GET = withAuth(async (req: NextRequest, { userId }) => {
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

  const negado = await guardaEmpresaFiscal({ userId, companyId, papelMinimo: 'gerente', log: { notaTipo: 'nfe', operacao: 'webhook_config', endpoint: 'webhook-config' } })
  if (negado) return negado

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

  // O segredo é um TOKEN de acesso (a Focus o devolve no header) — NUNCA expor na tela.
  // A tela mostra só o aviso automático ativo/inativo: registrado = já há segredo gravado.
  return NextResponse.json({
    ok: true,
    webhookUrl: buildWebhookUrl(),
    authorizationHeader: 'X-PS-Webhook-Token',
    webhookAtivo: !!(config.webhook_secret && String(config.webhook_secret).length >= 32),
  })
})

// POST · configura webhook no painel Focus NFe via /v2/hooks
export const POST = withAuth(async (req: NextRequest, { userId }) => {
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

    const negado = await guardaEmpresaFiscal({ userId, companyId, papelMinimo: 'gerente', log: { notaTipo: 'nfe', operacao: 'webhook_config', endpoint: 'webhook-config' } })
    if (negado) return negado

    const { data: config, error } = await supabaseAdmin
      .from('erp_fiscal_provider_config')
      .select('api_key_encrypted, ambiente, webhook_secret')
      .eq('company_id', companyId)
      .eq('provider', 'focusnfe')
      .eq('ativo', true)
      .maybeSingle()

    if (error || !config) {
      return NextResponse.json(
        { ok: false, mensagem: 'Config Focus NFe nao encontrada ou sem api_key' },
        { status: 404 }
      )
    }

    // FIX-FOCUS-TOKEN-VAULT (RD-52): coluna legada api_key_encrypted OU token do Vault
    // (fn_fiscal_obter_token) — o "Atualizar" grava no Vault, nao na coluna.
    let apiKey: string
    if (config.api_key_encrypted) {
      apiKey = decryptApiKey(config.api_key_encrypted)
    } else {
      const { data: tok } = await supabaseAdmin.rpc('fn_fiscal_obter_token', {
        p_company_id: companyId,
        p_ambiente: config.ambiente ?? 'producao',
      })
      const tokStr = typeof tok === 'string' ? tok.trim() : ''
      if (tokStr.length < 8) {
        return NextResponse.json(
          { ok: false, mensagem: 'Config Focus NFe nao encontrada ou sem api_key' },
          { status: 404 }
        )
      }
      apiKey = tokStr
    }

    // CNPJ da empresa (a Focus cadastra o gatilho por CNPJ).
    const { data: empresa } = await supabaseAdmin
      .from('companies').select('cnpj').eq('id', companyId).maybeSingle()
    const cnpj = String(empresa?.cnpj ?? '').replace(/\D/g, '')
    if (cnpj.length !== 14) {
      return NextResponse.json(
        { ok: false, mensagem: 'CNPJ da empresa ausente/inválido — necessário para cadastrar o webhook na Focus.' },
        { status: 400 }
      )
    }

    // FIX-FOCUS-WEBHOOK-TOKEN: a Focus NÃO assina o corpo. Cadastramos o gatilho com um TOKEN próprio
    // (authorization) que ela devolve no header authorization_header. Geramos um segredo forte por empresa
    // (32 bytes), guardamos em webhook_secret (server-side, nunca exposto) e o receptor valida por igualdade.
    let webhookSecret = (config.webhook_secret ?? '').trim()
    if (webhookSecret.length < 32) {
      webhookSecret = randomBytes(32).toString('hex')
      const { error: upErr } = await supabaseAdmin
        .from('erp_fiscal_provider_config')
        .update({ webhook_secret: webhookSecret })
        .eq('company_id', companyId).eq('provider', 'focusnfe').eq('ativo', true)
      if (upErr) {
        return NextResponse.json({ ok: false, mensagem: 'Falha ao gravar o segredo do webhook: ' + upErr.message }, { status: 500 })
      }
    }

    const baseUrl =
      config.ambiente === 'producao'
        ? 'https://api.focusnfe.com.br'
        : 'https://homologacao.focusnfe.com.br'
    const webhookUrl = buildWebhookUrl()
    const AUTH_HEADER = 'X-PS-Webhook-Token'
    const basic = `Basic ${Buffer.from(apiKey + ':').toString('base64')}`
    // Eventos que a empresa emite (nomes conforme doc Focus /v2/hooks). 'nfsen' = NFS-e Nacional.
    const EVENTOS = ['nfse', 'nfsen', 'nfe', 'nfce'] as const

    // Gatilhos já cadastrados (evita duplicar): lista e indexa por url+event.
    let existentes: Array<{ id?: string; url?: string; event?: string }> = []
    try {
      const rList = await fetch(`${baseUrl}/v2/hooks`, { headers: { Authorization: basic } })
      if (rList.ok) {
        const arr = (await rList.json().catch(() => null)) as unknown
        if (Array.isArray(arr)) existentes = arr as typeof existentes
      }
    } catch { /* segue pro cadastro */ }

    const relatorio: Array<{ evento: string; acao: string; ok: boolean; id: string | null; erro?: string }> = []
    for (const evento of EVENTOS) {
      try {
        const jaTem = existentes.find((h) => h?.event === evento && h?.url === webhookUrl)
        // upsert limpo: se já existe pra este url+evento, remove e recria com o token atual.
        if (jaTem?.id) {
          await fetch(`${baseUrl}/v2/hooks/${jaTem.id}`, { method: 'DELETE', headers: { Authorization: basic } }).catch(() => {})
        }
        const r = await fetch(`${baseUrl}/v2/hooks`, {
          method: 'POST',
          headers: { Authorization: basic, 'Content-Type': 'application/json' },
          body: JSON.stringify({ cnpj, event: evento, url: webhookUrl, authorization: webhookSecret, authorization_header: AUTH_HEADER }),
        })
        const txt = await r.text()
        let d: unknown = null
        try { d = txt ? JSON.parse(txt) : null } catch { d = { raw: txt } }
        const dd = d as { id?: string; hook_id?: string; mensagem?: string; erro?: string } | null
        relatorio.push({
          evento,
          acao: jaTem?.id ? 'atualizado' : 'registrado',
          ok: r.ok,
          id: dd?.id ?? dd?.hook_id ?? null,
          erro: r.ok ? undefined : (dd?.mensagem ?? dd?.erro ?? `HTTP ${r.status}`),
        })
      } catch (e) {
        relatorio.push({ evento, acao: 'falha', ok: false, id: null, erro: e instanceof Error ? e.message : 'erro' })
      }
    }

    const algumOk = relatorio.some((r) => r.ok)
    return NextResponse.json({
      ok: algumOk,
      webhookUrl,
      authorizationHeader: AUTH_HEADER,
      ambiente: config.ambiente,
      eventos: relatorio,
    }, { status: algumOk ? 200 : 502 })
  } catch (err) {
    return NextResponse.json(
      { ok: false, mensagem: err instanceof Error ? err.message : 'Erro' },
      { status: 500 }
    )
  }
})
