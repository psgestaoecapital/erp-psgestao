import { NextRequest, NextResponse } from 'next/server'
import { withContadorAuth } from '@/lib/contadorAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function GET(req: NextRequest) {
  return withContadorAuth(req, async (_req, session) => {
    if (!session.company_ids.length) {
      return NextResponse.json({ empresas: [] })
    }

    const { data: empresas } = await supabaseAdmin
      .from('companies')
      .select('id, razao_social, nome_fantasia, cnpj')
      .in('id', session.company_ids)
      .order('razao_social')

    // Para cada empresa, busca KPIs básicos do período mais recente
    const periodo = new Date().toISOString().slice(0,7)
    const empresasComKpis = await Promise.all((empresas || []).map(async (emp: any) => {
      const { data: apuracao } = await supabaseAdmin
        .from('fiscal_apuracoes')
        .select('receita_bruta, total_tributos, carga_efetiva')
        .eq('company_id', emp.id)
        .eq('periodo', periodo)
        .single()

      return { ...emp, fiscal: apuracao || null }
    }))

    return NextResponse.json({ empresas: empresasComKpis, total: empresasComKpis.length })
  })
}
