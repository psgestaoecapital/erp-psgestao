'use client'
// OFICINA · VEÍCULOS POR PLACA (histórico). Mobile-first.
// Busca por placa/cliente → dados do veículo + histórico de OS (data, status, serviços, km, mecânico,
// valor de referência) + evolução do km. 🚫 SEM operação financeira — leitura consolidada de erp_os.
import React, { useEffect, useState, useCallback, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Car, ChevronLeft, Search, Gauge, Wrench } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314'; const BG = '#FAF7F2'; const GOLD = '#C8941A'; const LINE = '#E7DECF'; const ESP60 = 'rgba(61,35,20,0.55)'
const OK = '#166534'
const brl = (n: number | null) => n == null ? null : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0)
const STATUS_LABEL: Record<string, string> = { aberta: 'Recebido', aguardando_aprovacao: 'Aguardando aprovação', em_execucao: 'Em serviço', aguardando_peca: 'Aguardando peça', pronta: 'Pronto', entregue: 'Entregue', cancelada: 'Cancelada' }
const fmtData = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '—'
const fmtKm = (k: number | null) => k == null ? '—' : `${new Intl.NumberFormat('pt-BR').format(k)} km`

type VeicLinha = { placa: string; cliente_nome: string | null; marca: string | null; modelo: string | null; ano: number | null; ultimo_km: number | null; os_count: number; ultima_data: string | null }
type OSHist = { id: string; numero: string; status: string; data: string | null; km: number | null; tecnico_nome: string | null; defeito_relatado: string | null; diagnostico: string | null; pecas_utilizadas: string | null; total: number | null; itens_count: number; valor_aprovado: number | null }
type Veiculo = { placa: string; cliente_nome: string | null; marca: string | null; modelo: string | null; ano: number | null; chassi: string | null; ultimo_km: number | null; os_count: number }
type KmPt = { data: string | null; km: number }

function useCompanyId(): string | null {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => {
      if (typeof window === 'undefined') return null
      const v = localStorage.getItem('ps_empresa_sel')
      if (!v || v === 'consolidado' || v.startsWith('group_')) return null
      return v
    }
    setId(read())
    const t = setInterval(() => { const v = read(); setId((p) => (p === v ? p : v)) }, 800)
    return () => clearInterval(t)
  }, [])
  return id
}

