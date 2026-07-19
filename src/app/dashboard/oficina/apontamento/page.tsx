'use client'
// OFICINA · APONTAMENTO DO MECÂNICO 💎 (tempo real por serviço). Mobile-first.
// Sobre os serviços APROVADOS do laudo: Iniciar (relógio) → Concluir → previsto × real (em horas).
// 🚫 SEM R$ — margem aqui é em HORAS. Custo/preço é da GE (lote sob validação do CEO).
import React, { useEffect, useState, useCallback, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Timer, ChevronLeft, Play, Square } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { PlacaInline } from '../_components/PlacaInline'

const ESP = '#3D2314'; const BG = '#FAF7F2'; const GOLD = '#C8941A'; const LINE = '#E7DECF'; const ESP60 = 'rgba(61,35,20,0.55)'
const OK = '#166534'; const RED = '#A32D2D'

type Apont = { id: string; status: string; tempo_real_h: number | null; iniciado_em: string | null; finalizado_em: string | null; mecanico_nome: string | null }
type ItemAp = { item_id: string; servico_id: string | null; descricao: string; tempo_estimado_h: number | null; severidade: string; apontamento: Apont | null }
type OSLinha = { id: string; numero: string; cliente_nome: string | null; placa: string | null; marca: string | null; modelo: string | null }

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

function horasDesde(iso: string | null): number {
  if (!iso) return 0
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, ms / 3600000)
}
function fmtH(h: number | null | undefined): string {
  if (h == null) return '—'
  const n = Number(h)
  if (n < 1) return `${Math.round(n * 60)}min`
  return `${n.toFixed(n % 1 === 0 ? 0 : 1)}h`
}

