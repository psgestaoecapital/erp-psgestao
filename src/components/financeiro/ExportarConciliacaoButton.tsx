'use client'
// Exporta (Excel .xlsx / PDF) a lista de conciliação que está na tela, conforme a aba ativa:
// Pendentes do extrato, Pendências do sistema, Conciliados ou Ignorados — do lote selecionado.
// Reutiliza o helper GENÉRICO @/lib/export/relatorioLista (o mesmo de "A Pagar" / "A Receber"),
// adaptando só as colunas ao formato de conciliação (movimento × título). Registra a emissão em
// relatorios_gerados (auditoria, best-effort). Nunca altera dado de cliente — só lê a lista da tela.
// Code: code-desenvolvedor-3 · PDCA GE gap2 (auditor_pdca_2) /dashboard/financeiro/conciliacao/inbox
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { exportarExcel, exportarPDF, type Coluna, type KpiItem, type RelatorioMeta } from '@/lib/export/relatorioLista'

// Subconjuntos ESTRUTURAIS das linhas da inbox — a página passa seus próprios tipos (mais ricos),
// que são atribuíveis a estes por tipagem estrutural do TypeScript.
export interface ConcExtrato { data_transacao: string; descricao: string | null; natureza: string | null; valor: number; sugestao_contraparte: string | null; sugestao_score: number | null; status: string }
export interface ConcSistema { data_vencimento: string | null; descricao: string | null; nome: string | null; categoria: string | null; natureza: string; valor: number | null; status: string | null }
export interface ConcConciliado { data_transacao: string; descricao: string | null; natureza: string | null; valor: number; contraparte: string | null; valor_lancamento: number | null; conciliado_em: string | null; match_origem: string | null }
export interface ConcIgnorado { data_transacao: string | null; descricao: string | null; natureza: string | null; valor: number; motivo_status: string | null }

export type VistaConc = 'extrato' | 'sistema' | 'conciliados' | 'ignorados'

const natLabel = (n: string | null | undefined): string => n === 'debito' ? 'Débito (saída)' : n === 'credito' ? 'Crédito (entrada)' : (n ?? '—')
// sugestao_score vem 0-1 (legado) ou 0-100; normaliza para % inteiro.
const scorePct = (s: number | null | undefined): number => { const v = Number(s ?? 0); return Math.round(v <= 1 ? v * 100 : v) }
const origemLabel = (o: string | null | undefined): string => o === 'auto' ? 'Automático' : o ? 'Manual' : '—'
const abs = (v: number | null | undefined): number => Math.abs(Number(v) || 0)

const VISTA_LABEL: Record<VistaConc, string> = {
  extrato: 'Pendentes do extrato',
  sistema: 'Pendências do sistema',
  conciliados: 'Conciliados',
  ignorados: 'Ignorados',
}

function colunas(vista: VistaConc): Coluna<Record<string, unknown>>[] {
  if (vista === 'extrato') {
    const c: Coluna<ConcExtrato>[] = [
      { header: 'Data', tipo: 'data', peso: 1, get: (r) => r.data_transacao },
      { header: 'Descrição', tipo: 'texto', peso: 2.6, get: (r) => r.descricao },
      { header: 'Natureza', tipo: 'texto', peso: 1.3, get: (r) => natLabel(r.natureza) },
      { header: 'Valor', tipo: 'moeda', peso: 1.1, align: 'right', total: true, get: (r) => abs(r.valor) },
      { header: 'Sugestão (contraparte)', tipo: 'texto', peso: 1.8, get: (r) => r.sugestao_contraparte },
      { header: 'Confiança (%)', tipo: 'numero', peso: 0.9, align: 'right', get: (r) => r.sugestao_score == null ? null : scorePct(r.sugestao_score) },
      { header: 'Situação', tipo: 'texto', peso: 1, get: (r) => r.status },
    ]
    return c as unknown as Coluna<Record<string, unknown>>[]
  }
  if (vista === 'sistema') {
    const c: Coluna<ConcSistema>[] = [
      { header: 'Vencimento', tipo: 'data', peso: 1, get: (r) => r.data_vencimento },
      { header: 'Descrição', tipo: 'texto', peso: 2.4, get: (r) => r.descricao },
      { header: 'Contraparte', tipo: 'texto', peso: 1.8, get: (r) => r.nome },
      { header: 'Categoria', tipo: 'texto', peso: 1.4, get: (r) => r.categoria },
      { header: 'Natureza', tipo: 'texto', peso: 1.3, get: (r) => natLabel(r.natureza) },
      { header: 'Valor', tipo: 'moeda', peso: 1.1, align: 'right', total: true, get: (r) => abs(r.valor) },
      { header: 'Situação', tipo: 'texto', peso: 1, get: (r) => r.status },
    ]
    return c as unknown as Coluna<Record<string, unknown>>[]
  }
  if (vista === 'conciliados') {
    const c: Coluna<ConcConciliado>[] = [
      { header: 'Data', tipo: 'data', peso: 1, get: (r) => r.data_transacao },
      { header: 'Descrição', tipo: 'texto', peso: 2.4, get: (r) => r.descricao },
      { header: 'Contraparte', tipo: 'texto', peso: 1.8, get: (r) => r.contraparte },
      { header: 'Natureza', tipo: 'texto', peso: 1.3, get: (r) => natLabel(r.natureza) },
      { header: 'Valor extrato', tipo: 'moeda', peso: 1.1, align: 'right', total: true, get: (r) => abs(r.valor) },
      { header: 'Valor lançamento', tipo: 'moeda', peso: 1.1, align: 'right', total: true, get: (r) => abs(r.valor_lancamento) },
      { header: 'Conciliado em', tipo: 'data', peso: 1, get: (r) => r.conciliado_em },
      { header: 'Origem', tipo: 'texto', peso: 1, get: (r) => origemLabel(r.match_origem) },
    ]
    return c as unknown as Coluna<Record<string, unknown>>[]
  }
  const c: Coluna<ConcIgnorado>[] = [
    { header: 'Data', tipo: 'data', peso: 1, get: (r) => r.data_transacao },
    { header: 'Descrição', tipo: 'texto', peso: 2.6, get: (r) => r.descricao },
    { header: 'Natureza', tipo: 'texto', peso: 1.3, get: (r) => natLabel(r.natureza) },
    { header: 'Valor', tipo: 'moeda', peso: 1.1, align: 'right', total: true, get: (r) => abs(r.valor) },
    { header: 'Motivo', tipo: 'texto', peso: 1.8, get: (r) => r.motivo_status },
  ]
  return c as unknown as Coluna<Record<string, unknown>>[]
}

