// src/app/sign/nr36/[token]/page.tsx
// Rota PÚBLICA (sem auth) — colaborador abre via link (wa.me) e dá CIÊNCIA + assina o relatório
// mensal de pausas térmicas (NR-36 · Art. 253 CLT), com valor jurídico pela Lei 14.063/2020.
//
// Espelha o padrão EPI (/sign/epi/[token]): anon client → RPCs SECURITY DEFINER com GRANT a anon.
// A ABERTURA é registrada (fn_..._marcar_visualizado) mesmo sem assinar — prova de apresentação.
//
// 🔒 RD-38: cada horário DECLARA sua origem. "confirmado pelo ponto" e "estimado" NUNCA parecem
// "registrado". O colaborador assina sabendo o que é dado e o que é inferência.

'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const C = {
  espresso: '#3D2314', espressoM: '#6B5D4F', offwhite: '#FAF7F2', cream: '#F0ECE3',
  gold: '#C8941A', borderLt: '#E0D8CC', ink: '#1A1A1A', muted: 'rgba(61,35,20,0.55)',
  green: '#16A34A', greenSoft: '#DCFCE7', red: '#DC2626', redSoft: '#FEE2E2',
  amber: '#B45309', amberSoft: '#FEF3C7', blue: '#1D4ED8',
}

interface Pausa { de: string | null; ate: string | null; min: number | null; classe: string | null; fim_origem: string | null; origem_label?: string | null; fim_original?: string | null }
interface Dia { data: string; status: string; jornada?: { inicio?: string; fim?: string } | null; pausas: Pausa[] }
interface Viz {
  token_id: string; company_id: string
  colaborador: { nome?: string; cpf?: string; matricula?: string; pis?: string; funcao?: string; setor?: string } | null
  competencia: string; periodo_inicio: string; periodo_fim: string
  resumo: { conforme?: number; desvio?: number; pendente_confirmacao?: number; sem_dado?: number; dias_total?: number } | null
  detalhe: Dia[] | null
  documento_hash: string; expires_at: string; expirado: boolean; ja_assinado: boolean; recusado: boolean
}

