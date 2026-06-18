'use client'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import FinanciamentoFormModal from '@/components/financiamento/FinanciamentoFormModal'

type Financiamento = {
  id: string
  banco: string | null
  tipo: string | null
  operacao: string | null
  contrato: string | null
  valor_original: number | null
  valor_liquido: number | null
  saldo_devedor: number | null
  saldo_total_parcelas: number | null
  taxa_mensal: number | null
  taxa_anual: number | null
  parcelas: number | null
  parcelas_restantes: number | null
  valor_parcela: number | null
  parcela_futura: number | null
  vencimento: string | null
  data_origem: string | null
  garantia: string | null
  status: string | null
  situacao: string | null
  em_carencia: boolean | null
  observacao: string | null
}

type Kpis = {
  contratos_ativos: number
  saldo_quitacao: number
  saldo_total_parcelas: number
  juros_embutidos: number
  compromisso_mensal: number
  contratos_em_carencia: number
}

const brl = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const ESPRESSO = '#3D2314'
const OFFWHITE = '#FAF7F2'
const DOURADO  = '#C8941A'
const BORDA    = '#E7DED3'

function KpiCard({ titulo, valor, destaque, sub }: { titulo: string; valor: string; destaque?: boolean; sub?: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: OFFWHITE, minHeight: 76 }}>
      <div className="text-[11px] uppercase opacity-60 leading-tight">{titulo}</div>
      <div className="font-bold leading-tight" style={{ color: destaque ? DOURADO : ESPRESSO }}>{valor}</div>
      {sub && <div className="text-[11px] opacity-60 leading-tight">{sub}</div>}
    </div>
  )
}

// undefined = modal fechado · null = novo · objeto = editar
type Editing = undefined | null | Financiamento

