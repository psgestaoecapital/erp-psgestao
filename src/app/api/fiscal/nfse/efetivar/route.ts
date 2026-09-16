// POST /api/fiscal/nfse/efetivar  — #18 etapa 3 · "tentar efetivar de novo"
// Reexecuta a efetivação de uma NFS-e AUTORIZADA cujas parcelas não geraram financeiro
// (efetivacao_status='falha' = AUTORIZADA_SEM_FINANCEIRO). Idempotente e atômico no backend
// (fn_nfse_efetivar_se_autorizada): só efetiva se a nota estiver 'autorizada'; se já 'ok', no-op.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = await req.json().catch(() => ({}))
    const nfseId: string | undefined = body?.nfseId
    if (!nfseId) return NextResponse.json({ ok: false, mensagem: 'nfseId obrigatório' }, { status: 400 })

    const { data: nota, error: notaErr } = await supabaseAdmin
      .from('erp_nfse_emitidas').select('id, company_id').eq('id', nfseId).maybeSingle()
    if (notaErr) return NextResponse.json({ ok: false, mensagem: notaErr.message }, { status: 500 })
    if (!nota) return NextResponse.json({ ok: false, mensagem: 'NFS-e não encontrada' }, { status: 404 })

    // multi-tenant: a empresa da nota tem que estar entre as do usuário
    const auth = req.headers.get('authorization') || ''
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: auth } }, auth: { persistSession: false },
    })
    const { data: perm } = await sb.rpc('get_user_company_ids')
    if (!(Array.isArray(perm) ? (perm as string[]) : []).includes(nota.company_id)) {
      return NextResponse.json({ ok: false, mensagem: 'sem acesso a esta empresa' }, { status: 403 })
    }

    const { data, error } = await supabaseAdmin.rpc('fn_nfse_efetivar_se_autorizada', { p_nfse_id: nfseId })
    if (error) return NextResponse.json({ ok: false, mensagem: error.message }, { status: 500 })
    const r = data as { ok?: boolean; erro?: string; motivo?: string } | null
    return NextResponse.json({
      ok: !!r?.ok,
      resultado: r,
      mensagem: r?.ok ? 'Efetivação concluída.' : (r?.erro || r?.motivo || 'Não foi possível efetivar agora.'),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, mensagem: (e as Error)?.message ?? 'Erro interno' }, { status: 500 })
  }
})
