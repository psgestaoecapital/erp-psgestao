// Sicredi · Cancelar Boleto (baixa no banco) · Node runtime (REST, sem mTLS).
// Cancela SOMENTE o boleto: o título (erp_receber) permanece ativo, para ser quitado por outro meio
// (Pix, dinheiro…) ou receber um novo boleto. Boleto pago/baixado não é elegível.
// Espelha a rota do Sicoob (RD-26): a única diferença é o conector (credencial Sicredi via Vault, banco 748).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { baixarBoleto, type SicrediAmbiente } from '@/lib/banco/sicredi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BANCO = '748'

async function logSync(company_id: string, status: 'ok' | 'erro', mensagem: string, payload: unknown) {
  await supabaseAdmin.from('erp_banco_sync_log').insert({
    company_id, banco_codigo: BANCO, provider: 'sicredi', tipo: 'boleto_cancelar',
    status, qtd: 1, mensagem, payload_resumo: payload,
  })
}

export async function POST(req: NextRequest) {
  try {
    const { receber_id } = await req.json()
    if (!receber_id) return NextResponse.json({ ok: false, erro: 'receber_id obrigatorio' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: req.headers.get('authorization') || '' } },
      auth: { persistSession: false },
    })
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, erro: 'nao autenticado' }, { status: 401 })

    // Título lido com o token do usuário: a RLS garante que ele só cancela boleto da própria empresa.
    const { data: rec } = await sb.from('erp_receber')
      .select('id, company_id, boleto_status, boleto_nosso_numero, boleto_banco_codigo, status')
      .eq('id', receber_id).single()
    if (!rec) return NextResponse.json({ ok: false, erro: 'titulo nao encontrado' }, { status: 404 })
    const companyId: string = rec.company_id

    // Ação irreversível no banco: papéis sem poder de edição financeira (consulta, operador, mecânico) não cancelam.
    const { data: acesso } = await sb.rpc('fn_acesso_efetivo', { p_user: user.id, p_company: companyId })
    const papel = (acesso as { papel_gestao?: string | null } | null)?.papel_gestao ?? null
    if (!papel || ['CLIENT_VIEWER', 'CLIENT_OPERATOR', 'OFICINA_MECANICO'].includes(papel)) {
      return NextResponse.json({ ok: false, erro: 'Seu perfil nao tem permissao para cancelar boleto. Peca ao gestor da empresa.' }, { status: 403 })
    }

    if (rec.boleto_status !== 'registrado' || !rec.boleto_nosso_numero) {
      return NextResponse.json({ ok: false, erro: 'Este titulo nao tem boleto ativo para cancelar.' }, { status: 409 })
    }
    if (rec.boleto_banco_codigo && String(rec.boleto_banco_codigo) !== BANCO) {
      return NextResponse.json({ ok: false, erro: 'O boleto deste titulo nao e do Sicredi.' }, { status: 409 })
    }
    if (['pago', 'liquidado', 'quitado'].includes(String(rec.status ?? '').toLowerCase())) {
      return NextResponse.json({ ok: false, erro: 'Titulo ja quitado: o boleto nao pode ser cancelado.' }, { status: 409 })
    }

    // Sem fallback para homologação: baixa só no ambiente de produção, onde o boleto real foi registrado.
    const ambiente: SicrediAmbiente = 'producao'
    const credResp = await supabaseAdmin.rpc('fn_banco_obter_credencial', {
      p_company_id: companyId, p_banco_codigo: BANCO, p_ambiente: ambiente,
    })
    const credRow = credResp.data as Record<string, unknown> | null
    const password = credRow?.client_secret as string | null
    const apiKey = credRow?.api_key as string | null
    const cooperativa = (credRow?.cooperativa as string | null) ?? ''
    const posto = (credRow?.posto as string | null) ?? ''
    const conta = (credRow?.conta as string | null) ?? ''
    const agencia = (credRow?.agencia as string | null) ?? null
    const codigoBeneficiario = (credRow?.codigo_beneficiario as string | null) ?? ''
    // username = codigoBeneficiario+cooperativa (manual v3.9.1), igual ao registro.
    const username = (codigoBeneficiario && cooperativa) ? `${codigoBeneficiario}${cooperativa}` : null
    if (!credRow || credRow.ok === false || !username || !password || !apiKey || !codigoBeneficiario) {
      await logSync(companyId, 'erro', 'cancelar boleto: credencial sicredi incompleta', { receber_id, por: user.id })
      return NextResponse.json({ ok: false, erro: 'Integracao bancaria Sicredi incompleta (Cadastros -> Contas bancarias).' }, { status: 412 })
    }

    const cred = {
      username, password, api_key: apiKey, ambiente,
      cooperativa, posto, codigo_beneficiario: codigoBeneficiario, conta, agencia,
    }
    // A resposta 2xx do PATCH (o Sicredi responde 202 — baixa assíncrona) basta como aceite do banco.
    const r = await baixarBoleto(cred, rec.boleto_nosso_numero)

    if (r.status < 200 || r.status >= 300) {
      await logSync(companyId, 'erro', `cancelar boleto recusado pelo banco: status ${r.status}`, {
        receber_id, nosso_numero: rec.boleto_nosso_numero, por: user.id, raw: r.raw,
      })
      return NextResponse.json({ ok: false, erro: 'O Sicredi recusou o cancelamento do boleto.', detalhes: r.raw }, { status: 502 })
    }

    // Só o boleto: limpa os dados de pagamento e marca 'cancelado'. O título não é tocado (status/valor/baixa).
    const { error: errUpd } = await supabaseAdmin.from('erp_receber').update({
      boleto_status: 'cancelado',
      boleto_linha_digitavel: null,
      boleto_codigo_barras: null,
      boleto_qr_code: null,
      boleto_url: null,
    }).eq('id', receber_id).eq('company_id', companyId)
    if (errUpd) {
      // O banco já baixou o boleto: registra para conciliar à mão em vez de deixar o ERP "registrado" sem aviso.
      await logSync(companyId, 'erro', `boleto baixado no banco mas o ERP não atualizou: ${errUpd.message}`, {
        receber_id, nosso_numero: rec.boleto_nosso_numero, por: user.id,
      })
      return NextResponse.json({ ok: false, erro: 'O banco cancelou o boleto, mas o sistema não conseguiu atualizar o título. Avise o suporte: o boleto já não pode ser pago.' }, { status: 500 })
    }

    await logSync(companyId, 'ok', `boleto cancelado nu=${rec.boleto_nosso_numero}`, {
      receber_id, nosso_numero: rec.boleto_nosso_numero, por: user.id, em: new Date().toISOString(), ambiente, retorno: r.raw,
    })
    return NextResponse.json({ ok: true, nosso_numero: rec.boleto_nosso_numero })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