export default function FinanciamentoPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [rows, setRows] = useState<Financiamento[]>([])
  const [kpis, setKpis] = useState<Kpis | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Editing>(undefined)
  const [toast, setToast] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!empresaUnica) {
      setRows([])
      setKpis(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const [lista, kpiResp] = await Promise.all([
      supabase
        .from('financiamentos')
        .select('*')
        .eq('company_id', empresaUnica)
        .order('saldo_devedor', { ascending: false }),
      supabase.rpc('fn_financiamentos_kpis', { p_company_id: empresaUnica }),
    ])
    setRows((lista.data ?? []) as Financiamento[])
    setKpis((kpiResp.data ?? null) as Kpis | null)
    setLoading(false)
  }, [empresaUnica])

  useEffect(() => { reload() }, [reload])

  async function excluir(r: Financiamento) {
    if (!confirm(`Excluir o contrato "${r.banco ?? ''} ${r.contrato ?? ''}"?\n\nEsta ação não pode ser desfeita.`)) return
    const { error } = await supabase.from('financiamentos').delete().eq('id', r.id)
    if (error) {
      setToast(`Erro ao excluir: ${error.message}`)
      return
    }
    setToast('Contrato excluído.')
    reload()
  }

  async function gerarPagar(r: Financiamento) {
    const { data, error } = await supabase.rpc('fn_financiamento_gerar_pagar', {
      p_financiamento_id: r.id,
    })
    if (error) {
      setToast(`Erro: ${error.message}`)
      return
    }
    const d = data as { ok?: boolean; contas_geradas_ou_atualizadas?: number; erro?: string } | null
    if (d?.erro) {
      setToast(`Erro: ${d.erro}`)
      return
    }
    const n = d?.contas_geradas_ou_atualizadas ?? 0
    setToast(n > 0
      ? `${n} conta(s) a pagar gerada(s) ou atualizada(s).`
      : 'Nenhuma parcela em aberto · cadastre o cronograma primeiro.')
  }

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(id)
  }, [toast])

  if (!empresaUnica) {
    return (
      <div className="p-4 max-w-3xl mx-auto" style={{ color: ESPRESSO }}>
        <header className="mb-4">
          <h1 className="text-xl font-bold flex items-center gap-2">🏦 Financiamento</h1>
        </header>
        <div className="rounded-xl p-6 text-center" style={{ background: OFFWHITE }}>
          <p className="font-medium">Selecione uma empresa específica</p>
          <p className="text-sm opacity-70">Use o trocador da TopNav para escolher uma empresa.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-5xl mx-auto relative" style={{ color: ESPRESSO }}>
      <header className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">🏦 Financiamento</h1>
          <p className="text-sm opacity-70">Contratos de financiamento e empréstimo da empresa.</p>
        </div>
        <button
          onClick={() => setEditing(null)}
          style={{
            background: DOURADO, color: '#fff', border: 'none',
            borderRadius: 10, padding: '10px 16px', fontWeight: 600,
            cursor: 'pointer', minHeight: 44,
          }}
        >
          + Novo contrato
        </button>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-5">
        <KpiCard titulo="Contratos ativos" valor={String(kpis?.contratos_ativos ?? 0)} />
        <KpiCard titulo="Saldo de quitação" valor={brl(kpis?.saldo_quitacao)} destaque />
        <KpiCard titulo="Saldo em parcelas" valor={brl(kpis?.saldo_total_parcelas)} />
        <KpiCard titulo="Juros embutidos" valor={brl(kpis?.juros_embutidos)} />
        <KpiCard titulo="Compromisso mensal" valor={brl(kpis?.compromisso_mensal)} />
        <KpiCard titulo="Em carência" valor={String(kpis?.contratos_em_carencia ?? 0)} />
      </div>

      {loading && <p className="opacity-60">Carregando…</p>}

      {!loading && rows.length === 0 && (
        <div className="rounded-xl p-6 text-center" style={{ background: OFFWHITE }}>
          <p className="font-medium">Nenhum financiamento cadastrado</p>
          <p className="text-sm opacity-70">Clique em &ldquo;+ Novo contrato&rdquo; para começar.</p>
        </div>
      )}

      <div className="space-y-3">
        {rows.map((r) => {
          const restantes = r.parcelas_restantes ?? '—'
          const total = r.parcelas ?? '—'
          const taxa = r.taxa_anual != null ? `${r.taxa_anual}% a.a.` :
                       r.taxa_mensal != null ? `${r.taxa_mensal}% a.m.` : null
          return (
            <div key={r.id} className="rounded-xl border p-4" style={{ borderColor: BORDA, background: '#fff' }}>
              <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                <div className="font-semibold">{r.banco ?? '—'}</div>
                <div className="flex gap-1">
                  {r.em_carencia && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full"
                          style={{ background: '#FFF3D6', color: '#7A5A0F' }}>em carência</span>
                  )}
                  {r.situacao && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: OFFWHITE }}>{r.situacao}</span>
                  )}
                </div>
              </div>
              <div className="text-2xl font-bold mb-1" style={{ color: DOURADO }}>{brl(r.saldo_devedor)}</div>
              {r.saldo_total_parcelas != null && r.saldo_total_parcelas !== r.saldo_devedor && (
                <div className="text-xs opacity-70 mb-2">saldo em parcelas: {brl(r.saldo_total_parcelas)}</div>
              )}
              <div className="text-sm opacity-80 flex flex-wrap gap-x-4 gap-y-1">
                <span>Parcela {brl(r.valor_parcela)}</span>
                <span>{restantes}/{total} restantes</span>
                {taxa && <span>{taxa}</span>}
                {r.vencimento && <span>vence {r.vencimento}</span>}
              </div>
              {(r.operacao || r.tipo || r.contrato || r.garantia || r.data_origem) && (
                <div className="text-xs opacity-60 mt-2 flex flex-wrap gap-x-3">
                  {r.operacao && <span>{r.operacao}</span>}
                  {r.tipo && <span>· {r.tipo}</span>}
                  {r.contrato && <span>· contrato {r.contrato}</span>}
                  {r.garantia && <span>· garantia: {r.garantia}</span>}
                  {r.data_origem && <span>· desde {r.data_origem}</span>}
                </div>
              )}
              {r.observacao && (
                <div className="text-xs opacity-70 mt-2 pt-2 border-t" style={{ borderColor: BORDA }}>
                  {r.observacao}
                </div>
              )}
              <div className="flex gap-2 mt-3 flex-wrap">
                <button onClick={() => setEditing(r)} style={btnSec}>Editar</button>
                <button onClick={() => gerarPagar(r)} style={btnSec}>Gerar contas a pagar</button>
                <button onClick={() => excluir(r)} style={btnDanger}>Excluir</button>
              </div>
            </div>
          )
        })}
      </div>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
          background: ESPRESSO, color: '#fff', padding: '10px 16px',
          borderRadius: 10, fontSize: 13, zIndex: 60, maxWidth: '90vw',
        }}>
          {toast}
        </div>
      )}

      {editing !== undefined && empresaUnica && (
        <FinanciamentoFormModal
          companyId={empresaUnica}
          initial={editing ?? undefined}
          onClose={() => setEditing(undefined)}
          onSaved={() => { setEditing(undefined); reload() }}
        />
      )}
    </div>
  )
}

const btnSec: React.CSSProperties = {
  border: `1px solid ${BORDA}`,
  background: '#fff',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 12,
  cursor: 'pointer',
  minHeight: 36,
}
const btnDanger: React.CSSProperties = {
  border: '1px solid #E5C2C2',
  background: '#fff',
  color: '#9A1F1F',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 12,
  cursor: 'pointer',
  minHeight: 36,
}