export default function ExportarConciliacaoButton(props: {
  companyId: string
  loteNome?: string | null
  periodo?: string | null
  kpis?: KpiItem[]
  vista: VistaConc
  extrato?: ConcExtrato[]
  sistema?: ConcSistema[]
  conciliados?: ConcConciliado[]
  ignorados?: ConcIgnorado[]
}) {
  const { companyId, loteNome, periodo, kpis = [], vista } = props
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState<'excel' | 'pdf' | null>(null)

  const linhas: Record<string, unknown>[] = (
    vista === 'extrato' ? (props.extrato ?? []) :
    vista === 'sistema' ? (props.sistema ?? []) :
    vista === 'conciliados' ? (props.conciliados ?? []) :
    (props.ignorados ?? [])
  ) as unknown as Record<string, unknown>[]

  async function exportar(formato: 'excel' | 'pdf') {
    setMenu(false)
    if (linhas.length === 0) { alert('Não há itens nesta aba para exportar.'); return }
    setBusy(formato)
    try {
      const [{ data: comp }, { data: auth }] = await Promise.all([
        supabase.from('companies').select('razao_social, nome_fantasia').eq('id', companyId).maybeSingle(),
        supabase.auth.getUser(),
      ])
      const empresa = (comp?.nome_fantasia || comp?.razao_social || 'Empresa') as string
      const filtros = [loteNome ? `Lote: ${loteNome}` : null, periodo ? `Período: ${periodo}` : null, `Aba: ${VISTA_LABEL[vista]}`]
        .filter(Boolean).join(' · ')
      const meta: RelatorioMeta = {
        titulo: `Conciliação bancária — ${VISTA_LABEL[vista]}`,
        empresa,
        filtros,
        emitidoPor: auth?.user?.email ?? undefined,
        emitidoEmISO: new Date().toISOString(),
        kpis,
      }
      const cols = colunas(vista)
      if (formato === 'excel') exportarExcel(meta, cols, linhas)
      else await exportarPDF(meta, cols, linhas)
      // auditoria best-effort — nunca trava o download (RD-51)
      void supabase.rpc('fn_relatorio_registrar', { p_company_id: companyId, p_tipo: `financeiro_conciliacao_${vista}_${formato}`, p_periodo: filtros }).then(() => undefined)
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
        title="Exportar a lista desta aba (Excel ou PDF)"
        data-testid="inbox-exportar"
        style={{
          background: '#FFFFFF', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.25)',
          padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
          cursor: busy ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
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
            minWidth: 190, overflow: 'hidden',
          }}>
            <MenuItem label="📊 Excel (.xlsx)" testid="inbox-exportar-excel" onClick={() => void exportar('excel')} />
            <MenuItem label="📄 PDF" testid="inbox-exportar-pdf" onClick={() => void exportar('pdf')} borderTop />
          </div>
        </>
      )}
    </div>
  )
}

function MenuItem({ label, onClick, borderTop, testid }: { label: string; onClick: () => void; borderTop?: boolean; testid?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
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
