import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

export async function GET() {
  try {
    // 1. Buscar clientes_assessoria
    const { data: clientes } = await supabase
      .from('clientes_assessoria')
      .select('id, nome, cnpj, segmento, regime_tributario, assessoria_id, status')
      .eq('status', 'ativo')
      .order('nome')

    // 2. Buscar companies (onde vivem os dados do omie_imports)
    const { data: companies } = await supabase
      .from('companies')
      .select('id, nome_fantasia, razao_social, cnpj, group_id')
      .order('nome_fantasia')

    const allEmpresas: any[] = []
    const seenCnpjs = new Set<string>()

    // Adicionar companies primeiro (tem dados reais em omie_imports)
    if (companies) {
      for (const c of companies) {
        const cnpjClean = (c.cnpj || '').replace(/[^0-9]/g, '')
        seenCnpjs.add(cnpjClean)
        allEmpresas.push({
          id: c.id,
          nome: c.nome_fantasia || c.razao_social || 'Sem nome',
          cnpj: c.cnpj || '',
          fonte: 'companies',
          group_id: c.group_id,
        })
      }
    }

    // Adicionar clientes_assessoria que NAO estao em companies (evitar duplicatas por CNPJ)
    if (clientes) {
      for (const c of clientes) {
        const cnpjClean = (c.cnpj || '').replace(/[^0-9]/g, '')
        if (cnpjClean && seenCnpjs.has(cnpjClean)) continue
        allEmpresas.push({
          id: c.id,
          nome: c.nome,
          cnpj: c.cnpj || '',
          fonte: 'clientes_assessoria',
          assessoria_id: c.assessoria_id,
        })
      }
    }

    // 3. Gerar grupos automaticos

    // 3a. Grupos por company_groups (se existir group_id)
    const groupIds = [...new Set(allEmpresas.filter(e => e.group_id).map(e => e.group_id))]
    const gruposDB: any[] = []
    if (groupIds.length > 0) {
      const { data: groups } = await supabase.from('company_groups').select('id, nome').in('id', groupIds)
      if (groups) {
        for (const g of groups) {
          const members = allEmpresas.filter(e => e.group_id === g.id)
          if (members.length > 1) {
            gruposDB.push({
              id: 'group_' + g.id,
              nome: 'GRUPO: ' + g.nome + ' (' + members.length + ' empresas)',
              fonte: 'grupo',
              empresa_ids: members.map(m => m.id),
              membros: members.map(m => ({ id: m.id, nome: m.nome, cnpj: m.cnpj })),
            })
          }
        }
      }
    }

    // 3b. Grupo por assessoria (todas as empresas da mesma assessoria)
    const assessoriaIds = [...new Set((clientes || []).map(c => c.assessoria_id).filter(Boolean))]
    const gruposAssessoria: any[] = []
    if (assessoriaIds.length > 0) {
      for (const aId of assessoriaIds) {
        const members = (clientes || []).filter(c => c.assessoria_id === aId)
        if (members.length > 1) {
          gruposAssessoria.push({
            id: 'assessoria_' + aId,
            nome: 'TODOS OS CLIENTES (' + members.length + ' empresas)',
            fonte: 'grupo',
            empresa_ids: members.map((m: any) => m.id),
            membros: members.map((m: any) => ({ id: m.id, nome: m.nome, cnpj: m.cnpj })),
          })
        }
      }
    }

    return NextResponse.json({
      empresas: [...gruposDB, ...gruposAssessoria, ...allEmpresas],
      total: allEmpresas.length,
      grupos: gruposDB.length + gruposAssessoria.length,
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro', empresas: [] }, { status: 200 })
  }
}