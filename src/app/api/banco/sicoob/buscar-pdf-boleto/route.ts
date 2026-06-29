// Sicoob · Buscar PDF (2a via) de boleto ja registrado · Node runtime (mTLS).
// Util pra boletos registrados antes do fluxo de PDF entrar em producao OU
// quando a 2a via falhou no momento do registro. NAO emite boleto — so puxa
// o PDF e grava boleto_url.
//
// Auth: sessao de usuario OU x-ping-secret (mesmo padrao do registrar-boleto).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { segundaViaBoleto, type SicoobAmbiente } from '@/lib/banco/sicoob'

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

function temSegredoValido(req: NextRequest): boolean {
  const expected = process.env.PING_SICOOB_SECRET
  const provided = req.headers.get('x-ping-secret') || ''
  if (!expected || !provided) return false
  const A = Buffer.from(provided)
  const B = Buffer.from(expected)
  if (A.length !== B.length) return false
  return timingSafeEqual(A, B)
}

async function logSync(company_id: string, status: 'ok' | 'erro', mensagem: string, payload: unknown) {
  await supabaseAdmin.from('erp_banco_sync_log').insert({
    company_id, banco_codigo: BANCO, provider: 'sicoob', tipo: 'boleto_segunda_via',
    status, qtd: 1, mensagem, payload_resumo: payload,
  })
}

export async function POST(req: NextRequest) {
  try {
    const { receber_id } = await req.json()
    if (!receber_id) return NextResponse.json({ ok: false, erro: 'receber_id obrigatorio' }, { status: 400 })

    const segredoOk = temSegredoValido(req)
    let sb: ReturnType<typeof userSupabase>
    if (segredoOk) {
      sb = supabaseAdmin as unknown as ReturnType<typeof userSupabase>
    } else {
      sb = userSupabase(req)
      const { data: { user } } = await sb.auth.getUser()
      if (!user) return NextResponse.json({ ok: false, erro: 'nao autenticado' }, { status: 401 })
    }

    const { data: rec, error: recErr } = await sb.from('erp_receber')
      .select('id, company_id, boleto_status, boleto_nosso_numero, boleto_url')
      .eq('id', receber_id).single()
    if (recErr || !rec) return NextResponse.json({ ok: false, erro: 'titulo nao encontrado' }, { status: 404 })
    if (rec.boleto_status !== 'registrado' || !rec.boleto_nosso_numero) {
      return NextResponse.json({ ok: false, erro: 'titulo sem boleto registrado' }, { status: 412 })
    }
    const companyId: string = rec.company_id

    // credencial Sicoob (mesma logica do registrar-boleto)
    let ambiente: SicoobAmbiente = 'producao'
    let credResp = await supabaseAdmin.rpc('fn_banco_obter_credencial', {
      p_company_id: companyId, p_banco_codigo: BANCO, p_ambiente: 'producao',
    })
    let credRow = credResp.data as Record<string, unknown> | null
    if (!credRow || credRow.ok === false) {
      credResp = await supabaseAdmin.rpc('fn_banco_obter_credencial', {
        p_company_id: companyId, p_banco_codigo: BANCO, p_ambiente: 'homologacao',
      })
      credRow = credResp.data as Record<string, unknown> | null
      ambiente = 'homologacao'
    }
    if (!credRow || credRow.ok === false) {
      await logSync(companyId, 'erro', 'credencial sicoob nao cadastrada', { receber_id })
      return NextResponse.json({ ok: false, erro: 'Integracao Sicoob nao cadastrada.' }, { status: 412 })
    }

    const clientId = credRow.client_id as string | null
    const certBase64 = credRow.cert_base64 as string | null
    const certSenha = credRow.cert_senha as string | null
    const cooperativa = (credRow.cooperativa as string | null) ?? ''
    const conta = (credRow.conta as string | null) ?? ''
    const codigoBeneficiario = (credRow.codigo_beneficiario as string | null) ?? ''
    const convenio = (credRow.convenio as string | null) ?? ''
    if (!clientId || !certBase64 || !certSenha) {
      await logSync(companyId, 'erro', 'client_id/cert/senha ausentes', { receber_id })
      return NextResponse.json({ ok: false, erro: 'client_id/certificado/senha faltando.' }, { status: 412 })
    }

    const pfx = Buffer.from(certBase64, 'base64')
    const sv = await segundaViaBoleto({
      client_id: clientId, ambiente,
      pfx, passphrase: certSenha,
      cooperativa, conta, codigo_beneficiario: codigoBeneficiario, convenio,
    }, rec.boleto_nosso_numero)

    if (!sv.pdfBase64) {
      await logSync(companyId, 'erro',
        `2a via sem PDF (status ${sv.status})`,
        { receber_id, raw: sv.raw, nosso_numero: rec.boleto_nosso_numero })
      return NextResponse.json({
        ok: false, erro: 'Sicoob nao retornou o PDF da 2a via.', detalhes: sv.raw,
      }, { status: 502 })
    }

    const pdfBytes = Buffer.from(sv.pdfBase64, 'base64')
    const objectPath = `${companyId}/${receber_id}.pdf`
    const up = await supabaseAdmin.storage.from('boletos')
      .upload(objectPath, pdfBytes, { contentType: 'application/pdf', upsert: true })
    if (up.error) {
      await logSync(companyId, 'erro', `upload pdf falhou: ${up.error.message}`, { receber_id })
      return NextResponse.json({ ok: false, erro: 'Falha ao salvar PDF.' }, { status: 500 })
    }
    const signed = await supabaseAdmin.storage.from('boletos')
      .createSignedUrl(objectPath, 60 * 60 * 24 * 365)
    const boletoUrl = signed.data?.signedUrl ?? null
    if (!boletoUrl) {
      await logSync(companyId, 'erro', 'signed url ausente', { receber_id })
      return NextResponse.json({ ok: false, erro: 'Falha ao gerar URL assinada.' }, { status: 500 })
    }

    await supabaseAdmin.from('erp_receber').update({ boleto_url: boletoUrl }).eq('id', receber_id)
    await logSync(companyId, 'ok',
      `2a via salva pra nu=${rec.boleto_nosso_numero}`, { receber_id, ambiente })

    return NextResponse.json({ ok: true, boleto_url: boletoUrl })
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, erro }, { status: 500 })
  }
}
