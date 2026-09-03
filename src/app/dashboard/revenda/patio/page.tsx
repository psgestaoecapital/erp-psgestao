'use client'

// Revenda de Veículos · Onda 1 — pátio. Cartão por veículo com dias parados (semáforo pelas faixas
// da empresa), situação e custo acumulado. Filtro por situação, ordenação por dias. Novo veículo pelo
// chassi (placa opcional). Dias e custo são DERIVADOS (view v_veic_patio) — nunca coluna.

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC',
}
const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none' }
const brl = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const SIT = ['em_preparacao', 'disponivel', 'reservado', 'vendido', 'entregue', 'devolvido']
const semColor = (s: string) => s === 'verde' ? { c: C.green, bg: C.greenBg } : s === 'amarelo' ? { c: C.amber, bg: C.amberBg } : { c: C.red, bg: C.redBg }

type Veic = { id: string; chassi: string; placa: string | null; modelo: string | null; ano_modelo: number | null; situacao: string; dias_patio: number; custo_acumulado: number; semaforo: string; foto_url: string | null }

export default function PatioPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const router = useRouter()
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [rows, setRows] = useState<Veic[]>([])
  const [fotoUrls, setFotoUrls] = useState<Record<string, string>>({})
  const [filtro, setFiltro] = useState('todos')
  const [erro, setErro] = useState<string | null>(null)
  const [novo, setNovo] = useState(false)

  const carregar = useCallback(async () => {
    if (!companyId) { setRows([]); return }
    const { data, error } = await supabase.from('v_veic_patio').select('*').eq('company_id', companyId).order('dias_patio', { ascending: false })
    if (error) { setErro(error.message); return }
    const lista = (data as Veic[]) ?? []
    setRows(lista)
    // foto_url guarda o storage_path da principal (bucket privado) — assina para exibir.
    // Legado eventual em URL pública (http) passa direto.
    const paths = lista.map((r) => r.foto_url).filter((u): u is string => !!u && !u.startsWith('http'))
    if (paths.length) {
      const { data: signed } = await supabase.storage.from('revenda-veiculos').createSignedUrls(paths, 3600)
      const m: Record<string, string> = {}
      ;(signed ?? []).forEach((s) => { if (s.signedUrl && s.path) m[s.path] = s.signedUrl })
      setFotoUrls(m)
    } else setFotoUrls({})
  }, [companyId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const visiveis = useMemo(() => filtro === 'todos' ? rows : rows.filter((r) => r.situacao === filtro), [rows, filtro])

  if (!companyId) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Selecione uma empresa específica no topo.</div>

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 1120, margin: '0 auto', color: C.esp }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>🚗 Comércio · Revenda</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Pátio de veículos</h1>
        </div>
        <button onClick={() => setNovo(true)} style={{ padding: '9px 16px', border: 'none', borderRadius: 8, background: C.gold, color: C.white, fontWeight: 700, cursor: 'pointer' }}>+ Novo veículo</button>
      </div>
      <p style={{ color: C.espM, fontSize: 13, margin: '6px 0 14px' }}>Dias parados e custo acumulado são calculados na hora — nunca gravados. Semáforo pelas faixas da empresa.</p>

      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }} onClick={() => setErro(null)}>{erro}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: C.espM }}>Situação&nbsp;
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={inp}>
            <option value="todos">todas</option>
            {SIT.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 12, color: C.espM }}>{visiveis.length} veículo(s) · ordenado por dias parados</span>
      </div>

      {visiveis.length === 0 ? (
        <div style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '30px 16px', textAlign: 'center', color: C.espM }}>Nenhum veículo no pátio. Cadastre o primeiro.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {visiveis.map((v) => {
            const sc = semColor(v.semaforo)
            return (
              <div key={v.id} onClick={() => router.push(`/dashboard/revenda/veiculo/${v.id}`)}
                style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', cursor: 'pointer' }}>
                <div style={{ height: 110, background: C.cream, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.espL, fontSize: 12 }}>
                  {(() => {
                    const src = v.foto_url ? (v.foto_url.startsWith('http') ? v.foto_url : fotoUrls[v.foto_url]) : null
                    // eslint-disable-next-line @next/next/no-img-element
                    return src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '📷 sem foto'
                  })()}
                </div>
                <div style={{ padding: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{v.modelo || '—'} {v.ano_modelo ? `· ${v.ano_modelo}` : ''}</div>
                  <div style={{ fontSize: 12, color: C.espM, fontFamily: 'monospace' }}>{v.placa || 'sem placa'} · {v.chassi.slice(-6)}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: sc.bg, color: sc.c, fontWeight: 700 }}>● {v.dias_patio} dia(s)</span>
                    <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.cream, color: C.espM }}>{v.situacao.replace('_', ' ')}</span>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: C.espM }}>custo acumulado <b style={{ color: C.esp }}>{brl(v.custo_acumulado)}</b></div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {novo && <NovoVeiculo companyId={companyId} onClose={() => setNovo(false)} onSaved={(id) => { setNovo(false); if (id) router.push(`/dashboard/revenda/veiculo/${id}`); else void carregar() }} onErro={setErro} />}
    </div>
  )
}

