import { NextRequest, NextResponse } from 'next/server'
import { withContadorAuth } from '@/lib/contadorAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// Alíquotas da Reforma Tributária (LC 214/2025)
const ALIQ = {
  cbs_2026:  0.009,  // 0,9% — teste, sem cobrança
  ibs_2026:  0.001,  // 0,1% — teste
  cbs_2027:  0.09,   // CBS plena
  ibs_2027:  0.001,  // IBS inicia 2027
  ibs_2033:  0.17,   // IBS completo 2033
  total_2033: 0.262, // CBS 9,2% + IBS 17% estimado
}

export async function GET(req: NextRequest, { params }: { params: Promise<{id:string}> }) {
  return withContadorAuth(req, async (_req, session) => {
    const { id } = await params
    if (!session.company_ids.includes(id)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    // Busca dados reais da empresa
    const { data: cfg } = await supabaseAdmin
      .from('fiscal_configuracao').select('*').eq('company_id',id).single()

    const { data: apuracoes } = await supabaseAdmin
      .from('fiscal_apuracoes')
      .select('periodo, receita_bruta, total_tributos, carga_efetiva')
      .eq('company_id',id)
      .order('periodo', { ascending: false })
      .limit(12)

    const receita_media = apuracoes && apuracoes.length > 0
      ? apuracoes.reduce((s: number, a: any) => s + (a.receita_bruta || 0), 0) / apuracoes.length
      : 0

    const regime = cfg?.regime || 'simples'
    const prazo_rec = cfg?.prazo_rec_dias || 30

    // Carga atual por regime
    const carga_atual_pct = regime === 'simples' ? 0.085 : regime === 'presumido' ? 0.118 : 0.145
    const carga_atual = receita_media * carga_atual_pct

    // Simulações
    const sim_2026_cbs = receita_media * ALIQ.cbs_2026
    const sim_2026_ibs = receita_media * ALIQ.ibs_2026
    const sim_2026_total = sim_2026_cbs + sim_2026_ibs

    const sim_2033 = receita_media * ALIQ.total_2033

    // Split Payment — impacto no capital de giro
    const aliq_split = ALIQ.cbs_2026 + ALIQ.ibs_2026
    const float_perdido = receita_media * aliq_split * prazo_rec / 30

    // Regime ótimo 2026
    const cargas = {
      simples:   receita_media * 0.085 + sim_2026_total,
      presumido: receita_media * 0.118 + sim_2026_total,
      real:      receita_media * 0.145 + sim_2026_total,
    }
    const regime_otimo = Object.entries(cargas).sort(([,a],[,b])=>a-b)[0][0]

    return NextResponse.json({
      empresa_id: id,
      regime_atual: regime,
      receita_media_mensal: receita_media,

      carga_atual: { valor: carga_atual, pct: carga_atual_pct * 100 },

      reforma_2026: {
        cbs: sim_2026_cbs, ibs: sim_2026_ibs, total: sim_2026_total,
        carater: 'informativo — sem cobrança efetiva em 2026',
      },

      reforma_2033: {
        total: sim_2033,
        variacao_pct: receita_media > 0 ? ((sim_2033 - carga_atual) / carga_atual * 100) : 0,
      },

      split_payment: {
        float_perdido_mes: float_perdido,
        float_perdido_ano: float_perdido * 12,
        descricao: 'Capital de giro que deixará de existir com Split Payment',
        inicio_testes: '2026',
        obrigatorio_a_partir: '2028',
      },

      regime_otimo: {
        recomendado: regime_otimo,
        cargas,
        economia_vs_atual: carga_atual - cargas[regime_otimo as keyof typeof cargas],
      },
    })
  })
}
