import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

export async function GET() {
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