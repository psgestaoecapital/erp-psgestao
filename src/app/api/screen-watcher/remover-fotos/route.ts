// POST /api/screen-watcher/remover-fotos
// Header: x-watcher-secret (valida WATCHER_SECRET)
//
// INCIDENTE LGPD 20/09 (0e8add26) · ITEM A: rota de LIMPEZA do bucket público system-screenshots.
// O app já tem SUPABASE_SERVICE_ROLE_KEY no servidor, então apaga pela Storage API — o que também
// invalida o cache da CDN (diferente de deletar a linha em storage.objects, que o banco bloqueia).
//
// Body (JSON):
//   { paths: string[] }                          → apaga exatamente esses objetos
//   { prefixo?, desde?, max? }                   → apaga os que casarem (prefixo = 1º segmento/rota; desde = ISO)
//   { ..., relatorio: true }                     → NÃO apaga; só devolve contagem por rota + 5 amostras
// Responde o que apagou (ou apagaria). Fecha (a) as 4 fotos de 20/09 12:52–12:53 e (b) a limpeza do
// acervo não-demo (rodar antes com relatorio:true). Só PS admin/robô com o segredo — nunca exposto ao cliente.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BUCKET = 'system-screenshots'

type Body = { paths?: string[]; prefixo?: string; desde?: string; max?: number; relatorio?: boolean }

function porRota(nomes: string[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const n of nomes) { const r = n.split('/')[0] || '(raiz)'; m[r] = (m[r] || 0) + 1 }
  return m
}

export async function POST(req: NextRequest) {
  const expected = process.env.WATCHER_SECRET
  if (!expected || req.headers.get('x-watcher-secret') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY ausente' }, { status: 500 })
  }

  let body: Body
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const supabase = supabaseAdmin
  const max = Math.max(1, Math.min(5000, Number(body.max) || 2000))
  let alvos: string[] = []
  let modo: 'paths' | 'filtro'

  if (Array.isArray(body.paths) && body.paths.length) {
    modo = 'paths'
    alvos = body.paths.map((p) => String(p).replace(/^\/+/, '')).filter(Boolean)
  } else if (body.prefixo || body.desde) {
    modo = 'filtro'
    // service_role lê storage.objects sem RLS. Filtra por bucket + prefixo (1º segmento) + created_at.
    let q = supabase.schema('storage').from('objects')
      .select('name, created_at')
      .eq('bucket_id', BUCKET)
      .order('created_at', { ascending: false })
      .limit(max)
    if (body.prefixo) q = q.like('name', `${body.prefixo}%`)
    if (body.desde) q = q.gte('created_at', body.desde)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: 'falha ao listar objetos', detalhe: error.message }, { status: 500 })
    alvos = ((data as { name: string }[]) ?? []).map((o) => o.name)
  } else {
    return NextResponse.json({ error: 'informe "paths" (lista) ou um filtro ("prefixo"/"desde")' }, { status: 400 })
  }

  if (!alvos.length) return NextResponse.json({ ok: true, modo, total_alvo: 0, removidas: 0, aviso: 'nada casou o critério' })

  const relatorioBase = { modo, total_alvo: alvos.length, por_rota: porRota(alvos), amostras: alvos.slice(0, 5) }

  // Modo relatório: NÃO apaga (RD-70: relatório antes da limpeza do acervo).
  if (body.relatorio) {
    return NextResponse.json({ ok: true, relatorio: true, ...relatorioBase })
  }

  // Apaga em lotes de 100 (a Storage API remove por lista e invalida a CDN).
  let removidas = 0
  const erros: { lote: number; erro: string }[] = []
  for (let i = 0; i < alvos.length; i += 100) {
    const lote = alvos.slice(i, i + 100)
    const { data, error } = await supabase.storage.from(BUCKET).remove(lote)
    if (error) { erros.push({ lote: i / 100, erro: error.message }); continue }
    removidas += (data as unknown[] | null)?.length ?? lote.length
  }

  return NextResponse.json({ ok: erros.length === 0, ...relatorioBase, removidas, erros })
}
