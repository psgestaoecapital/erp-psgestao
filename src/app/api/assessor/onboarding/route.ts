import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

export async function GET() {
  try {
    const { data, error } = await supabase.from('assessorias').select('*').order('created_at', { ascending: false }).limit(10)
    if (error) return NextResponse.json({ error: 'GET: ' + error.message + ' | code: ' + error.code + ' | details: ' + error.details }, { status: 500 })
    return NextResponse.json({ assessorias: data || [] })
  } catch (err: unknown) {
    return NextResponse.json({ error: 'catch GET: ' + (err instanceof Error ? err.message : String(err)) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const id = body.id as string | undefined
    const nome = body.nome as string

    if (!nome) return NextResponse.json({ error: 'Nome obrigatorio' }, { status: 400 })

    // Build record with only provided fields
    const record: Record<string, unknown> = { nome }
    if (body.cnpj !== undefined) record.cnpj = body.cnpj || null
    if (body.nome_fantasia !== undefined) record.nome_fantasia = body.nome_fantasia || null
    if (body.email !== undefined) record.email = body.email || null
    if (body.telefone !== undefined) record.telefone = body.telefone || null
    if (body.cor_primaria !== undefined) record.cor_primaria = body.cor_primaria
    if (body.cor_secundaria !== undefined) record.cor_secundaria = body.cor_secundaria
    if (body.cor_fundo !== undefined) record.cor_fundo = body.cor_fundo
    if (body.logo_url !== undefined) record.logo_url = body.logo_url || null
    if (body.plano !== undefined) record.plano = body.plano
    record.updated_at = new Date().toISOString()

    let data, error

    if (id) {
      const result = await supabase.from('assessorias').update(record).eq('id', id).select()
      data = result.data
      error = result.error
    } else {
      record.created_at = new Date().toISOString()
      const result = await supabase.from('assessorias').insert(record).select()
      data = result.data
      error = result.error
    }

    if (error) {
      return NextResponse.json({ 
        error: 'Supabase: ' + error.message + ' | code: ' + error.code + ' | hint: ' + (error.hint || 'none') + ' | details: ' + (error.details || 'none')
      }, { status: 500 })
    }

    return NextResponse.json({ success: true, assessoria: data?.[0] || null })
  } catch (err: unknown) {
    return NextResponse.json({ error: 'catch POST: ' + (err instanceof Error ? err.message : String(err)) }, { status: 500 })
  }
}