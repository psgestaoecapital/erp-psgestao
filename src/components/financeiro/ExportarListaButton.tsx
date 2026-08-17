'use client'
// Botão "Exportar" (PDF/Excel) das telas Despesas a Pagar / Receitas a Receber.
// Exporta EXATAMENTE a lista que está na tela (linhas já filtradas) + KPIs do topo + totais.
// Usa o helper genérico (reutilizável) e registra a emissão em relatorios_gerados (auditoria).
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { exportarExcel, exportarPDF, type Coluna, type KpiItem, type RelatorioMeta } from '@/lib/export/relatorioLista'

type Tipo = 'pagar' | 'receber'
export interface LinhaExport {
  descricao: string
  nome_pessoa: string | null
  categoria: string | null
  valor_documento: number
  valor_pago: number | null
  data_vencimento: string
  data_pagamento: string | null
  situacao: 'pago' | 'conciliado' | 'agendado' | 'incluido_remessa' | 'vencido' | 'hoje' | 'a_vencer'
  numero_documento: string | null
}

const statusLabel = (s: LinhaExport['situacao'], tipo: Tipo): string => {
  if (s === 'pago') return tipo === 'receber' ? 'Recebido' : 'Pago'
  if (s === 'conciliado') return 'Conciliado'
  if (s === 'agendado') return 'Agendado'
  if (s === 'incluido_remessa') return 'Incluído na remessa'
  if (s === 'vencido') return 'Vencido'
  if (s === 'hoje') return 'Hoje'
  return 'A vencer'
}

export default function ExportarListaButton({ companyId, tipo, titulo, filtros, kpis, linhas }: {
  companyId: string
  tipo: Tipo
  titulo: string
  filtros: string
  kpis: KpiItem[]
  linhas: LinhaExport[]
}) {
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState<'excel' | 'pdf' | null>(null)

  const colunas: Coluna<LinhaExport>[] = [
    { header: 'Vencimento', tipo: 'data', peso: 1, get: (r) => r.data_vencimento },
    { header: 'Descrição', tipo: 'texto', peso: 2.4, get: (r) => r.descricao },
    { header: tipo === 'pagar' ? 'Fornecedor' : 'Cliente', tipo: 'texto', peso: 1.8, get: (r) => r.nome_pessoa },
    { header: 'Documento', tipo: 'texto', peso: 1, get: (r) => r.numero_documento },
    { header: 'Categoria', tipo: 'texto', peso: 1.4, get: (r) => r.categoria },
    { header: 'Valor', tipo: 'moeda', peso: 1.1, align: 'right', total: true, get: (r) => r.valor_documento },
    { header: tipo === 'pagar' ? 'Valor pago' : 'Valor recebido', tipo: 'moeda', peso: 1.1, align: 'right', total: true, get: (r) => r.valor_pago ?? 0 },
    { header: 'Saldo', tipo: 'moeda', peso: 1.1, align: 'right', total: true, get: (r) => Math.max(0, (r.valor_documento || 0) - (r.valor_pago ?? 0)) },
    { header: 'Pagamento', tipo: 'data', peso: 1, get: (r) => r.data_pagamento },
    { header: 'Status', tipo: 'texto', peso: 1, get: (r) => statusLabel(r.situacao, tipo) },
  ]

  async function exportar(formato: 'excel' | 'pdf') {
    setMenu(false)
    if (linhas.length === 0) { alert('Nenhum lançamento na tela para exportar.'); return }
    setBusy(formato)
    try {
      const [{ data: comp }, { data: auth }] = await Promise.all([
        supabase.from('companies').select('razao_social, nome_fantasia').eq('id', companyId).maybeSingle(),
        supabase.auth.getUser(),
      ])
      const empresa = (comp?.nome_fantasia || comp?.razao_social || 'Empresa') as string
      const meta: RelatorioMeta = {
        titulo, empresa, filtros,
        emitidoPor: auth?.user?.email ?? undefined,
        emitidoEmISO: new Date().toISOString(),
        kpis,
      }
      if (formato === 'excel') exportarExcel(meta, colunas, linhas)
      else await exportarPDF(meta, colunas, linhas)
      // auditoria (best-effort — nunca trava o download, RD-51)
      void supabase.rpc('fn_relatorio_registrar', { p_company_id: companyId, p_tipo: `financeiro_${tipo}_${formato}`, p_periodo: filtros })
    } catch (e) {
      alert('Falha ao gerar o relatório: ' + ((e as Error).message || 'erro'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setMenu((v) => !v)}
        disabled={busy !== null}
        title="Exportar a lista da tela (PDF ou Excel)"
        style={{
          background: '#FFFFFF', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.25)',
          padding: '9px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600,
          cursor: busy ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
        }}
      >
        ⬇ {busy === 'excel' ? 'Gerando Excel…' : busy === 'pdf' ? 'Gerando PDF…' : 'Exportar'} ▾
      </button>
      {menu && (
        <>
          <div onClick={() => setMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{
            position: 'absolute', right: 0, top: '110%', zIndex: 41, background: '#FFFFFF',
            border: '0.5px solid rgba(61,35,20,0.2)', borderRadius: 8, boxShadow: '0 8px 24px rgba(61,35,20,0.18)',
            minWidth: 180, overflow: 'hidden',
          }}>
            <MenuItem label="📊 Excel (.xlsx)" onClick={() => void exportar('excel')} />
            <MenuItem label="📄 PDF" onClick={() => void exportar('pdf')} borderTop />
          </div>
        </>
      )}
    </div>
  )
}

function MenuItem({ label, onClick, borderTop }: { label: string; onClick: () => void; borderTop?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
        borderTop: borderTop ? '0.5px solid rgba(61,35,20,0.1)' : 'none',
        padding: '11px 14px', fontSize: 13, color: '#3D2314', cursor: 'pointer', fontWeight: 600,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = '#FAF7F2' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {label}
    </button>
  )
}
