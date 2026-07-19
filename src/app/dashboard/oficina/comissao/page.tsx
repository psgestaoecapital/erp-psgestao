'use client'
// OFICINA · COMISSÃO DO MECÂNICO (relatório gerencial). Mobile-friendly.
// Base: horas reais apontadas (LOTE 4) + produção (valor dos serviços) × regra por mecânico.
// 🚫 SEM folha/pagamento/lançamento — é só o CÁLCULO. A GE paga (fronteira financeira).
import React, { useEffect, useState, useCallback, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Percent, ChevronLeft, Plus, Clock, TrendingUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314'; const BG = '#FAF7F2'; const GOLD = '#C8941A'; const LINE = '#E7DECF'; const ESP60 = 'rgba(61,35,20,0.55)'
const OK = '#166534'
const brl = (n: number | null | undefined) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0)
const fmtH = (h: number | null | undefined) => `${(Number(h) || 0).toFixed(1)}h`

type MecCalc = { mecanico: string; servicos: number; horas: number; producao: number; regra_tipo: string | null; regra_valor: number | null; comissao: number }
type Regra = { id: string; mecanico_nome: string | null; tipo: string; valor: number }

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

function isoHoje(): string { return new Date().toISOString().slice(0, 10) }
function isoInicioMes(): string { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10) }

