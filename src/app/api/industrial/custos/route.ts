import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin'
import { exigirUsuario, exigirEmpresas } from '@/lib/auth/guardaApi'

export async function GET(req: NextRequest) {
  const guarda = await exigirUsuario(req)
  if (guarda instanceof NextResponse) return guarda
  try {
    const url = new URL(req.url)
    const empresa_id = url.searchParams.get('empresa_id')
    const periodo = url.searchParams.get('periodo')
    // Empresa agora é obrigatória (antes, sem filtro, devolvia os custos de TODAS as empresas).
    const negado = await exigirEmpresas(guarda, [empresa_id])
    if (negado) return negado

    let query = supabase.from('custos_industriais').select('*').order('periodo', { ascending: false })
    query = query.eq('empresa_id', empresa_id as string)
    if (periodo) query = query.eq('periodo', periodo)

    const { data, error } = await query.limit(100)
    if (error) throw error
    return NextResponse.json({ custos: data || [] })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const guarda = await exigirUsuario(req)
  if (guarda instanceof NextResponse) return guarda
  try {
    const body = await req.json()
    const { empresa_id, periodo, especie, planta, grupos, volume_ton, cabecas, fonte, orcamento } = body

    if (!empresa_id || !periodo) {
      return NextResponse.json({ error: 'empresa_id e periodo obrigatorios' }, { status: 400 })
    }
    const negado = await exigirEmpresas(guarda, [empresa_id])
    if (negado) return negado

    const CAMPOS = [
      'materia_prima', 'mao_obra_direta', 'mao_obra_indireta', 'embalagens',
      'energia', 'gas_vapor', 'agua_efluentes', 'manutencao', 'logistica_interna',
      'depreciacao', 'insumos_quimicos', 'servicos_terceirizados', 'outros_custos'
    ]

    const record: Record<string, unknown> = {
      empresa_id, periodo,
      especie: especie || null,
      planta: planta || null,
      fonte: fonte || 'manual',
      volume_ton: volume_ton || null,
      cabecas_abatidas: cabecas || null,
    }

    if (grupos) {
      CAMPOS.forEach((campo) => {
        record[campo] = grupos[campo] || 0
      })
    }

    if (orcamento) {
      CAMPOS.forEach((campo) => {
        record['orc_' + campo] = orcamento[campo] || 0
      })
    }

    const { data, error } = await supabase
      .from('custos_industriais')
      .upsert(record, { onConflict: 'empresa_id,periodo,especie,planta' })
      .select()

    if (error) throw error
    return NextResponse.json({ success: true, data })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro' }, { status: 500 })
  }
}