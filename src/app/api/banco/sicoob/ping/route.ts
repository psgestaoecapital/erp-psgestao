// Sicoob · Ping de AUTH · Node runtime (mTLS).
// Prova so a conexao OAuth2/mTLS (Keycloak) — NAO emite boleto, nao grava nada.
// Util pra validar cert + client_id + scopes antes de qualquer outra chamada.
//
// Auth: header `x-ping-secret: <PING_SICOOB_SECRET>` OU query `?token=<...>`.
// O segredo vem da env PING_SICOOB_SECRET (configurar no Vercel project env).
// Sem env configurada -> rota responde 503 (nao permite acesso anonimo por acidente).
import { NextRequest, NextResponse } from 'next/server'
import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { obterToken, type SicoobAmbiente } from '@/lib/banco/sicoob'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BANCO = '756'
const COMPANY_PS = 'b26c19c0-bf6d-495b-b8d1-9fa8d6896725'

function tsEq(a: string, b: string): boolean {
  const A = Buffer.from(a)
  const B = Buffer.from(b)
  if (A.length !== B.length) return false
  return timingSafeEqual(A, B)
}

async function handle(req: NextRequest) {
  try {
    const secret = process.env.PING_SICOOB_SECRET
    if (!secret) {
      return NextResponse.json({
        ok: false, status: 503,
        erro: 'PING_SICOOB_SECRET nao configurado no servidor',
      }, { status: 503 })
    }
    const url = new URL(req.url)
    const provided = req.headers.get('x-ping-secret') || url.searchParams.get('token') || ''
    if (!provided || !tsEq(provided, secret)) {
      return NextResponse.json({ ok: false, status: 401, erro: 'token invalido' }, { status: 401 })
    }

    const company = url.searchParams.get('company') || COMPANY_PS
    const ambiente = (url.searchParams.get('ambiente') || 'homologacao') as SicoobAmbiente
    if (ambiente !== 'producao' && ambiente !== 'homologacao') {
      return NextResponse.json({ ok: false, status: 400, erro: 'ambiente invalido' }, { status: 400 })
    }

    // Le credencial via Vault (service role)
    const credResp = await supabaseAdmin.rpc('fn_banco_obter_credencial', {
      p_company_id: company, p_banco_codigo: BANCO, p_ambiente: ambiente,
    })
    const credRow = credResp.data as Record<string, unknown> | null
    if (!credRow || credRow.ok === false) {
      return NextResponse.json({
        ok: false, status: 412,
        erro: 'Credencial Sicoob nao encontrada',
        detalhe: credRow ?? null, ambiente, company,
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
        ambiente,
      }, { status: 412 })
    }

    const t0 = Date.now()
    try {
      const token = await obterToken({
        client_id: clientId, ambiente,
        pfx: Buffer.from(certBase64, 'base64'),
        passphrase: certSenha,
        cooperativa, conta, codigo_beneficiario: codigoBeneficiario, convenio,
      })
      return NextResponse.json({
        ok: true,
        ambiente, company, client_id: clientId,
        token_len: token.length,
        latencia_ms: Date.now() - t0,
      })
    } catch (e) {
      const erro_sicoob = e instanceof Error ? e.message : String(e)
      return NextResponse.json({
        ok: false, status: 500, ambiente, erro_sicoob,
      }, { status: 500 })
    }
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, erro }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