function maskCPF(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}
const fmtData = (s: string) => { try { return new Date(s + (s.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('pt-BR') } catch { return s } }
const fmtDT = (s: string) => { try { return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return s } }
const competenciaLabel = (s: string) => { try { const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) } catch { return s } }

// as 3 aparências por origem (RD-38): registrado ≠ confirmado pelo ponto ≠ estimado
function renderPausaFim(p: Pausa): { texto: string; cor: string; sufixo: string } {
  const de = p.de || '—'
  if (!p.ate) return { texto: `${de} → sem registro de saída`, cor: C.red, sufixo: '' }
  switch (p.fim_origem) {
    case 'estimado': return { texto: `${de} → ~${p.ate}`, cor: C.amber, sufixo: ' (estimado)' }
    case 'confirmado_ponto': return { texto: `${de} → ${p.ate}`, cor: C.blue, sufixo: ' (confirmado pelo ponto)' }
    case 'confirmado_manual': return { texto: `${de} → ${p.ate}`, cor: C.espresso, sufixo: ' (confirmado)' }
    default: return { texto: `${de} → ${p.ate}`, cor: C.espresso, sufixo: '' } // registrado no relógio
  }
}

export default function SignNr36Page() {
  const params = useParams()
  const token = params?.token as string
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [viz, setViz] = useState<Viz | null>(null)
  const [cpf, setCpf] = useState('')
  const [aceito, setAceito] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [okHash, setOkHash] = useState<string | null>(null)
  const [geoloc, setGeoloc] = useState<{ lat: number; lng: number; accuracy: number } | null>(null)

  useEffect(() => {
    if (!token) return
    let alive = true
    ;(async () => {
      try {
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null
        const { data, error } = await supabase.rpc('fn_nr36_ciencia_marcar_visualizado', { p_token: token, p_ip: null, p_user_agent: ua })
        if (error) throw error
        const r = (Array.isArray(data) ? data[0] : data) as Viz
        if (!alive) return
        if (!r) throw new Error('Documento não encontrado')
        setViz(r)
      } catch (e) { if (alive) setErro((e as Error)?.message || 'Falha ao carregar') }
      finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [token])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeoloc({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => { /* negou — segue sem geoloc */ }, { enableHighAccuracy: false, timeout: 6000, maximumAge: 0 },
    )
  }, [])

  async function confirmar() {
    if (!viz || cpf.replace(/\D/g, '').length !== 11 || !aceito) return
    setEnviando(true); setErro(null)
    try {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null
      const { data, error } = await supabase.rpc('fn_nr36_ciencia_confirmar_assinatura', {
        p_token: token, p_codigo_confirmacao: cpf.replace(/\D/g, ''), p_ip: null, p_user_agent: ua,
        p_geolocalizacao: geoloc ?? null, p_foto_url: null,
      })
      if (error) throw error
      const r = (Array.isArray(data) ? data[0] : data) as { sucesso: boolean; assinatura_hash: string | null; mensagem: string }
      if (!r?.sucesso) throw new Error(r?.mensagem || 'CPF não confere.')
      setOkHash(r.assinatura_hash)
    } catch (e) { setErro((e as Error)?.message || 'Falha ao confirmar') }
    finally { setEnviando(false) }
  }

  if (loading) return <Shell><p style={{ textAlign: 'center', color: C.muted }}>Carregando…</p></Shell>
  if (erro && !viz) return <Shell><div style={erroBox}>{erro}</div></Shell>
  if (okHash || viz?.ja_assinado) return (
    <Shell>
      <div style={{ textAlign: 'center', padding: 20 }}>
        <div style={{ fontSize: 56, marginBottom: 10 }}>✅</div>
        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, color: C.espresso, margin: '0 0 8px' }}>Ciência registrada</h2>
        <p style={{ color: C.espressoM, fontSize: 14, margin: 0 }}>Obrigado. Sua assinatura foi registrada com valor jurídico (Lei 14.063/2020).</p>
        {okHash && <div style={{ background: C.cream, padding: 12, borderRadius: 8, fontFamily: 'monospace', fontSize: 12, color: C.espresso, marginTop: 14 }}><div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>Hash de integridade:</div>{okHash.slice(0, 24)}…</div>}
      </div>
    </Shell>
  )
  if (viz?.recusado) return <Shell><div style={{ ...erroBox, background: C.amberSoft, color: C.amber, borderLeftColor: C.amber }}>Este documento foi marcado como recusado. Fale com o responsável de SST.</div></Shell>
  if (viz?.expirado) return <Shell><div style={{ textAlign: 'center', padding: 20 }}><div style={{ fontSize: 48 }}>⏰</div><h2 style={{ fontFamily: 'Fraunces, Georgia, serif', color: C.espresso }}>Link expirou</h2><p style={{ color: C.espressoM, fontSize: 14 }}>Solicite um novo link ao responsável de SST.</p></div></Shell>

  const col = viz?.colaborador || {}
  const dias = viz?.detalhe || []
  const r = viz?.resumo || {}
  const nEstimadas = dias.reduce((acc, d) => acc + (d.pausas || []).filter(p => p.fim_origem === 'estimado').length, 0)
  const primeiro = (col.nome || '').split(' ')[0] || 'colaborador(a)'

  return (
    <Shell>
      <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, color: C.espresso, margin: '0 0 4px' }}>Olá, {primeiro}!</h2>
      <p style={{ color: C.espressoM, fontSize: 14, margin: '0 0 16px' }}>Confira o relatório das suas pausas térmicas de <strong>{competenciaLabel(viz!.competencia)}</strong> e dê sua ciência.</p>

      <div style={card}>
        <Linha k="Nome" v={col.nome} /><Linha k="CPF" v={col.cpf} /><Linha k="Matrícula" v={col.matricula} />
        <Linha k="PIS" v={col.pis} /><Linha k="Função" v={col.funcao} /><Linha k="Setor" v={col.setor} />
        <Linha k="Período" v={`${fmtData(viz!.periodo_inicio)} a ${fmtData(viz!.periodo_fim)}`} />
      </div>

      <div style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Kpi n={r.conforme ?? 0} l="Conformes" c={C.green} />
        <Kpi n={r.desvio ?? 0} l="Desvios" c={C.red} />
        <Kpi n={r.pendente_confirmacao ?? 0} l="Em confirmação" c={C.amber} />
        <Kpi n={r.dias_total ?? 0} l="Dias" c={C.espresso} />
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, letterSpacing: 1, textTransform: 'uppercase', margin: '4px 2px 8px' }}>Detalhamento diário</div>
      {dias.map((d, i) => (
        <div key={i} style={{ ...card, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <strong style={{ color: C.espresso, fontSize: 13 }}>{fmtData(d.data)}</strong>
            <span style={{ fontSize: 11, color: C.muted }}>{d.jornada?.inicio && d.jornada?.fim ? `jornada ${d.jornada.inicio}–${d.jornada.fim}` : ''}</span>
          </div>
          {(d.pausas || []).length === 0 ? <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>Nenhuma pausa registrada neste dia.</div> :
            (d.pausas || []).map((p, j) => { const f = renderPausaFim(p); return (
              <div key={j} style={{ fontSize: 13, color: C.espresso, lineHeight: 1.7 }}>
                <span style={{ fontFamily: 'monospace' }}>{f.texto}</span>
                <span style={{ color: f.cor, fontWeight: 600 }}>{f.sufixo}</span>
                {p.min != null && <span style={{ color: C.muted, fontSize: 11 }}> · {p.min} min</span>}
              </div>
            ) })}
        </div>
      ))}

      {nEstimadas > 0 && (
        <div style={{ ...card, background: C.amberSoft, borderColor: C.amber }}>
          <p style={{ fontSize: 12, color: C.amber, margin: 0, lineHeight: 1.5 }}>
            <strong>{nEstimadas} pausa(s)</strong> deste período tiveram o horário de término <strong>estimado</strong> por falta de registro de saída. A estimativa considera a duração padrão de 20 minutos e <strong>não substitui o registro</strong>.
          </p>
        </div>
      )}

      <div style={{ ...card, background: C.amberSoft, borderColor: C.amber }}>
        <p style={{ fontSize: 12, color: '#92400E', margin: 0, lineHeight: 1.5 }}>
          <strong>Aviso legal:</strong> Sua ciência tem valor jurídico pela <strong>Lei 14.063/2020</strong>. Um hash de integridade garante que o documento não foi alterado.
        </p>
      </div>

      <label style={labelStyle}>Confirme seu CPF para assinar</label>
      <input type="tel" inputMode="numeric" value={cpf} onChange={(e) => setCpf(maskCPF(e.target.value))} placeholder="000.000.000-00" autoComplete="off" style={inputStyle} />

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12, background: '#FFFFFF', border: `1px solid ${C.borderLt}`, borderRadius: 8, marginTop: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={aceito} onChange={(e) => setAceito(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18, accentColor: C.gold, flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: C.espresso, lineHeight: 1.5 }}>Tomei ciência do relatório das minhas pausas térmicas neste período, incluindo os horários registrados, confirmados pelo ponto e estimados.</span>
      </label>

      {erro && <div style={{ ...erroBox, marginTop: 12 }}>{erro}</div>}

      <button onClick={confirmar} disabled={!(cpf.replace(/\D/g, '').length === 11 && aceito && !enviando)}
        style={{ marginTop: 16, width: '100%', minHeight: 52, padding: 14, borderRadius: 10, border: 'none',
          background: (cpf.replace(/\D/g, '').length === 11 && aceito && !enviando) ? C.green : C.borderLt,
          color: '#FFFFFF', fontSize: 15, fontWeight: 700, cursor: (cpf.replace(/\D/g, '').length === 11 && aceito && !enviando) ? 'pointer' : 'not-allowed' }}>
        {enviando ? '⏳ Registrando…' : '✓ Dar ciência e assinar'}
      </button>
      <p style={{ fontSize: 10, color: C.muted, textAlign: 'center', margin: '14px 0 0' }}>Link expira em {fmtDT(viz?.expires_at ?? '')}</p>
    </Shell>
  )
}

