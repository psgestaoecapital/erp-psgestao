'use client'

// Chamado #6724 · Relatório de Ordens de Serviço por período (só leitura).
// Usa fn_os_relatorio_periodo (guarda por empresa; o perfil mecânico não vê valores).

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

export const dynamic = 'force-dynamic'

type Base = 'abertura' | 'conclusao' | 'entrega'
interface Linha { qtd?: number; servico: number; pecas: number; total: number }
interface Item { id: string; numero: string | null; cliente_nome: string | null; placa: string | null; status: string; data_ref: string | null; servico: number; pecas: number; total: number }
interface Rel { ok: boolean; erro?: string; totais: Linha & { qtd: number }; por_status: (Linha & { status: string; qtd: number })[]; itens: Item[] }

const STATUS: Record<string, string> = {
  orcamento: 'Orçamento', aberta: 'Aberta', em_execucao: 'Em execução', aguardando_peca: 'Aguardando peça',
  aguardando_aprovacao: 'Aguardando aprovação', aprovada: 'Aprovada', pronta: 'Pronta', entregue: 'Entregue', cancelada: 'Cancelada',
}
const BASES: { v: Base; l: string }[] = [
  { v: 'abertura', l: 'Data de abertura' }, { v: 'conclusao', l: 'Data de conclusão' }, { v: 'entrega', l: 'Data de entrega' },
]
const brl = (v: number) => 'R$ ' + Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtD = (s: string | null) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('pt-BR') : '—')
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const mes = (delta: number) => {
  const h = new Date()
  return { de: iso(new Date(h.getFullYear(), h.getMonth() + delta, 1)), ate: iso(new Date(h.getFullYear(), h.getMonth() + delta + 1, 0)) }
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E0D8CC', borderRadius: 12, padding: 16 }
const inp: React.CSSProperties = { minHeight: 44, padding: '10px 12px', border: '1px solid #E0D8CC', borderRadius: 8, fontSize: 14, background: '#fff' }
const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#6B5D4F', marginBottom: 4 }

export default function RelatorioOSPage() {
  const { sel } = useCompanyIds()
  const companyId = useMemo<string | null>(() => (!sel || sel === 'consolidado' || sel.startsWith('group_') ? null : sel), [sel])
  const [de, setDe] = useState(mes(-1).de)
  const [ate, setAte] = useState(mes(-1).ate)
  const [base, setBase] = useState<Base>('abertura')
  const [rel, setRel] = useState<Rel | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) { setRel(null); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_os_relatorio_periodo', { p_company_id: companyId, p_de: de, p_ate: ate, p_base: base })
    const r = data as Rel | null
    if (error || !r || r.ok === false) { setRel(null); setErro(error?.message || r?.erro || 'Falha ao carregar o relatório') }
    else setRel(r)
    setLoading(false)
  }, [companyId, de, ate, base])

  useEffect(() => { void carregar() }, [carregar])

  const atalho = (delta: number) => { const m = mes(delta); setDe(m.de); setAte(m.ate) }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 16, display: 'grid', gap: 16 }}>
      <div>
        <Link href="/dashboard/os" style={{ fontSize: 13, color: '#6B5D4F' }}>← Ordens de serviço</Link>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#3D2314', margin: '6px 0 0' }}>Relatório de ordens de serviço</h1>
        <p style={{ fontSize: 13, color: '#6B5D4F', margin: '4px 0 0' }}>
          Soma de serviços, peças e total no período. Não entram ordens excluídas nem canceladas.
        </p>
      </div>

      {!companyId ? (
        <div style={card}>Selecione uma empresa para ver o relatório.</div>
      ) : (
        <>
          <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <div>
              <label style={lbl}>De<AjudaCampo chave="os.relatorio.periodo" rota="/dashboard/os/relatorio" /></label>
              <input type="date" style={inp} value={de} onChange={(e) => setDe(e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Até</label>
              <input type="date" style={inp} value={ate} onChange={(e) => setAte(e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Data usada<AjudaCampo chave="os.relatorio.base_data" rota="/dashboard/os/relatorio" /></label>
              <select style={inp} value={base} onChange={(e) => setBase(e.target.value as Base)}>
                {BASES.map((b) => <option key={b.v} value={b.v}>{b.l}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" style={{ ...inp, cursor: 'pointer' }} onClick={() => atalho(-1)}>Mês passado</button>
              <button type="button" style={{ ...inp, cursor: 'pointer' }} onClick={() => atalho(0)}>Este mês</button>
            </div>
          </div>

          {loading && <div style={card}>Carregando…</div>}
          {erro && <div style={{ ...card, color: '#B91C1C', background: '#FEE2E2' }}>{erro}</div>}

          {rel && !loading && (
            <>
              <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
                <div><div style={lbl}>Totais do período<AjudaCampo chave="os.relatorio.totais" rota="/dashboard/os/relatorio" /></div><div style={{ fontSize: 13 }}>{rel.totais.qtd} ordem(ns)</div></div>
                <div><div style={lbl}>Serviços</div><strong>{brl(rel.totais.servico)}</strong></div>
                <div><div style={lbl}>Peças</div><strong>{brl(rel.totais.pecas)}</strong></div>
                <div><div style={lbl}>Total</div><strong style={{ fontSize: 18 }}>{brl(rel.totais.total)}</strong></div>
              </div>

              <div style={{ ...card, overflowX: 'auto' }}>
                <div style={lbl}>Por situação<AjudaCampo chave="os.relatorio.por_situacao" rota="/dashboard/os/relatorio" /></div>
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                  <thead><tr style={{ textAlign: 'left', color: '#6B5D4F' }}><th>Situação</th><th>Qtd</th><th>Serviços</th><th>Peças</th><th>Total</th></tr></thead>
                  <tbody>
                    {rel.por_status.length === 0 && <tr><td colSpan={5} style={{ padding: 8 }}>Nenhuma ordem no período.</td></tr>}
                    {rel.por_status.map((s) => (
                      <tr key={s.status}><td style={{ padding: '6px 0' }}>{STATUS[s.status] ?? s.status}</td><td>{s.qtd}</td><td>{brl(s.servico)}</td><td>{brl(s.pecas)}</td><td>{brl(s.total)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ ...card, overflowX: 'auto' }}>
                <div style={lbl}>Ordens do período</div>
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                  <thead><tr style={{ textAlign: 'left', color: '#6B5D4F' }}><th>Nº</th><th>Data</th><th>Cliente</th><th>Placa</th><th>Situação</th><th>Serviços</th><th>Peças</th><th>Total</th></tr></thead>
                  <tbody>
                    {rel.itens.map((o) => (
                      <tr key={o.id}>
                        <td style={{ padding: '6px 0' }}>{o.numero ?? '—'}</td><td>{fmtD(o.data_ref)}</td><td>{o.cliente_nome ?? '—'}</td>
                        <td>{o.placa ?? '—'}</td><td>{STATUS[o.status] ?? o.status}</td><td>{brl(o.servico)}</td><td>{brl(o.pecas)}</td><td>{brl(o.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
