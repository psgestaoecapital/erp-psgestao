'use client'

// HB2 · Propostas dentro do Hub (RD-52: mesma fonte erp_orcamentos, sem 2ª lista). Antes redirecionava para
// /dashboard/orcamentos e o usuário "saía" do Hub. Agora a lista, o funil e a busca vivem aqui; criar/editar
// continua no editor completo (1 toque). Só leitura. 3 estados: erro / vazio (ensina) / dados.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { fmtR } from '@/lib/psgc-tokens'
import { supabase } from '@/lib/supabase'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'

const STATUS: Record<string, { cor: string; label: string }> = {
  rascunho: { cor: '#9C8E80', label: 'Rascunho' }, enviado: { cor: '#3B82F6', label: 'Enviado' },
  visualizado: { cor: '#8B5CF6', label: 'Visualizado' }, aprovado: { cor: '#16A34A', label: 'Aprovado' },
  recusado: { cor: '#B91C1C', label: 'Recusado' }, expirado: { cor: '#F59E0B', label: 'Expirado' },
  convertido: { cor: GOLD, label: 'Virou pedido' },
}
const ABERTAS = ['rascunho', 'enviado', 'visualizado']

type Proposta = { id: string; numero: string | null; cliente_nome: string | null; status: string; total: number | null; data_emissao: string | null; obra_id: string | null }

export default function PropostasHubPage() {
  const { companyIds } = useCompanyIds()
  const [linhas, setLinhas] = useState<Proposta[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('todos')

  const carregar = useCallback(async () => {
    if (!companyIds?.length) { setLoading(false); return }
    setLoading(true); setErro('')
    try {
      const { data, error } = await comPrazo(
        async () => await supabase.from('erp_orcamentos').select('id,numero,cliente_nome,status,total,data_emissao,obra_id')
          .in('company_id', companyIds).order('data_emissao', { ascending: false }).limit(100),
        { ms: 8000, tentativas: 1, label: 'propostas_hub' },
      )
      if (error) { setErro(error.message); return }
      setLinhas((data ?? []) as Proposta[])
    } catch { setErro(MSG_CARREGAMENTO_FALHOU) } finally { setLoading(false) }
  }, [companyIds])
  useEffect(() => { carregar() }, [carregar])

  const vis = useMemo(() => {
    const b = busca.trim().toLowerCase()
    return linhas.filter(l => (filtro === 'todos' || l.status === filtro)
      && (!b || (l.numero ?? '').toLowerCase().includes(b) || (l.cliente_nome ?? '').toLowerCase().includes(b)))
  }, [linhas, busca, filtro])
  const abertas = linhas.filter(l => ABERTAS.includes(l.status))
  const valorAberto = abertas.reduce((s, l) => s + Number(l.total ?? 0), 0)
  const valorAprov = linhas.filter(l => l.status === 'aprovado' || l.status === 'convertido').reduce((s, l) => s + Number(l.total ?? 0), 0)

  const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 16px', flex: '1 1 160px' }
  return (
    <div style={{ background: BG, color: ESP, padding: 20, minHeight: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Propostas</h1>
          <div style={{ fontSize: 12, color: MUT }}>Orçamentos enviados aos clientes — do rascunho ao pedido.</div>
        </div>
        <Link href="/dashboard/orcamentos" style={{ background: GOLD, color: '#fff', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>+ Nova proposta</Link>
      </div>

      {erro ? (
        <div role="alert" style={{ marginTop: 16, padding: 14, border: '1px solid #B91C1C', borderRadius: 10, color: '#B91C1C', fontSize: 13 }}>
          {erro} <button onClick={carregar} style={{ marginLeft: 8, textDecoration: 'underline', background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}>Tentar de novo</button>
        </div>
      ) : loading ? (
        <div style={{ marginTop: 16, color: MUT, fontSize: 13 }}>Carregando propostas…</div>
      ) : linhas.length === 0 ? (
        <div style={{ marginTop: 16, padding: 20, border: `1px dashed ${LINE}`, borderRadius: 12, fontSize: 13 }}>
          Nenhuma proposta ainda. Escolha serviços do catálogo, o preço sai do custo real e a proposta vai ao cliente por link.{' '}
          <Link href="/dashboard/orcamentos" style={{ color: GOLD, fontWeight: 600 }}>Criar a primeira proposta</Link>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
            <div style={card}><div style={{ fontSize: 11, color: MUT }}>Em aberto</div><div style={{ fontSize: 18, fontWeight: 700 }}>{abertas.length}</div><div style={{ fontSize: 12, color: MUT }}>{fmtR(valorAberto)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: MUT }}>Aprovadas / viraram pedido</div><div style={{ fontSize: 18, fontWeight: 700 }}>{fmtR(valorAprov)}</div></div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
            <div style={{ flex: '1 1 220px', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por número ou cliente"
                style={{ flex: 1, padding: '8px 12px', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 13 }} />
              <AjudaCampo chave="projetos.propostas.busca" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <select value={filtro} onChange={e => setFiltro(e.target.value)} style={{ padding: '8px 12px', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 13 }}>
                <option value="todos">Todos os status</option>
                {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <AjudaCampo chave="projetos.propostas.status" />
            </div>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 12, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left', fontSize: 12, color: MUT }}>
                <th style={{ padding: '8px 12px' }}>Número</th><th style={{ padding: '8px 12px' }}>Cliente</th>
                <th style={{ padding: '8px 12px' }}>Status</th><th style={{ padding: '8px 12px', textAlign: 'right' }}>Total</th><th style={{ padding: '8px 12px' }} />
              </tr></thead>
              <tbody>
                {vis.map(l => {
                  const st = STATUS[l.status] ?? { cor: MUT, label: l.status }
                  return (
                    <tr key={l.id} style={{ borderTop: `1px solid ${LINE}`, fontSize: 13 }}>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: GOLD, fontWeight: 600 }}>{l.numero ?? '—'}</td>
                      <td style={{ padding: '8px 12px' }}>{l.cliente_nome ?? '—'}</td>
                      <td style={{ padding: '8px 12px' }}><span style={{ color: st.cor, fontWeight: 600 }}>{st.label}</span></td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmtR(Number(l.total ?? 0))}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        <Link href="/dashboard/orcamentos" style={{ color: GOLD, fontWeight: 600, fontSize: 12 }}>Abrir</Link>
                      </td>
                    </tr>
                  )
                })}
                {vis.length === 0 && <tr><td colSpan={5} style={{ padding: 16, color: MUT, fontSize: 13 }}>Nenhuma proposta com esse filtro.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
