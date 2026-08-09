'use client'
// SPEC · Rentabilidade por dentista & cadeira — o grão final do moat. Cruza agendamento CONCLUÍDO ×
// receita (procedimento.valor) × custo (material C1 + estrutura C2) → lucro/margem por profissional ou
// cadeira. Read-only via fn_odonto_rentabilidade. RD-51: procedimento sem custeio → "parcial". [→GE] DRE.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ShellOdonto, PageHeaderOdonto, CardOdonto, EmptyStateOdonto, MetricStat, TOK } from '@/components/odonto/ui'
import { TrendingUp, User, Armchair, AlertTriangle } from 'lucide-react'

const brl = (n: number) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
function corMargem(pct: number | null): string { if (pct === null) return TOK.mut; if (pct < 0) return TOK.red; if (pct < 25) return '#B45309'; return TOK.green }

type Linha = { nome: string; receita: number; custo: number; material: number; mo: number; fixo: number; lucro: number; margem_pct: number | null; n_proc: number; horas: number; lucro_hora: number | null; parcial_qtd: number }
type Totais = { receita: number; custo: number; lucro: number; material: number; mo: number; fixo: number; n_proc: number; horas: number; parcial_qtd: number; margem_pct: number | null }
type Resp = { ok?: boolean; dim: string; custo_hora: number | null; linhas: Linha[]; totais: Totais }

function useCompanyId(): string | null {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => { if (typeof window === 'undefined') return null; const v = localStorage.getItem('ps_empresa_sel'); return (!v || v === 'consolidado' || v.startsWith('group_')) ? null : v }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setId(read())
    const t = setInterval(() => { const v = read(); setId((p) => (p === v ? p : v)) }, 800)
    return () => clearInterval(t)
  }, [])
  return id
}
const primeiroDiaMes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }
const hoje = () => new Date().toISOString().slice(0, 10)

