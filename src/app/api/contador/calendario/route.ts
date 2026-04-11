import { NextRequest, NextResponse } from 'next/server'
import { withContadorAuth } from '@/lib/contadorAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function GET(req: NextRequest) {
  return withContadorAuth(req, async (_req, session) => {
    const hoje = new Date().toISOString().slice(0,10)
    const em90 = new Date(Date.now() + 90*24*60*60*1000).toISOString().slice(0,10)

    // Busca obrigações de todas as empresas do escritório
    const { data: obrigacoes } = await supabaseAdmin
      .from('fiscal_calendario')
      .select('*, companies:company_id(razao_social, nome_fantasia)')
      .in('company_id', session.company_ids)
      .gte('vencimento', hoje)
      .lte('vencimento', em90)
      .order('vencimento')

    // Agrupa por urgência
    const criticas = (obrigacoes||[]).filter((o:any) => {
      const dias = Math.ceil((new Date(o.vencimento).getTime() - Date.now()) / 86400000)
      return dias <= 7
    })

    return NextResponse.json({
      escritorio_id: session.escritorio_id,
      total_empresas: session.company_ids.length,
      obrigacoes: obrigacoes || [],
      criticas,
      total: obrigacoes?.length || 0,
      periodo: { inicio: hoje, fim: em90 },
    })
  })
}
