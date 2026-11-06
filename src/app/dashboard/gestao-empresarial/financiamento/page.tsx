'use client'
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import FinanciamentoFormModal from '@/components/financiamento/FinanciamentoFormModal'
import FinanciamentoDetalhe from '@/components/financiamento/FinanciamentoDetalhe'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

type Financiamento = Record<string, unknown> & {
  id: string
  banco: string | null
  contrato: string | null
  tipo_operacao: string | null
  saldo_devedor: number | null
  saldo_total_parcelas: number | null
  valor_parcela: number | null
  parcelas: number | null
  parcelas_restantes: number | null
  taxa_mensal: number | null
  taxa_anual: number | null
  vencimento: string | null
  situacao: string | null
  em_carencia: boolean | null
  status: string | null
  arquivado_em?: string | null
  excluido_em?: string | null
  excluido_motivo?: string | null
  quitado_em?: string | null
}

// Situação do contrato na tela (Tryo Gesso via CEO 28/10): em andamento · vencido · quitado · arquivado · excluído.
type Filtro = 'andamento' | 'vencidos' | 'quitados' | 'arquivados' | 'excluidos'
const hojeISO = () => new Date().toISOString().slice(0, 10)
// vencimento vem como texto DD/MM/AAAA (ou AAAA-MM-DD); devolve AAAA-MM-DD ou null
function vencFinal(v: string | null): string | null {
  if (!v) return null
  const t = v.trim()
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null
}
function situacaoDe(r: Financiamento): Filtro {
  const st = (r.status ?? 'ativo').toLowerCase()
  if (r.excluido_em || st === 'cancelado') return 'excluidos'
  if (st === 'encerrado') return 'arquivados'
  if (st === 'quitado' || st === 'liquidado') return 'quitados'
  const vf = vencFinal(r.vencimento)
  if ((vf && vf < hojeISO()) || r.parcelas_restantes === 0) return 'vencidos'
  return 'andamento'
}
const FILTROS: { k: Filtro; l: string }[] = [
  { k: 'andamento', l: 'Em andamento' }, { k: 'vencidos', l: 'Vencidos' }, { k: 'quitados', l: 'Quitados' },
  { k: 'arquivados', l: 'Arquivados' }, { k: 'excluidos', l: 'Excluídos' },
]
type Acao = { tipo: 'arquivar' | 'quitar' | 'excluir'; alvos: Financiamento[] }

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

type Aba = 'contratos' | 'visao' | 'cronograma'
type Editing = undefined | null | Financiamento

type Parcela = {
  id: string
  financiamento_id: string
  numero: number
  data_vencimento: string
  valor_parcela: number | null
  amortizacao: number | null
  juros: number | null
  saldo_apos: number | null
  status: string | null
}

function KpiCard({ titulo, valor, destaque }: { titulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="rounded-xl p-3" style={{ background: OFFWHITE, minHeight: 76 }}>
      <div className="text-[11px] uppercase opacity-60 leading-tight">{titulo}</div>
      <div className="font-bold leading-tight" style={{ color: destaque ? DOURADO : ESPRESSO }}>{valor}</div>
    </div>
  )
}