export default function VeiculosPage() {
  const companyId = useCompanyId()
  const router = useRouter()
  const [termo, setTermo] = useState('')
  const [lista, setLista] = useState<VeicLinha[]>([])
  const [sel, setSel] = useState<{ veiculo: Veiculo; os: OSHist[]; km_evolucao: KmPt[] } | null>(null)
  const [carregando, setCarregando] = useState(false)

  const buscar = useCallback(async () => {
    if (!companyId) return
    setCarregando(true)
    const { data } = await supabase.rpc('fn_oficina_veiculos_listar', { p_company_id: companyId, p_termo: termo || null })
    setLista((data as VeicLinha[]) ?? [])
    setCarregando(false)
  }, [companyId, termo])

  useEffect(() => { void buscar() }, [companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  const abrir = async (placa: string) => {
    if (!companyId) return
    const { data } = await supabase.rpc('fn_oficina_veiculo_historico', { p_company_id: companyId, p_placa: placa })
    setSel(data as { veiculo: Veiculo; os: OSHist[]; km_evolucao: KmPt[] })
  }

  if (!companyId) return <div style={{ padding: 24, color: ESP60, background: BG, minHeight: '100vh' }}>Selecione uma empresa específica no topo para abrir os Veículos.</div>

  // DETALHE
  if (sel) {
    const v = sel.veiculo
    const kmMax = Math.max(1, ...sel.km_evolucao.map((p) => p.km))
    return (
      <div style={{ background: BG, minHeight: '100vh', color: ESP }}>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 14px 40px' }}>
          <button onClick={() => setSel(null)} style={linkBtn}><ChevronLeft size={16} /> Veículos</button>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 6 }}>🔧 Oficina · Veículo</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 2px', display: 'flex', alignItems: 'center', gap: 8 }}><Car size={22} /> {v.placa}</h1>
          <div style={{ fontSize: 14, color: ESP60, marginBottom: 12 }}>{[v.marca, v.modelo, v.ano].filter(Boolean).join(' · ') || 'Veículo'}{v.cliente_nome ? ` · ${v.cliente_nome}` : ''}</div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Stat l="Passagens" v={String(v.os_count)} />
            <Stat l="Último KM" v={fmtKm(v.ultimo_km)} />
            {v.chassi && <Stat l="Chassi" v={v.chassi} />}
          </div>

          {sel.km_evolucao.length > 1 && (
            <Sec titulo="Evolução do KM">
              {sel.km_evolucao.map((p, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: ESP60, width: 74, flexShrink: 0 }}>{fmtData(p.data)}</span>
                  <div style={{ flex: 1, background: '#F0EADE', borderRadius: 6, height: 14, overflow: 'hidden' }}>
                    <div style={{ width: `${(p.km / kmMax) * 100}%`, height: '100%', background: GOLD }} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, width: 78, textAlign: 'right', flexShrink: 0 }}>{fmtKm(p.km)}</span>
                </div>
              ))}
            </Sec>
          )}

          <Sec titulo={`Histórico de serviços (${sel.os.length})`}>
            {sel.os.length === 0 && <div style={{ color: ESP60, fontSize: 13 }}>Sem OS registradas.</div>}
            {sel.os.map((o) => (
              <div key={o.id} style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, marginBottom: 10, background: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{fmtData(o.data)}</span>
                  <span style={{ fontSize: 11, color: ESP60 }}>{o.numero} · {STATUS_LABEL[o.status] ?? o.status}</span>
                </div>
                {o.defeito_relatado && <div style={{ fontSize: 13, color: ESP, marginTop: 4 }}>Queixa: {o.defeito_relatado}</div>}
                {o.diagnostico && <div style={{ fontSize: 13, color: ESP60, marginTop: 3 }}>Laudo: {o.diagnostico}</div>}
                {o.pecas_utilizadas && <div style={{ fontSize: 12, color: ESP60, marginTop: 3 }}>Peças: {o.pecas_utilizadas}</div>}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6, fontSize: 12, color: ESP60 }}>
                  {o.km != null && <span><Gauge size={12} style={{ verticalAlign: -1 }} /> {fmtKm(o.km)}</span>}
                  {o.tecnico_nome && <span><Wrench size={12} style={{ verticalAlign: -1 }} /> {o.tecnico_nome}</span>}
                  {o.itens_count > 0 && <span>{o.itens_count} item(ns) no laudo</span>}
                  {(o.valor_aprovado != null || o.total != null) && (
                    <span style={{ color: OK, fontWeight: 700, marginLeft: 'auto' }}>{brl(o.valor_aprovado ?? o.total)}</span>
                  )}
                </div>
              </div>
            ))}
          </Sec>
        </div>
      </div>
    )
  }

  // LISTA / BUSCA
  return (
    <div style={{ background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 14px 40px' }}>
        <button onClick={() => router.push('/dashboard/oficina/patio')} style={linkBtn}><ChevronLeft size={16} /> Pátio</button>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 6 }}>🔧 Oficina · Veículos</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}><Car size={22} /> Veículos</h1>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', border: `1px solid ${LINE}`, borderRadius: 10, padding: '0 10px', background: '#fff', flex: 1 }}>
            <Search size={16} color={ESP60} />
            <input value={termo} onChange={(e) => setTermo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void buscar() }}
              placeholder="Placa ou cliente…" style={{ ...inp, border: 'none', padding: '11px 0' }} />
          </div>
          <button onClick={() => void buscar()} disabled={carregando} style={{ ...btnGold, minWidth: 52 }}><Search size={18} /></button>
        </div>

        {lista.length === 0 && <div style={{ color: ESP60, fontSize: 14, padding: '20px 0' }}>{carregando ? 'Buscando…' : 'Nenhum veículo encontrado.'}</div>}
        {lista.map((veic) => (
          <button key={veic.placa} onClick={() => void abrir(veic.placa)} style={{ width: '100%', textAlign: 'left', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 10, cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: 1 }}>{veic.placa}</span>
              <span style={{ fontSize: 11, color: ESP60 }}>{veic.os_count} passagem(ns)</span>
            </div>
            <div style={{ fontSize: 13, color: ESP, marginTop: 3 }}>{[veic.marca, veic.modelo, veic.ano].filter(Boolean).join(' · ') || '—'}</div>
            <div style={{ fontSize: 12, color: ESP60, marginTop: 2 }}>{veic.cliente_nome || 'Cliente não informado'}{veic.ultimo_km != null ? ` · ${fmtKm(veic.ultimo_km)}` : ''}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function Sec({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: ESP60, fontWeight: 700, marginBottom: 10 }}>{titulo}</div>
      {children}
    </div>
  )
}
function Stat({ l, v }: { l: string; v: string }) {
  return (
    <div style={{ flex: 1, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 12px', minWidth: 0 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: ESP60, fontWeight: 700 }}>{l}</div>
      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</div>
    </div>
  )
}
const inp: CSSProperties = { width: '100%', padding: '11px 12px', border: `1px solid ${LINE}`, borderRadius: 10, fontSize: 15, background: '#fff', color: ESP, outline: 'none', fontFamily: 'inherit' }
const btnGold: CSSProperties = { background: GOLD, color: '#3D2314', border: 'none', borderRadius: 10, padding: '11px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }
const linkBtn: CSSProperties = { background: 'none', border: 'none', color: ESP60, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: 0 }
