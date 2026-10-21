// Sicoob · Cancelar boleto (baixa no banco) · Node runtime (mTLS).
// Cancela SÓ o boleto: o título (erp_receber) permanece ativo — o cliente pagou por outro meio (Pix, dinheiro…).
// Só marca "cancelado" depois do aceite do banco. Quem/quando/retorno ficam em audit_log_global + erp_banco_sync_log.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Buffer } from 'node:buffer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { baixarBoleto, type SicoobAmbiente } from '@/lib/banco/sicoob'
import { boletoElegivelParaCancelar, camposAposCancelarBoleto } from '@/lib/banco/cancelarBoleto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BANCO = '756'

function userSupabase(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const auth = req.headers.get('authorization') || ''
  return createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
}

async function logSync(company_id: string, status: 'ok' | 'erro', mensagem: string, payload: unknown) {
  try {
    await supabaseAdmin.from('erp_banco_sync_log').insert({
      company_id, banco_codigo: BANCO, provider: 'sicoob', tipo: 'boleto_cancelar',
      status, qtd: 1, mensagem: mensagem.slice(0, 1000), payload_resumo: payload,
    })
  } catch { /* log não derruba a rota */ }
}

export async function POST(req: NextRequest) {
  try {
    const { receber_id } = await req.json()
    if (!receber_id) return NextResponse.json({ ok: false, erro: 'receber_id obrigatorio' }, { status: 400 })

    // Só sessão de usuário (sem segredo de teste): cancelar boleto é ação humana, com autoria.
    const sb = userSupabase(req)
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, erro: 'nao autenticado' }, { status: 401 })

    // RLS do usuário: só enxerga título de empresa a que tem acesso.
    const { data: rec } = await sb.from('erp_receber')
      .select('id, company_id, status, boleto_status, boleto_nosso_numero, boleto_banco_codigo')
      .eq('id', receber_id).maybeSingle()
    if (!rec) return NextResponse.json({ ok: false, erro: 'titulo nao encontrado' }, { status: 404 })
    if (rec.boleto_banco_codigo && rec.boleto_banco_codigo !== BANCO) {
      return NextResponse.json({ ok: false, erro: 'Este boleto não é do Sicoob.' }, { status: 409 })
    }
    if (!boletoElegivelParaCancelar(rec)) {
      return NextResponse.json({ ok: false, erro: 'Só é possível cancelar boleto registrado de título em aberto (boleto pago, baixado ou título quitado não pode).' }, { status: 409 })
    }
    const companyId: string = rec.company_id
    const nossoNumero = String(rec.boleto_nosso_numero)

    let ambiente: SicoobAmbiente = 'producao'
    let credResp = await supabaseAdmin.rpc('fn_banco_obter_credencial', { p_company_id: companyId, p_banco_codigo: BANCO, p_ambiente: 'producao' })
    let credRow = credResp.data as Record<string, unknown> | null
    if (!credRow || credRow.ok === false) {
      credResp = await supabaseAdmin.rpc('fn_banco_obter_credencial', { p_company_id: companyId, p_banco_codigo: BANCO, p_ambiente: 'homologacao' })
      credRow = credResp.data as Record<string, unknown> | null
      ambiente = 'homologacao'
    }
    if (!credRow || credRow.ok === false) {
      return NextResponse.json({ ok: false, erro: 'Cadastre a Integracao bancaria Sicoob antes (Cadastros -> Contas bancarias).' }, { status: 412 })
    }
    const clientId = credRow.client_id as string | null
    const certBase64 = credRow.cert_base64 as string | null
    const certSenha = credRow.cert_senha as string | null
    const cooperativa = (credRow.cooperativa as string | null) ?? ''
    const conta = (credRow.conta as string | null) ?? ''
    const codigoBeneficiario = (credRow.codigo_beneficiario as string | null) ?? ''
    const convenio = (credRow.convenio as string | null) ?? ''
    if (!clientId || !certBase64 || !certSenha || !cooperativa || !conta || !codigoBeneficiario) {
      return NextResponse.json({ ok: false, erro: 'Integracao Sicoob incompleta (client_id, certificado, cooperativa, conta ou beneficiario).' }, { status: 412 })
    }

    const baixa = await baixarBoleto({
      client_id: clientId, ambiente, pfx: Buffer.from(certBase64, 'base64'), passphrase: certSenha,
      cooperativa, conta, codigo_beneficiario: codigoBeneficiario, convenio,
    }, nossoNumero)

    if (!baixa.ok) {
      await logSync(companyId, 'erro', `cancelar boleto recusado: status ${baixa.status}`, { receber_id, nosso_numero: nossoNumero, user_id: user.id, raw: baixa.raw })
      return NextResponse.json({ ok: false, erro: 'O Sicoob não aceitou o cancelamento do boleto. O boleto e o título continuam como estavam.', detalhes: baixa.raw }, { status: 502 })
    }

    const { error: updErr } = await supabaseAdmin.from('erp_receber').update(camposAposCancelarBoleto()).eq('id', receber_id)
    await logSync(companyId, updErr ? 'erro' : 'ok', `boleto cancelado nu=${nossoNumero}${updErr ? ` (banco baixou, mas o título não atualizou: ${updErr.message})` : ''}`,
      { receber_id, nosso_numero: nossoNumero, user_id: user.id, ambiente, retorno_banco: baixa.raw })
    await supabaseAdmin.from('audit_log_global').insert({
      company_id: companyId, user_id: user.id, tabela: 'erp_receber', registro_id: receber_id,
      acao: 'BOLETO_CANCELADO',
      valor_anterior: { boleto_status: rec.boleto_status, boleto_nosso_numero: nossoNumero },
      valor_novo: { boleto_status: 'cancelado', titulo_mantido: true, banco: 'sicoob', retorno_banco: baixa.raw ?? null },
    }).then(() => {}, () => {})

    if (updErr) return NextResponse.json({ ok: false, erro: 'O banco baixou o boleto, mas o sistema não conseguiu atualizar o título. Avise o suporte; não gere outro boleto.' }, { status: 500 })
    return NextResponse.json({ ok: true, nosso_numero: nossoNumero, ambiente })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
