import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  try {
    const form = await req.formData()
    const arquivo = form.get('arquivo')
    const senha = form.get('senha')
    const companyId = form.get('companyId')
    const cnpj = form.get('cnpj')
    const razaoSocial = form.get('razaoSocial')
    const validadeInicio = form.get('validadeInicio')
    const validadeFim = form.get('validadeFim')
    const thumbprint = form.get('thumbprint')

    if (
      !(arquivo instanceof File) ||
      typeof senha !== 'string' ||
      typeof companyId !== 'string' ||
      typeof cnpj !== 'string' ||
      typeof validadeInicio !== 'string' ||
      typeof validadeFim !== 'string'
    ) {
      return NextResponse.json({ ok: false, erro: 'Campos obrigatórios ausentes' }, { status: 400 })
    }

    const inicioDate = new Date(validadeInicio).toISOString().slice(0, 10)
    const fimDate = new Date(validadeFim).toISOString().slice(0, 10)

    const { data: validacao, error: valErr } = await supabaseAdmin.rpc('fn_validar_certificado_a1', {
      p_company_id: companyId,
      p_cnpj_certificado: cnpj,
      p_validade_inicio: inicioDate,
      p_validade_fim: fimDate,
    })
    if (valErr) {
      return NextResponse.json({ ok: false, erro: valErr.message }, { status: 500 })
    }
    const val = (validacao ?? {}) as { valido?: boolean; erro?: string; codigo?: string; warning?: string }
    if (!val.valido) {
      return NextResponse.json({ ok: false, erro: val.erro ?? 'Certificado inválido', codigo: val.codigo }, { status: 400 })
    }

    await supabaseAdmin
      .from('erp_certificados_a1')
      .update({ status: 'removido', removido_em: new Date().toISOString(), removido_por: userId })
      .eq('company_id', companyId)
      .eq('status', 'ativo')

    const storagePath = `${companyId}/${cnpj}/${crypto.randomUUID()}.pfx`
    const bytes = new Uint8Array(await arquivo.arrayBuffer())
    const { error: upErr } = await supabaseAdmin.storage
      .from('fiscal-certificados-a1')
      .upload(storagePath, bytes, { contentType: 'application/x-pkcs12', upsert: false })
    if (upErr) {
      return NextResponse.json({ ok: false, erro: `Erro no storage: ${upErr.message}` }, { status: 500 })
    }

    // TODO: substituir por pgsodium/vault antes de produção (issue de hardening fiscal)
    const senhaB64 = Buffer.from(senha, 'utf-8').toString('base64')

    const { data: cert, error: insErr } = await supabaseAdmin
      .from('erp_certificados_a1')
      .insert({
        company_id: companyId,
        cnpj_certificado: cnpj,
        razao_social_certificado: typeof razaoSocial === 'string' ? razaoSocial : null,
        storage_bucket: 'fiscal-certificados-a1',
        storage_path: storagePath,
        arquivo_tamanho_bytes: arquivo.size,
        arquivo_hash_sha256: typeof thumbprint === 'string' ? thumbprint : null,
        senha_encrypted: senhaB64,
        validade_inicio: inicioDate,
        validade_fim: fimDate,
        status: 'ativo',
        criado_por: userId,
        atualizado_por: userId,
      })
      .select('id, validade_fim')
      .single()

    if (insErr) {
      await supabaseAdmin.storage.from('fiscal-certificados-a1').remove([storagePath])
      return NextResponse.json({ ok: false, erro: insErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, certificado: cert, warning: val.warning })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ ok: false, erro: msg }, { status: 500 })
  }
})
