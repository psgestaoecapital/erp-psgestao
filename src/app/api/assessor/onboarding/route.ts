import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

export async function GET() {
  try {
    const { data, error } = await supabase.from('assessorias').select('*').order('created_at', { ascending: false }).limit(10)
    if (error) throw error
    return NextResponse.json({ assessorias: data || [] })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, nome, cnpj, nome_fantasia, email, telefone, cor_primaria, cor_secundaria, cor_fundo, logo_url, plano } = body

    if (!nome) return NextResponse.json({ error: 'Nome obrigatorio' }, { status: 400 })

    const record = {
      nome,
      cnpj: cnpj || null,
      nome_fantasia: nome_fantasia || null,
      email: email || null,
      telefone: telefone || null,
      cor_primaria: cor_primaria || '#3D2314',
      cor_secundaria: cor_secundaria || '#C8941A',
      cor_fundo: cor_fundo || '#FAF7F2',
      logo_url: logo_url || null,
      plano: plano || 'starter',
      updated_at: new Date().toISOString(),
    }

    let result
    if (id) {
      const { data, error } = await supabase.from('assessorias').update(record).eq('id', id).select()
      if (error) throw error
      result = data
    } else {
      const { data, error } = await supabase.from('assessorias').insert({ ...record, created_at: new Date().toISOString() }).select()
      if (error) throw error
      result = data
    }

    return NextResponse.json({ success: true, assessoria: result?.[0] || null })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro ao salvar' }, { status: 500 })
  }
}