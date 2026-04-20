// src/app/api/sync/omie/produtos/route.ts
// PS Gestão ERP — Sync Produtos Omie → PS Gestão

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { omiePaginate, getOmieAuthFromDb } from '@/lib/omieClient'

export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function mapOmieProduto(omie: any, companyId: string) {
  const isServico = omie.tipoItem === '04' || omie.tipoItem === '05' || omie.descr_detalhada?.toLowerCase().includes('servi')
  return {
    company_id: companyId,
    codigo: String(omie.codigo || omie.codigo_produto_integracao || ''),
    nome: omie.descricao || '',
    descricao: omie.descr_detalhada || '',
    tipo: isServico ? 'servico' : 'produto',
    unidade: omie.unidade || 'UN',
    categoria: omie.descricao_familia || '',
    marca: omie.marca || '',
    ncm: omie.ncm || '',
    codigo_barras: omie.ean || '',
    preco_venda: Number(omie.valor_unitario) || 0,
    preco_custo: Number(omie.custo_medio) || 0,
    estoque_atual: Number(omie.estoque_atual) || 0,
    estoque_minimo: Number(omie.estoque_minimo) || 0,
    peso_liquido: Number(omie.peso_liq) || 0,
    peso_bruto: Number(omie.peso_bruto) || 0,
    origem_fiscal: omie.origem_mercadoria || '0',
    cfop: omie.cfop || '',
    ref_externa_sistema: 'OMIE',
    ref_externa_id: String(omie.codigo_produto || ''),
    ativo: omie.inativo !== 'S',
  }
}

export async function POST(req: Request) {
  try {
    const { company_id } = await req.json()
    if (!company_id) {
      return NextResponse.json({ error: 'company_id obrigatório' }, { status: 400 })
    }

    const auth = await getOmieAuthFromDb(supabase, company_id)
    if (!auth) {
      return NextResponse.json({ error: 'Conector Omie não configurado para esta empresa' }, { status: 404 })
    }

    console.log(`[SYNC-PROD] Iniciando — company_id: ${company_id}`)
    const inicio = Date.now()

    const todos = await omiePaginate(
      auth,
      'ListarProdutos',
      (pagina) => ({
        pagina,
        registros_por_pagina: 50,
        apenas_importado_api: 'N',
      }),
      (response) => ({
        items: response.produto_servico_cadastro || [],
        totalPaginas: response.total_de_paginas || 1,
        totalRegistros: response.total_de_registros || 0,
      })
    )

    console.log(`[SYNC-PROD] ${todos.length} produtos recebidos do Omie`)

    let inseridos = 0
    let atualizados = 0
    let erros = 0
    const errosDetalhes: string[] = []

    for (const omie of todos) {
      try {
        const dados = mapOmieProduto(omie, company_id)
        if (!dados.nome) continue

        const { data: existing } = await supabase
          .from('erp_produtos')
          .select('id')
          .eq('company_id', company_id)
          .eq('ref_externa_sistema', 'OMIE')
          .eq('ref_externa_id', dados.ref_externa_id)
          .maybeSingle()

        if (existing) {
          const { error } = await supabase
            .from('erp_produtos')
            .update(dados)
            .eq('id', existing.id)
          if (error) throw error
          atualizados++
        } else {
          const { error } = await supabase
            .from('erp_produtos')
            .insert(dados)
          if (error) throw error
          inseridos++
        }
      } catch (err: any) {
        erros++
        errosDetalhes.push(`${omie.descricao}: ${err.message}`)
      }
    }

    const duracaoMs = Date.now() - inicio

    await supabase.from('omie_sync_log').insert({
      company_id,
      tipo: 'produtos',
      total_omie: todos.length,
      inseridos,
      atualizados,
      erros,
      duracao_ms: duracaoMs,
      detalhes_erros: errosDetalhes.slice(0, 50).join('\n'),
      executado_em: new Date().toISOString(),
    })

    console.log(`[SYNC-PROD] ✅ Concluído em ${duracaoMs}ms — +${inseridos} / ↻${atualizados} / ✗${erros}`)

    return NextResponse.json({
      success: true,
      total_omie: todos.length,
      inseridos,
      atualizados,
      erros,
      duracao_ms: duracaoMs,
      errosDetalhes: errosDetalhes.slice(0, 10),
    })
  } catch (err: any) {
    console.error('[SYNC-PROD] ❌ Erro fatal:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
