'use client'

// RD-41 · SPEC B — Relatório de Manutenções (financeiro/GE consulta). Custo/peças/lucro
// por OS entregue, congelado no snapshot da entrega. Custo da peça vem do PRODUTO de GE
// [→GE]; mão de obra = horas × custo-hora. Números por company_id (RLS). "estimado" ≠ real.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { supabase } from '@/lib/supabase'
import { Wrench, Download, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.6)', ESP40 = 'rgba(61,35,20,0.45)'
const OK = '#166534', RED = '#A32D2D', WHITE = '#FFFFFF'
const brl = (v: number | null | undefined) => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (v: number | null | undefined) => v == null ? '—' : `${Number(v).toFixed(1)}%`
const fmtData = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—'

type Linha = {
  id: string; numero: string | null; entregue_em: string | null; cliente_nome: string | null
  placa: string | null; veiculo: string | null; tecnico_nome: string | null
  receita: number | null; custo_pecas: number | null; custo_mo: number | null
  lucro: number | null; margem: number | null; aguardando: boolean
}
type Totais = { qtd: number; receita: number | null; custo_pecas: number; custo_mo: number; lucro: number | null; ticket_medio: number | null; margem_media: number | null; qtd_aguardando: number }
type Detalhe = { pecas: { descricao: string; quantidade: number; status: string; custo_unit: number; custo_total: number }[]; mao_obra: { horas: number; custo_hora: number | null; custo: number } }