function Linha({ k, v }: { k: string; v?: string | null }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0', borderBottom: `1px solid ${C.cream}` }}><span style={{ color: C.muted }}>{k}</span><span style={{ color: C.espresso, fontWeight: 600 }}>{v || '—'}</span></div>
}
function Kpi({ n, l, c }: { n: number; l: string; c: string }) {
  return <div style={{ flex: '1 1 60px', textAlign: 'center' }}><div style={{ fontSize: 22, fontWeight: 800, color: c, lineHeight: 1 }}>{n}</div><div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{l}</div></div>
}
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: C.offwhite, color: C.ink, padding: 'clamp(12px,4vw,24px)', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <header style={{ textAlign: 'center', marginBottom: 20, paddingTop: 12 }}>
          <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 700, color: C.espresso, letterSpacing: 1 }}>PS <span style={{ color: C.gold }}>Gestão</span></div>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2, textTransform: 'uppercase', marginTop: 2 }}>Ciência de Pausas Térmicas · NR-36</div>
        </header>
        {children}
        <footer style={{ marginTop: 28, paddingTop: 16, borderTop: `1px solid ${C.borderLt}`, fontSize: 10, color: C.muted, textAlign: 'center', lineHeight: 1.6 }}>Lei 14.063/2020 · Hash SHA-256 · Registro de abertura e assinatura</footer>
      </div>
    </div>
  )
}
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: C.espresso, letterSpacing: 0.5, marginTop: 14, marginBottom: 6, textTransform: 'uppercase' }
const inputStyle: React.CSSProperties = { width: '100%', padding: '14px', background: '#FFFFFF', border: `1px solid ${C.borderLt}`, borderRadius: 8, fontSize: 17, color: C.ink, outline: 'none', boxSizing: 'border-box' }
const card: React.CSSProperties = { background: '#FFFFFF', border: `1px solid ${C.borderLt}`, borderRadius: 10, padding: 14, marginBottom: 12 }
const erroBox: React.CSSProperties = { background: C.redSoft, color: '#991B1B', padding: '12px 14px', borderRadius: 8, fontSize: 13, borderLeft: `4px solid ${C.red}` }
