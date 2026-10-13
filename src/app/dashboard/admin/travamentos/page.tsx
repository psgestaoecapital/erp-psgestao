'use client'

// P0 (16bc8561) · painel "registro de travamentos" (Camada 4). Lê fn_travamentos_resumo (agregado
// por etapa na janela). Guarda de acesso é NO SERVIDOR (só adm/acesso_total ou PS_ADMIN) — se a RPC
// devolver 42501, mostramos "acesso restrito". Dado interno da PS, não é do cliente.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { comPrazo } from '@/lib/comPrazo'

type Linha = {
  label: string
  total: number
  timeouts: number
  max_ms: number | null
  avg_ms: number | null
  ultimo: string
}

const JANELAS: { label: string; horas: number }[] = [
  { label: '24 h', horas: 24 },
  { label: '7 dias', horas: 24 * 7 },
  { label: '30 dias', horas: 24 * 30 },
]

const C = {
  bg: '#FAF7F2', card: '#FFFFFF', border: '#E0D8CC', text: '#3D2314',
  textM: '#6B5D4F', textD: '#9C8E80', gold: '#C8941A', red: '#EF4444', green: '#22C55E',
}

function fmtMs(ms: number | null): string {
  if (ms == null) return '—'
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`
  return `${ms} ms`
}
function fmtQuando(iso: string): string {
  try { return new Date(iso).toLocaleString('pt-BR') } catch { return iso }
}

export default function TravamentosPage() {
  const [horas, setHoras] = useState(24)
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [semAcesso, setSemAcesso] = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null); setSemAcesso(false)
    try {
      const desde = new Date(Date.now() - horas * 3600 * 1000).toISOString()
      const { data, error } = await comPrazo(
        async () => await supabase.rpc('fn_travamentos_resumo', { p_desde: desde }),
        { ms: 8000, tentativas: 1, label: 'admin_travamentos_resumo' },
      )
      if (error) {
        // 42501 = guarda de acesso da RPC negou (não é adm/PS)
        if (error.code === '42501' || /sem acesso/i.test(error.message)) { setSemAcesso(true); return }
        setErro(error.message); return
      }
      setLinhas((Array.isArray(data) ? data : []) as Linha[])
    } catch {
      setErro('Não conseguimos carregar os travamentos. Tente de novo.')
    } finally {
      setLoading(false)
    }
  }, [horas])

  useEffect(() => { void carregar() }, [carregar])

  const totalEventos = linhas.reduce((s, l) => s + l.total, 0)
  const totalTimeouts = linhas.reduce((s, l) => s + l.timeouts, 0)

  return (
    <div style={{ padding: 20, maxWidth: 960, margin: '0 auto', background: C.bg, minHeight: '100vh', color: C.text }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.gold }}>⏱️ Travamentos de carregamento</div>
          <div style={{ fontSize: 11, color: C.textD }}>
            Telas que penduraram (timeout) ou demoraram mais de 10 s. Quanto menor, melhor.
          </div>
        </div>
        <Link href="/dashboard/admin" style={{ padding: '8px 16px', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 11, textDecoration: 'none' }}>← Admin</Link>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {JANELAS.map((j) => (
          <button key={j.horas} onClick={() => setHoras(j.horas)}
            style={{ padding: '6px 14px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
              border: `1px solid ${horas === j.horas ? C.gold : C.border}`,
              background: horas === j.horas ? `${C.green}12` : 'transparent',
              color: horas === j.horas ? C.gold : C.textM, fontWeight: horas === j.horas ? 600 : 400 }}>
            {j.label}
          </button>
        ))}
        <button onClick={() => void carregar()} style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.textM, fontSize: 11, cursor: 'pointer' }}>↻ Atualizar</button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
        <Kpi label="Etapas afetadas" value={String(linhas.length)} />
        <Kpi label="Eventos (total)" value={String(totalEventos)} accent={totalEventos > 0 ? C.gold : C.green} />
        <Kpi label="Timeouts (pendurou)" value={String(totalTimeouts)} accent={totalTimeouts > 0 ? C.red : C.green} />
      </div>

      {semAcesso ? (
        <Aviso icon="🔒" titulo="Acesso restrito" texto="Este painel é exclusivo da equipe PS / administradores." />
      ) : erro ? (
        <Aviso icon="⚠️" titulo="Não conseguimos carregar" texto={erro} acao={<button onClick={() => void carregar()} style={btnAcao}>Tentar de novo</button>} />
      ) : loading ? (
        <p style={{ color: C.textM, fontSize: 13 }}>Carregando…</p>
      ) : linhas.length === 0 ? (
        <Aviso icon="✅" titulo="Nenhum travamento na janela" texto="Nenhuma tela pendurou ou passou de 10 s no período selecionado." />
      ) : (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.8fr 0.8fr 0.8fr 0.8fr 1.4fr', padding: '10px 14px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: C.textD, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>
            <span>Etapa</span><span>Eventos</span><span>Timeouts</span><span>Máx</span><span>Média</span><span>Último</span>
          </div>
          {linhas.map((l) => (
            <div key={l.label} style={{ display: 'grid', gridTemplateColumns: '2fr 0.8fr 0.8fr 0.8fr 0.8fr 1.4fr', padding: '10px 14px', fontSize: 12, borderBottom: `0.5px solid ${C.border}`, alignItems: 'center' }}>
              <span style={{ fontWeight: 600, wordBreak: 'break-word' }}>{l.label}</span>
              <span>{l.total}</span>
              <span style={{ color: l.timeouts > 0 ? C.red : C.textM, fontWeight: l.timeouts > 0 ? 700 : 400 }}>{l.timeouts}</span>
              <span>{fmtMs(l.max_ms)}</span>
              <span>{fmtMs(l.avg_ms)}</span>
              <span style={{ color: C.textM, fontSize: 11 }}>{fmtQuando(l.ultimo)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const btnAcao: React.CSSProperties = { marginTop: 10, padding: '8px 18px', borderRadius: 8, background: C.gold, color: '#FFF', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: C.textD, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 700, color: accent ?? C.text }}>{value}</span>
    </div>
  )
}

function Aviso({ icon, titulo, texto, acao }: { icon: string; titulo: string; texto: string; acao?: React.ReactNode }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 28, textAlign: 'center' }}>
      <div style={{ fontSize: 34, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 }}>{titulo}</div>
      <div style={{ fontSize: 12, color: C.textM, maxWidth: 420, margin: '0 auto' }}>{texto}</div>
      {acao}
    </div>
  )
}
