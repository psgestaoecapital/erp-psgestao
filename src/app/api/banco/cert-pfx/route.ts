// POST /api/banco/cert-pfx — certificado de COMUNICAÇÃO bancária (mTLS). Faz DUAS coisas, ambas de leitura
// de cripto (node-forge), server-side (não pertence ao SQL nem ao browser), e READ-ONLY quanto a dados:
//
//  (a) CONVERTER: recebe o par .crt + .key (PEM) e devolve um PKCS#12 (.pfx) base64, para o mesmo caminho
//      de mTLS (que espera .pfx) funcionar com o certificado que o banco entrega em .crt/.key. (#14 Rodrigo)
//  (b) EXTRAIR VALIDADE: recebe um .pfx já pronto (base64 + senha) e devolve só o vencimento (notAfter),
//      para a tela gravar a validade no salvar e mostrar o semáforo. (melhoria Rodrigo · validade do cert)
//
// Em ambos os casos devolve `valido_ate` (YYYY-MM-DD). A chave privada NUNCA vira coluna aberta; o .pfx só
// é devolvido para a tela salvar pelo caminho normal (fn_banco_salvar_credencial → Vault).
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

// notAfter do certificado → 'YYYY-MM-DD' (ou null se indisponível). Uso comum às duas operações.
function validadeIso(cert: forge.pki.Certificate): string | null {
  const na = cert.validity?.notAfter
  return na ? new Date(na).toISOString().slice(0, 10) : null
}

// (a) converte o par .crt + .key em .pfx base64 e devolve a validade do certificado.
function converterCrtKeyEmPfx(certPem: string, keyPem: string, keyPassphrase: string, outPassphrase: string):
  { erro: string; status: number } | { pfxBase64: string; validoAte: string | null } {
  if (!certPem || !/-----BEGIN CERTIFICATE-----/.test(certPem)) {
    return { erro: 'Arquivo do certificado (.crt/.pem) inválido — precisa começar com "-----BEGIN CERTIFICATE-----".', status: 400 }
  }
  if (!keyPem || !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(keyPem)) {
    return { erro: 'Arquivo da chave (.key/.pem) inválido — precisa conter "-----BEGIN PRIVATE KEY-----".', status: 400 }
  }
  if (!outPassphrase) {
    return { erro: 'Defina uma senha para o certificado (ela protege o .pfx gerado e você a informará ao lado).', status: 400 }
  }
  let privateKey: forge.pki.PrivateKey | null = null
  try {
    privateKey = keyPassphrase ? forge.pki.decryptRsaPrivateKey(keyPem, keyPassphrase) : forge.pki.privateKeyFromPem(keyPem)
  } catch (e) {
    return { erro: 'Não foi possível ler a chave privada: ' + (e instanceof Error ? e.message : String(e)), status: 400 }
  }
  if (!privateKey) {
    return { erro: 'A chave privada está cifrada e a senha dela não confere (ou o formato não é suportado).', status: 400 }
  }
  let cert: forge.pki.Certificate
  try {
    cert = forge.pki.certificateFromPem(certPem)
  } catch (e) {
    return { erro: 'Não foi possível ler o certificado: ' + (e instanceof Error ? e.message : String(e)), status: 400 }
  }
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(privateKey, [cert], outPassphrase, { algorithm: '3des' })
  const der = forge.asn1.toDer(p12Asn1).getBytes()
  return { pfxBase64: forge.util.encode64(der), validoAte: validadeIso(cert) }
}

// (b) abre um .pfx (base64) com a senha e devolve a validade do 1º certificado. Não converte nada.
function validadeDePfx(pfxBase64: string, senha: string): { erro: string; status: number } | { validoAte: string | null } {
  if (!pfxBase64) return { erro: 'Envie o certificado (.pfx) em base64.', status: 400 }
  try {
    const der = forge.util.decode64(pfxBase64)
    const asn1 = forge.asn1.fromDer(der)
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha || '')
    const bags = p12.getBags({ bagType: forge.pki.oids.certBag })
    const certBags = bags[forge.pki.oids.certBag] || []
    const cert = certBags.find((b) => b.cert)?.cert
    if (!cert) return { erro: 'Não foi encontrado certificado dentro do .pfx.', status: 400 }
    return { validoAte: validadeIso(cert) }
  } catch (e) {
    return { erro: 'Não foi possível abrir o .pfx (senha incorreta ou arquivo inválido): ' + (e instanceof Error ? e.message : String(e)), status: 400 }
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!(await temSessao(req))) {
      return NextResponse.json({ ok: false, erro: 'não autenticado' }, { status: 401 })
    }
    const body = await req.json().catch(() => ({}))

    // (b) só extrair validade de um .pfx já pronto (nenhuma conversão)
    if (body?.pfx_base64) {
      const r = validadeDePfx(String(body.pfx_base64), String(body?.pfx_senha ?? ''))
      if ('erro' in r) return NextResponse.json({ ok: false, erro: r.erro }, { status: r.status })
      return NextResponse.json({ ok: true, valido_ate: r.validoAte })
    }

    // (a) converter .crt + .key em .pfx (e já devolver a validade)
    const r = converterCrtKeyEmPfx(
      String(body?.cert_pem ?? '').trim(),
      String(body?.key_pem ?? '').trim(),
      String(body?.key_passphrase ?? ''),
      String(body?.out_passphrase ?? ''),
    )
    if ('erro' in r) return NextResponse.json({ ok: false, erro: r.erro }, { status: r.status })
    return NextResponse.json({ ok: true, pfx_base64: r.pfxBase64, valido_ate: r.validoAte })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
