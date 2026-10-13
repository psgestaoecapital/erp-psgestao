// POST /api/screen-watcher/remover-fotos
// Header: x-watcher-secret (valida WATCHER_SECRET)
//
// INCIDENTE LGPD 20/09 (0e8add26) · ITEM A: limpeza do bucket PRIVADO system-screenshots pela Storage API
// (service_role no servidor). Apagar pela Storage API também invalida o cache da CDN — deletar a linha em
// storage.objects é bloqueado pelo banco.
//
// Correção (o schema `storage` NÃO é exposto ao PostgREST → nada de .schema('storage')): a listagem/filtro
// percorre o bucket com supabase.storage.from(BUCKET).list(prefixo, {limit,offset}), descendo nas pastas
// (o id nulo marca pasta; o não-nulo, arquivo — cada arquivo traz created_at).
//
// Body (JSON):
//   { paths: string[] }                              → apaga exatamente esses objetos
//   { prefixo?, desde?, ate?, max? }                 → apaga os que casarem (prefixo=1º segmento; desde/ate=ISO)
//   { retencao_dias: N }                             → apaga o que for MAIS VELHO que N dias (ate = agora−N)
//   { ..., relatorio: true }                         → NÃO apaga; devolve total + por_rota + 5 amostras
// desde = criado em/após (inclusivo). ate = criado ANTES (exclusivo). Responde o que apagou (ou apagaria).

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const BUCKET = 'system-screenshots'
const PAGINA = 1000

type Body = { paths?: string[]; prefixo?: string; desde?: string; ate?: string; retencao_dias?: number; max?: number; relatorio?: boolean }
type Obj = { name: string; created_at: string | null }

function porRota(nomes: string[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const n of nomes) { const r = n.split('/')[0] || '(raiz)'; m[r] = (m[r] || 0) + 1 }
  return m
}

// Percorre recursivamente o bucket via Storage API (nunca storage.objects). Para ao atingir `teto`.
async function listarBucket(
  supabase: typeof supabaseAdmin, prefixo: string, teto: number,
): Promise<Obj[]> {
  const out: Obj[] = []
  const filas: string[] = [prefixo.replace(/^\/+|\/+$/g, '')]
  while (filas.length && out.length < teto) {
    const atual = filas.shift() as string
    let offset = 0
    for (;;) {
      const { data, error } = await supabase.storage.from(BUCKET).list(atual || undefined, {
        limit: PAGINA, offset, sortBy: { column: 'created_at', order: 'asc' },
      })
      if (error) throw new Error(error.message)
      const entradas = data ?? []
      for (const e of entradas) {
        const full = atual ? `${atual}/${e.name}` : e.name
        if (e.id === null) filas.push(full)                                   // pasta → percorre depois
        else { out.push({ name: full, created_at: (e as { created_at?: string }).created_at ?? null }); if (out.length >= teto) break }
      }
      if (entradas.length < PAGINA || out.length >= teto) break
      offset += PAGINA
    }
  }
  return out
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
  const max = Math.max(1, Math.min(50000, Number(body.max) || 20000))

  // ── Modo paths: apaga exatamente o que veio ──────────────────────────────────────────────────────
  if (Array.isArray(body.paths) && body.paths.length) {
    const alvos = body.paths.map((p) => String(p).replace(/^\/+/, '')).filter(Boolean)
    const relatorioBase = { modo: 'paths' as const, total_alvo: alvos.length, por_rota: porRota(alvos), amostras: alvos.slice(0, 5) }
    if (body.relatorio) return NextResponse.json({ ok: true, relatorio: true, ...relatorioBase })
    const { removidas, erros } = await apagar(supabase, alvos)
    return NextResponse.json({ ok: erros.length === 0, ...relatorioBase, removidas, erros })
  }

  // ── Modo filtro/retenção: percorre o bucket e casa por prefixo/data ───────────────────────────────
  let desde = body.desde || null
  let ate = body.ate || null
  if (body.retencao_dias && body.retencao_dias > 0) {
    ate = new Date(Date.now() - body.retencao_dias * 86400_000).toISOString()  // mais velho que N dias
  }
  if (!body.prefixo && !desde && !ate) {
    return NextResponse.json({ error: 'informe "paths", um filtro ("prefixo"/"desde"/"ate") ou "retencao_dias"' }, { status: 400 })
  }

  let objetos: Obj[]
  try { objetos = await listarBucket(supabase, body.prefixo || '', max) }
  catch (e) { return NextResponse.json({ error: 'falha ao listar objetos', detalhe: e instanceof Error ? e.message : String(e) }, { status: 500 }) }

  const desdeMs = desde ? Date.parse(desde) : null
  const ateMs = ate ? Date.parse(ate) : null
  const casam = objetos.filter((o) => {
    if (body.prefixo && !o.name.startsWith(body.prefixo)) return false
    const t = o.created_at ? Date.parse(o.created_at) : NaN
    if (desdeMs != null && !(Number.isNaN(t) ? false : t >= desdeMs)) return false
    if (ateMs != null && !(Number.isNaN(t) ? false : t < ateMs)) return false
    return true
  })
  const alvos = casam.map((o) => o.name)
  const relatorioBase = {
    modo: 'filtro' as const, filtro: { prefixo: body.prefixo || null, desde, ate },
    varridos: objetos.length, total_alvo: alvos.length, por_rota: porRota(alvos), amostras: alvos.slice(0, 5),
  }

  if (body.relatorio) return NextResponse.json({ ok: true, relatorio: true, ...relatorioBase })
  if (!alvos.length) return NextResponse.json({ ok: true, ...relatorioBase, removidas: 0, aviso: 'nada casou o critério' })
  const { removidas, erros } = await apagar(supabase, alvos)
  return NextResponse.json({ ok: erros.length === 0, ...relatorioBase, removidas, erros })
}

async function apagar(supabase: typeof supabaseAdmin, alvos: string[]): Promise<{ removidas: number; erros: { lote: number; erro: string }[] }> {
  let removidas = 0
  const erros: { lote: number; erro: string }[] = []
  for (let i = 0; i < alvos.length; i += 100) {
    const lote = alvos.slice(i, i + 100)
    const { data, error } = await supabase.storage.from(BUCKET).remove(lote)
    if (error) { erros.push({ lote: i / 100, erro: error.message }); continue }
    removidas += (data as unknown[] | null)?.length ?? lote.length
  }
  return { removidas, erros }
}
