// Cancelar boleto · Node runtime. Baixa SÓ o boleto no banco (Sicoob/Sicredi) e marca boleto_status='cancelado';
// o título (erp_receber) NÃO é cancelado nem excluído. Bradesco: avisa que a API não está habilitada (412).
// Auditoria: erp_banco_sync_log (tipo boleto_cancelar) com quem, quando e o retorno do banco.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Buffer } from 'node:buffer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { baixarBoleto as baixarSicoob, type SicoobAmbiente } from '@/lib/banco/sicoob'
import { baixarBoleto as baixarSicredi, type SicrediAmbiente } from '@/lib/banco/sicredi'
import {
  BANCO_PROVIDER, CANCELAMENTO_API, MSG_SEM_API, CAMPOS_BOLETO_CANCELADO, motivoNaoCancelavel, jaBaixadoNoBanco,
} from '@/lib/banco/cancelarBoleto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function userSupabase(req: NextRequest) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: req.headers.get('authorization') || '' } },
    auth: { persistSession: false },
  })
}

async function credencial(companyId: string, banco: string, ambientes: string[]) {
  for (const amb of ambientes) {
    const { data } = await supabaseAdmin.rpc('fn_banco_obter_credencial', { p_company_id: companyId, p_banco_codigo: banco, p_ambiente: amb })
    const row = data as Record<string, unknown> | null
    if (row && row.ok !== false) return { row, ambiente: amb }
  }
  return null
}

export async function POST(req: NextRequest) {
  try {
    const { receber_id } = await req.json()
    if (!receber_id) return NextResponse.json({ ok: false, erro: 'receber_id obrigatorio' }, { status: 400 })

    const sb = userSupabase(req)
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, erro: 'nao autenticado' }, { status: 401 })

    // RLS do usuário decide se ele enxerga o título (empresa dele).
    const { data: rec } = await sb.from('erp_receber')
      .select('id, company_id, status, boleto_status, boleto_nosso_numero, boleto_banco_codigo')
      .eq('id', receber_id).maybeSingle()
    if (!rec) return NextResponse.json({ ok: false, erro: 'titulo nao encontrado' }, { status: 404 })

    const motivo = motivoNaoCancelavel(rec)
    if (motivo) return NextResponse.json({ ok: false, erro: motivo }, { status: 409 })

    const companyId: string = rec.company_id
    const banco = rec.boleto_banco_codigo as string
    const provider = BANCO_PROVIDER[banco]
    const log = (status: 'ok' | 'erro', mensagem: string, payload: unknown) =>
      supabaseAdmin.from('erp_banco_sync_log').insert({
        company_id: companyId, banco_codigo: banco, provider, tipo: 'boleto_cancelar', status, qtd: 1, mensagem,
        payload_resumo: { receber_id, usuario: user.id, em: new Date().toISOString(), nosso_numero: rec.boleto_nosso_numero, retorno: payload },
      })

    if (!CANCELAMENTO_API[provider]) {
      await log('erro', `cancelamento via API nao habilitado (${provider})`, null)
      return NextResponse.json({ ok: false, erro: MSG_SEM_API[provider], sem_api: true }, { status: 412 })
    }

    const cred = await credencial(companyId, banco, ['producao', 'homologacao'])
    if (!cred) return NextResponse.json({ ok: false, erro: `Integração bancária ${provider} não cadastrada.` }, { status: 412 })
    const r = cred.row
    const s = (v: unknown) => (typeof v === 'string' ? v : '')
    const nn = rec.boleto_nosso_numero as string

    let resp: { status: number; ok: boolean; raw: unknown }
    if (provider === 'sicoob') {
      if (!s(r.client_id) || !s(r.cert_base64) || !s(r.cert_senha) || !s(r.codigo_beneficiario)) {
        return NextResponse.json({ ok: false, erro: 'Credenciais Sicoob incompletas (client_id, certificado ou beneficiário).' }, { status: 412 })
      }
      resp = await baixarSicoob({
        client_id: s(r.client_id), ambiente: cred.ambiente as SicoobAmbiente,
        pfx: Buffer.from(s(r.cert_base64), 'base64'), passphrase: s(r.cert_senha),
        cooperativa: s(r.cooperativa), conta: s(r.conta), codigo_beneficiario: s(r.codigo_beneficiario), convenio: s(r.convenio),
      }, nn)
    } else {
      const username = s(r.codigo_beneficiario) && s(r.cooperativa) ? `${s(r.codigo_beneficiario)}${s(r.cooperativa)}` : ''
      if (!username || !s(r.client_secret) || !s(r.api_key) || !s(r.posto)) {
        return NextResponse.json({ ok: false, erro: 'Credenciais Sicredi incompletas (código de acesso, x-api-key, posto).' }, { status: 412 })
      }
      resp = await baixarSicredi({
        username, password: s(r.client_secret), api_key: s(r.api_key), ambiente: cred.ambiente as SicrediAmbiente,
        cooperativa: s(r.cooperativa), posto: s(r.posto), codigo_beneficiario: s(r.codigo_beneficiario),
        conta: s(r.conta), agencia: s(r.agencia) || null,
      }, nn)
    }

    if (!resp.ok && !jaBaixadoNoBanco(resp.raw)) {
      await log('erro', `banco recusou a baixa: status ${resp.status}`, resp.raw)
      return NextResponse.json({ ok: false, erro: 'O banco recusou o cancelamento do boleto.', detalhes: resp.raw }, { status: 502 })
    }

    // Só o boleto: título (valor, vencimento, status) fica intacto.
    const { error: upErr } = await supabaseAdmin.from('erp_receber').update(CAMPOS_BOLETO_CANCELADO).eq('id', receber_id)
    if (upErr) {
      await log('erro', `banco baixou, mas falhou ao gravar no titulo: ${upErr.message}`, resp.raw)
      return NextResponse.json({ ok: false, erro: 'O banco cancelou o boleto, mas não foi possível atualizar o título. Avise o suporte.' }, { status: 500 })
    }
    await log('ok', 'boleto cancelado no banco; titulo mantido', resp.raw)
    return NextResponse.json({ ok: true, titulo_mantido: true })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
