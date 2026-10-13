'use client'
// F2.6 · Linha do tempo da obra — a história completa (oportunidade → levantamento → orçamento → obra → medição).
// Tudo de fn_obra_linha_do_tempo (RD-26: consulta unificada, não persiste). Tempo por fase calculado aqui.
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A'
const brl = (n: number | null | undefined) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Ev = { quando: string; fase: string; tipo: string; descricao: string | null; autor: string }
type Obra = { id: string; numero: string; nome: string | null; cliente: string | null; status: string; valor_previsto: number | null; valor_medido: number | null; centro_custo_id: string | null; data_inicio: string | null }
type Timeline = { ok: boolean; erro?: string; obra?: Obra; eventos: Ev[]; total_eventos: number }

// Ordem canônica das fases + rótulo/ícone (genérico, qualquer funil).
const FASES: { v: string; l: string; icone: string }[] = [
  { v: 'oportunidade', l: 'Oportunidade', icone: '🎯' },
  { v: 'levantamento', l: 'Levantamento', icone: '📐' },
  { v: 'orcamento', l: 'Orçamento', icone: '📄' },
  { v: 'obra', l: 'Obra', icone: '🏗️' },
  { v: 'medicao', l: 'Medição', icone: '📏' },
]
const faseInfo = (v: string) => FASES.find((f) => f.v === v) ?? { v, l: v, icone: '•' }
const fmtDataHora = (iso: string) => { const d = new Date(iso); return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) }
const fmtData = (iso: string) => { const d = new Date(iso); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) }
const diasEntre = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000))

