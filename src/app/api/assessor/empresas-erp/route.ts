import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

export async function GET() {
  try {
    const allEmpresas: any[] = []

    // 1. Buscar da tabela empresas
    const { data: empresas } = await supabase.from('empresas').select('id, nome, cnpj, regime_tributario').order('nome')
    if (empresas) allEmpresas.push(...empresas.map((e: any) => ({ ...e, fonte: 'empresas' })))

    // 2. Buscar da tabela clientes_assessoria
    const { data: clientes } = await supabase.from('clientes_assessoria').select('id, nome, cnpj, email, telefone, assessoria_id').order('nome')
    if (clientes) {
      clientes.forEach((c: any) => {
        // Evitar duplicatas por CNPJ
        if (!allEmpresas.find((e: any) => e.cnpj && c.cnpj && e.cnpj === c.cnpj)) {
          allEmpresas.push({ id: c.id, nome: c.nome, cnpj: c.cnpj, fonte: 'clientes_assessoria', assessoria_id: c.assessoria_id })
        }
      })
    }

    // 3. Identificar grupos (mesmo prefixo CNPJ = mesmo grupo)
    const grupos: Record<string, any[]> = {}
    allEmpresas.forEach((e: any) => {
      if (e.cnpj) {
        const raiz = e.cnpj.replace(/[^0-9]/g, '').substring(0, 8)
        if (!grupos[raiz]) grupos[raiz] = []
        grupos[raiz].push(e)
      }
    })

    // Criar opcoes de grupo consolidado
    const gruposConsolidados = Object.entries(grupos)
      .filter(([, members]) => members.length > 1)
      .map(([raiz, members]) => ({
        id: 'grupo_' + raiz,
        nome: 'GRUPO: ' + members[0].nome.split(' ')[0] + ' (' + members.length + ' empresas)',
        cnpj: raiz + '... (consolidado)',
        fonte: 'grupo',
        empresa_ids: members.map((m: any) => m.id),
        membros: members.map((m: any) => ({ id: m.id, nome: m.nome, cnpj: m.cnpj })),
      }))

    return NextResponse.json({ 
      empresas: [...gruposConsolidados, ...allEmpresas],
      total: allEmpresas.length,
      grupos: gruposConsolidados.length,
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro', empresas: [] }, { status: 200 })
  }
}