export default function FinanciamentoPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [aba, setAba] = useState<Aba>('contratos')
  const [rows, setRows] = useState<Financiamento[]>([])
  const [kpis, setKpis] = useState<Kpis | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Editing>(undefined)
  const [viewing, setViewing] = useState<Financiamento | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [parcelas, setParcelas] = useState<Parcela[]>([])
  const [parcelasLoading, setParcelasLoading] = useState(false)
  const [contratoFiltro, setContratoFiltro] = useState<string>('todos')
  const [statusFiltro, setStatusFiltro] = useState<'todas' | 'pagas' | 'a_vencer'>('todas')
  const [filtro, setFiltro] = useState<Filtro>('andamento')
  const [acao, setAcao] = useState<Acao | null>(null)

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

  const reloadParcelas = useCallback(async () => {
    if (!empresaUnica) { setParcelas([]); return }
    setParcelasLoading(true)
    const { data } = await supabase
      .from('financiamento_parcelas')
      .select('id, financiamento_id, numero, data_vencimento, valor_parcela, amortizacao, juros, saldo_apos, status')
      .eq('company_id', empresaUnica)
      .order('financiamento_id')
      .order('numero')
    setParcelas((data ?? []) as Parcela[])
    setParcelasLoading(false)
  }, [empresaUnica])
  useEffect(() => { reloadParcelas() }, [reloadParcelas])

  async function recalcular(r: Financiamento) {
    const { error } = await supabase.rpc('fn_financiamento_recalcular', { p_id: r.id })
    if (error) { setToast(`Erro: ${error.message}`); return }
    setToast('Financiamento recalculado.')
    reload(); reloadParcelas()
  }
  async function gerarCronograma(r: Financiamento) {
    const { error } = await supabase.rpc('fn_financiamento_gerar_cronograma', { p_id: r.id })
    if (error) { setToast(`Erro: ${error.message}`); return }
    setToast('Cronograma gerado.')
    reload(); reloadParcelas()
  }

  // Arquivar · quitar · excluir (com rastro) · desfazer — tudo pela fn_financiamento_situacao (nada é apagado de vez).
  async function aplicar(alvos: Financiamento[], tipo: string, motivo?: string, data?: string) {
    let ok = 0; let abertas = 0; let erro: string | null = null
    for (const r of alvos) {
      const { data: res, error } = await supabase.rpc('fn_financiamento_situacao', { p_id: r.id, p_acao: tipo, p_motivo: motivo ?? null, p_data: data ?? null })
      const j = res as { ok?: boolean; erro?: string; contas_pagar_abertas?: number } | null
      if (error || !j?.ok) { erro = error?.message ?? (j?.erro === 'motivo_obrigatorio' ? 'informe o motivo' : j?.erro ?? 'falhou'); continue }
      ok++; abertas += j.contas_pagar_abertas ?? 0
    }
    const rot: Record<string, string> = { arquivar: 'arquivado(s)', desarquivar: 'desarquivado(s)', quitar: 'marcado(s) como quitado(s)', reabrir: 'reaberto(s)', excluir: 'excluído(s) — dá para restaurar em Excluídos', restaurar: 'restaurado(s)' }
    setToast(erro && ok === 0 ? `Erro: ${erro}` : `${ok} contrato(s) ${rot[tipo] ?? tipo}.${abertas > 0 ? ` Atenção: ${abertas} conta(s) a pagar em aberto deste(s) contrato(s) continuam no financeiro.` : ''}${erro ? ` (${erro})` : ''}`)
    setAcao(null); setViewing(null); reload()
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
      : 'Nenhuma parcela em aberto · cadastre o cronograma primeiro (F3).')
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
          <p className="text-sm opacity-70">Contratos de financiamento, empréstimo e consórcio.</p>
        </div>
        {aba === 'contratos' && (
          <button onClick={() => setEditing(null)} style={btnNovo}>+ Novo contrato</button>
        )}
      </header>

      <nav style={tabBar}>
        <button onClick={() => setAba('contratos')} style={tab(aba === 'contratos')}>Contratos</button>
        <button onClick={() => setAba('visao')} style={tab(aba === 'visao')}>Visão Geral</button>
        <button onClick={() => setAba('cronograma')} style={tab(aba === 'cronograma')}>Cronograma</button>
      </nav>

      {aba === 'contratos' && (
        <>
          <div className="text-[11px] uppercase opacity-60 mb-1 flex items-center">Indicadores (só contratos em andamento)<AjudaCampo chave="ge.financiamento.kpis" /></div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-5">
            <KpiCard titulo="Contratos ativos" valor={String(kpis?.contratos_ativos ?? 0)} />
            <KpiCard titulo="Saldo de quitação" valor={brl(kpis?.saldo_quitacao)} destaque />
            <KpiCard titulo="Saldo em parcelas" valor={brl(kpis?.saldo_total_parcelas)} />
            <KpiCard titulo="Juros embutidos" valor={brl(kpis?.juros_embutidos)} />
            <KpiCard titulo="Compromisso mensal" valor={brl(kpis?.compromisso_mensal)} />
            <KpiCard titulo="Em carência" valor={String(kpis?.contratos_em_carencia ?? 0)} />
          </div>

          {loading && <p className="opacity-60">Carregando…</p>}

          {(() => {
            const cont = Object.fromEntries(FILTROS.map((f) => [f.k, rows.filter((r) => situacaoDe(r) === f.k).length])) as Record<Filtro, number>
            const vencidos = rows.filter((r) => situacaoDe(r) === 'vencidos')
            return (
              <div className="flex gap-2 flex-wrap items-center mb-3" data-testid="fin-filtros">
                {FILTROS.map((f) => (
                  <button key={f.k} onClick={() => setFiltro(f.k)} style={chipSt(filtro === f.k)} data-testid={`fin-filtro-${f.k}`}>
                    {f.l} · {cont[f.k] ?? 0}
                  </button>
                ))}
                <AjudaCampo chave="ge.financiamento.filtro" />
                {filtro === 'vencidos' && vencidos.length > 0 && (
                  <button onClick={() => setAcao({ tipo: 'arquivar', alvos: vencidos })} style={{ ...btnSec, marginLeft: 'auto' }} data-testid="fin-arquivar-vencidos">
                    Arquivar os {vencidos.length} vencidos
                  </button>
                )}
              </div>
            )
          })()}

          {!loading && rows.length === 0 && (
            <div className="rounded-xl p-6 text-center" style={{ background: OFFWHITE }}>
              <p className="font-medium">Nenhum financiamento cadastrado</p>
              <p className="text-sm opacity-70">Clique em &ldquo;+ Novo contrato&rdquo; para começar.</p>
            </div>
          )}

          <div className="space-y-3">
            {!loading && rows.length > 0 && rows.filter((r) => situacaoDe(r) === filtro).length === 0 && (
              <div className="rounded-xl p-5 text-center text-sm opacity-70" style={{ background: OFFWHITE }}>Nenhum contrato nesta situação.</div>
            )}
            {rows.filter((r) => situacaoDe(r) === filtro).map((r) => {
              const sit = situacaoDe(r)
              const restantes = r.parcelas_restantes ?? '—'
              const total = r.parcelas ?? '—'
              const taxa = r.taxa_anual != null ? `${r.taxa_anual}% a.a.` :
                           r.taxa_mensal != null ? `${r.taxa_mensal}% a.m.` : null
              return (
                <div
                  key={r.id}
                  className="rounded-xl border p-4 cursor-pointer"
                  style={{ borderColor: BORDA, background: '#fff' }}
                  onClick={() => setViewing(r)}
                >
                  <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                    <div className="font-semibold">
                      {r.banco ?? '—'}
                      {r.contrato && (
                        <span className="ml-2 font-normal" style={{ color: '#6b5444' }}>
                          · Contrato {r.contrato}
                        </span>
                      )}
                      {r.tipo_operacao && r.tipo_operacao !== 'financiamento' && (
                        <span className="text-[11px] ml-2 opacity-60">{r.tipo_operacao}</span>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {r.em_carencia && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full"
                              style={{ background: '#FFF3D6', color: '#7A5A0F' }}>em carência</span>
                      )}
                      {sit === 'vencidos' ? (
                        <span className="text-[11px] px-2 py-0.5 rounded-full inline-flex items-center" style={{ background: '#FBE3E0', color: '#9A1F1F', fontWeight: 600 }}>vencido<AjudaCampo chave="ge.financiamento.vencido" /></span>
                      ) : sit === 'quitados' ? (
                        <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: '#DCEFD7', color: '#2F5A1F', fontWeight: 600 }}>quitado{r.quitado_em ? ` em ${r.quitado_em.split('-').reverse().join('/')}` : ''}</span>
                      ) : sit === 'arquivados' ? (
                        <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: '#EEE9E2' }}>arquivado</span>
                      ) : sit === 'excluidos' ? (
                        <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: '#F4D6D6', color: '#7A1F1F' }} title={r.excluido_motivo ?? ''}>excluído{r.excluido_motivo ? ` · ${r.excluido_motivo}` : ''}</span>
                      ) : r.situacao ? (
                        <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: OFFWHITE }}>{r.situacao}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
                    <div>
                      <div className="text-[11px] uppercase opacity-60 leading-tight">Saldo de quitação (principal)</div>
                      <div className="text-xl font-bold leading-tight" style={{ color: DOURADO }}>{brl(r.saldo_devedor)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase opacity-60 leading-tight">Saldo em parcelas (c/ juros)</div>
                      <div className="text-xl font-bold leading-tight" style={{ color: ESPRESSO }}>{brl(r.saldo_total_parcelas)}</div>
                    </div>
                  </div>
                  <div className="text-sm opacity-80 flex flex-wrap gap-x-4 gap-y-1">
                    <span>Parcela {brl(r.valor_parcela)}</span>
                    <span>{restantes}/{total} restantes</span>
                    {taxa && <span>{taxa}</span>}
                    {r.vencimento && <span>vence {r.vencimento}</span>}
                  </div>
                  <div
                    className="flex gap-2 mt-3 flex-wrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {sit === 'excluidos' ? (
                      <button onClick={() => void aplicar([r], 'restaurar')} style={btnSec} data-testid="fin-restaurar">Restaurar</button>
                    ) : (
                      <>
                        <button onClick={() => setEditing(r)} style={btnSec} data-testid="fin-editar">Editar</button>
                        {(sit === 'andamento' || sit === 'vencidos') && (
                          <>
                            <button onClick={() => recalcular(r)} style={btnSec}>Recalcular</button>
                            <button onClick={() => gerarCronograma(r)} style={btnSec}>Gerar cronograma</button>
                            <button onClick={() => gerarPagar(r)} style={btnSec}>Gerar contas a pagar</button>
                            <button onClick={() => setAcao({ tipo: 'quitar', alvos: [r] })} style={btnSec} data-testid="fin-quitar">Marcar como quitado</button>
                          </>
                        )}
                        {sit === 'quitados' && <button onClick={() => void aplicar([r], 'reabrir')} style={btnSec}>Reabrir</button>}
                        {sit === 'arquivados'
                          ? <button onClick={() => void aplicar([r], 'desarquivar')} style={btnSec} data-testid="fin-desarquivar">Desarquivar</button>
                          : <button onClick={() => setAcao({ tipo: 'arquivar', alvos: [r] })} style={btnSec} data-testid="fin-arquivar">Arquivar</button>}
                        <button onClick={() => setAcao({ tipo: 'excluir', alvos: [r] })} style={btnDanger} data-testid="fin-excluir">Excluir</button>
                      </>
                    )}
                    <AjudaCampo chave="ge.financiamento.acoes" />
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {aba === 'visao' && (
        <VisaoGeral parcelas={parcelas} loading={parcelasLoading} kpis={kpis} />
      )}

      {aba === 'cronograma' && (
        <Cronograma
          parcelas={parcelas}
          loading={parcelasLoading}
          contratos={rows}
          contratoFiltro={contratoFiltro}
          setContratoFiltro={setContratoFiltro}
          statusFiltro={statusFiltro}
          setStatusFiltro={setStatusFiltro}
        />
      )}

      {toast && (
        <div style={toastStyle}>{toast}</div>
      )}

      {acao && <AcaoModal acao={acao} onClose={() => setAcao(null)} onConfirmar={(motivo, data) => void aplicar(acao.alvos, acao.tipo, motivo, data)} />}

      {viewing && (
        <FinanciamentoDetalhe
          row={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => { setEditing(viewing); setViewing(null) }}
          onGerarPagar={() => gerarPagar(viewing)}
        />
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

const tabBar: CSSProperties = {
  display: 'flex',
  gap: 4,
  marginBottom: 16,
  borderBottom: `1px solid ${BORDA}`,
}

function tab(active: boolean): CSSProperties {
  return {
    border: 'none',
    background: 'none',
    padding: '10px 16px',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: active ? 600 : 400,
    color: active ? DOURADO : ESPRESSO,
    borderBottom: active ? `2px solid ${DOURADO}` : '2px solid transparent',
    marginBottom: -1,
    minHeight: 44,
  }
}

const btnNovo: CSSProperties = {
  background: DOURADO,
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  padding: '10px 16px',
  fontWeight: 600,
  cursor: 'pointer',
  minHeight: 44,
}
const btnSec: CSSProperties = {
  border: `1px solid ${BORDA}`,
  background: '#fff',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 12,
  cursor: 'pointer',
  minHeight: 36,
}
const btnDanger: CSSProperties = {
  border: '1px solid #E5C2C2',
  background: '#fff',
  color: '#9A1F1F',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 12,
  cursor: 'pointer',
  minHeight: 36,
}
const toastStyle: CSSProperties = {
  position: 'fixed',
  bottom: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  background: ESPRESSO,
  color: '#fff',
  padding: '10px 16px',
  borderRadius: 10,
  fontSize: 13,
  zIndex: 60,
  maxWidth: '90vw',
}

// ─── VISÃO GERAL ─────────────────────────────────────────────
function VisaoGeral({ parcelas, loading, kpis }: { parcelas: Parcela[]; loading: boolean; kpis: Kpis | null }) {
  if (loading) return <p className="opacity-60">Carregando…</p>
  if (parcelas.length === 0) {
    return (
      <div className="rounded-xl p-6 text-center" style={{ background: OFFWHITE }}>
        <p className="font-medium">Visão Geral</p>
        <p className="text-sm opacity-70">Disponível quando houver cronograma — clique em &ldquo;Gerar cronograma&rdquo; no contrato.</p>
      </div>
    )
  }
  const amortizadoTotal = parcelas.filter((p) => p.status === 'paga').reduce((s, p) => s + Number(p.amortizacao ?? 0), 0)
  const pct = parcelas.length > 0 ? (parcelas.filter((p) => p.status === 'paga').length / parcelas.length) * 100 : 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KpiCard titulo="Saldo de quitação" valor={brl(kpis?.saldo_quitacao)} destaque />
        <KpiCard titulo="Saldo em parcelas" valor={brl(kpis?.saldo_total_parcelas)} />
        <KpiCard titulo="Juros embutidos" valor={brl(kpis?.juros_embutidos)} />
        <KpiCard titulo="Compromisso mensal" valor={brl(kpis?.compromisso_mensal)} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-2 gap-2">
        <KpiCard titulo="Amortizado" valor={brl(amortizadoTotal)} />
        <KpiCard titulo="% quitado" valor={`${pct.toFixed(1)}%`} />
      </div>
      <SaldoChart parcelas={parcelas} />
    </div>
  )
}

function SaldoChart({ parcelas }: { parcelas: Parcela[] }) {
  // Soma saldo_apos por numero (se multi-contrato, soma todos)
  const porNumero = new Map<number, number>()
  for (const p of parcelas) {
    porNumero.set(p.numero, (porNumero.get(p.numero) ?? 0) + Number(p.saldo_apos ?? 0))
  }
  const pontos = Array.from(porNumero.entries()).sort((a, b) => a[0] - b[0])
  if (pontos.length === 0) return null
  const W = 600, H = 160, P = 20
  const maxY = Math.max(...pontos.map(([, v]) => v))
  const maxX = pontos.length > 1 ? pontos[pontos.length - 1][0] : 1
  const polyline = pontos.map(([n, v], i) => {
    const x = P + ((pontos.length === 1 ? 0 : i / (pontos.length - 1))) * (W - 2 * P)
    const y = H - P - (maxY > 0 ? (v / maxY) * (H - 2 * P) : 0)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <div className="rounded-xl p-4" style={{ background: '#fff', border: `1px solid ${BORDA}` }}>
      <div className="text-sm font-semibold mb-2" style={{ color: ESPRESSO }}>Evolução do saldo devedor</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 200 }} preserveAspectRatio="none">
        <polyline points={polyline} fill="none" stroke={DOURADO} strokeWidth="2" />
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke={BORDA} />
      </svg>
      <div className="flex justify-between text-[11px] opacity-60 mt-1">
        <span>parcela 1</span>
        <span>parcela {maxX}</span>
      </div>
    </div>
  )
}

