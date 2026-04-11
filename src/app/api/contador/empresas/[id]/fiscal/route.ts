import { NextRequest, NextResponse } from 'next/server'
import { withContadorAuth } from '@/lib/contadorAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function GET(req: NextRequest, { params }: { params: Promise<{id:string}> }) {
  return withContadorAuth(req, async (_req, session) => {
    const { id } = await params
    if (!session.company_ids.includes(id)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const url = new URL(req.url)
    const periodo = url.searchParams.get('periodo') || new Date().toISOString().slice(0,7)

    const [config, apuracao, calendario, splitPay] = await Promise.all([
      supabaseAdmin.from('fiscal_configuracao').select('*').eq('company_id',id).single(),
      supabaseAdmin.from('fiscal_apuracoes').select('*').eq('company_id',id).eq('periodo',periodo).single(),
      supabaseAdmin.from('fiscal_calendario').select('*').eq('company_id',id)
        .gte('vencimento', new Date().toISOString().slice(0,10))
        .order('vencimento').limit(5),
      supabaseAdmin.from('fiscal_split_payment').select('*').eq('company_id',id).eq('periodo',periodo).single(),
    ])

    return NextResponse.json({
      empresa_id: id,
      periodo,
      configuracao: config.data,
      apuracao: apuracao.data,
      proximas_obrigacoes: calendario.data || [],
      split_payment: splitPay.data,
    })
  })
}
