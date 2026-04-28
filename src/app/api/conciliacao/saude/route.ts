// src/app/api/conciliacao/saude/route.ts
//
// Módulo Conciliação Universal — Dashboard de saúde
// Alimenta a página hub /dashboard/conciliacao
// Usa view canônica v_conciliacao_saude

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withAuth(async (req: NextRequest, { userId }) => {
  const { searchParams } = new URL(req.url)
  const company_id = searchParams.get('company_id')

  try {
    // 1. Saúde por empresa+tipo (via view canônica)
    let saudeQuery = supabaseAdmin.from('v_conciliacao_saude').select('*')
    if (company_id) {
      saudeQuery = saudeQuery.eq('company_id', company_id)
    }
    saudeQuery = saudeQuery.order('total_movimentos', { ascending: false })

    const { data: saude, error: errSaude } = await saudeQuery

    if (errSaude) {
      console.error('[conciliacao/saude] view v_conciliacao_saude:', errSaude)
      return NextResponse.json(
        {
          error: 'saude_falhou',
          mensagem_humana:
            'Não consegui carregar a saúde da conciliação. Tente atualizar.',
        },
        { status: 500 }
      )
    }

    // 2. Lotes ativos (não arquivados) — top 50 mais recentes
    let lotesQuery = supabaseAdmin
      .from('conciliacao_lote')
      .select(
        'id, nome, tipo, operadora, total_movimentos, total_pendentes, total_conciliados, status, created_at, company_id'
      )
      .neq('status', 'arquivado')
      .order('created_at', { ascending: false })
      .limit(50)

    if (company_id) {
      lotesQuery = lotesQuery.eq('company_id', company_id)
    }

    const { data: lotes, error: errLotes } = await lotesQuery

    if (errLotes) {
      console.error('[conciliacao/saude] select lotes:', errLotes)
      // Não bloqueia — devolve saúde sem lotes
      return NextResponse.json({
        saude: saude || [],
        lotes: [],
        aviso: 'Lista de lotes indisponível agora.',
      })
    }

    return NextResponse.json({
      saude: saude || [],
      lotes: lotes || [],
    })
  } catch (e: any) {
    console.error('[conciliacao/saude] excecao:', e)
    return NextResponse.json(
      {
        error: 'erro_inesperado',
        mensagem_humana: 'Algo saiu do controle. Tente atualizar a página.',
      },
      { status: 500 }
    )
  }
})
