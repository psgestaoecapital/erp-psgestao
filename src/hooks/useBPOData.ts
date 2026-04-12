import { useState, useEffect, useCallback } from 'react'
import { applyBPOFilters, filterSummary, type Lancamento } from '@/lib/dataFilters'
import { supabase } from '@/lib/supabase'

interface UseBPODataOptions {
  empresaId: string
  periodo?: string
  enabled?: boolean
}

const STATUS_EXCL = new Set(['CANCELADO','CANCELADA','ESTORNADO','ESTORNADA','DEVOLVIDO','DEVOLVIDA','ANULADO','ANULADA'])

function extractFromOmie(imports: any[]): Lancamento[] {
  const rows: Lancamento[] = []
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
        rows.push({
          id: r.codigo_lancamento_omie || r.numero_documento || String(Math.random()),
          status: st.toLowerCase() || 'ativo',
          tipo: 'receita',
          categoria: r.descricao_categoria || r.codigo_categoria || '',
          valor: v,
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
        rows.push({
          id: r.codigo_lancamento_omie || r.numero_documento || String(Math.random()),
          status: st.toLowerCase() || 'ativo',
          tipo: 'despesa',
          categoria: r.descricao_categoria || r.codigo_categoria || '',
          valor: -v,
        })
      }
    }
    if (imp.import_type === 'import_csv') {
      const regs = imp.import_data?.registros || []
      if (Array.isArray(regs)) for (const r of regs) {
        rows.push({
          id: String(Math.random()),
          tipo: (Number(r.valor) || 0) >= 0 ? 'receita' : 'despesa',
          categoria: r.categoria || 'Importado',
          valor: Number(r.valor) || 0,
        })
      }
    }
  }
  return rows
}

export function useBPOData({ empresaId, periodo, enabled = true }: UseBPODataOptions) {
  const [data, setData] = useState<Lancamento[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<ReturnType<typeof filterSummary> | null>(null)

  const fetchData = useCallback(async () => {
    if (!empresaId || !enabled) return
    setLoading(true)
    setError(null)

    try {
      const { data: imports, error: dbError } = await supabase
        .from('omie_imports')
        .select('import_type, import_data')
        .eq('company_id', empresaId)

      if (dbError) throw new Error(dbError.message)

      const raw = extractFromOmie(imports || [])
      const filtered = applyBPOFilters(raw)
      setData(filtered)
      setSummary(filterSummary(raw, filtered))
    } catch (err: any) {
      setError(err.message)
      setData([])
    } finally {
      setLoading(false)
    }
  }, [empresaId, periodo, enabled])

  useEffect(() => { fetchData() }, [fetchData])
  return { data, loading, error, summary, refetch: fetchData }
}