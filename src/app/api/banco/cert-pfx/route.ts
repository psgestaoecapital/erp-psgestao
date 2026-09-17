// POST /api/banco/cert-pfx — #14 (Rodrigo/Bradesco): converte o par .crt + .key (PEM) em um
// PKCS#12 (.pfx) base64, para que o mesmo caminho de mTLS (que espera .pfx) funcione com o
// certificado de COMUNICAÇÃO bancária que o banco entrega em .crt/.key.
//
// Por que server-side: é operação de cripto (node-forge), não pertence ao SQL nem ao browser.
// READ-ONLY quanto a dados: não grava nada — devolve o base64 do .pfx para a tela salvar pelo
// caminho normal (fn_banco_salvar_credencial → Vault). A chave privada NUNCA vira coluna aberta.
//
// Auth: exige sessão do usuário (Bearer ou cookie). Sem sessão, 401.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import forge from 'node-forge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 20

async function temSessao(req: NextRequest): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const auth = req.headers.get('authorization') || ''
  if (auth.toLowerCase().startsWith('bearer ')) {
    const sb = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
    const { data: { user } } = await sb.auth.getUser()
    if (user) return true
  }
  try {
    const store = await cookies()
    const sb = createServerClient(url, anon, {
      cookies: { getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })), setAll: () => {} },
    })
    const { data: { user } } = await sb.auth.getUser()
    if (user) return true
  } catch { /* sem cookie */ }
  return false
}

export async function POST(req: NextRequest) {
  try {
    if (!(await temSessao(req))) {
      return NextResponse.json({ ok: false, erro: 'não autenticado' }, { status: 401 })
    }
    const body = await req.json().catch(() => ({}))
    const certPem: string = String(body?.cert_pem ?? '').trim()
    const keyPem: string = String(body?.key_pem ?? '').trim()
    const keyPassphrase: string = String(body?.key_passphrase ?? '')
    const outPassphrase: string = String(body?.out_passphrase ?? '')

    if (!certPem || !/-----BEGIN CERTIFICATE-----/.test(certPem)) {
      return NextResponse.json({ ok: false, erro: 'Arquivo do certificado (.crt/.pem) inválido — precisa começar com "-----BEGIN CERTIFICATE-----".' }, { status: 400 })
    }
    if (!keyPem || !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(keyPem)) {
      return NextResponse.json({ ok: false, erro: 'Arquivo da chave (.key/.pem) inválido — precisa conter "-----BEGIN PRIVATE KEY-----".' }, { status: 400 })
    }
    if (!outPassphrase) {
      return NextResponse.json({ ok: false, erro: 'Defina uma senha para o certificado (ela protege o .pfx gerado e você a informará ao lado).' }, { status: 400 })
    }

    // Chave privada: aceita PEM normal ou PEM cifrado (com passphrase da própria chave).
    let privateKey: forge.pki.PrivateKey | null = null
    try {
      privateKey = keyPassphrase
        ? forge.pki.decryptRsaPrivateKey(keyPem, keyPassphrase)
        : forge.pki.privateKeyFromPem(keyPem)
    } catch (e) {
      return NextResponse.json({ ok: false, erro: 'Não foi possível ler a chave privada: ' + (e instanceof Error ? e.message : String(e)) }, { status: 400 })
    }
    if (!privateKey) {
      return NextResponse.json({ ok: false, erro: 'A chave privada está cifrada e a senha dela não confere (ou o formato não é suportado).' }, { status: 400 })
    }

    let cert: forge.pki.Certificate
    try {
      cert = forge.pki.certificateFromPem(certPem)
    } catch (e) {
      return NextResponse.json({ ok: false, erro: 'Não foi possível ler o certificado: ' + (e instanceof Error ? e.message : String(e)) }, { status: 400 })
    }

    // Monta o PKCS#12 (.pfx) protegido pela senha informada. O adapter (Sicoob/Bradesco) abre esse
    // .pfx com essa mesma senha (guardada no Vault ao lado) na hora do mTLS.
    const p12Asn1 = forge.pkcs12.toPkcs12Asn1(privateKey, [cert], outPassphrase, { algorithm: '3des' })
    const der = forge.asn1.toDer(p12Asn1).getBytes()
    const pfxBase64 = forge.util.encode64(der)

    const na = cert.validity?.notAfter
    return NextResponse.json({
      ok: true,
      pfx_base64: pfxBase64,
      valido_ate: na ? new Date(na).toISOString().slice(0, 10) : null,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
