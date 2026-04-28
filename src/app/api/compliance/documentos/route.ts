// PS Gestão ERP — Compliance Hub
// POST /api/compliance/documentos  (multipart/form-data)
//
// Campos (form-data):
//   file                 — arquivo (PDF/JPG/PNG, máx 10 MB)
//   company_id           — obrigatório
//   tipo_documento_id    — obrigatório
//   funcionario_id?      — obrigatório se for doc de funcionário
//   empresa_alvo_id?     — obrigatório se for doc da empresa
//   data_emissao?        — yyyy-mm-dd
//   data_validade?       — yyyy-mm-dd
//   sem_validade?        — 'true'|'false'
//   numero_documento?
//   emissor?
//   observacoes?
//
// Storage: bucket 'compliance'
// Path: {company_id}/{funcionario_id|'empresa'}/{tipo_slug}/{uuid}.{ext}
//
// Quando substitui um doc existente (mesmo tipo + escopo), marca o anterior
// como ativo=false e guarda documento_anterior_id. O trigger do banco
// recalcula status_validade e propaga alerta em bpo_inbox_items.

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { createClient } from '@supabase/supabase-js'

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB
const MIME_PERMITIDOS = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
])
const BUCKET = 'compliance'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function extFromName(name: string): string {
  const m = name.match(/\.([a-zA-Z0-9]{1,6})$/)
  return m ? m[1].toLowerCase() : 'bin'
}

function uuid(): string {
  // crypto.randomUUID está disponível em Node 19+ (Vercel usa moderno).
  return (globalThis.crypto as any)?.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  const form = await req.formData().catch(() => null)
  if (!form) {
    return NextResponse.json({ ok: false, error: 'multipart inválido' }, { status: 400 })
  }

  const file = form.get('file') as File | null
  const companyId = (form.get('company_id') as string | null) || ''
  const tipoDocumentoId = (form.get('tipo_documento_id') as string | null) || ''
  const funcionarioId = (form.get('funcionario_id') as string | null) || null
  const empresaAlvoId = (form.get('empresa_alvo_id') as string | null) || null
  const prestadorId = (form.get('prestador_id') as string | null) || null
  const dataEmissao = (form.get('data_emissao') as string | null) || null
  const dataValidade = (form.get('data_validade') as string | null) || null
  const semValidadeRaw = (form.get('sem_validade') as string | null) || 'false'
  const numeroDocumento = (form.get('numero_documento') as string | null) || null
  const emissor = (form.get('emissor') as string | null) || null
  const observacoes = (form.get('observacoes') as string | null) || null

  if (!file) return NextResponse.json({ ok: false, error: 'file obrigatório' }, { status: 400 })
  if (!companyId || !tipoDocumentoId) {
    return NextResponse.json(
      { ok: false, error: 'company_id e tipo_documento_id obrigatórios' },
      { status: 400 }
    )
  }
  if (!funcionarioId && !empresaAlvoId && !prestadorId) {
    return NextResponse.json(
      { ok: false, error: 'informe funcionario_id, empresa_alvo_id ou prestador_id' },
      { status: 400 }
    )
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: `arquivo excede ${MAX_BYTES / 1024 / 1024} MB` },
      { status: 400 }
    )
  }
  if (!MIME_PERMITIDOS.has(file.type)) {
    return NextResponse.json(
      { ok: false, error: `tipo não permitido: ${file.type}` },
      { status: 400 }
    )
  }

  const sb = admin()

  // Descobre o slug do tipo para compor o path.
  const { data: tipo } = await sb
    .from('compliance_tipos_documento')
    .select('slug')
    .eq('id', tipoDocumentoId)
    .maybeSingle()
  const tipoSlug = (tipo as any)?.slug || 'sem-slug'

  const scope = funcionarioId || (prestadorId ? `prestador-${prestadorId}` : 'empresa')
  const ext = extFromName(file.name)
  const path = `${companyId}/${scope}/${tipoSlug}/${uuid()}.${ext}`

  // Upload para o Storage.
  const bytes = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: file.type,
      upsert: false,
    })
  if (upErr) {
    return NextResponse.json(
      { ok: false, error: `storage: ${upErr.message}` },
      { status: 500 }
    )
  }

  // Marca documento(s) anterior(es) como inativos para o mesmo escopo + tipo.
  const anteriorFilters: Record<string, any> = {
    company_id: companyId,
    tipo_documento_id: tipoDocumentoId,
    ativo: true,
  }
  if (funcionarioId) anteriorFilters.funcionario_id = funcionarioId
  if (empresaAlvoId) anteriorFilters.empresa_alvo_id = empresaAlvoId
  if (prestadorId) anteriorFilters.prestador_id = prestadorId
  const { data: anteriores } = await sb
    .from('compliance_documentos')
    .select('id, versao')
    .match(anteriorFilters)
  const versaoAnterior = (anteriores || []).reduce(
    (max: number, r: any) => Math.max(max, Number(r.versao) || 0),
    0
  )
  const documentoAnteriorId = (anteriores || [])[0]?.id ?? null
  if (anteriores && anteriores.length > 0) {
    await sb
      .from('compliance_documentos')
      .update({ ativo: false, updated_at: new Date().toISOString() })
      .in('id', anteriores.map((a: any) => a.id))
  }

  // Insere o novo doc. Trigger no DB recalcula status_validade e alerta.
  const insertPayload: Record<string, any> = {
    company_id: companyId,
    funcionario_id: funcionarioId,
    empresa_alvo_id: empresaAlvoId,
    prestador_id: prestadorId,
    tipo_documento_id: tipoDocumentoId,
    arquivo_url: path, // guardamos o path; signed URL é gerada na GET.
    arquivo_nome_original: file.name,
    arquivo_tamanho_bytes: file.size,
    arquivo_mimetype: file.type,
    data_emissao: dataEmissao || null,
    data_validade: semValidadeRaw === 'true' ? null : dataValidade || null,
    sem_validade: semValidadeRaw === 'true',
    numero_documento: numeroDocumento,
    emissor,
    observacoes,
    uploaded_by: userId,
    versao: versaoAnterior + 1,
    documento_anterior_id: documentoAnteriorId,
    ativo: true,
  }

  const { data: doc, error: insErr } = await sb
    .from('compliance_documentos')
    .insert(insertPayload)
    .select('*')
    .single()
  if (insErr) {
    // Se insert falhar, tenta remover o arquivo pra não deixar lixo.
    await sb.storage.from(BUCKET).remove([path]).catch(() => {})
    return NextResponse.json(
      { ok: false, error: `insert: ${insErr.message}` },
      { status: 500 }
    )
  }
  return NextResponse.json({ ok: true, documento: doc })
})
