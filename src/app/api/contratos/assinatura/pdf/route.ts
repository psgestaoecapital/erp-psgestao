// #2936 etapa 3 · "Baixar contrato assinado" (usuário logado da empresa).
// 1) confere com o JWT do usuário que o envio é visível a ele (RLS da empresa) e está assinado por todos;
// 2) gera o PDF assinado se ainda não existir (idempotente) e 3) devolve um link de download de 2 minutos.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { exigirLogin } from '@/lib/auth/guardaApi'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { BUCKET_CONTRATOS } from '@/lib/contratos/assinatura'
import { gerarEArquivarPdfAssinado } from '@/lib/contratos/pdfAssinadoServidor'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const POST = exigirLogin(async (req: NextRequest, u) => {
  let body: { envio_id?: string }
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, erro: 'Pedido inválido' }, { status: 400 }) }
  const envioId = (body.envio_id ?? '').trim()
  if (!UUID_RE.test(envioId)) return NextResponse.json({ ok: false, erro: 'Envio inválido' }, { status: 400 })

  const doUsuario = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${u.token}` } },
  })
  const { data: env, error } = await doUsuario.from('erp_contrato_assinatura_envio').select('id, status').eq('id', envioId).maybeSingle()
  if (error || !env) return NextResponse.json({ ok: false, erro: 'Envio não encontrado' }, { status: 404 })
  if (env.status !== 'assinado') return NextResponse.json({ ok: false, erro: 'O contrato ainda não foi assinado por todos' }, { status: 409 })

  const g = await gerarEArquivarPdfAssinado(envioId, new URL(req.url).origin)
  if (!g.ok) return NextResponse.json({ ok: false, erro: g.erro }, { status: 500 })
  const { data: s } = await supabaseAdmin.storage.from(BUCKET_CONTRATOS).createSignedUrl(g.path, 120, { download: true })
  if (!s?.signedUrl) return NextResponse.json({ ok: false, erro: 'Não consegui gerar o link de download' }, { status: 500 })
  return NextResponse.json({ ok: true, url: s.signedUrl })
})
