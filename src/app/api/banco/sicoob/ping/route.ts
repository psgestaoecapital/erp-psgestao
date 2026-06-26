// Sicoob · Ping de AUTH · Node runtime (mTLS).
// Prova so a conexao OAuth2/mTLS (Keycloak) — NAO emite boleto, nao grava nada.
// Util pra validar cert + client_id + scopes antes de qualquer outra chamada.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Buffer } from 'node:buffer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { obterToken, type SicoobAmbiente } from '@/lib/banco/sicoob'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BANCO = '756'
const COMPANY_PS = 'b26c19c0-bf6d-495b-b8d1-9fa8d6896725'

function userSupabase(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const auth = req.headers.get('authorization') || ''
  return createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
}

async function handle(req: NextRequest) {
  try {
    // Auth do request (usuario logado tem que ter acesso a PS Gestao)
    const sb = userSupabase(req)
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, erro: 'nao autenticado' }, { status: 401 })

    const company = new URL(req.url).searchParams.get('company') || COMPANY_PS
    const ambienteParam = (new URL(req.url).searchParams.get('ambiente') || 'homologacao') as SicoobAmbiente

    // Le credencial via Vault (service role)
    const credResp = await supabaseAdmin.rpc('fn_banco_obter_credencial', {
      p_company_id: company, p_banco_codigo: BANCO, p_ambiente: ambienteParam,
    })
    const credRow = credResp.data as Record<string, unknown> | null
    if (!credRow || credRow.ok === false) {
      return NextResponse.json({
        ok: false, status: 412,
        erro: 'Credencial Sicoob nao encontrada',
        detalhe: credRow ?? null, ambiente: ambienteParam, company,
      }, { status: 412 })
    }

    const clientId = credRow.client_id as string | null
    const certBase64 = credRow.cert_base64 as string | null
    const certSenha = credRow.cert_senha as string | null
    const cooperativa = (credRow.cooperativa as string | null) ?? ''
    const conta = (credRow.conta as string | null) ?? ''
    const codigoBeneficiario = (credRow.codigo_beneficiario as string | null) ?? ''
    const convenio = (credRow.convenio as string | null) ?? ''

    if (!clientId || !certBase64 || !certSenha) {
      return NextResponse.json({
        ok: false, status: 412,
        erro: 'client_id / cert / senha faltando na config',
        tem_client_id: !!clientId, tem_cert: !!certBase64, tem_senha: !!certSenha,
        ambiente: ambienteParam,
      }, { status: 412 })
    }

    const t0 = Date.now()
    try {
      const token = await obterToken({
        client_id: clientId, ambiente: ambienteParam,
        pfx: Buffer.from(certBase64, 'base64'),
        passphrase: certSenha,
        cooperativa, conta, codigo_beneficiario: codigoBeneficiario, convenio,
      })
      const ms = Date.now() - t0
      return NextResponse.json({
        ok: true,
        ambiente: ambienteParam,
        company,
        client_id: clientId,
        token_len: token.length,
        latencia_ms: ms,
      })
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e)
      return NextResponse.json({
        ok: false, status: 500, ambiente: ambienteParam, erro,
      }, { status: 500 })
    }
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, erro }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