function NovoVeiculo({ companyId, onClose, onSaved, onErro }: { companyId: string; onClose: () => void; onSaved: (id?: string) => void; onErro: (m: string) => void }) {
  const [f, setF] = useState({ chassi: '', placa: '', marca: '', modelo: '', ano_modelo: '', cor: '', origem: 'compra_pf', valor_aquisicao: '' })
  const [busy, setBusy] = useState(false)
  async function salvar() {
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.rpc('fn_veic_criar', {
      p_company_id: companyId,
      p_veiculo: { chassi: f.chassi.trim(), placa: f.placa.trim() || null, marca: f.marca.trim() || null, modelo: f.modelo.trim() || null, ano_modelo: f.ano_modelo ? Number(f.ano_modelo) : null, cor: f.cor.trim() || null, origem: f.origem, valor_aquisicao: f.valor_aquisicao ? Number(f.valor_aquisicao) : null },
      p_user: user?.id ?? null,
    })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string; id?: string } | null
    if (error || !r?.ok) { onErro(r?.erro === 'chassi_ja_cadastrado' ? 'Chassi já cadastrado nesta empresa.' : r?.erro === 'chassi_obrigatorio' ? 'Chassi é obrigatório.' : (error?.message || 'Falha ao salvar')); return }
    onSaved(r.id)
  }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.white, borderRadius: 12, padding: 18, width: 'min(520px,100%)' }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Novo veículo</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <input value={f.chassi} onChange={(e) => setF({ ...f, chassi: e.target.value })} placeholder="chassi (obrigatório)" style={{ ...inp, gridColumn: '1 / -1' }} />
          <input value={f.placa} onChange={(e) => setF({ ...f, placa: e.target.value })} placeholder="placa (opcional — carro sem placa existe)" style={inp} />
          <input value={f.marca} onChange={(e) => setF({ ...f, marca: e.target.value })} placeholder="marca" style={inp} />
          <input value={f.modelo} onChange={(e) => setF({ ...f, modelo: e.target.value })} placeholder="modelo" style={inp} />
          <input value={f.ano_modelo} onChange={(e) => setF({ ...f, ano_modelo: e.target.value })} placeholder="ano modelo" style={inp} />
          <input value={f.cor} onChange={(e) => setF({ ...f, cor: e.target.value })} placeholder="cor" style={inp} />
          <select value={f.origem} onChange={(e) => setF({ ...f, origem: e.target.value })} style={inp}>
            <option value="compra_pf">compra PF</option><option value="compra_pj">compra PJ</option><option value="consignacao">consignação</option><option value="troca">troca</option>
          </select>
          <input value={f.valor_aquisicao} onChange={(e) => setF({ ...f, valor_aquisicao: e.target.value })} placeholder="valor de aquisição" style={{ ...inp, gridColumn: '1 / -1' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.espM, cursor: 'pointer' }}>Cancelar</button>
          <button disabled={!f.chassi.trim() || busy} onClick={() => void salvar()} style={{ padding: '8px 16px', border: 'none', borderRadius: 8, background: f.chassi.trim() && !busy ? C.gold : C.espL, color: C.white, fontWeight: 700, cursor: f.chassi.trim() && !busy ? 'pointer' : 'not-allowed' }}>{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  )
}