export default function ManutencoesPage() {
  const { companyIds } = useCompanyIds()
  const companyId = companyIds[0] ?? null
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [totais, setTotais] = useState<Totais | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // filtros
  const [dataIni, setDataIni] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [placa, setPlaca] = useState('')
  const [mecanico, setMecanico] = useState('')
  const [cliente, setCliente] = useState('')  // filtro por nome (client-side)
  // drill
  const [expandido, setExpandido] = useState<string | null>(null)
  const [detalhe, setDetalhe] = useState<Record<string, Detalhe>>({})
  const [carregandoDet, setCarregandoDet] = useState(false)

  const carregar = useCallback(async () => {
    if (!companyId) return
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_manutencoes_relatorio', {
      p_company_id: companyId,
      p_cliente_id: null,
      p_data_ini: dataIni || null, p_data_fim: dataFim || null,
      p_placa: placa.trim() || null, p_mecanico: mecanico.trim() || null,
    })
    setLoading(false)
    const r = data as { ok?: boolean; erro?: string; linhas?: Linha[]; totais?: Totais } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha ao carregar'); return }
    setLinhas(r.linhas ?? [])
    setTotais(r.totais ?? null)
  }, [companyId, dataIni, dataFim, placa, mecanico])

  useEffect(() => { void carregar() }, [carregar])

  const abrirDetalhe = async (os: Linha) => {
    if (expandido === os.id) { setExpandido(null); return }
    setExpandido(os.id)
    if (!detalhe[os.id] && companyId) {
      setCarregandoDet(true)
      const { data } = await supabase.rpc('fn_manutencao_detalhe', { p_company_id: companyId, p_os_id: os.id })
      setCarregandoDet(false)
      const d = data as { ok?: boolean } & Detalhe | null
      if (d?.ok) setDetalhe((p) => ({ ...p, [os.id]: { pecas: d.pecas, mao_obra: d.mao_obra } }))
    }
  }

  // filtro cliente por nome (client-side) — evita carregar 600+ clientes num select
  const visiveis = useMemo(() => {
    const q = cliente.trim().toLowerCase()
    return q ? linhas.filter((l) => (l.cliente_nome ?? '').toLowerCase().includes(q)) : linhas
  }, [linhas, cliente])

  const exportarCSV = () => {
    const head = ['Data entrega', 'Cliente', 'Veículo', 'Placa', 'Mecânico', 'Receita', 'Custo peças', 'Custo mão de obra', 'Lucro', 'Margem %', 'Origem']
    const linhasCsv = visiveis.map((l) => [
      fmtData(l.entregue_em), l.cliente_nome ?? '', l.veiculo ?? '', l.placa ?? '', l.tecnico_nome ?? '',
      l.receita ?? '', l.custo_pecas ?? '', l.custo_mo ?? '', l.lucro ?? '', l.margem ?? '',
      l.aguardando ? 'aguardando faturamento' : 'faturado',
    ])
    const csv = [head, ...linhasCsv].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `manutencoes_${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  if (!companyId) return <div style={{ padding: 24, color: ESP60, background: BG, minHeight: '100vh' }}>Selecione uma empresa específica no topo para ver as manutenções.</div>

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px 48px', maxWidth: 1100, margin: '0 auto', color: ESP }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>Financeiro · Gestão da mecânica</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0', display: 'inline-flex', alignItems: 'center', gap: 8 }}><Wrench size={22} color={GOLD} /> Manutenções</h1>
        </div>
        <button onClick={exportarCSV} disabled={visiveis.length === 0}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 8, border: `1px solid ${LINE}`, background: WHITE, color: ESP, fontWeight: 700, fontSize: 13, cursor: visiveis.length ? 'pointer' : 'not-allowed', opacity: visiveis.length ? 1 : 0.5 }}>
          <Download size={15} /> Exportar CSV
        </button>
      </div>
      <p style={{ color: ESP60, fontSize: 13, marginTop: 6, marginBottom: 16 }}>Custo da peça vem do produto (Estoque/GE); mão de obra = horas × custo-hora. Lucro congelado na entrega.</p>

      {/* Filtros */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 14 }}>
        <Campo l="De (entrega)"><input type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} style={inp} /></Campo>
        <Campo l="Até"><input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} style={inp} /></Campo>
        <Campo l="Cliente"><input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="nome…" style={inp} /></Campo>
        <Campo l="Placa"><input value={placa} onChange={(e) => setPlaca(e.target.value)} placeholder="ABC…" style={inp} /></Campo>
        <Campo l="Mecânico"><input value={mecanico} onChange={(e) => setMecanico(e.target.value)} placeholder="nome…" style={inp} /></Campo>
      </div>

      {/* Totais do período */}
      {totais && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
          <Tot l="OS entregues" v={String(totais.qtd)} />
          <Tot l="Receita" v={brl(totais.receita)} />
          <Tot l="Custo (peças+MO)" v={brl((totais.custo_pecas ?? 0) + (totais.custo_mo ?? 0))} />
          <Tot l="Lucro" v={brl(totais.lucro)} cor={Number(totais.lucro) >= 0 ? OK : RED} />
          <Tot l="Margem média" v={pct(totais.margem_media)} />
          <Tot l="Ticket médio" v={brl(totais.ticket_medio)} />
        </div>
      )}
      {totais && totais.qtd_aguardando > 0 && (
        <div style={{ fontSize: 12, color: '#1D4671', background: '#E5EEF8', border: '1px solid #3D6FA8', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
          ℹ️ <b>Receita e lucro aguardam o faturamento pela OS</b> (previsto após a validação do GE). Os <b>custos</b> (peças e mão de obra) já refletem o real.
          {' '}{totais.qtd_aguardando} de {totais.qtd} sem faturamento vinculado.
        </div>
      )}

      {erro && <div style={{ background: '#FCEBEB', color: '#791F1F', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{erro}</div>}

      {/* Lista */}
      {loading ? (
        <div style={{ color: ESP60, fontSize: 13, padding: 20, textAlign: 'center' }}>Carregando…</div>
      ) : visiveis.length === 0 ? (
        <div style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 12, padding: '30px 16px', textAlign: 'center', color: ESP60 }}>
          Nenhuma manutenção entregue no filtro. Ajuste o período ou os filtros.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visiveis.map((l) => {
            const est = l.aguardando
            const aberto = expandido === l.id
            return (
              <div key={l.id} style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 10, overflow: 'hidden' }}>
                <button onClick={() => void abrirDetalhe(l)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '12px 14px', display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) repeat(4, minmax(0,1fr)) auto', gap: 10, alignItems: 'center' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: ESP, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {l.placa || 'sem placa'}
                      {est && <span title="Sem faturamento vinculado à OS ainda" style={{ fontSize: 9.5, fontWeight: 700, color: '#1D4671', background: '#E5EEF8', borderRadius: 4, padding: '1px 5px' }}>aguardando faturamento</span>}
                    </div>
                    <div style={{ fontSize: 12, color: ESP60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fmtData(l.entregue_em)} · {l.cliente_nome || '—'}{l.veiculo ? ` · ${l.veiculo}` : ''}</div>
                  </div>
                  <Cel l="Receita" v={brl(l.receita)} />
                  <Cel l="Custo peças" v={brl(l.custo_pecas)} />
                  <Cel l="Mão de obra" v={brl(l.custo_mo)} />
                  <Cel l="Lucro" v={brl(l.lucro)} sub={pct(l.margem)} cor={Number(l.lucro) >= 0 ? OK : RED} />
                  <span style={{ color: ESP40 }}>{aberto ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</span>
                </button>

                {aberto && (
                  <div style={{ borderTop: `1px solid ${LINE}`, background: BG, padding: '12px 14px' }}>
                    {carregandoDet && !detalhe[l.id] ? (
                      <div style={{ color: ESP60, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Loader2 size={14} className="animate-spin" /> Carregando detalhe…</div>
                    ) : detalhe[l.id] ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
                        <div>
                          <div style={secTit}>Peças (custo do produto · GE)</div>
                          {detalhe[l.id].pecas.length === 0 ? <div style={{ fontSize: 12, color: ESP60 }}>Nenhuma peça com custo nesta OS.</div> : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                              <tbody>
                                {detalhe[l.id].pecas.map((p, i) => (
                                  <tr key={i} style={{ borderBottom: `0.5px solid ${LINE}` }}>
                                    <td style={{ padding: '5px 4px', color: ESP }}>{Number(p.quantidade)}× {p.descricao}</td>
                                    <td style={{ padding: '5px 4px', textAlign: 'right', color: ESP60 }}>{brl(p.custo_unit)} un.</td>
                                    <td style={{ padding: '5px 4px', textAlign: 'right', fontWeight: 700, color: ESP }}>{brl(p.custo_total)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                        <div>
                          <div style={secTit}>Mão de obra</div>
                          <div style={{ fontSize: 13, color: ESP }}>
                            {Number(detalhe[l.id].mao_obra.horas).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}h × {detalhe[l.id].mao_obra.custo_hora != null ? brl(detalhe[l.id].mao_obra.custo_hora) + '/h' : 'custo-hora indisponível'}
                            <div style={{ fontWeight: 700, marginTop: 4 }}>= {brl(detalhe[l.id].mao_obra.custo)}</div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const inp: React.CSSProperties = { width: '100%', padding: '9px 11px', fontSize: 13, borderRadius: 8, border: `1px solid ${LINE}`, background: WHITE, color: ESP, boxSizing: 'border-box' }
const secTit: React.CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: GOLD, fontWeight: 700, marginBottom: 6 }
function Campo({ l, children }: { l: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><span style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 3 }}>{l}</span>{children}</label>
}
function Tot({ l, v, cor }: { l: string; v: string; cor?: string }) {
  return (
    <div style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: ESP40, fontWeight: 600 }}>{l}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: cor ?? ESP, marginTop: 3, lineHeight: 1.2 }}>{v}</div>
    </div>
  )
}
function Cel({ l, v, sub, cor }: { l: string; v: string; sub?: string; cor?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.3, color: ESP40, fontWeight: 600 }}>{l}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: cor ?? ESP, fontVariantNumeric: 'tabular-nums' }}>{v}{sub ? <span style={{ fontSize: 10.5, fontWeight: 600, color: ESP60 }}> · {sub}</span> : ''}</div>
    </div>
  )
}
