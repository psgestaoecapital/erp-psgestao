// src/app/api/conciliacao/match/route.ts
//
// Módulo Conciliação Universal — Ações sobre movimento
// 4 ações: aplicar | rejeitar | ignorar | pular.
// Atalhos de teclado da tela mapeiam: Enter=aplicar, R=rejeitar, I=ignorar, Esc=pular.

import { NextRequest, NextResponse } from 'next/server'
import { exigirLogin, exigirEmpresas, negar } from '@/lib/auth/guardaApi'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface MatchBody {
  acao: 'aplicar' | 'rejeitar' | 'ignorar' | 'pular'
  movimento_id: string
  lancamento_tabela?: 'erp_pagar' | 'erp_receber'
  lancamento_id?: string
  motivo?: string
}

const ACOES_VALIDAS = ['aplicar', 'rejeitar', 'ignorar', 'pular'] as const
const TABELAS_VALIDAS = ['erp_pagar', 'erp_receber'] as const

export const POST = exigirLogin(async (req: NextRequest, u) => {
  const { userId } = u
  let body: MatchBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      {
        error: 'json_invalido',
        mensagem_humana: 'A ação chegou estragada — atualize a página e tente de novo.',
      },
      { status: 400 }
    )
  }

  const { acao, movimento_id, lancamento_tabela, lancamento_id, motivo } = body

  if (!acao || !movimento_id) {
    return NextResponse.json(
      {
        error: 'campos_obrigatorios',
        mensagem_humana: 'Faltou indicar a ação ou o movimento.',
      },
      { status: 400 }
    )
  }

  if (!ACOES_VALIDAS.includes(acao as any)) {
    return NextResponse.json(
      {
        error: 'acao_desconhecida',
        mensagem_humana: `Ação "${acao}" não existe. Use: aplicar, rejeitar, ignorar ou pular.`,
      },
      { status: 400 }
    )
  }

  try {
    // Empresa REAL do movimento e, se vier, do lançamento — o usuário precisa ter acesso às duas.
    const { data: mov } = await supabaseAdmin.from('conciliacao_movimento').select('company_id').eq('id', movimento_id).maybeSingle()
    if (!mov) return negar(404, 'Movimento não encontrado.')
    const empresas = [(mov as { company_id: string }).company_id]
    if ((acao === 'aplicar' || acao === 'rejeitar') && lancamento_tabela && lancamento_id) {
      if (!(TABELAS_VALIDAS as readonly string[]).includes(lancamento_tabela)) return negar(400, 'Tabela de lançamento inválida.')
      const { data: lanc } = await supabaseAdmin.from(lancamento_tabela).select('company_id').eq('id', lancamento_id).maybeSingle()
      if (!lanc) return negar(404, 'Lançamento não encontrado.')
      empresas.push((lanc as { company_id: string }).company_id)
    }
    const negado = await exigirEmpresas(u, empresas)
    if (negado) return negado

    // ===== APLICAR =====
    if (acao === 'aplicar') {
      if (!lancamento_tabela || !lancamento_id) {
        return NextResponse.json(
          {
            error: 'aplicar_sem_lancamento',
            mensagem_humana:
              'Para aplicar match, indique qual lançamento será conciliado.',
          },
          { status: 400 }
        )
      }
      if (!TABELAS_VALIDAS.includes(lancamento_tabela as any)) {
        return NextResponse.json(
          {
            error: 'tabela_invalida',
            mensagem_humana: 'Tabela de lançamento inválida.',
          },
          { status: 400 }
        )
      }

      const { data, error } = await supabaseAdmin.rpc(
        'fn_conciliacao_aplicar_match',
        {
          p_movimento_id: movimento_id,
          p_lancamento_tabela: lancamento_tabela,
          p_lancamento_id: lancamento_id,
          p_operador_id: userId,
          p_origem: 'manual',
        }
      )

      if (error) {
        console.error('[conciliacao/match] aplicar:', error)
        return NextResponse.json(
          {
            error: 'aplicar_falhou',
            mensagem_humana: 'Não consegui aplicar o match agora. Tente de novo.',
          },
          { status: 500 }
        )
      }

      return NextResponse.json({ ok: true, resultado: data })
    }

    // ===== REJEITAR =====
    if (acao === 'rejeitar') {
      if (!lancamento_tabela || !lancamento_id) {
        return NextResponse.json(
          {
            error: 'rejeitar_sem_lancamento',
            mensagem_humana:
              'Para rejeitar uma sugestão, é preciso saber qual sugestão é.',
          },
          { status: 400 }
        )
      }

      const { error } = await supabaseAdmin.rpc(
        'fn_conciliacao_rejeitar_sugestao',
        {
          p_movimento_id: movimento_id,
          p_lancamento_tabela: lancamento_tabela,
          p_lancamento_id: lancamento_id,
          p_operador_id: userId,
        }
      )

      if (error) {
        console.error('[conciliacao/match] rejeitar:', error)
        return NextResponse.json(
          {
            error: 'rejeitar_falhou',
            mensagem_humana: 'Não consegui registrar a rejeição. Tente novamente.',
          },
          { status: 500 }
        )
      }

      return NextResponse.json({
        ok: true,
        mensagem: 'IA aprendeu que essa sugestão não serve.',
      })
    }

    // ===== IGNORAR =====
    if (acao === 'ignorar') {
      const { error } = await supabaseAdmin
        .from('conciliacao_movimento')
        .update({
          status: 'ignorado',
          motivo_status: motivo || 'Marcado como ignorado pelo operador',
          updated_at: new Date().toISOString(),
        })
        .eq('id', movimento_id)

      if (error) {
        console.error('[conciliacao/match] ignorar:', error)
        return NextResponse.json(
          {
            error: 'ignorar_falhou',
            mensagem_humana: 'Não consegui marcar como ignorado. Tente de novo.',
          },
          { status: 500 }
        )
      }

      return NextResponse.json({ ok: true })
    }

    // ===== PULAR =====
    if (acao === 'pular') {
      return NextResponse.json({
        ok: true,
        mensagem: 'Movimento pulado — volta para a fila.',
      })
    }

    return NextResponse.json(
      {
        error: 'acao_nao_tratada',
        mensagem_humana: 'Algo inesperado aconteceu com a ação.',
      },
      { status: 500 }
    )
  } catch (e: any) {
    console.error('[conciliacao/match] excecao:', e)
    return NextResponse.json(
      {
        error: 'erro_inesperado',
        mensagem_humana:
          'Algo saiu do controle. Tenta atualizar e refazer a ação.',
      },
      { status: 500 }
    )
  }
})
