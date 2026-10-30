// Banco do Brasil · Cancelar Boleto (baixa no banco) · Node runtime. Chamado #5404.
// Cancela SOMENTE o boleto: o título (erp_receber) permanece ativo. Boleto pago/baixado não é elegível.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { baixarBoletoBb } from '@/lib/banco/bb/cobranca'
import { BB_BANCO, carregarCredBb, logSyncBb } from '@/lib/banco/bb/servidor'
import { extractBankMessage } from '@/lib/banco/bankError'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { receber_id } = await req.json()
    if (!receber_id) return NextResponse.json({ ok: false, erro: 'receber_id obrigatorio' }, { status: 400 })
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: req.headers.get('authorization') || '' } }, auth: { persistSession: false },
    })
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, erro: 'nao autenticado' }, { status: 401 })

    const { data: rec } = await sb.from('erp_receber')
      .select('id, company_id, boleto_status, boleto_nosso_numero, boleto_banco_codigo, status').eq('id', receber_id).single()
    if (!rec) return NextResponse.json({ ok: false, erro: 'titulo nao encontrado' }, { status: 404 })
    const companyId: string = rec.company_id

    const { data: acesso } = await sb.rpc('fn_acesso_efetivo', { p_user: user.id, p_company: companyId })
    const papel = (acesso as { papel_gestao?: string | null } | null)?.papel_gestao ?? null
    if (!papel || ['CLIENT_VIEWER', 'CLIENT_OPERATOR', 'OFICINA_MECANICO'].includes(papel)) {
      return NextResponse.json({ ok: false, erro: 'Seu perfil nao tem permissao para cancelar boleto. Peca ao gestor da empresa.' }, { status: 403 })
    }
    if (rec.boleto_status !== 'registrado' || !rec.boleto_nosso_numero) {
      return NextResponse.json({ ok: false, erro: 'Este titulo nao tem boleto ativo para cancelar.' }, { status: 409 })
    }
    if (rec.boleto_banco_codigo && String(rec.boleto_banco_codigo) !== BB_BANCO) {
      return NextResponse.json({ ok: false, erro: 'O boleto deste titulo nao e do Banco do Brasil.' }, { status: 409 })
    }
    if (['pago', 'liquidado', 'quitado'].includes(String(rec.status ?? '').toLowerCase())) {
      return NextResponse.json({ ok: false, erro: 'Titulo ja quitado: o boleto nao pode ser cancelado.' }, { status: 409 })
    }

    const c = await carregarCredBb(companyId)
    if (!c) return NextResponse.json({ ok: false, erro: 'Integração bancária do Banco do Brasil incompleta (Conexões bancárias).' }, { status: 412 })

    const r = await baixarBoletoBb(c.cred, rec.boleto_nosso_numero, c.cfg.convenio)
    if (r.status < 200 || r.status >= 300) {
      await logSyncBb(companyId, 'boleto_cancelar', 'erro', `cancelar boleto recusado pelo banco: status ${r.status}`, { receber_id, nosso_numero: rec.boleto_nosso_numero, por: user.id, raw: r.raw })
      const msg = extractBankMessage(r.raw)
      return NextResponse.json({ ok: false, erro: msg ? `O Banco do Brasil recusou o cancelamento: ${msg}` : 'O Banco do Brasil recusou o cancelamento do boleto.', detalhes: r.raw }, { status: 502 })
    }

    const { error: errUpd } = await supabaseAdmin.from('erp_receber').update({
      boleto_status: 'cancelado', boleto_linha_digitavel: null, boleto_codigo_barras: null, boleto_qr_code: null, boleto_url: null,
    }).eq('id', receber_id).eq('company_id', companyId)
    if (errUpd) {
      await logSyncBb(companyId, 'boleto_cancelar', 'erro', `boleto baixado no banco mas o ERP não atualizou: ${errUpd.message}`, { receber_id, nosso_numero: rec.boleto_nosso_numero, por: user.id })
      return NextResponse.json({ ok: false, erro: 'O banco cancelou o boleto, mas o sistema não conseguiu atualizar o título. Avise o suporte: o boleto já não pode ser pago.' }, { status: 500 })
    }
    await logSyncBb(companyId, 'boleto_cancelar', 'ok', `boleto cancelado nu=${rec.boleto_nosso_numero} (${c.cred.ambiente})`, { receber_id, nosso_numero: rec.boleto_nosso_numero, por: user.id, ambiente: c.cred.ambiente })
    return NextResponse.json({ ok: true, nosso_numero: rec.boleto_nosso_numero, ambiente: c.cred.ambiente })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
