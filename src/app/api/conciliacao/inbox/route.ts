// src/app/api/conciliacao/inbox/route.ts
//
// Módulo Conciliação Universal — Inbox
// Lista movimentos pendentes de um lote com top sugestão IA já calculada.
// Polimórfico: serve bancário, cartão despesa, cartão venda.

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withAuth(async (req: NextRequest, { userId }) => {
  const { searchParams } = new URL(req.url)
  const lote_id = searchParams.get('lote_id')
  const status = searchParams.get('status') || 'pendente'
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)

  if (!lote_id) {
    return NextResponse.json(
      {
        error: 'lote_id_obrigatorio',
        mensagem_humana: 'Informe qual lote você quer consultar.',
      },
      { status: 400 }
    )
  }

  try {
    // RPC: banco já retorna movimentos + top sugestão IA em uma chamada
    const { data: movimentos, error: errMov } = await supabaseAdmin.rpc(
      'fn_conciliacao_inbox',
      {
        p_lote_id: lote_id,
        p_company_id: null,
        p_status: status,
        p_limite: limit,
      }
    )

    if (errMov) {
      console.error('[conciliacao/inbox] rpc fn_conciliacao_inbox:', errMov)
      return NextResponse.json(
        {
          error: 'rpc_inbox_falhou',
          mensagem_humana:
            'Não consegui carregar a inbox agora. Tente atualizar em alguns segundos.',
          tentar_novamente_em_segundos: 3,
        },
        { status: 500 }
      )
    }

    // Header da tela: dados do lote
    const { data: lote, error: errLote } = await supabaseAdmin
      .from('conciliacao_lote')
      .select(
        'id, nome, tipo, operadora, total_movimentos, total_pendentes, total_conciliados, total_ignorados, status, periodo_inicio, periodo_fim, company_id'
      )
      .eq('id', lote_id)
      .single()

    if (errLote) {
      console.error('[conciliacao/inbox] select lote:', errLote)
      return NextResponse.json(
        {
          error: 'lote_nao_encontrado',
          mensagem_humana: 'O lote pedido não foi encontrado ou foi arquivado.',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      lote,
      movimentos: movimentos || [],
      total_retornado: (movimentos || []).length,
    })
  } catch (e: any) {
    console.error('[conciliacao/inbox] excecao:', e)
    return NextResponse.json(
      {
        error: 'erro_inesperado',
        mensagem_humana:
          'Algo saiu do controle. Já fui avisado e vou investigar — me cole o ID se aparecer.',
      },
      { status: 500 }
    )
  }
})
