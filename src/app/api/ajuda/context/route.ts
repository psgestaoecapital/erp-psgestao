import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Supabase env vars ausentes em runtime')
  }
  return createClient(url, key)
}

export async function GET() {
  let supabase
  try {
    supabase = getSupabase()
  } catch (e: any) {
    if (e.message?.includes('env vars ausentes')) {
      return NextResponse.json({ error: 'config_missing' }, { status: 503 })
    }
    throw e
  }

  try {
    const [empRes, assRes] = await Promise.all([
      supabase.from('empresas').select('id, nome').order('nome'),
      supabase.from('assessorias').select('id, nome'),
    ])
    const { count } = await supabase.from('lancamentos').select('*', { count: 'exact', head: true })

    return NextResponse.json({
      versao: 'v8.1.0',
      empresas: (empRes.data || []).length,
      lancamentos: count || 0,
      assessorias: (assRes.data || []).length,
      modulos: 17,
      timestamp: new Date().toISOString(),
    })
  } catch (err: unknown) {
    return NextResponse.json({ versao: 'v8.1.0', empresas: 0, lancamentos: 0 })
  }
}
