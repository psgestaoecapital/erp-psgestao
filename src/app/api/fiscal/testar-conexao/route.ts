import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Stub de teste — GE-F3 vai trocar por ping real na Focus NFe API.
export const POST = withAuth(async (req: NextRequest) => {
  try {
    const { companyId } = (await req.json()) as { companyId?: string }
    if (!companyId) return NextResponse.json({ ok: false, erro: 'companyId obrigatório' }, { status: 400 })

    const { data, error } = await supabaseAdmin.rpc('fn_buscar_provider_config_ativa', {
      p_company_id: companyId,
      p_provider: 'focusnfe',
    })
    if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

    const payload = (data ?? {}) as {
      encontrou?: boolean
      tem_certificado?: boolean
      config?: { ambiente?: string }
      certificado?: { validade_fim?: string }
    }

    if (!payload.encontrou) {
      return NextResponse.json({ ok: false, mensagem: 'Configuração Focus NFe não encontrada' })
    }
    if (!payload.tem_certificado) {
      return NextResponse.json({ ok: false, mensagem: 'Certificado A1 não encontrado' })
    }

    const validadeFim = payload.certificado?.validade_fim
    const diasParaExpirar = validadeFim
      ? Math.floor((new Date(validadeFim).getTime() - Date.now()) / 86_400_000)
      : null

    const mensagem = diasParaExpirar !== null && diasParaExpirar < 30
      ? `OK · certificado expira em ${diasParaExpirar} dias`
      : `OK · certificado válido${diasParaExpirar !== null ? ` (${diasParaExpirar} dias)` : ''}`

    return NextResponse.json({
      ok: true,
      mensagem,
      ambiente: payload.config?.ambiente,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro'
    return NextResponse.json({ ok: false, erro: msg }, { status: 500 })
  }
})
