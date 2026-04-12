import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

const STATUS_EXCL = new Set(['CANCELADO','CANCELADA','ESTORNADO','ESTORNADA','DEVOLVIDO','DEVOLVIDA','ANULADO','ANULADA'])

interface Row { data: string; valor: number; descricao: string; categoria: string; fornecedor: string; cliente: string; tipo: string }

// Converte DD/MM/YYYY ou YYYY-MM-DD para YYYY-MM (para agrupar por mes)
function toYearMonth(d: string): string {
  if (!d) return ''
  if (d.includes('/')) {
    const p = d.split('/')
    if (p.length === 3 && p[2].length === 4) return p[2] + '-' + p[1].padStart(2, '0')
    if (p.length === 3 && p[0].length === 4) return p[0] + '-' + p[1].padStart(2, '0')
  }
  if (d.includes('-') && d.length >= 7) return d.substring(0, 7)
  return d
}

// Converte DD/MM/YYYY para YYYY-MM-DD (para ordenacao)
function toISO(d: string): string {
  if (!d) return ''
  if (d.includes('/')) {
    const p = d.split('/')
    if (p.length === 3 && p[2].length === 4) return p[2] + '-' + p[1].padStart(2, '0') + '-' + p[0].padStart(2, '0')
  }
  return d
}

function extractFromOmie(imports: any[]): Row[] {
  const rows: Row[] = []
  const nomes: Record<string, string> = {}
  for (const imp of imports) {
    if (imp.import_type === 'clientes') {
      const cls = imp.import_data?.clientes_cadastro || []
      if (Array.isArray(cls)) for (const c of cls) {
        const cod = String(c.codigo_cliente_omie || c.codigo_cliente || c.codigo || '')
        nomes[cod] = c.nome_fantasia || c.razao_social || ''
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
        rows.push({ data: r.data_emissao || r.data_vencimento || '', valor: v, descricao: r.observacao || r.descricao_categoria || '', categoria: r.descricao_categoria || r.codigo_categoria || '', fornecedor: '', cliente: nomes[codCF] || 'Cliente ' + codCF, tipo: 'receita' })
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
        rows.push({ data: r.data_emissao || r.data_vencimento || '', valor: -v, descricao: r.observacao || r.descricao_categoria || '', categoria: r.descricao_categoria || r.codigo_categoria || '', fornecedor: nomes[codCF] || r.observacao || 'Fornecedor ' + codCF, cliente: '', tipo: 'despesa' })
      }
    }
    if (imp.import_type === 'import_csv') {
      const regs = imp.import_data?.registros || []
      if (Array.isArray(regs)) for (const r of regs) {
        const v = Number(r.valor) || 0
        rows.push({ data: r.data || '', valor: v, descricao: r.descricao || '', categoria: r.categoria || '', fornecedor: r.fornecedor || '', cliente: '', tipo: v >= 0 ? 'receita' : 'despesa' })
      }
    }
  }
  return rows.sort((a, b) => toISO(b.data).localeCompare(toISO(a.data)))
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const empresa_id = body.empresa_id as string
    if (!empresa_id) return NextResponse.json({ error: 'empresa_id obrigatorio' }, { status: 400 })

    // Try omie_imports first (main data source)
    const { data: imports } = await supabase
      .from('omie_imports').select('import_type, import_data')
      .eq('company_id', empresa_id)

    // Also try with clientes_assessoria ID mapping
    let rows = extractFromOmie(imports || [])

    if (rows.length === 0) {
      // Maybe empresa_id is a clientes_assessoria ID, not a companies ID
      // Try to find matching company by CNPJ
      const { data: cliente } = await supabase
        .from('clientes_assessoria').select('cnpj').eq('id', empresa_id).single()
      if (cliente?.cnpj) {
        const { data: comp } = await supabase
          .from('companies').select('id').eq('cnpj', cliente.cnpj).single()
        if (comp?.id) {
          const { data: imports2 } = await supabase
            .from('omie_imports').select('import_type, import_data')
            .eq('company_id', comp.id)
          rows = extractFromOmie(imports2 || [])
        }
      }
    }

    if (rows.length === 0) return NextResponse.json({ error: 'Nenhum lancamento encontrado. Importe dados via Omie ou CSV.' }, { status: 404 })

    // ABC Clientes
    const cMap: Record<string, number> = {}
    rows.filter(l => l.valor > 0).forEach(l => {
      const k = l.cliente || l.fornecedor || 'N/I'
      cMap[k] = (cMap[k] || 0) + l.valor
    })
    const abcClientes = Object.entries(cMap).map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor)

    // ABC Fornecedores
    const fMap: Record<string, number> = {}
    rows.filter(l => l.valor < 0).forEach(l => {
      const k = l.fornecedor || l.cliente || 'N/I'
      fMap[k] = (fMap[k] || 0) + Math.abs(l.valor)
    })
    const abcFornecedores = Object.entries(fMap).map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor)

    // ABC Categorias
    const catMap: Record<string, { receita: number; despesa: number }> = {}
    rows.forEach(l => {
      const k = l.categoria || 'Sem Categoria'
      if (!catMap[k]) catMap[k] = { receita: 0, despesa: 0 }
      if (l.valor >= 0) catMap[k].receita += l.valor
      else catMap[k].despesa += Math.abs(l.valor)
    })
    const abcCategorias = Object.entries(catMap).map(([nome, v]) => ({ nome, receita: v.receita, despesa: v.despesa, saldo: v.receita - v.despesa })).sort((a, b) => b.despesa - a.despesa)

    // DFCL Mensal
    const mMap: Record<string, { receita: number; despesa: number }> = {}
    rows.forEach(l => {
      if (!l.data) return
      const mes = toYearMonth(l.data)
      if (!mes || mes.length < 6) return
      if (!mMap[mes]) mMap[mes] = { receita: 0, despesa: 0 }
      if (l.valor >= 0) mMap[mes].receita += l.valor
      else mMap[mes].despesa += Math.abs(l.valor)
    })
    const dfcl = Object.entries(mMap).map(([mes, v]) => ({ mes, receita: v.receita, despesa: v.despesa, saldo: v.receita - v.despesa })).sort((a, b) => a.mes.localeCompare(b.mes))

    return NextResponse.json({
      total_lancamentos: rows.length,
      periodo: { inicio: toISO(rows[rows.length - 1]?.data || ''), fim: toISO(rows[0]?.data || '') },
      abc_clientes: abcClientes.slice(0, 20),
      abc_fornecedores: abcFornecedores.slice(0, 20),
      abc_categorias: abcCategorias,
      dfcl_mensal: dfcl,
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro' }, { status: 500 })
  }
}