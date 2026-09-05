// PS Gestão ERP — Compliance · Treinamentos NR
// POST /api/compliance/nr-certificado  (multipart/form-data)
//   file         — PDF/JPG/PNG do certificado (máx 10 MB)
//   company_id   — obrigatório
//   presenca_id  — obrigatório (nr_turma_presenca)
//
// Storage: bucket 'compliance' · path {company_id}/treinamentos/{presenca_id}/{uuid}.{ext}
// Mesmo padrão de compliance/documentos (service role; guarda o path, signed URL na GET).

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { createClient } from '@supabase/supabase-js'

const MAX_BYTES = 10 * 1024 * 1024
const MIME_PERMITIDOS = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'])
const BUCKET = 'compliance'

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}
function extFromName(name: string): string {
  const m = name.match(/\.([a-zA-Z0-9]{1,6})$/)
  return m ? m[1].toLowerCase() : 'bin'
}
function uuid(): string {
  return (globalThis.crypto as { randomUUID?: () => string })?.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

export const POST = withAuth(async (req: NextRequest) => {
  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ ok: false, error: 'multipart inválido' }, { status: 400 })

  const file = form.get('file') as File | null
  const companyId = (form.get('company_id') as string | null) || ''
  const presencaId = (form.get('presenca_id') as string | null) || ''

  if (!file) return NextResponse.json({ ok: false, error: 'file obrigatório' }, { status: 400 })
  if (!companyId || !presencaId) return NextResponse.json({ ok: false, error: 'company_id e presenca_id obrigatórios' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: `arquivo excede ${MAX_BYTES / 1024 / 1024} MB` }, { status: 400 })
  if (!MIME_PERMITIDOS.has(file.type)) return NextResponse.json({ ok: false, error: `tipo não permitido: ${file.type}` }, { status: 400 })

  const sb = admin()
  // presença tem que ser do tenant informado (fail-closed)
  const { data: pres } = await sb.from('nr_turma_presenca').select('id, certificado_url').eq('id', presencaId).eq('company_id', companyId).maybeSingle()
  if (!pres) return NextResponse.json({ ok: false, error: 'presença não encontrada nesta empresa' }, { status: 404 })

  const path = `${companyId}/treinamentos/${presencaId}/${uuid()}.${extFromName(file.name)}`
  const bytes = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: file.type, upsert: false })
  if (upErr) return NextResponse.json({ ok: false, error: `storage: ${upErr.message}` }, { status: 500 })

  const { error: updErr } = await sb.from('nr_turma_presenca')
    .update({ certificado_url: path, data_emissao_certificado: new Date().toISOString().slice(0, 10) })
    .eq('id', presencaId).eq('company_id', companyId)
  if (updErr) {
    await sb.storage.from(BUCKET).remove([path]).catch(() => {})
    return NextResponse.json({ ok: false, error: `update: ${updErr.message}` }, { status: 500 })
  }
  // remove o certificado anterior (se havia) — não deixa lixo
  const anterior = (pres as { certificado_url?: string | null }).certificado_url
  if (anterior && anterior !== path) await sb.storage.from(BUCKET).remove([anterior]).catch(() => {})

  // ponte #27: o certificado vira documento na ficha do funcionário (se o treinamento tiver tipo
  // de documento vinculado). Falha aqui NÃO invalida o upload — o certificado já está gravado.
  let documento: unknown = null
  try {
    const { data: sync } = await sb.rpc('fn_nr_sincronizar_documento', { p_presenca_id: presencaId })
    documento = sync
  } catch { /* sync best-effort; o anexo do certificado permanece válido */ }

  return NextResponse.json({ ok: true, path, documento })
}) as unknown as (req: NextRequest) => Promise<NextResponse>
