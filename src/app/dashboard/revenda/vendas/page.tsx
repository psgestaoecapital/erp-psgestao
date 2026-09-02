'use client'

// Revenda de Veículos · Onda 3A — vendas. Lista da view v_veic_venda (totais por devedor derivados).
// Entrega e cancelamento por RPC. O desconto embutido da troca é mostrado como tal — nunca some no custo.

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC', blue: '#2F5AA8',
}
const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none' }
const brl = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const brDate = (d: string) => d ? String(d).slice(0, 10).split('-').reverse().join('/') : ''
const SIT = ['aberta', 'faturada', 'entregue', 'cancelada']

type Venda = {
  id: string; veiculo_id: string; chassi: string; modelo: string | null; placa: string | null; cliente_nome: string | null
  data_venda: string; valor_venda: number | null; desconto_embutido_troca: number | null
  valor_entrada: number | null; valor_financiado: number | null; banco_nome: string | null; retorno_banco: number | null
  situacao: string; total_cliente: number; total_banco: number; vendedor_nome: string | null
}

export default function VendasPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const router = useRouter()
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [rows, setRows] = useState<Venda[]>([])
  const [filtro, setFiltro] = useState('todos')
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) { setRows([]); return }
    const { data, error } = await supabase.from('v_veic_venda').select('*').eq('company_id', companyId).order('data_venda', { ascending: false })
    if (error) { setErro(error.message); return }
    setRows((data as Venda[]) ?? [])
  }, [companyId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const visiveis = useMemo(() => filtro === 'todos' ? rows : rows.filter((r) => r.situacao === filtro), [rows, filtro])

  async function userId() { const { data: { user } } = await supabase.auth.getUser(); return user?.id ?? null }
  async function entregar(v: Venda) {
    const { data, error } = await supabase.rpc('fn_veic_venda_entregar', { p_venda_id: v.id, p_user: await userId(), p_obs: null })
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha'); return }
    setMsg('Veículo entregue.'); void carregar()
  }
  async function cancelar(v: Venda) {
    const { data, error } = await supabase.rpc('fn_veic_venda_cancelar', { p_venda_id: v.id, p_user: await userId(), p_motivo: null })
    const r = data as { ok?: boolean; erro?: string; titulos_nao_excluidos?: number } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha'); return }
    setMsg(r.titulos_nao_excluidos ? `⚠️ Venda cancelada. ${r.titulos_nao_excluidos} título(s) em Contas a Receber NÃO foram excluídos — trate-os no financeiro.` : 'Venda cancelada.')
    void carregar()
  }

  if (!companyId) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Selecione uma empresa específica no topo.</div>

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 1120, margin: '0 auto', color: C.esp }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>🚗 Comércio · Revenda</div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Vendas</h1>
      <p style={{ color: C.espM, fontSize: 13, margin: '6px 0 14px' }}>Entrada é do cliente, financiado é do banco — cada um é um título com o devedor certo. O desconto da troca aparece como desconto, não some no custo do usado.</p>

      {msg && <div style={{ background: C.amberBg, color: C.amber, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }} onClick={() => setMsg(null)}>{msg}</div>}
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }} onClick={() => setErro(null)}>{erro}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: C.espM }}>Situação&nbsp;
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={inp}>
            <option value="todos">todas</option>
            {SIT.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 12, color: C.espM }}>{visiveis.length} venda(s)</span>
      </div>

      {visiveis.length === 0 ? (
        <div style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '30px 16px', textAlign: 'center', color: C.espM }}>Nenhuma venda registrada. Registre a venda pela ficha do veículo.</div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {visiveis.map((v) => (
            <div key={v.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{v.modelo || '—'} <span style={{ fontWeight: 400, color: C.espM, fontFamily: 'monospace', fontSize: 12 }}>· {v.placa || v.chassi.slice(-6)}</span></div>
                  <div style={{ fontSize: 13, color: C.espM }}>{v.cliente_nome || '—'} · {brDate(v.data_venda)}{v.vendedor_nome ? ` · vend. ${v.vendedor_nome}` : ''}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: C.gold }}>{brl(v.valor_venda ?? 0)}</div>
                  <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: v.situacao === 'entregue' ? C.greenBg : v.situacao === 'cancelada' ? C.redBg : '#E8EEF9', color: v.situacao === 'entregue' ? C.green : v.situacao === 'cancelada' ? C.red : C.blue, fontWeight: 700 }}>{v.situacao}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: C.espM, marginTop: 8 }}>
                <span>cliente deve <b style={{ color: C.esp }}>{brl(v.total_cliente)}</b></span>
                <span>banco deve <b style={{ color: C.esp }}>{brl(v.total_banco)}</b></span>
                {v.retorno_banco ? <span>retorno banco {brl(v.retorno_banco)}</span> : null}
                {v.desconto_embutido_troca ? <span style={{ color: C.amber }} title="valor de troca − valor de avaliação">desconto embutido na troca {brl(v.desconto_embutido_troca)}</span> : null}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={() => router.push(`/dashboard/revenda/veiculo/${v.veiculo_id}`)} style={{ padding: '6px 12px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.blue, cursor: 'pointer', fontSize: 12 }}>ver veículo</button>
                {v.situacao !== 'entregue' && v.situacao !== 'cancelada' && <button onClick={() => void entregar(v)} style={{ padding: '6px 12px', border: 'none', borderRadius: 8, background: C.green, color: C.white, fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>marcar entregue</button>}
                {v.situacao !== 'cancelada' && <button onClick={() => void cancelar(v)} style={{ padding: '6px 12px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.red, cursor: 'pointer', fontSize: 12 }}>cancelar</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
