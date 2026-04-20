// src/app/api/sync/omie/clientes/route.ts
// PS Gestão ERP — Sync Clientes Omie → PS Gestão

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { omiePaginate, getOmieAuthFromDb } from '@/lib/omieClient'

export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function mapOmieCliente(omie: any, companyId: string) {
  return {
    company_id: companyId,
    codigo: String(omie.codigo_cliente_integracao || omie.codigo_cliente_omie || ''),
    razao_social: omie.razao_social || '',
    nome_fantasia: omie.nome_fantasia || omie.razao_social || '',
    tipo_pessoa: (omie.cnpj_cpf || '').length > 11 ? 'PJ' : 'PF',
    cpf_cnpj: (omie.cnpj_cpf || '').replace(/\D/g, ''),
    ie: omie.inscricao_estadual || '',
    im: omie.inscricao_municipal || '',
    telefone: (omie.telefone1_ddd || '') + (omie.telefone1_numero || ''),
    celular: (omie.telefone2_ddd || '') + (omie.telefone2_numero || ''),
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

    console.log(`[SYNC-CLI] Iniciando — company_id: ${company_id}`)
    const inicio = Date.now()

    const todos = await omiePaginate(
      auth,
      'ListarClientes',
      (pagina) => ({
        pagina,
        registros_por_pagina: 50,
        apenas_importado_api: 'N',
        filtrar_apenas_clientes: 'S',
      }),
      (response) => ({
        items: response.clientes_cadastro || [],
        totalPaginas: response.total_de_paginas || 1,
        totalRegistros: response.total_de_registros || 0,
      })
    )

    console.log(`[SYNC-CLI] ${todos.length} clientes recebidos do Omie`)

    let inseridos = 0
    let atualizados = 0
    let erros = 0
    const errosDetalhes: string[] = []

    for (const omie of todos) {
      try {
        const dados = mapOmieCliente(omie, company_id)
        if (!dados.razao_social) continue

        const { data: existing } = await supabase
          .from('erp_clientes')
          .select('id')
          .eq('company_id', company_id)
          .eq('ref_externa_sistema', 'OMIE')
          .eq('ref_externa_id', dados.ref_externa_id)
          .maybeSingle()

        if (existing) {
          const { error } = await supabase
            .from('erp_clientes')
            .update(dados)
            .eq('id', existing.id)
          if (error) throw error
          atualizados++
        } else {
          const { error } = await supabase
            .from('erp_clientes')
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

    await supabase.from('omie_sync_log').insert({
      company_id,
      tipo: 'clientes',
      total_omie: todos.length,
      inseridos,
      atualizados,
      erros,
      duracao_ms: duracaoMs,
      detalhes_erros: errosDetalhes.slice(0, 50).join('\n'),
      executado_em: new Date().toISOString(),
    })

    console.log(`[SYNC-CLI] ✅ Concluído em ${duracaoMs}ms — +${inseridos} / ↻${atualizados} / ✗${erros}`)

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
    console.error('[SYNC-CLI] ❌ Erro fatal:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
