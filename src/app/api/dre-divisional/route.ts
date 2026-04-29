// PS Gestão ERP — DRE Divisional
// GET /api/dre-divisional?company_id=...&ano=2026&mes=4&view_mode=mes|ytd|serie_12m
//
// Lê v_dre_divisional_completo (motor de rateio NBC TG 16 já calculado no banco).
// view_mode:
//   - 'mes'        => apenas (ano, mes) requisitado
//   - 'ytd'        => agrega janeiro..mes do ano
//   - 'serie_12m'  => + serie dos últimos 12 meses por LN (para gráfico linha)

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Linha = {
  ln_id: string
  ln_nome: string
  rob: number
  deducoes: number
  impostos: number
  cmv: number
  desp_variavel: number
  desp_fixa: number
  receita_liquida: number
  margem_bruta: number
  margem_contribuicao: number
  ebitda_pre_rateio: number
  rateio_sede_recebido: number
  ebitda_pos_rateio: number
  ebitda_pct_pos_rateio: number
  qtd_lancamentos: number
}

function fail(status: number, mensagem_humana: string) {
  return NextResponse.json({ ok: false, error: mensagem_humana, mensagem_humana }, { status })
}

function n(v: any): number {
  if (v === null || v === undefined) return 0
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

function mapLinha(r: any): Linha {
  return {
    ln_id: r.ln_id,
    ln_nome: r.ln_nome,
    rob: n(r.rob),
    deducoes: n(r.deducoes),
    impostos: n(r.impostos),
    cmv: n(r.cmv),
    desp_variavel: n(r.desp_variavel),
    desp_fixa: n(r.desp_fixa),
    receita_liquida: n(r.receita_liquida),
    margem_bruta: n(r.margem_bruta),
    margem_contribuicao: n(r.margem_contribuicao),
    ebitda_pre_rateio: n(r.ebitda_pre_rateio),
    rateio_sede_recebido: n(r.rateio_sede_recebido),
    ebitda_pos_rateio: n(r.ebitda_pos_rateio),
    ebitda_pct_pos_rateio: n(r.ebitda_pct_pos_rateio),
    qtd_lancamentos: Number(r.qtd_lancamentos || 0),
  }
}

// Soma campos numéricos das linhas, agrupando por ln_id (usado em ytd).
function agregarPorLn(linhas: Linha[]): Linha[] {
  const map = new Map<string, Linha>()
  for (const l of linhas) {
    const cur = map.get(l.ln_id)
    if (!cur) {
      map.set(l.ln_id, { ...l })
    } else {
      cur.rob += l.rob
      cur.deducoes += l.deducoes
      cur.impostos += l.impostos
      cur.cmv += l.cmv
      cur.desp_variavel += l.desp_variavel
      cur.desp_fixa += l.desp_fixa
      cur.receita_liquida += l.receita_liquida
      cur.margem_bruta += l.margem_bruta
      cur.margem_contribuicao += l.margem_contribuicao
      cur.ebitda_pre_rateio += l.ebitda_pre_rateio
      cur.rateio_sede_recebido += l.rateio_sede_recebido
      cur.ebitda_pos_rateio += l.ebitda_pos_rateio
      cur.qtd_lancamentos += l.qtd_lancamentos
    }
  }
  // Recalcula % com bases agregadas.
  const out = Array.from(map.values())
  for (const l of out) {
    l.ebitda_pct_pos_rateio = l.rob > 0 ? Number(((l.ebitda_pos_rateio / l.rob) * 100).toFixed(2)) : 0
  }
  return out
}

export const GET = withAuth(async (req: NextRequest) => {
  const url = new URL(req.url)
  const company_id = url.searchParams.get('company_id') || ''
  const anoStr = url.searchParams.get('ano')
  const mesStr = url.searchParams.get('mes')
  const view_mode = (url.searchParams.get('view_mode') || 'mes') as 'mes' | 'ytd' | 'serie_12m'

  if (!company_id) return fail(400, 'company_id é obrigatório.')
  if (!anoStr || !mesStr) return fail(400, 'ano e mes são obrigatórios.')
  const ano = Number(anoStr)
  const mes = Number(mesStr)
  if (!Number.isInteger(ano) || ano < 1900 || ano > 2200) return fail(400, 'ano inválido.')
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return fail(400, 'mes inválido (1-12).')
  if (!['mes', 'ytd', 'serie_12m'].includes(view_mode)) return fail(400, 'view_mode inválido.')

  // Empresa
  const { data: empresa, error: empErr } = await supabaseAdmin
    .from('companies')
    .select('id, razao_social, nome_fantasia')
    .eq('id', company_id)
    .maybeSingle()
  if (empErr) return fail(500, `Falha ao consultar empresa: ${empErr.message}`)
  if (!empresa) return fail(404, 'Empresa não encontrada.')

  // Configuração de rateio
  const { data: config } = await supabaseAdmin
    .from('rateio_config_empresa')
    .select('metodo_default, ratear_sede_automatico')
    .eq('company_id', company_id)
    .maybeSingle()

  // Linhas do mês (sempre busca: usado em mes/ytd/serie_12m header)
  let linhas: Linha[] = []
  let qtdLnsAtivas = 0

  if (view_mode === 'mes') {
    const { data, error } = await supabaseAdmin
      .from('v_dre_divisional_completo')
      .select('*')
      .eq('company_id', company_id)
      .eq('ano', ano)
      .eq('mes', mes)
    if (error) return fail(500, `Falha ao consultar DRE: ${error.message}`)
    linhas = (data || []).map(mapLinha)
    qtdLnsAtivas = linhas.length
  } else {
    // ytd ou serie_12m: agrega janeiro..mes do ano corrente
    const { data, error } = await supabaseAdmin
      .from('v_dre_divisional_completo')
      .select('*')
      .eq('company_id', company_id)
      .eq('ano', ano)
      .lte('mes', mes)
    if (error) return fail(500, `Falha ao consultar DRE: ${error.message}`)
    const todas = (data || []).map(mapLinha)
    linhas = agregarPorLn(todas)
    qtdLnsAtivas = linhas.length
  }

  // Série 12 meses (último ano rolante até ano/mes). Filtra cliente-side
  // para evitar acrobacias com .or() composto no PostgREST.
  let serie_12m: Array<{ ano: number; mes: number; ln_id: string; ln_nome: string; ebitda_pos_rateio: number }> = []
  if (view_mode === 'serie_12m') {
    const inicio = new Date(ano, mes - 12, 1)
    const anoIni = inicio.getFullYear()
    const { data: serie, error: serieErr } = await supabaseAdmin
      .from('v_dre_divisional_completo')
      .select('ano, mes, ln_id, ln_nome, ebitda_pos_rateio')
      .eq('company_id', company_id)
      .gte('ano', anoIni)
      .lte('ano', ano)
      .order('ano')
      .order('mes')
    if (serieErr) return fail(500, `Falha ao consultar série: ${serieErr.message}`)
    const limiteIni = anoIni * 100 + (inicio.getMonth() + 1)
    const limiteFim = ano * 100 + mes
    serie_12m = (serie || [])
      .filter((r: any) => {
        const k = Number(r.ano) * 100 + Number(r.mes)
        return k >= limiteIni && k <= limiteFim
      })
      .map((r: any) => ({
        ano: Number(r.ano),
        mes: Number(r.mes),
        ln_id: r.ln_id,
        ln_nome: r.ln_nome,
        ebitda_pos_rateio: n(r.ebitda_pos_rateio),
      }))
  }

  // Totais
  const totais = {
    receita_total: linhas.reduce((s, l) => s + l.rob, 0),
    ebitda_pre_total: linhas.reduce((s, l) => s + l.ebitda_pre_rateio, 0),
    rateio_total: linhas.reduce((s, l) => s + l.rateio_sede_recebido, 0),
    ebitda_real_total: linhas.reduce((s, l) => s + l.ebitda_pos_rateio, 0),
    qtd_lancamentos_total: linhas.reduce((s, l) => s + l.qtd_lancamentos, 0),
  }

  return NextResponse.json({
    ok: true,
    metadata: {
      empresa: {
        id: (empresa as any).id,
        razao_social: (empresa as any).razao_social || (empresa as any).nome_fantasia || '—',
      },
      periodo: { ano, mes, view_mode },
      metodo_rateio: (config as any)?.metodo_default || 'receita',
      ratear_sede_automatico: (config as any)?.ratear_sede_automatico ?? true,
      tem_lns_suficientes: qtdLnsAtivas >= 2,
      qtd_lns_ativas: qtdLnsAtivas,
    },
    linhas: linhas.sort((a, b) => b.rob - a.rob),
    serie_12m,
    totais,
  })
})
