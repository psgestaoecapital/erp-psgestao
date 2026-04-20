// src/app/api/sync/omie/fornecedores/route.ts
// PS Gestão ERP — Sync Fornecedores Omie → PS Gestão

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { omiePaginate, getOmieAuthFromDb } from '@/lib/omieClient'

export const maxDuration = 300 // 5 min

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ═══ Mapeamento Omie → PS Gestão ═══
// Campos Omie de Cliente/Fornecedor (tag tipo_cliente contém "Fornecedor")
function mapOmieFornecedor(omie: any, companyId: string) {
  return {
    company_id: companyId,
    codigo: String(omie.codigo_cliente_integracao || omie.codigo_cliente_omie || ''),
    razao_social: omie.razao_social || '',
    nome_fantasia: omie.nome_fantasia || omie.razao_social || '',
    tipo_pessoa: (omie.cnpj_cpf || '').length > 11 ? 'PJ' : 'PF',
    cpf_cnpj: (omie.cnpj_cpf || '').replace(/\D/g, ''),
    ie: omie.inscricao_estadual || '',
    telefone: (omie.telefone1_ddd || '') + (omie.telefone1_numero || ''),
    email: omie.email || '',
    site: omie.homepage || '',
    cep: (omie.cep || '').replace(/\D/g, ''),
    logradouro: omie.endereco || '',
    numero: omie.endereco_numero || '',
    complemento: omie.complemento || '',
    bairro: omie.bairro || '',
    cidade: omie.cidade || '',
    uf: omie.estado || '',
    atividade_principal: omie.cnae || '',
    situacao_cadastral: omie.inativo === 'S' ? 'Inativo' : 'Ativo',
    observacoes: omie.observacao || '',
    ref_externa_sistema: 'OMIE',
    ref_externa_id: String(omie.codigo_cliente_omie || ''),
    ativo: omie.inativo !== 'S',
    bloqueado: omie.bloqueado === 'S',
  }
}

/**
 * POST /api/sync/omie/fornecedores
 * Body: { company_id: string }
 */
export async function POST(req: Request) {
  try {
    const { company_id } = await req.json()
    if (!company_id) {
      return NextResponse.json({ error: 'company_id obrigatório' }, { status: 400 })
    }

    // Pega credenciais Omie
    const auth = await getOmieAuthFromDb(supabase, company_id)
    if (!auth) {
      return NextResponse.json({ error: 'Conector Omie não configurado para esta empresa' }, { status: 404 })
    }

    console.log(`[SYNC-FORN] Iniciando — company_id: ${company_id}`)
    const inicio = Date.now()

    // Busca todos fornecedores da Omie (filtra tag "Fornecedor")
    const todos = await omiePaginate(
      auth,
      'ListarClientes',
      (pagina) => ({
        pagina,
        registros_por_pagina: 50,
        apenas_importado_api: 'N',
        filtrar_apenas_fornecedor: 'S', // filtro Omie pra trazer só fornecedores
      }),
      (response) => ({
        items: response.clientes_cadastro || [],
        totalPaginas: response.total_de_paginas || 1,
        totalRegistros: response.total_de_registros || 0,
      })
    )

    console.log(`[SYNC-FORN] ${todos.length} fornecedores recebidos do Omie`)

    // Upsert no Supabase
    let inseridos = 0
    let atualizados = 0
    let erros = 0
    const errosDetalhes: string[] = []

    for (const omie of todos) {
      try {
        const dados = mapOmieFornecedor(omie, company_id)
        if (!dados.razao_social) continue

        // Verifica se já existe (por ref_externa_id)
        const { data: existing } = await supabase
          .from('erp_fornecedores')
          .select('id')
          .eq('company_id', company_id)
          .eq('ref_externa_sistema', 'OMIE')
          .eq('ref_externa_id', dados.ref_externa_id)
          .maybeSingle()

        if (existing) {
          const { error } = await supabase
            .from('erp_fornecedores')
            .update(dados)
            .eq('id', existing.id)
          if (error) throw error
          atualizados++
        } else {
          const { error } = await supabase
            .from('erp_fornecedores')
            .insert(dados)
          if (error) throw error
          inseridos++
        }
      } catch (err: any) {
        erros++
        errosDetalhes.push(`${omie.razao_social}: ${err.message}`)
      }
    }

    const duracaoMs = Date.now() - inicio

    // Registra log de sync
    await supabase.from('omie_sync_log').insert({
      company_id,
      tipo: 'fornecedores',
      total_omie: todos.length,
      inseridos,
      atualizados,
      erros,
      duracao_ms: duracaoMs,
      detalhes_erros: errosDetalhes.slice(0, 50).join('\n'),
      executado_em: new Date().toISOString(),
    })

    console.log(`[SYNC-FORN] ✅ Concluído em ${duracaoMs}ms — +${inseridos} / ↻${atualizados} / ✗${erros}`)

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
    console.error('[SYNC-FORN] ❌ Erro fatal:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