export default function ComissaoPage() {
  const companyId = useCompanyId()
  const router = useRouter()
  const [ini, setIni] = useState(isoInicioMes())
  const [fim, setFim] = useState(isoHoje())
  const [mecs, setMecs] = useState<MecCalc[]>([])
  const [regras, setRegras] = useState<Regra[]>([])
  const [carregando, setCarregando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // form de regra
  const [rNome, setRNome] = useState('')
  const [rTipo, setRTipo] = useState('percentual_mo')
  const [rValor, setRValor] = useState('')

  const calcular = useCallback(async () => {
    if (!companyId) return
    setCarregando(true)
    const [{ data: calc }, { data: regs }] = await Promise.all([
      supabase.rpc('fn_oficina_comissao_calcular', { p_company_id: companyId, p_data_ini: ini, p_data_fim: fim }),
      supabase.rpc('fn_oficina_comissao_regras', { p_company_id: companyId }),
    ])
    const c = calc as { mecanicos?: MecCalc[] } | null
    setMecs(c?.mecanicos ?? [])
    setRegras((regs as Regra[]) ?? [])
    setCarregando(false)
  }, [companyId, ini, fim])

  useEffect(() => { void calcular() }, [companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  const salvarRegra = async () => {
    if (!companyId) return
    const { data, error } = await supabase.rpc('fn_oficina_comissao_regra_salvar', {
      p_company_id: companyId, p_dados: { mecanico_nome: rNome || null, tipo: rTipo, valor: rValor.replace(',', '.') || '0' },
    })
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || j?.ok === false) { setMsg('❌ ' + (error?.message || j?.erro)); return }
    setMsg('✅ Regra salva.'); setRNome(''); setRValor('')
    await calcular()
  }

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t) }, [msg])

  if (!companyId) return <div style={{ padding: 24, color: ESP60, background: BG, minHeight: '100vh' }}>Selecione uma empresa específica no topo para abrir a Comissão.</div>

  const totalComissao = mecs.reduce((s, m) => s + (Number(m.comissao) || 0), 0)
  const descRegra = (r: Regra) => r.tipo === 'por_hora' ? `${brl(r.valor)}/h` : `${Number(r.valor)}% da mão de obra`

  return (
    <div style={{ background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '16px 14px 40px' }}>
        <button onClick={() => router.push('/dashboard/oficina/patio')} style={linkBtn}><ChevronLeft size={16} /> Pátio</button>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 6 }}>🔧 Oficina · Comissão</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}><Percent size={22} /> Comissão do mecânico</h1>
        <div style={{ fontSize: 12, color: ESP60, marginBottom: 12 }}>Cálculo pelos serviços executados (apontados). O pagamento é feito pela gestão financeira.</div>

        <Sec titulo="Período">
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Campo l="De"><input type="date" value={ini} onChange={(e) => setIni(e.target.value)} style={inp} /></Campo>
            <Campo l="Até"><input type="date" value={fim} onChange={(e) => setFim(e.target.value)} style={inp} /></Campo>
            <button onClick={() => void calcular()} disabled={carregando} style={{ ...btnGold, height: 42 }}>{carregando ? 'Calculando…' : 'Calcular'}</button>
          </div>
        </Sec>

        <Sec titulo={`Comissão por mecânico · total ${brl(totalComissao)}`}>
          {mecs.length === 0 && <div style={{ color: ESP60, fontSize: 13 }}>Nenhum serviço apontado no período.</div>}
          {mecs.map((m) => (
            <div key={m.mecanico} style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, marginBottom: 10, background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{m.mecanico}</span>
                <span style={{ fontWeight: 800, fontSize: 18, color: OK }}>{brl(m.comissao)}</span>
              </div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6, fontSize: 12, color: ESP60 }}>
                <span><Clock size={12} style={{ verticalAlign: -1 }} /> {fmtH(m.horas)}</span>
                <span><TrendingUp size={12} style={{ verticalAlign: -1 }} /> produção {brl(m.producao)}</span>
                <span>{m.servicos} serviço(s)</span>
                <span style={{ marginLeft: 'auto' }}>{m.regra_tipo ? (m.regra_tipo === 'por_hora' ? `${brl(m.regra_valor)}/h` : `${Number(m.regra_valor)}%`) : 'sem regra'}</span>
              </div>
            </div>
          ))}
        </Sec>

        <Sec titulo="Regras de comissão">
          {regras.map((r) => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${LINE}` }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{r.mecanico_nome || 'Padrão (todos)'}</span>
              <span style={{ fontSize: 13, color: ESP60 }}>{descRegra(r)}</span>
            </div>
          ))}
          <div style={{ marginTop: 12 }}>
            <Campo l="Mecânico (em branco = regra padrão da empresa)"><input value={rNome} onChange={(e) => setRNome(e.target.value)} placeholder="Nome do mecânico" style={inp} /></Campo>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Campo l="Tipo">
                <select value={rTipo} onChange={(e) => setRTipo(e.target.value)} style={{ ...inp, minWidth: 180 }}>
                  <option value="percentual_mo">% da mão de obra</option>
                  <option value="por_hora">R$ por hora</option>
                </select>
              </Campo>
              <Campo l={rTipo === 'por_hora' ? 'R$/hora' : '% (percentual)'}><input value={rValor} onChange={(e) => setRValor(e.target.value.replace(/[^\d.,]/g, ''))} inputMode="decimal" placeholder={rTipo === 'por_hora' ? '30' : '10'} style={{ ...inp, maxWidth: 120 }} /></Campo>
              <button onClick={() => void salvarRegra()} style={{ ...btnGold, height: 42, gap: 4 }}><Plus size={15} /> Salvar regra</button>
            </div>
          </div>
        </Sec>
      </div>
      {msg && <Toast>{msg}</Toast>}
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
function Campo({ l, children }: { l: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 10 }}><div style={{ fontSize: 11, color: ESP60, marginBottom: 4 }}>{l}</div>{children}</div>
}
function Toast({ children }: { children: React.ReactNode }) {
  return <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: ESP, color: '#fff', padding: '10px 16px', borderRadius: 999, fontSize: 13, zIndex: 70, maxWidth: '92%', textAlign: 'center' }}>{children}</div>
}
const inp: CSSProperties = { width: '100%', padding: '10px 12px', border: `1px solid ${LINE}`, borderRadius: 10, fontSize: 15, background: '#fff', color: ESP, outline: 'none', fontFamily: 'inherit' }
const btnGold: CSSProperties = { background: GOLD, color: '#3D2314', border: 'none', borderRadius: 10, padding: '10px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }
const linkBtn: CSSProperties = { background: 'none', border: 'none', color: ESP60, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: 0 }
