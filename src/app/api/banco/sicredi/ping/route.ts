// Sicredi · Ping · testa auth (obtém token) sem registrar nada. Node runtime.
// Uso: valida credenciais no Vault (client_id/secret + api_key) antes de registrar boleto.
import { NextRequest, NextResponse } from 'next/server'
import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { obterToken, type SicrediAmbiente } from '@/lib/banco/sicredi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BANCO = '748'

function temSegredoValido(req: NextRequest): boolean {
  const expected = process.env.PING_SICREDI_SECRET
  const provided = req.headers.get('x-ping-secret') || ''
  if (!expected || !provided) return false
  const A = Buffer.from(provided); const B = Buffer.from(expected)
  if (A.length !== B.length) return false
  return timingSafeEqual(A, B)
}

export async function POST(req: NextRequest) {
  try {
    if (!temSegredoValido(req)) return NextResponse.json({ ok: false, erro: 'segredo invalido' }, { status: 401 })
    const { company_id, ambiente } = await req.json()
    if (!company_id) return NextResponse.json({ ok: false, erro: 'company_id obrigatorio' }, { status: 400 })
    const amb: SicrediAmbiente = ambiente === 'homologacao' ? 'homologacao' : 'producao'

    const credResp = await supabaseAdmin.rpc('fn_banco_obter_credencial', { p_company_id: company_id, p_banco_codigo: BANCO, p_ambiente: amb })
    const c = credResp.data as Record<string, unknown> | null
    if (!c || c.ok === false) return NextResponse.json({ ok: false, erro: 'credencial sicredi nao cadastrada' }, { status: 412 })
    const codBenef = (c.codigo_beneficiario as string) ?? ''
    const coop = (c.cooperativa as string) ?? ''
    if (!codBenef || !coop || !c.client_secret || !c.api_key) return NextResponse.json({ ok: false, erro: 'codigo_beneficiario/cooperativa, codigo de acesso ou api_key faltando' }, { status: 412 })

    // Manual Cobrança Sicredi v3.9.1: username = codigoBeneficiario+cooperativa; password = Código de Acesso.
    const token = await obterToken({
      username: `${codBenef}${coop}`, password: c.client_secret as string, api_key: c.api_key as string,
      ambiente: amb, codigo_beneficiario: codBenef, cooperativa: coop,
      posto: (c.posto as string) ?? '', conta: (c.conta as string) ?? '', agencia: (c.agencia as string) ?? null,
    })
    return NextResponse.json({ ok: true, autenticou: !!token, ambiente: amb })
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, erro }, { status: 500 })
  }
}
