// POST /api/banco/testar-conexao  — TESTE DE CONEXÃO BANCÁRIA (chamado #14, pedido do CEO)
// GENÉRICO (Sicoob, Sicredi, Bradesco e qualquer banco que entrar). READ-ONLY:
//   1) valida o certificado A1 (existe, senha confere, não venceu) — local, sem rede;
//   2) faz a AUTENTICAÇÃO real no banco (OAuth/mTLS) — uma chamada de leitura que NÃO escreve nada.
// ⚠️ NUNCA emite boleto de teste nem envia remessa. Teste que escreve não é teste.
// Mostra o erro REAL do banco (não "falha ao conectar") e grava o histórico (quem/quando/resultado)
// em erp_banco_teste_conexao via fn_banco_teste_conexao_registrar.
//
// Auth: sessão do usuário (Bearer ou cookie) com get_user_company_ids() incluindo a company.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { Buffer } from 'node:buffer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { validarCertBase64, type CertInfo } from '@/lib/banco/cert'
import { obterToken as sicoobToken, SICOOB_SCOPE_CONSULTAR_BOLETO, type SicoobAmbiente } from '@/lib/banco/sicoob'
import { obterToken as bradescoToken, type BradescoAmbiente } from '@/lib/banco/bradesco'
import { obterToken as sicrediToken, type SicrediAmbiente } from '@/lib/banco/sicredi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Sessao = { sb: SupabaseClient; userId: string; email: string }

function bearerClient(req: NextRequest): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const auth = req.headers.get('authorization') || ''
  return createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
}
async function cookieClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const store = await cookies()
  return createServerClient(url, anon, {
    cookies: { getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })), setAll: () => { /* read-only */ } },
  }) as unknown as SupabaseClient
}
async function resolverSessao(req: NextRequest): Promise<Sessao | null> {
  const auth = req.headers.get('authorization') || ''
  if (auth.toLowerCase().startsWith('bearer ')) {
    const sb = bearerClient(req)
    const { data: { user } } = await sb.auth.getUser()
    if (user) return { sb, userId: user.id, email: user.email ?? '' }
  }
  try {
    const sb = await cookieClient()
    const { data: { user } } = await sb.auth.getUser()
    if (user) return { sb, userId: user.id, email: user.email ?? '' }
  } catch { /* sem cookie */ }
  return null
}

// Autentica no banco (leitura, não grava). Devolve ok + erro REAL do banco. Registry: 1 provider = 1 caso.
async function autenticar(
  provider: string,
  ambiente: string,
  cred: Record<string, unknown>,
): Promise<{ suportado: boolean; ok: boolean; erro: string | null }> {
  const s = (k: string) => (cred[k] == null ? '' : String(cred[k]))
  try {
    if (provider === 'sicoob') {
      await sicoobToken({
        client_id: s('client_id'), ambiente: (ambiente === 'homologacao' ? 'homologacao' : 'producao') as SicoobAmbiente,
        pfx: Buffer.from(s('cert_base64'), 'base64'), passphrase: s('cert_senha'),
        cooperativa: s('cooperativa'), conta: s('conta'), codigo_beneficiario: s('codigo_beneficiario'), convenio: s('convenio'),
      }, SICOOB_SCOPE_CONSULTAR_BOLETO) // escopo de CONSULTA (leitura), nunca inclusão
      return { suportado: true, ok: true, erro: null }
    }
    if (provider === 'bradesco') {
      await bradescoToken({
        client_id: s('client_id'), client_secret: s('client_secret'),
        ambiente: (ambiente === 'producao' ? 'producao' : 'sandbox') as BradescoAmbiente,
        pfx: Buffer.from(s('cert_base64'), 'base64'), passphrase: s('cert_senha'),
      })
      return { suportado: true, ok: true, erro: null }
    }
    if (provider === 'sicredi') {
      await sicrediToken({
        username: `${s('codigo_beneficiario')}${s('cooperativa')}`, password: s('client_secret'), api_key: s('api_key'),
        ambiente: (ambiente === 'homologacao' ? 'homologacao' : 'producao') as SicrediAmbiente,
        cooperativa: s('cooperativa'), posto: s('posto'), codigo_beneficiario: s('codigo_beneficiario'),
        conta: s('conta'), agencia: s('agencia') || null,
      })
      return { suportado: true, ok: true, erro: null }
    }
    return { suportado: false, ok: false, erro: `Teste automático de conexão ainda não disponível para "${provider}".` }
  } catch (e) {
    return { suportado: true, ok: false, erro: e instanceof Error ? e.message : String(e) }
  }
}

