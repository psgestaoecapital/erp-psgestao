import { NextRequest, NextResponse } from 'next/server'
import { exigirLogin, exigirEmpresas } from '@/lib/auth/guardaApi'
import { createClient } from '@supabase/supabase-js'

export const GET = exigirLogin(async (req: NextRequest, u) => {
  const { searchParams } = new URL(req.url)
  const empresaId = searchParams.get('empresa_id')
  if (!empresaId) return NextResponse.json({ error: 'empresa_id obrigatório' }, { status: 400 })
  const negado = await exigirEmpresas(u, [empresaId])
  if (negado) return negado

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data, error } = await supabase.from('categorias').select('*').eq('empresa_id', empresaId).order('nome')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
})
