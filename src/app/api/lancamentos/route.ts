import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { createClient } from '@supabase/supabase-js'

const STATUS_EXCL = new Set(['CANCELADO','CANCELADA','ESTORNADO','ESTORNADA','DEVOLVIDO','DEVOLVIDA','ANULADO','ANULADA'])

function extractFromOmie(imports: any[]): any[] {
  const rows: any[] = []
  const clienteNomes: Record<string, string> = {}
  for (const imp of imports) {
    if (imp.import_type === 'clientes') {
      const cls = imp.import_data?.clientes_cadastro || []
      if (Array.isArray(cls)) for (const c of cls) {
        const cod = String(c.codigo_cliente_omie || c.codigo_cliente || c.codigo || '')
        clienteNomes[cod] = c.nome_fantasia || c.razao_social || ''
      }
    }
  }
  for (const imp of imports) {
    if (imp.import_type === 'contas_receber') {
      const regs = imp.import_data?.conta_receber_cadastro || []
      if (!Array.isArray(regs)) continue
      for (const r of regs) {
        const st = (r.status_titulo || '').toUpperCase().trim()
        if (STATUS_EXCL.has(st)) continue
        const v = Number(r.valor_documento) || 0
        if (v <= 0) continue
        const codCF = String(r.codigo_cliente_fornecedor || '')
        rows.push({
          id: r.codigo_lancamento_omie || r.numero_documento || crypto.randomUUID(),
          empresa_id: imp.company_id,
          data_lancamento: r.data_emissao || r.data_vencimento || '',
          descricao: r.observacao || r.descricao_categoria || '',
          valor: v,
          categoria: r.descricao_categoria || r.codigo_categoria || '',
          fornecedor: clienteNomes[codCF] || '',
          tipo: 'receita',
          status: st.toLowerCase() || 'ativo',
          origem: 'omie',
        })
      }
    }
    if (imp.import_type === 'contas_pagar') {
      const regs = imp.import_data?.conta_pagar_cadastro || []
      if (!Array.isArray(regs)) continue
      for (const r of regs) {
        const st = (r.status_titulo || '').toUpperCase().trim()
        if (STATUS_EXCL.has(st)) continue
        const v = Number(r.valor_documento) || 0
        if (v <= 0) continue
        const codCF = String(r.codigo_cliente_fornecedor || r.codigo_fornecedor || '')
        rows.push({
          id: r.codigo_lancamento_omie || r.numero_documento || crypto.randomUUID(),
          empresa_id: imp.company_id,
          data_lancamento: r.data_emissao || r.data_vencimento || '',
          descricao: r.observacao || r.descricao_categoria || '',
          valor: -v,
          categoria: r.descricao_categoria || r.codigo_categoria || '',
          fornecedor: clienteNomes[codCF] || r.observacao || '',
          tipo: 'despesa',
          status: st.toLowerCase() || 'ativo',
          origem: 'omie',
        })
      }
    }
    if (imp.import_type === 'import_csv') {
      const regs = imp.import_data?.registros || []
      if (Array.isArray(regs)) for (const r of regs) {
        rows.push({
          id: crypto.randomUUID(),
          empresa_id: imp.company_id,
          data_lancamento: r.data || '',
          descricao: r.descricao || '',
          valor: Number(r.valor) || 0,
          categoria: r.categoria || 'Importado',
          fornecedor: r.fornecedor || '',
          tipo: (Number(r.valor) || 0) >= 0 ? 'receita' : 'despesa',
          status: 'ativo',
          origem: 'import_csv',
        })
      }
    }
  }
  return rows.sort((a, b) => (b.data_lancamento || '').localeCompare(a.data_lancamento || ''))
}

export const GET = withAuth(async (req: NextRequest, { userId }) => {
  const { searchParams } = new URL(req.url)
  const empresaId = searchParams.get('empresa_id')
  if (!empresaId) return NextResponse.json({ error: 'empresa_id obrigatorio' }, { status: 400 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Try lancamentos table first
  const { data: lancData, error: lancError } = await supabase
    .from('lancamentos').select('*').eq('empresa_id', empresaId)
    .neq('status', 'cancelado').order('data_lancamento', { ascending: false })

  if (!lancError && lancData && lancData.length > 0) {
    return NextResponse.json({ data: lancData, source: 'lancamentos' })
  }

  // Fallback: extract from omie_imports
  const { data: imports, error: impError } = await supabase
    .from('omie_imports').select('import_type, import_data, company_id')
    .eq('company_id', empresaId)

  if (impError) return NextResponse.json({ error: impError.message }, { status: 500 })

  const extracted = extractFromOmie(imports || [])
  return NextResponse.json({ data: extracted, source: 'omie_imports' })
})

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  const body = await req.json()
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Try to insert into lancamentos table
  const { data, error } = await supabase
    .from('lancamentos').insert({ ...body, created_by: userId }).select().single()

  if (error) {
    // Fallback: save as omie_imports import_csv
    const { error: impError } = await supabase.from('omie_imports').insert({
      company_id: body.empresa_id,
      import_type: 'import_csv',
      import_data: { registros: [body] },
      record_count: 1,
    })
    if (impError) return NextResponse.json({ error: impError.message }, { status: 500 })
    return NextResponse.json({ data: body, source: 'omie_imports_fallback' }, { status: 201 })
  }

  return NextResponse.json({ data }, { status: 201 })
})