import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

export async function GET() {
  try {
    // Buscar da tabela clientes_assessoria (tabela real do sistema)
    const { data: clientes, error } = await supabase
      .from('clientes_assessoria')
      .select('id, nome, cnpj, segmento, regime_tributario, assessoria_id, status')
      .eq('status', 'ativo')
      .order('nome')

    if (error) {
      return NextResponse.json({ error: error.message, empresas: [] }, { status: 200 })
    }

    const allEmpresas = (clientes || []).map((c: any) => ({
      id: c.id,
      nome: c.nome,
      cnpj: c.cnpj,
      segmento: c.segmento,
      regime_tributario: c.regime_tributario,
      fonte: 'clientes_assessoria',
    }))

    // Identificar grupos (mesmo prefixo CNPJ raiz = mesmo grupo)
    const grupos: Record<string, any[]> = {}
    allEmpresas.forEach((e: any) => {
      if (e.cnpj) {
        const raiz = String(e.cnpj).replace(/[^0-9]/g, '').substring(0, 8)
        if (!grupos[raiz]) grupos[raiz] = []
        grupos[raiz].push(e)
      }
    })

    const gruposConsolidados = Object.entries(grupos)
      .filter(([, members]) => (members as any[]).length > 1)
      .map(([raiz, members]) => ({
        id: 'grupo_' + raiz,
        nome: 'GRUPO: ' + (members as any[])[0].nome.split(' ')[0] + ' (' + (members as any[]).length + ' empresas)',
        cnpj: raiz + '... (consolidado)',
        fonte: 'grupo',
        empresa_ids: (members as any[]).map((m: any) => m.id),
        membros: (members as any[]).map((m: any) => ({ id: m.id, nome: m.nome, cnpj: m.cnpj })),
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