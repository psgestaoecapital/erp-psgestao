// PS Gestão ERP — Compliance Validação Automática
// GET /api/compliance/status?company_id
//
// Status consolidado por empresa: KPIs verde/amarelo/vermelho/cinza,
// consultas recentes e próximas a vencer (30d).

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function fail(status: number, mensagem_humana: string) {
  return NextResponse.json({ ok: false, error: mensagem_humana, mensagem_humana }, { status })
}

export const GET = withAuth(async (req: NextRequest) => {
  const url = new URL(req.url)
  const company_id = url.searchParams.get('company_id') || ''
  if (!company_id) return fail(400, 'company_id é obrigatório.')

  // Empresa
  const { data: empresa, error: empErr } = await supabaseAdmin
    .from('companies')
    .select('id, razao_social, nome_fantasia, cnpj')
    .eq('id', company_id)
    .maybeSingle()
  if (empErr) return fail(500, `Falha ao consultar empresa: ${empErr.message}`)
  if (!empresa) return fail(404, 'Empresa não encontrada.')

  // View de status (já agrega último resultado por (alvo_tipo, alvo_id|alvo_documento, provedor))
  const { data: linhas, error: vwErr } = await supabaseAdmin
    .from('v_compliance_status_consultas')
    .select('*')
    .eq('company_id', company_id)
  if (vwErr) return fail(500, `Falha ao consultar status: ${vwErr.message}`)

  const items = (linhas as any[]) || []

  let verde = 0, amarelo = 0, vermelho = 0, cinza = 0
  for (const l of items) {
    const s = (l.semaforo || 'cinza') as string
    if (s === 'verde') verde++
    else if (s === 'amarelo') amarelo++
    else if (s === 'vermelho') vermelho++
    else cinza++
  }
  const total = items.length
  const conformidade_pct = total > 0 ? Math.round((verde / total) * 100) : 0

  // Status geral da empresa: vermelho domina, depois amarelo, depois verde, senão cinza
  const status_geral: 'verde' | 'amarelo' | 'vermelho' | 'cinza' =
    vermelho > 0 ? 'vermelho' :
    amarelo > 0 ? 'amarelo' :
    verde > 0 ? 'verde' : 'cinza'

  // Próximas a vencer 30 dias (verde com data_validade dentro de 30d)
  const hoje = Date.now()
  const proximas = items
    .filter((l) => l.data_validade)
    .map((l) => {
      const venc = new Date(l.data_validade).getTime()
      const dias = Math.round((venc - hoje) / 86_400_000)
      return { ...l, dias_para_vencer: dias }
    })
    .filter((l) => l.dias_para_vencer >= 0 && l.dias_para_vencer <= 30)
    .sort((a, b) => a.dias_para_vencer - b.dias_para_vencer)
    .slice(0, 20)

  // Consultas recentes (últimas 30 da view, ordenadas por consultada_em desc)
  const consultas_recentes = [...items]
    .sort((a, b) => {
      const ta = a.consultada_em ? new Date(a.consultada_em).getTime() : 0
      const tb = b.consultada_em ? new Date(b.consultada_em).getTime() : 0
      return tb - ta
    })
    .slice(0, 30)

  return NextResponse.json({
    ok: true,
    empresa: {
      id: (empresa as any).id,
      cnpj: (empresa as any).cnpj || null,
      razao_social: (empresa as any).razao_social || (empresa as any).nome_fantasia || '—',
      status_geral,
    },
    resumo: {
      total_alvos: total,
      verde, amarelo, vermelho, cinza,
      conformidade_pct,
      proximas_a_vencer_30d: proximas,
    },
    consultas_recentes,
  })
})