const USA_CERTIFICADO = new Set(['sicoob', 'bradesco'])

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const companyId: string | undefined = body?.company_id
    const providerConfigId: string | undefined = body?.provider_config_id
    if (!companyId || !providerConfigId) {
      return NextResponse.json({ ok: false, erro: 'company_id e provider_config_id são obrigatórios' }, { status: 400 })
    }

    const sessao = await resolverSessao(req)
    if (!sessao) return NextResponse.json({ ok: false, erro: 'não autenticado' }, { status: 401 })
    const { data: perm, error: permErr } = await sessao.sb.rpc('get_user_company_ids')
    if (permErr) return NextResponse.json({ ok: false, erro: permErr.message }, { status: 500 })
    if (!(Array.isArray(perm) ? (perm as string[]) : []).includes(companyId)) {
      return NextResponse.json({ ok: false, erro: 'sem acesso a esta empresa' }, { status: 403 })
    }

    // config do provider (service role — a checagem multi-tenant já passou acima)
    const { data: cfg, error: cfgErr } = await supabaseAdmin
      .from('erp_banco_provider_config')
      .select('id, provider, ambiente, banco_codigo, ativo')
      .eq('id', providerConfigId).eq('company_id', companyId).maybeSingle()
    if (cfgErr) return NextResponse.json({ ok: false, erro: cfgErr.message }, { status: 500 })
    if (!cfg) return NextResponse.json({ ok: false, erro: 'configuração não encontrada' }, { status: 404 })
    const provider = String(cfg.provider)
    const ambiente = String(cfg.ambiente)
    const bancoCodigo = cfg.banco_codigo ? String(cfg.banco_codigo) : null

    // credencial (Vault) — genérico p/ todos os bancos
    const credResp = await supabaseAdmin.rpc('fn_banco_obter_credencial', {
      p_company_id: companyId, p_banco_codigo: bancoCodigo, p_ambiente: ambiente,
    })
    const cred = credResp.data as Record<string, unknown> | null
    const credOk = !!cred && cred.ok !== false

    const t0 = Date.now()

    // (1) certificado (só bancos que usam A1)
    let cert: CertInfo
    if (USA_CERTIFICADO.has(provider)) {
      cert = credOk
        ? validarCertBase64(cred!.cert_base64 as string | null, cred!.cert_senha as string | null)
        : { presente: false, senha_ok: false, valido: false, not_before: null, not_after: null, dias_para_vencer: null, status: 'ausente' }
    } else {
      cert = { presente: false, senha_ok: false, valido: false, not_before: null, not_after: null, dias_para_vencer: null, status: 'nao_aplicavel' }
    }

    // (2) autenticação real — pulada quando o certificado já reprova (erro do cert é mais claro que o TLS cru)
    let authOk: boolean | null = null
    let erro: string | null = null
    if (!credOk) {
      erro = 'Credencial não encontrada nesta empresa/ambiente. Salve a configuração antes de testar.'
    } else if (USA_CERTIFICADO.has(provider) && (cert.status === 'ausente' || cert.status === 'senha_invalida' || cert.status === 'vencido' || cert.status === 'erro')) {
      authOk = false
      erro = cert.status === 'vencido'
        ? `Certificado vencido em ${cert.not_after ? new Date(cert.not_after).toLocaleDateString('pt-BR') : '—'}. Renove o A1 e salve de novo.`
        : cert.status === 'senha_invalida' ? 'Senha do certificado não confere. Reenvie o A1 com a senha correta.'
        : cert.status === 'ausente' ? 'Certificado A1 não está salvo nesta configuração.'
        : (cert.erro ?? 'Certificado inválido.')
    } else {
      const r = await autenticar(provider, ambiente, cred!)
      authOk = r.suportado ? r.ok : null
      if (!r.ok) erro = r.erro
    }

    const latencia = Date.now() - t0

    // status final
    let status: 'ok' | 'erro' | 'parcial'
    if (authOk === true) status = 'ok'
    else if (authOk === false) status = 'erro'
    else status = cert.status === 'ok' || cert.status === 'expirando' ? 'parcial' : 'erro'
    // cert expirando + auth ok → alerta, mas não é falha: marca 'parcial'
    if (status === 'ok' && cert.status === 'expirando') status = 'parcial'

    const cert_expira_em = cert.not_after ? cert.not_after.slice(0, 10) : null
    const detalhe = { cert, provider, ambiente }

    // histórico (quem/quando/resultado)
    let historicoId: string | null = null
    try {
      const { data: hid } = await supabaseAdmin.rpc('fn_banco_teste_conexao_registrar', {
        p_company_id: companyId, p_provider: provider, p_banco_codigo: bancoCodigo, p_ambiente: ambiente,
        p_provider_config_id: providerConfigId, p_status: status, p_cert_status: cert.status,
        p_cert_expira_em: cert_expira_em, p_auth_ok: authOk, p_erro: erro ? erro.slice(0, 2000) : null,
        p_detalhe: detalhe, p_latencia_ms: latencia, p_testado_por: sessao.userId, p_testado_por_email: sessao.email,
      })
      historicoId = (hid as string) ?? null
    } catch { /* histórico não pode derrubar o teste */ }

    return NextResponse.json({
      ok: status !== 'erro', status, provider, ambiente,
      cert, auth_ok: authOk, erro, latencia_ms: latencia,
      testado_em: new Date().toISOString(), testado_por_email: sessao.email,
      historico_id: historicoId,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