export default function ApontamentoPage() {
  const companyId = useCompanyId()
  const router = useRouter()
  const [lista, setLista] = useState<OSLinha[]>([])
  const [osSel, setOsSel] = useState<OSLinha | null>(null)
  const [itens, setItens] = useState<ItemAp[]>([])
  const [mecanico, setMecanico] = useState('')
  const [tempoManual, setTempoManual] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [, setTick] = useState(0)

  // relógio: re-render a cada 30s p/ atualizar o tempo decorrido dos apontamentos abertos
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 30000); return () => clearInterval(t) }, [])

  const carregarLista = useCallback(async () => {
    if (!companyId) return
    const { data } = await supabase.rpc('fn_oficina_os_fila', { p_company_id: companyId, p_etapa: 'apontamento' })
    setLista((data as OSLinha[]) ?? [])
  }, [companyId])
  const setPlacaLocal = (osId: string, placa: string) => setLista((p) => p.map((o) => (o.id === osId ? { ...o, placa } : o)))

  useEffect(() => { void carregarLista() }, [carregarLista])

  const carregarOS = useCallback(async (os: OSLinha) => {
    if (!companyId) return
    const { data } = await supabase.rpc('fn_oficina_apontamento_obter', { p_company_id: companyId, p_os_id: os.id })
    const d = data as { itens?: ItemAp[] } | null
    setItens(d?.itens ?? [])
  }, [companyId])

  const abrirOS = async (os: OSLinha) => {
    if (!companyId) return
    const { data } = await supabase.rpc('fn_oficina_apontamento_obter', { p_company_id: companyId, p_os_id: os.id })
    const d = data as { itens?: ItemAp[] } | null
    if ((d?.itens ?? []).length === 0) { setMsg('Sem serviços aprovados nessa OS. Faça diagnóstico + aprovação primeiro.'); return }
    setOsSel(os); setItens(d?.itens ?? [])
  }

  const iniciar = async (it: ItemAp) => {
    if (!companyId || !osSel) return
    setBusy(it.item_id)
    const { data, error } = await supabase.rpc('fn_oficina_apontamento_iniciar', {
      p_company_id: companyId, p_os_id: osSel.id, p_item_id: it.item_id, p_mecanico_nome: mecanico || null,
    })
    setBusy(null)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || j?.ok === false) { setMsg('❌ ' + (error?.message || j?.erro)); return }
    await carregarOS(osSel)
  }

  const concluir = async (it: ItemAp) => {
    if (!companyId || !osSel || !it.apontamento) return
    setBusy(it.item_id)
    const manual = tempoManual[it.item_id]
    const tempo = manual && manual.trim() ? Number(manual.replace(',', '.')) : null
    const { data, error } = await supabase.rpc('fn_oficina_apontamento_concluir', {
      p_company_id: companyId, p_apontamento_id: it.apontamento.id,
      p_tempo_real_h: tempo, p_mecanico_nome: mecanico || null, p_observacao: null,
    })
    setBusy(null)
    const j = data as { ok?: boolean; erro?: string; tempo_real_h?: number; execucao_gravada?: boolean } | null
    if (error || j?.ok === false) { setMsg('❌ ' + (error?.message || j?.erro)); return }
    setTempoManual((p) => { const n = { ...p }; delete n[it.item_id]; return n })
    setMsg(`✅ ${fmtH(j?.tempo_real_h)} registradas${j?.execucao_gravada ? ' (alimenta o tempário)' : ''}.`)
    await carregarOS(osSel)
  }

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t) }, [msg])

  if (!companyId) return <div style={{ padding: 24, color: ESP60, background: BG, minHeight: '100vh' }}>Selecione uma empresa específica no topo para abrir o Apontamento.</div>

  if (!osSel) return (
    <div style={{ background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 14px 40px' }}>
        <button onClick={() => router.push('/dashboard/oficina/patio')} style={linkBtn}><ChevronLeft size={16} /> Pátio</button>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 6 }}>🔧 Oficina · Apontamento</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}><Timer size={22} /> Em qual carro você vai trabalhar?</h1>
        {lista.length === 0 && <div style={{ color: ESP60, fontSize: 14, padding: '20px 0' }}>Nenhuma OS aprovada ainda. Passe pela Aprovação primeiro.</div>}
        {lista.map((os) => (
          <div key={os.id} onClick={() => void abrirOS(os)} style={{ width: '100%', textAlign: 'left', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 10, cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <PlacaInline companyId={companyId} osId={os.id} placa={os.placa} onSaved={(p) => setPlacaLocal(os.id, p)} />
              <span style={{ fontSize: 11, color: ESP60 }}>{os.numero}</span>
            </div>
            <div style={{ fontSize: 13, color: ESP, marginTop: 3 }}>{[os.marca, os.modelo].filter(Boolean).join(' ') || 'Veículo'}{os.cliente_nome ? ` · ${os.cliente_nome}` : ''}</div>
          </div>
        ))}
      </div>
      {msg && <Toast>{msg}</Toast>}
    </div>
  )

  const totalPrev = itens.reduce((s, i) => s + (Number(i.tempo_estimado_h) || 0), 0)
  const totalReal = itens.reduce((s, i) => s + (i.apontamento?.status === 'concluido' ? (Number(i.apontamento.tempo_real_h) || 0) : 0), 0)

  return (
    <div style={{ background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 14px 96px' }}>
        <button onClick={() => setOsSel(null)} style={linkBtn}><ChevronLeft size={16} /> Trocar veículo</button>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 6 }}>🔧 Oficina · Apontamento · {osSel.numero}</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '2px 0 10px' }}>{osSel.placa} · {osSel.marca} {osSel.modelo}</h1>

        <Sec titulo="Mecânico">
          <input value={mecanico} onChange={(e) => setMecanico(e.target.value)} placeholder="Seu nome" style={inp} />
        </Sec>

        <Sec titulo="Serviços aprovados">
          {itens.map((it) => {
            const ap = it.apontamento
            const rodando = ap?.status === 'em_andamento'
            const concluido = ap?.status === 'concluido'
            const decorrido = rodando ? horasDesde(ap!.iniciado_em) : 0
            const real = concluido ? Number(ap!.tempo_real_h) : null
            const prev = Number(it.tempo_estimado_h) || 0
            const estourou = real != null && prev > 0 && real > prev
            return (
              <div key={it.item_id} style={{ border: `1px solid ${rodando ? GOLD : LINE}`, borderRadius: 12, padding: 12, marginBottom: 10, background: '#fff' }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{it.descricao}</div>
                <div style={{ fontSize: 11, color: ESP60, marginTop: 2 }}>
                  Previsto {fmtH(it.tempo_estimado_h)}{it.servico_id ? ' · tempário' : ''}
                  {concluido && <> · Real <b style={{ color: estourou ? RED : OK }}>{fmtH(real)}</b>{ap?.mecanico_nome ? ` · ${ap.mecanico_nome}` : ''}</>}
                </div>

                {!ap && (
                  <button onClick={() => void iniciar(it)} disabled={busy === it.item_id} style={{ ...btnGold, marginTop: 10, width: '100%', gap: 6 }}><Play size={16} /> Iniciar</button>
                )}
                {rodando && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 13, color: GOLD, fontWeight: 700, marginBottom: 8 }}>⏱ Em andamento · {fmtH(decorrido)} decorrida(s)</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input value={tempoManual[it.item_id] ?? ''} onChange={(e) => setTempoManual((p) => ({ ...p, [it.item_id]: e.target.value.replace(/[^\d.,]/g, '') }))}
                        placeholder={`Horas (ex.: ${prev || 1})`} inputMode="decimal" style={{ ...inp, flex: 1 }} />
                      <button onClick={() => void concluir(it)} disabled={busy === it.item_id} style={{ ...btnDark, gap: 6, minWidth: 130 }}><Square size={15} /> Concluir</button>
                    </div>
                    <div style={{ fontSize: 11, color: ESP60, marginTop: 4 }}>Deixe em branco p/ usar o relógio ({fmtH(decorrido)}).</div>
                  </div>
                )}
                {concluido && (
                  <button onClick={() => void iniciar(it)} disabled={busy === it.item_id} style={{ ...btnLine, marginTop: 10, width: '100%' }}>Reabrir / refazer</button>
                )}
              </div>
            )
          })}
          {itens.length === 0 && <div style={{ color: ESP60, fontSize: 13 }}>Nenhum serviço aprovado.</div>}
        </Sec>
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: `1px solid ${LINE}`, padding: '10px 14px' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700 }}>
          <span style={{ color: ESP60 }}>Previsto <b style={{ color: ESP }}>{fmtH(totalPrev)}</b></span>
          <span style={{ color: ESP60 }}>Real <b style={{ color: totalReal > totalPrev && totalPrev > 0 ? RED : OK }}>{fmtH(totalReal)}</b></span>
        </div>
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
function Toast({ children }: { children: React.ReactNode }) {
  return <div style={{ position: 'fixed', bottom: 74, left: '50%', transform: 'translateX(-50%)', background: ESP, color: '#fff', padding: '10px 16px', borderRadius: 999, fontSize: 13, zIndex: 70, maxWidth: '92%', textAlign: 'center' }}>{children}</div>
}
const inp: CSSProperties = { width: '100%', padding: '11px 12px', border: `1px solid ${LINE}`, borderRadius: 10, fontSize: 15, background: '#fff', color: ESP, outline: 'none', fontFamily: 'inherit' }
const btnGold: CSSProperties = { background: GOLD, color: '#3D2314', border: 'none', borderRadius: 10, padding: '11px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }
const btnDark: CSSProperties = { background: ESP, color: '#fff', border: 'none', borderRadius: 10, padding: '11px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }
const btnLine: CSSProperties = { background: '#fff', color: ESP, border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }
const linkBtn: CSSProperties = { background: 'none', border: 'none', color: ESP60, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: 0 }