// ─── CRONOGRAMA ──────────────────────────────────────────────
function Cronograma({
  parcelas, loading, contratos, contratoFiltro, setContratoFiltro, statusFiltro, setStatusFiltro,
}: {
  parcelas: Parcela[]; loading: boolean;
  contratos: Financiamento[];
  contratoFiltro: string; setContratoFiltro: (v: string) => void;
  statusFiltro: 'todas' | 'pagas' | 'a_vencer'; setStatusFiltro: (v: 'todas' | 'pagas' | 'a_vencer') => void;
}) {
  if (loading) return <p className="opacity-60">Carregando…</p>
  if (parcelas.length === 0) {
    return (
      <div className="rounded-xl p-6 text-center" style={{ background: OFFWHITE }}>
        <p className="font-medium">Cronograma</p>
        <p className="text-sm opacity-70">Disponível quando houver cronograma — clique em &ldquo;Gerar cronograma&rdquo; no contrato.</p>
      </div>
    )
  }
  const hoje = new Date().toISOString().slice(0, 10)
  const filtradas = parcelas.filter((p) => {
    if (contratoFiltro !== 'todos' && p.financiamento_id !== contratoFiltro) return false
    if (statusFiltro === 'pagas' && p.status !== 'paga') return false
    if (statusFiltro === 'a_vencer' && p.status === 'paga') return false
    return true
  })
  const nomeContrato = (id: string) => {
    const c = contratos.find((x) => x.id === id)
    if (!c) return id.slice(0, 8)
    const banco = c.banco ?? ''
    const contrato = c.contrato ?? ''
    if (banco && contrato) return `${banco} · Contrato ${contrato}`
    return (banco || contrato).trim() || id.slice(0, 8)
  }
  const multi = contratoFiltro === 'todos' && new Set(parcelas.map((p) => p.financiamento_id)).size > 1

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center">
        <select value={contratoFiltro} onChange={(e) => setContratoFiltro(e.target.value)} style={selSt}>
          <option value="todos">Todos os contratos</option>
          {contratos.map((c) => <option key={c.id} value={c.id}>{nomeContrato(c.id)}</option>)}
        </select>
        <div className="flex gap-1">
          {(['todas', 'pagas', 'a_vencer'] as const).map((s) => (
            <button key={s} onClick={() => setStatusFiltro(s)} style={chipSt(statusFiltro === s)}>
              {s === 'todas' ? 'Todas' : s === 'pagas' ? 'Pagas' : 'A vencer'}
            </button>
          ))}
        </div>
        <span className="text-xs opacity-60 ml-auto">{filtradas.length} parcela(s)</span>
      </div>
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: BORDA, background: '#fff' }}>
        <table className="w-full text-sm">
          <thead className="text-xs" style={{ background: OFFWHITE }}>
            <tr>
              {multi && <th className="text-left p-2">Contrato</th>}
              <th className="text-left p-2">Nº</th>
              <th className="text-left p-2">Vencimento</th>
              <th className="text-right p-2">Parcela</th>
              <th className="text-right p-2">Juros</th>
              <th className="text-right p-2">Amortização</th>
              <th className="text-right p-2">Saldo devedor</th>
              <th className="text-center p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((p) => {
              const venc = p.data_vencimento ?? ''
              const paga = p.status === 'paga'
              const atrasada = !paga && venc && venc < hoje
              return (
                <tr key={p.id} style={{ borderTop: `1px solid ${BORDA}` }}>
                  {multi && <td className="p-2 text-xs opacity-70">{nomeContrato(p.financiamento_id)}</td>}
                  <td className="p-2">{p.numero}</td>
                  <td className="p-2">{venc}</td>
                  <td className="p-2 text-right">{brl(Number(p.valor_parcela))}</td>
                  <td className="p-2 text-right opacity-80">{brl(Number(p.juros))}</td>
                  <td className="p-2 text-right opacity-80">{brl(Number(p.amortizacao))}</td>
                  <td className="p-2 text-right">{brl(Number(p.saldo_apos))}</td>
                  <td className="p-2 text-center">
                    <span style={{ fontSize: 11, color: paga ? '#3F8D3F' : atrasada ? '#C44536' : ESPRESSO, fontWeight: 600 }}>
                      {paga ? '🟢 paga' : atrasada ? '🔴 atrasada' : 'aberta'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const selSt: CSSProperties = {
  border: `1px solid ${BORDA}`, background: '#fff', borderRadius: 8, padding: '6px 10px',
  fontSize: 12, color: ESPRESSO, colorScheme: 'light' as CSSProperties['colorScheme'],
}
function chipSt(active: boolean): CSSProperties {
  return {
    border: `1px solid ${active ? DOURADO : BORDA}`,
    background: active ? DOURADO : '#fff',
    color: active ? '#fff' : ESPRESSO,
    borderRadius: 999, padding: '4px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
  }
}

// ─── Confirmar arquivar · quitar · excluir ───────────────────
function AcaoModal({ acao, onClose, onConfirmar }: { acao: Acao; onClose: () => void; onConfirmar: (motivo?: string, data?: string) => void }) {
  const [motivo, setMotivo] = useState('')
  const [data, setData] = useState(hojeISO())
  const [busy, setBusy] = useState(false)
  const n = acao.alvos.length
  const nome = n === 1 ? `${acao.alvos[0].banco ?? ''} ${acao.alvos[0].contrato ? '· ' + acao.alvos[0].contrato : ''}`.trim() : `${n} contratos`
  const titulo = acao.tipo === 'arquivar' ? `Arquivar ${nome}` : acao.tipo === 'quitar' ? `Marcar ${nome} como quitado` : `Excluir ${nome}`
  const texto = acao.tipo === 'arquivar'
    ? 'O contrato sai dos indicadores e da lista principal e vai para Arquivados. O cronograma e o histórico ficam guardados; dá para desarquivar quando quiser.'
    : acao.tipo === 'quitar'
      ? 'O contrato vai para Quitados e sai do saldo devedor e do compromisso mensal. Dá para reabrir.'
      : 'O contrato vai para Excluídos com o motivo, quem excluiu e quando. Nada é apagado de vez: dá para restaurar.'
  const exigeMotivo = acao.tipo === 'excluir'
  const pronto = !busy && (!exigeMotivo || motivo.trim().length > 0) && (acao.tipo !== 'quitar' || !!data)
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 20, width: '100%', maxWidth: 460, color: ESPRESSO }} onClick={(e) => e.stopPropagation()} data-testid="fin-acao-modal">
        <h2 className="text-lg font-bold mb-2 flex items-center">{titulo}<AjudaCampo chave={`ge.financiamento.${acao.tipo}`} /></h2>
        <p className="text-sm opacity-80 mb-3">{texto}</p>
        {acao.tipo === 'quitar' && (
          <label className="block mb-3 text-sm"><span className="font-semibold flex items-center">Data da quitação<AjudaCampo chave="ge.financiamento.quitar" /></span>
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={{ ...selSt, width: '100%', marginTop: 4, padding: '8px 10px' }} data-testid="fin-quitar-data" />
          </label>
        )}
        {acao.tipo !== 'quitar' && (
          <label className="block mb-3 text-sm"><span className="font-semibold flex items-center">Motivo{exigeMotivo ? ' *' : ' (opcional)'}<AjudaCampo chave={`ge.financiamento.${acao.tipo}`} /></span>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={exigeMotivo ? 'Ex.: lançado em duplicidade' : 'Ex.: contrato terminou em julho'} style={{ ...selSt, width: '100%', marginTop: 4, padding: '8px 10px' }} data-testid="fin-acao-motivo" />
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} style={btnSec}>Cancelar</button>
          <button disabled={!pronto} onClick={() => { setBusy(true); onConfirmar(motivo.trim() || undefined, acao.tipo === 'quitar' ? data : undefined) }}
            style={{ ...(acao.tipo === 'excluir' ? btnDanger : btnNovo), opacity: pronto ? 1 : 0.5, minHeight: 40 }} data-testid="fin-acao-confirmar">
            {busy ? 'Salvando…' : acao.tipo === 'arquivar' ? 'Arquivar' : acao.tipo === 'quitar' ? 'Marcar como quitado' : 'Excluir'}
          </button>
        </div>
      </div>
    </div>
  )
}
