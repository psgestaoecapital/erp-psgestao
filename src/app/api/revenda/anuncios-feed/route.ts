import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// R8b · Feed de anúncios para portais — arquivo CSV padrão dos veículos DISPONÍVEIS da empresa.
// Snapshot para o lojista subir no portal; integração direta com portal específico só com decisão do CEO.
// Bearer do usuário → RLS por empresa (só vê veículos da própria empresa). Bucket privado → URLs assinadas
// (1h) das fotos, na ordem definida na ficha (a capa primeiro). Sem foto/sem texto → colunas vazias (não inventa).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const BUCKET = 'revenda-veiculos'

// escapa um campo CSV (aspas duplas + separador ; comum no pt-BR/Excel)
function csv(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const auth = req.headers.get('authorization') || ''
  if (!url || !anon || !auth.startsWith('Bearer ')) return NextResponse.json({ ok: false, erro: 'não autenticado' }, { status: 401 })
  const companyId = req.nextUrl.searchParams.get('companyId')
  if (!companyId) return NextResponse.json({ ok: false, erro: 'companyId obrigatório' }, { status: 400 })

  const sb = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data, error } = await sb.from('veic_veiculo')
    .select('id,marca,modelo,versao,ano_fabricacao,ano_modelo,km_atual,cor,combustivel,cambio,portas,preco_venda,anuncio_texto')
    .eq('company_id', companyId).eq('situacao', 'disponivel').is('deleted_at', null)
    .order('marca').order('modelo')
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 403 })
  const veics = (data as Array<Record<string, unknown>>) ?? []

  // fotos por veículo (ordem da ficha) → assina em lote
  const ids = veics.map((v) => String(v.id))
  const fotosPorVeic: Record<string, string[]> = {}
  if (ids.length) {
    const { data: fotos } = await sb.from('veic_veiculo_foto').select('veiculo_id, storage_path, ordem').in('veiculo_id', ids).order('ordem')
    const paths = ((fotos as Array<{ veiculo_id: string; storage_path: string }>) ?? []).map((f) => f.storage_path)
    const assinadas: Record<string, string> = {}
    if (paths.length) {
      const { data: signed } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600)
      ;(signed ?? []).forEach((s) => { if (s.path && s.signedUrl) assinadas[s.path] = s.signedUrl })
    }
    ;((fotos as Array<{ veiculo_id: string; storage_path: string }>) ?? []).forEach((f) => {
      const u = assinadas[f.storage_path]; if (!u) return
      ;(fotosPorVeic[f.veiculo_id] ||= []).push(u)
    })
  }

  const cab = ['id', 'marca', 'modelo', 'versao', 'ano_fabricacao', 'ano_modelo', 'km', 'cor', 'combustivel', 'cambio', 'portas', 'preco', 'descricao', 'fotos']
  const linhas = [cab.join(';')]
  for (const v of veics) {
    linhas.push([
      csv(v.id), csv(v.marca), csv(v.modelo), csv(v.versao), csv(v.ano_fabricacao), csv(v.ano_modelo),
      csv(v.km_atual), csv(v.cor), csv(v.combustivel), csv(v.cambio), csv(v.portas), csv(v.preco_venda),
      csv(v.anuncio_texto), csv((fotosPorVeic[String(v.id)] ?? []).join('|')),
    ].join(';'))
  }
  const corpo = '﻿' + linhas.join('\r\n')  // BOM para o Excel abrir acentos certo
  return new NextResponse(corpo, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="anuncios-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