export default function RentabilidadePage() {
  const companyId = useCompanyId()
  const [dim, setDim] = useState<'profissional' | 'cadeira'>('profissional')
  const [de, setDe] = useState(primeiroDiaMes())
  const [ate, setAte] = useState(hoje())
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)

  const carregar = useCallback(async (cid: string) => {
    setLoading(true)
    const { data: r } = await supabase.rpc('fn_odonto_rentabilidade', { p_company_id: cid, p_de: de, p_ate: ate, p_dim: dim })
    setData((r as Resp | null) ?? null)
    setLoading(false)
  }, [de, ate, dim])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (companyId) void carregar(companyId) }, [companyId, carregar])

  if (!companyId) return <ShellOdonto><EmptyStateOdonto titulo="Escolha uma clínica" linha="Selecione uma empresa específica no topo do menu para ver a rentabilidade." /></ShellOdonto>

  const t = data?.totais
  const linhas = data?.linhas ?? []
  const maxLucro = Math.max(1, ...linhas.map((l) => Math.abs(l.lucro)))

  return (
    <ShellOdonto>
      <PageHeaderOdonto icon={<TrendingUp size={20} />} titulo="Rentabilidade"
        subtitulo="Onde a clínica ganha e onde perde: lucro por dentista e por cadeira (receita − custo real)" />

      {/* filtros */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'inline-flex', gap: 4, background: TOK.bg, borderRadius: 999, padding: 3 }}>
          {(['profissional', 'cadeira'] as const).map((d) => (
            <button key={d} onClick={() => setDim(d)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 700, padding: '6px 13px', borderRadius: 999, cursor: 'pointer', border: 'none', background: dim === d ? TOK.gold : 'transparent', color: dim === d ? '#fff' : TOK.mut }}>
              {d === 'profissional' ? <User size={14} /> : <Armchair size={14} />}{d === 'profissional' ? 'Por dentista' : 'Por cadeira'}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <input type="date" value={de} onChange={(e) => setDe(e.target.value)} style={inpData} />
        <span style={{ color: TOK.mut, fontSize: 12 }}>até</span>
        <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} style={inpData} />
      </div>

      {/* totais */}
      <CardOdonto style={{ padding: 16, marginBottom: 12, background: 'linear-gradient(180deg,#FFFDF8,#fff)', borderColor: TOK.gold }}>
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
          <MetricStat valor={brl(t?.receita ?? 0)} label="Receita executada" cor={TOK.esp} />
          <MetricStat valor={brl(t?.custo ?? 0)} label="Custo (mat+MO+fixo)" cor={TOK.mut} />
          <MetricStat valor={brl(t?.lucro ?? 0)} label="Lucro" cor={corMargem(t?.margem_pct ?? null)} />
          <MetricStat valor={t?.margem_pct != null ? `${t.margem_pct}%` : '—'} label="Margem" cor={corMargem(t?.margem_pct ?? null)} />
          <MetricStat valor={String(t?.n_proc ?? 0)} label="Procedimentos" cor={TOK.mut} />
        </div>
        <div style={{ fontSize: 11, color: TOK.mut30, marginTop: 8 }}>Custo/hora {data?.custo_hora != null ? brl(data.custo_hora) : '—'} · o resultado alimenta o <strong>DRE divisional</strong> <span style={{ color: TOK.gold, fontWeight: 700 }}>[→GE]</span>.</div>
      </CardOdonto>

      {(t?.parcial_qtd ?? 0) > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#FBF0DF', border: `0.5px solid #B45309`, borderRadius: 10, padding: '9px 11px', marginBottom: 12 }}>
          <AlertTriangle size={16} style={{ color: '#B45309', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 11.5, color: '#7A5312' }}><strong>{t?.parcial_qtd} procedimento(s)</strong> sem custeio completo (ficha técnica ou duração/custo-hora) — a rentabilidade é <strong>parcial</strong>. Complete o custeio para o número fechar.</div>
        </div>
      )}

      {/* ranking */}
      {loading ? (
        <CardOdonto><div style={{ fontSize: 13, color: TOK.mut }}>Calculando…</div></CardOdonto>
      ) : linhas.length === 0 ? (
        <EmptyStateOdonto titulo="Sem procedimentos concluídos no período" linha="Conclua atendimentos na agenda (e configure o custeio) para ver a rentabilidade por dentista e cadeira." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {linhas.map((l, i) => (
            <CardOdonto key={i} style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: TOK.esp }}>{i === 0 && l.lucro > 0 ? '🏆 ' : ''}{l.nome}</span>
                    {l.parcial_qtd > 0 && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: '#FBF0DF', color: '#B45309' }}>parcial</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: TOK.mut, marginTop: 2 }}>
                    {l.n_proc} proc · {l.horas}h · {l.lucro_hora != null ? `${brl(l.lucro_hora)}/h` : '—/h'} · receita {brl(l.receita)} · custo {brl(l.custo)}
                  </div>
                  <div style={{ fontSize: 10.5, color: TOK.mut30, marginTop: 2 }}>composição: material {brl(l.material)} · MO {brl(l.mo)} · fixo {brl(l.fixo)}</div>
                  <div style={{ height: 5, borderRadius: 999, background: TOK.line, marginTop: 6, overflow: 'hidden', maxWidth: 260 }}>
                    <div style={{ width: `${Math.min(100, Math.abs(l.lucro) / maxLucro * 100)}%`, height: '100%', background: l.lucro < 0 ? TOK.red : TOK.green }} />
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: corMargem(l.margem_pct) }}>{brl(l.lucro)}</div>
                  <div style={{ fontSize: 11.5, color: corMargem(l.margem_pct), fontWeight: 700 }}>{l.margem_pct != null ? `${l.margem_pct}% margem` : '—'}</div>
                </div>
              </div>
            </CardOdonto>
          ))}
        </div>
      )}
    </ShellOdonto>
  )
}

const inpData: React.CSSProperties = { border: `0.5px solid ${TOK.line}`, borderRadius: 8, padding: '7px 10px', fontSize: 13, color: TOK.esp, background: '#fff' }
