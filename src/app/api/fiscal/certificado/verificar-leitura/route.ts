// POST /api/fiscal/certificado/verificar-leitura — testa se o A1 ativo da empresa é LEGÍVEL,
// não só se está dentro da validade. Existe porque o pré-voo (fn_fiscal_previo, RPC) só compara a
// coluna validade_fim (uma data): um certificado válido até 2027 mas ILEGÍVEL passaria como "ok" e a
// emissão/boleto falharia depois. Caso real (FC Pisos, 24/09/2026): A1 em formato PKCS#12 LEGADO
// (3DES/RC2 + MAC SHA-1), válido até 2027, que o OpenSSL 3 recusa com "Unsupported PKCS12 PFX data".
//
// O que testamos aqui (server-side, Node runtime):
//   (1) node-forge abre o PKCS#12 com a senha guardada?  → é o parser que o sistema usa de verdade
//       (upload, validação e agora o mTLS via pfxParaMtls). Se abre, o certificado é USÁVEL.
//   (2) o OpenSSL 3 nativo abre o mesmo arquivo?  → se NÃO, o formato é LEGADO (por isso o mTLS
//       precisa do caminho node-forge). Só um diagnóstico — não impede, já que (1) resolve.
//
// Leitura apenas: baixa o cert do Storage privado, testa, e NÃO devolve nenhum dado sensível (nem o
// arquivo, nem a senha) — só o veredito.
import { NextRequest, NextResponse } from 'next/server'
import tls from 'node:tls'
import { Buffer } from 'node:buffer'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { guardaEmpresaFiscal } from '@/lib/auth/assertAcessoEmpresa'
import { validarCertBase64 } from '@/lib/banco/cert'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 20

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  try {
    const body = await req.json().catch(() => ({}))
    const companyId = typeof body?.companyId === 'string' ? body.companyId : ''
    if (!companyId) return NextResponse.json({ ok: false, erro: 'companyId ausente' }, { status: 400 })

    const negado = await guardaEmpresaFiscal({ userId, companyId, papelMinimo: 'membro', log: { notaTipo: 'nfse', operacao: 'certificado_verificar_leitura', endpoint: 'certificado/verificar-leitura' } })
    if (negado) return negado

    const { data: cert } = await supabaseAdmin
      .from('erp_certificados_a1')
      .select('storage_bucket, storage_path, senha_encrypted, validade_fim, arquivo_tamanho_bytes')
      .eq('company_id', companyId)
      .eq('status', 'ativo')
      .limit(1)
      .maybeSingle()

    if (!cert) {
      return NextResponse.json({ ok: true, presente: false, mensagem: 'Nenhum certificado A1 ativo cadastrado.' })
    }

    const dl = await supabaseAdmin.storage.from(cert.storage_bucket as string).download(cert.storage_path as string)
    if (dl.error || !dl.data) {
      return NextResponse.json({ ok: false, presente: true, legivel: false, erro: `Falha ao baixar o certificado do storage: ${dl.error?.message ?? 'sem dado'}` }, { status: 502 })
    }
    const bytes = Buffer.from(await dl.data.arrayBuffer())
    const senha = cert.senha_encrypted ? Buffer.from(cert.senha_encrypted as string, 'base64').toString('utf-8') : ''

    // (1) leitura pelo parser que o sistema usa (node-forge)
    const info = validarCertBase64(bytes.toString('base64'), senha)
    const legivel = info.presente && info.senha_ok && (info.status !== 'erro')

    // (2) o OpenSSL 3 nativo consegue? (createSecureContext usa o mesmo caminho do https.Agent com pfx)
    let opensslNativo = false
    let opensslErro: string | null = null
    try {
      tls.createSecureContext({ pfx: bytes, passphrase: senha })
      opensslNativo = true
    } catch (e) {
      opensslNativo = false
      opensslErro = e instanceof Error ? e.message : String(e)
    }

    return NextResponse.json({
      ok: true,
      presente: true,
      legivel,                                   // node-forge abriu com a senha → o sistema consegue usar
      senha_confere: info.senha_ok,
      openssl_nativo: opensslNativo,             // false = formato legado (usa o caminho node-forge no mTLS)
      formato: legivel ? (opensslNativo ? 'moderno' : 'legado') : 'ilegivel',
      tamanho_bytes: cert.arquivo_tamanho_bytes ?? bytes.length,
      validade_fim: info.not_after ?? (cert.validade_fim as string | null),
      dias_para_vencer: info.dias_para_vencer,
      status_validade: info.status,              // ok | expirando | vencido | senha_invalida | erro
      erro: legivel ? null : (info.erro ?? opensslErro),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
})