export default function LinhaDoTempoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [tl, setTl] = useState<Timeline | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [faseFiltro, setFaseFiltro] = useState<string>('todas')

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_linha_do_tempo', { p_obra_id: id })
    setLoading(false)
    if (error) { setErro(error.message); return }
    const j = data as Timeline
    if (!j?.ok) { setErro(j?.erro === 'sem_acesso' ? 'Sem acesso a esta obra.' : (j?.erro ?? 'Falha ao carregar a linha do tempo.')); return }
    setTl(j)
  }, [id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  const eventos = useMemo(() => (tl?.eventos ?? []).slice().sort((a, b) => a.quando.localeCompare(b.quando)), [tl])

  // Marcos por fase (início de cada fase presente) + dias desde a fase anterior → lead time do negócio.
  const marcos = useMemo(() => {
    const inicioPorFase = new Map<string, string>()
    for (const e of eventos) if (!inicioPorFase.has(e.fase)) inicioPorFase.set(e.fase, e.quando)
    const ordenadas = FASES.filter((f) => inicioPorFase.has(f.v))
    return ordenadas.map((f, i) => {
      const inicio = inicioPorFase.get(f.v)!
      const dias = i === 0 ? 0 : diasEntre(inicioPorFase.get(ordenadas[i - 1].v)!, inicio)
      return { fase: f.v, l: f.l, icone: f.icone, inicio, dias }
    })
  }, [eventos])
  const cicloTotal = eventos.length >= 2 ? diasEntre(eventos[0].quando, eventos[eventos.length - 1].quando) : 0

  const eventosFiltrados = faseFiltro === 'todas' ? eventos : eventos.filter((e) => e.fase === faseFiltro)
  const obra = tl?.obra

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <Link href="/dashboard/projetos/obras?area=hub" style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Obras</Link>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 8 }}>Hub · Obra</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, color: ESP, margin: '2px 0 4px' }}>
          Linha do tempo {obra ? `· ${obra.numero}` : ''}
        </h1>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div>
          : erro ? <div style={{ background: '#FBEAEA', color: '#B91C1C', borderRadius: 10, padding: 14, fontSize: 13 }}>{erro}</div>
          : (
            <>
              {/* Cabeçalho da obra */}
              {obra && (
                <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: ESP }}>{obra.nome || obra.numero}</div>
                  <div style={{ fontSize: 12.5, color: MUT, marginTop: 2 }}>{obra.cliente || 'Cliente não informado'} · {obra.status}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginTop: 10 }}>
                    <Mini label="Contratado" valor={brl(obra.valor_previsto)} cor={ESP} />
                    <Mini label="Medido" valor={brl(obra.valor_medido)} cor={VERDE} />
                    <Mini label="Centro de custo" valor={obra.centro_custo_id ? obra.numero : '—'} cor={ESP} />
                  </div>
                </div>
              )}

              {/* Barra de fases com o tempo de cada uma (lead time) */}
              {marcos.length > 0 && (
                <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: ESP }}>Tempo por fase</span>
                    {cicloTotal > 0 && <span style={{ fontSize: 12, color: GOLD, fontWeight: 700 }}>Ciclo total: {cicloTotal} {cicloTotal === 1 ? 'dia' : 'dias'}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {marcos.map((m, i) => (
                      <div key={m.fase} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {i > 0 && <span style={{ fontSize: 11, color: MUT }}>+{m.dias}{m.dias === 1 ? 'd' : 'd'} →</span>}
                        <div style={{ background: BG, border: `1px solid ${LINE}`, borderRadius: 999, padding: '5px 10px', fontSize: 11.5, color: ESP }}>
                          <span aria-hidden>{m.icone}</span> {m.l} <span style={{ color: MUT }}>· {fmtData(m.inicio)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Filtro por fase */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                <ChipFase ativo={faseFiltro === 'todas'} onClick={() => setFaseFiltro('todas')}>Tudo ({eventos.length})</ChipFase>
                {FASES.filter((f) => eventos.some((e) => e.fase === f.v)).map((f) => (
                  <ChipFase key={f.v} ativo={faseFiltro === f.v} onClick={() => setFaseFiltro(f.v)}>{f.icone} {f.l}</ChipFase>
                ))}
              </div>

              {/* Timeline vertical */}
              {eventos.length === 0 ? (
                <div style={{ background: '#fff', border: `1px dashed ${LINE}`, borderRadius: 12, padding: 24, textAlign: 'center' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: ESP }}>Sem eventos registrados ainda</div>
                  <div style={{ fontSize: 12.5, color: MUT, marginTop: 6, maxWidth: 480, marginInline: 'auto' }}>Esta obra foi criada antes do registro de histórico. Os eventos a partir de agora aparecerão aqui.</div>
                </div>
              ) : (
                <div style={{ position: 'relative', paddingLeft: 8 }}>
                  {eventosFiltrados.map((e, i) => {
                    const fi = faseInfo(e.fase)
                    return (
                      <div key={i} style={{ display: 'flex', gap: 12, paddingBottom: 14, position: 'relative' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <div style={{ width: 30, height: 30, borderRadius: 999, background: '#fff', border: `1.5px solid ${GOLD}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>{fi.icone}</div>
                          {i < eventosFiltrados.length - 1 && <div style={{ width: 1.5, flex: 1, background: LINE, marginTop: 2 }} />}
                        </div>
                        <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 10, padding: '9px 12px', flex: 1, marginBottom: 2 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: GOLD, fontWeight: 700 }}>{fi.l}</span>
                            <span style={{ fontSize: 11, color: MUT }}>{fmtDataHora(e.quando)}</span>
                          </div>
                          <div style={{ fontSize: 13, color: ESP, marginTop: 3 }}>{e.descricao || e.tipo}</div>
                          <div style={{ fontSize: 11.5, color: MUT, marginTop: 3 }}><span aria-hidden>👤</span> {e.autor}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
      </div>
    </div>
  )
}

function Mini({ label, valor, cor }: { label: string; valor: string; cor: string }) {
  return (
    <div style={{ background: BG, border: `0.5px solid ${LINE}`, borderRadius: 10, padding: '8px 10px' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: cor }}>{valor}</div>
      <div style={{ fontSize: 10, color: MUT, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
    </div>
  )
}
function ChipFase({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} style={{ padding: '5px 11px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', border: `1px solid ${ativo ? GOLD : LINE}`, background: ativo ? '#FBF4E4' : '#fff', color: ativo ? '#A57A15' : MUT }}>{children}</button>
}
