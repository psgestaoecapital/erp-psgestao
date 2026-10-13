'use client'

// Revenda · R9c (Garantia) — tela prevista no blueprint. Garantia por venda (prazo/KM + termo), acionamento
// que REUSA a OS de preparação da Oficina (o custo volta ao veículo e ao lucro real por veic_custo), e o
// sinistro por modelo. Provisão é OPCIONAL por empresa (liga no perfil fiscal); desligada → não provisiona
// (há revenda que não provisiona). Fonte única no banco (RD-65). Sem dado → "sem registros" (RD-51). Paleta PS.

import { useCallback, useEffect, useState, Suspense } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC',
}
const brl = (v: number | null | undefined) => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const brDate = (d?: string | null) => d ? String(d).slice(0, 10).split('-').reverse().join('/') : ''
const inp: React.CSSProperties = { padding: '7px 9px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 7, background: C.white, color: C.esp, outline: 'none' }

type Gar = {
  id: string; venda_id: string; veiculo_id: string; prazo_meses: number | null; km_limite: number | null; status: string
  provisao_ativa: boolean; provisao_valor: number; cliente_nome: string | null; data_venda: string | null; valor_venda: number | null
  marca: string | null; modelo: string | null; acionamentos: number; custo_acionamentos: number
}
type Venda = { id: string; cliente_nome: string | null; data_venda: string | null; valor_venda: number | null; marca?: string | null; modelo?: string | null }
type Sinistro = { modelo: string; acionamentos: number; custo: number }

export default function GarantiaPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const anoIni = `${new Date().getFullYear()}-01-01`
  const hoje = new Date().toISOString().slice(0, 10)
  const [de, setDe] = useState(anoIni)
  const [ate, setAte] = useState(hoje)
  const [gars, setGars] = useState<Gar[]>([])
  const [sinistros, setSinistros] = useState<Sinistro[]>([])
  const [semGarantia, setSemGarantia] = useState<Venda[]>([])
  const [nova, setNova] = useState({ venda_id: '', prazo: '', km: '', termo: '' })
  const [provisao, setProvisao] = useState<{ tem_perfil_aprovado: boolean; ativa: boolean; pct: number | null; conta_id: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function userId() { const { data: { session } } = await supabase.auth.getSession(); return session?.user?.id ?? null }

  const carregar = useCallback(async () => {
    if (!companyId) { setGars([]); setSinistros([]); setSemGarantia([]); return }
    const [lst, sin, vds] = await Promise.all([
      supabase.rpc('fn_veic_garantia_listar', { p_company_id: companyId }),
      supabase.rpc('fn_veic_garantia_sinistro_por_modelo', { p_company_id: companyId, p_de: de, p_ate: ate }),
      supabase.from('veic_venda').select('id,cliente_nome,data_venda,valor_venda,veic_veiculo(marca,modelo)').eq('company_id', companyId).is('deleted_at', null).is('devolvido_em', null).order('data_venda', { ascending: false }).limit(200),
    ])
    const rl = lst.data as { ok?: boolean; itens?: Gar[]; provisao_estado?: { tem_perfil_aprovado: boolean; ativa: boolean; pct: number | null; conta_id: string | null } } | null
    if (rl?.ok) { setGars(rl.itens ?? []); setProvisao(rl.provisao_estado ?? null) }
    const rs = sin.data as { ok?: boolean; por_modelo?: Sinistro[] } | null
    setSinistros(rs?.ok ? (rs.por_modelo ?? []) : [])
    const comGar = new Set((rl?.itens ?? []).map((g) => g.venda_id))
    const vlist = ((vds.data as Array<{ id: string; cliente_nome: string | null; data_venda: string | null; valor_venda: number | null; veic_veiculo?: { marca?: string | null; modelo?: string | null } }>) ?? [])
      .filter((v) => !comGar.has(v.id)).map((v) => ({ id: v.id, cliente_nome: v.cliente_nome, data_venda: v.data_venda, valor_venda: v.valor_venda, marca: v.veic_veiculo?.marca, modelo: v.veic_veiculo?.modelo }))
    setSemGarantia(vlist)
  }, [companyId, de, ate])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  async function registrar() {
    if (!companyId || !nova.venda_id) { setErro('Escolha a venda.'); return }
    setBusy(true); setErro(null)
    const { data } = await supabase.rpc('fn_veic_garantia_registrar', {
      p_venda_id: nova.venda_id, p_prazo_meses: nova.prazo.trim() ? Math.trunc(Number(nova.prazo)) : null,
      p_km_limite: nova.km.trim() ? Number(nova.km) : null, p_termo: nova.termo.trim() || null, p_user: await userId(),
    })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (!r?.ok) { setErro(r?.erro === 'sem_acesso' ? 'Sem acesso.' : (r?.erro || 'Falha ao registrar a garantia.')); return }
    setMsg('Garantia registrada.'); setNova({ venda_id: '', prazo: '', km: '', termo: '' }); void carregar()
  }

  async function acionar(g: Gar) {
    const desc = window.prompt('Descreva o problema do acionamento (abre uma OS de preparação):', '')
    if (desc === null) return
    setBusy(true); setErro(null)
    const { data } = await supabase.rpc('fn_veic_garantia_acionar', { p_garantia_id: g.id, p_descricao: desc || null, p_user: await userId() })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string; numero?: string } | null
    if (!r?.ok) { setErro(r?.erro || 'Falha ao acionar a garantia.'); return }
    setMsg(`Acionamento aberto — OS ${r.numero}. O custo entra na conta do veículo.`); void carregar()
  }

  if (!companyId) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Selecione uma empresa específica no topo.</div>

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 1100, margin: '0 auto', color: C.esp }}>
      <a href="/dashboard/revenda/patio" style={{ fontSize: 12, color: C.gold, textDecoration: 'none' }}>← voltar ao pátio</a>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '6px 0 2px' }}>Garantia</h1>
      <p style={{ color: C.espM, fontSize: 13, margin: '0 0 14px' }}>Garantia por venda (prazo/KM + termo). Acionar abre uma OS de preparação — o custo volta ao veículo e ao lucro real da venda. Provisão é opcional (liga no perfil fiscal).</p>

      {msg && <div style={{ background: C.greenBg, color: C.green, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 10 }} onClick={() => setMsg(null)}>{msg}</div>}
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 10 }} onClick={() => setErro(null)}>{erro}</div>}

      {/* B1 · estado da provisão (vem do perfil fiscal vigente) — visível aqui, com link para configurar */}
      {provisao && (
        <div style={{ background: provisao.ativa ? C.greenBg : C.cream, border: `1px solid ${provisao.ativa ? C.green : C.border}`, borderRadius: 10, padding: '9px 13px', marginBottom: 12, fontSize: 12.5, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: C.esp }}>
            <b>Provisão de garantia:</b> {provisao.ativa
              ? <span style={{ color: C.green }}>ligada · {provisao.pct != null ? `${provisao.pct}%` : 'sem %'}{provisao.conta_id ? ' · conta configurada' : ' · conta não definida'}</span>
              : <span style={{ color: C.espM }}>{provisao.tem_perfil_aprovado ? 'desligada' : 'desligada (sem perfil fiscal aprovado)'} — não provisiona</span>}
          </span>
          <a href="/dashboard/revenda/fiscal" style={{ color: C.gold, textDecoration: 'none', fontWeight: 700 }}>configurar no perfil fiscal →</a>
        </div>
      )}

      {/* Registrar nova garantia */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Registrar garantia numa venda</div>
        {semGarantia.length === 0 ? (
          <div style={{ fontSize: 12.5, color: C.espL, fontStyle: 'italic' }}>Todas as vendas já têm garantia registrada (ou não há vendas).</div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ fontSize: 11, color: C.espM }}>Venda<br />
              <select value={nova.venda_id} onChange={(e) => setNova({ ...nova, venda_id: e.target.value })} style={{ ...inp, minWidth: 260 }}>
                <option value="">escolha…</option>
                {semGarantia.map((v) => <option key={v.id} value={v.id}>{brDate(v.data_venda)} · {[v.marca, v.modelo].filter(Boolean).join(' ')} · {v.cliente_nome || 'sem cliente'} · {brl(v.valor_venda)}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 11, color: C.espM }}>Prazo (meses)<br /><input value={nova.prazo} onChange={(e) => setNova({ ...nova, prazo: e.target.value.replace(/\D/g, '') })} placeholder="config" style={{ ...inp, width: 90 }} /></label>
            <label style={{ fontSize: 11, color: C.espM }}>KM limite<br /><input value={nova.km} onChange={(e) => setNova({ ...nova, km: e.target.value.replace(/\D/g, '') })} placeholder="opc." style={{ ...inp, width: 100 }} /></label>
            <label style={{ fontSize: 11, color: C.espM, flex: 1, minWidth: 200 }}>Termo (junto do termo de entrega)<br /><input value={nova.termo} onChange={(e) => setNova({ ...nova, termo: e.target.value })} placeholder="cláusulas da garantia…" style={{ ...inp, width: '100%', boxSizing: 'border-box' }} /></label>
            <button disabled={busy || !nova.venda_id} onClick={() => void registrar()} style={{ background: (busy || !nova.venda_id) ? C.espL : C.gold, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontWeight: 700, cursor: (busy || !nova.venda_id) ? 'not-allowed' : 'pointer', fontSize: 13 }}>+ Registrar</button>
          </div>
        )}
      </div>

      {/* Sinistro por modelo */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Sinistro por modelo</div>
          <label style={{ fontSize: 11, color: C.espM }}>De<br /><input type="date" value={de} onChange={(e) => setDe(e.target.value)} style={inp} /></label>
          <label style={{ fontSize: 11, color: C.espM }}>Até<br /><input type="date" value={ate} onChange={(e) => setAte(e.target.value)} style={inp} /></label>
        </div>
        {sinistros.length === 0 ? <div style={{ fontSize: 12.5, color: C.espL, fontStyle: 'italic' }}>Sem acionamentos no período.</div> : (
          <div style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 120px', gap: 8, fontSize: 10, textTransform: 'uppercase', color: C.espM }}><span>modelo</span><span>acionamentos</span><span>custo</span></div>
            {sinistros.map((s) => (
              <div key={s.modelo} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 120px', gap: 8, borderTop: `1px solid ${C.cream}`, padding: '4px 0' }}>
                <span>{s.modelo}</span><span>{s.acionamentos}</span><span style={{ color: s.custo > 0 ? C.red : C.espL }}>{s.custo > 0 ? brl(s.custo) : '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Garantias */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Garantias <span style={{ color: C.espM, fontWeight: 400 }}>· {gars.length}</span></div>
        {gars.length === 0 ? <div style={{ fontSize: 12.5, color: C.espL, fontStyle: 'italic' }}>Nenhuma garantia registrada ainda.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 820, borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr style={{ textAlign: 'left', color: C.espM, fontSize: 10.5, textTransform: 'uppercase' }}>
                <th style={{ padding: '4px 6px' }}>veículo</th><th style={{ padding: '4px 6px' }}>cliente</th><th style={{ padding: '4px 6px' }}>venda</th><th style={{ padding: '4px 6px' }}>prazo/KM</th><th style={{ padding: '4px 6px' }}>provisão</th><th style={{ padding: '4px 6px' }}>acion.</th><th style={{ padding: '4px 6px' }}>custo</th><th style={{ padding: '4px 6px' }}></th>
              </tr></thead>
              <tbody>{gars.map((g) => (
                <tr key={g.id} style={{ borderTop: `1px solid ${C.cream}` }}>
                  <td style={{ padding: '5px 6px' }}>{[g.marca, g.modelo].filter(Boolean).join(' ') || '—'}</td>
                  <td style={{ padding: '5px 6px', color: C.espM }}>{g.cliente_nome || '—'}</td>
                  <td style={{ padding: '5px 6px', color: C.espM }}>{brDate(g.data_venda)}</td>
                  <td style={{ padding: '5px 6px' }}>{g.prazo_meses != null ? `${g.prazo_meses}m` : '—'}{g.km_limite != null ? ` · ${Number(g.km_limite).toLocaleString('pt-BR')}km` : ''}</td>
                  <td style={{ padding: '5px 6px', color: g.provisao_ativa ? C.esp : C.espL }}>{g.provisao_ativa ? brl(g.provisao_valor) : 'não provisiona'}</td>
                  <td style={{ padding: '5px 6px' }}>{g.acionamentos}</td>
                  <td style={{ padding: '5px 6px', color: g.custo_acionamentos > 0 ? C.red : C.espL }}>{g.custo_acionamentos > 0 ? brl(g.custo_acionamentos) : '—'}</td>
                  <td style={{ padding: '5px 6px' }}><button disabled={busy} onClick={() => void acionar(g)} style={{ border: `1px solid ${C.gold}`, background: C.white, color: C.gold, borderRadius: 7, padding: '4px 10px', cursor: 'pointer', fontSize: 11.5, fontWeight: 700 }}>acionar</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
