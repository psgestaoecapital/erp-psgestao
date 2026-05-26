'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import UploadOfxArea from '@/components/conciliacao/UploadOfxArea'

interface Lote {
  id: string
  nome: string
  tipo: string
  origem: string | null
  periodo_inicio: string | null
  periodo_fim: string | null
  total_movimentos: number
  total_conciliados: number
  total_pendentes: number
  status: string
  created_at: string
}

interface Saude {
  total_lotes: number
  lotes_abertos: number
  lotes_em_andamento: number
  lotes_conciliados: number
  total_movimentos: number
  movimentos_pendentes: number
  movimentos_conciliados: number
  pct_conciliado: number | null
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = s.split('T')[0]
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

export default function ConciliacaoPage() {
  const router = useRouter()
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [lotes, setLotes] = useState<Lote[]>([])
  const [saude, setSaude] = useState<Saude | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ignore = false
    if (!empresaUnica) { setLoading(false); return }
    ;(async () => {
      setLoading(true)
      const [lotesRes, saudeRes] = await Promise.all([
        supabase.from('conciliacao_lote')
          .select('id, nome, tipo, origem, periodo_inicio, periodo_fim, total_movimentos, total_conciliados, total_pendentes, status, created_at')
          .eq('company_id', empresaUnica)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase.from('v_conciliacao_saude')
          .select('total_lotes, lotes_abertos, lotes_em_andamento, lotes_conciliados, total_movimentos, movimentos_pendentes, movimentos_conciliados, pct_conciliado')
          .eq('company_id', empresaUnica)
          .maybeSingle(),
      ])
      if (!ignore) {
        setLotes((lotesRes.data ?? []) as Lote[])
        setSaude((saudeRes.data ?? null) as Saude | null)
        setLoading(false)
      }
    })()
    return () => { ignore = true }
  }, [empresaUnica])

  if (!empresaUnica) {
    return <div style={infoBox}>Selecione uma empresa para ver conciliação.</div>
  }

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <button onClick={() => router.push('/dashboard/gestao-empresarial')} style={backLink}>
          ← Painel Gestão Empresarial
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: '#3D2314', margin: '0 0 6px' }}>
              Conciliação Bancária
            </h1>
            <p style={{ color: 'rgba(61,35,20,0.65)', fontSize: 13, margin: 0 }}>
              Lotes importados · saúde de conciliação · inbox de pendências
            </p>
          </div>
          <button onClick={() => router.push('/dashboard/financeiro/conciliacao/inbox')} style={primaryBtn}>
            Inbox de pendências →
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
          <Card label="% Conciliado" valor={`${Number(saude?.pct_conciliado ?? 0).toFixed(0)}%`} cor="#3B6D11" destaque />
          <Card label="Movimentos pendentes" valor={String(saude?.movimentos_pendentes ?? 0)} cor="#BA7517" />
          <Card label="Lotes abertos" valor={String(saude?.lotes_abertos ?? 0)} cor="#3D2314" />
          <Card label="Total lotes" valor={String(saude?.total_lotes ?? 0)} cor="rgba(61,35,20,0.5)" />
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, marginBottom: 8 }}>
            Importar extrato bancário
          </div>
          <UploadOfxArea companyId={empresaUnica} />
        </div>

        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 400, color: '#3D2314', margin: '0 0 12px' }}>
          Lotes recentes
        </h2>

        {loading ? (
          <div style={emptyBox}>Carregando lotes…</div>
        ) : lotes.length === 0 ? (
          <div style={emptyBox}>
            <div style={{ fontSize: 14, color: '#3D2314', fontWeight: 600, marginBottom: 6 }}>Nenhum lote importado ainda</div>
            <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)' }}>
              Quando importar um OFX/CSV, ele aparecerá aqui.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lotes.map((l) => {
              const pct = l.total_movimentos > 0 ? Math.round((l.total_conciliados / l.total_movimentos) * 100) : 0
              return (
                <button key={l.id} onClick={() => router.push(`/dashboard/financeiro/conciliacao/${l.id}`)} style={loteCard}>
                  <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#3D2314', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.nome}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 2 }}>
                      {l.tipo} · {l.origem ?? '—'} · {fmtDate(l.periodo_inicio)} a {fmtDate(l.periodo_fim)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: pct === 100 ? '#3B6D11' : pct >= 50 ? '#BA7517' : '#A32D2D' }}>
                      {pct}%
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 2 }}>
                      {l.total_conciliados}/{l.total_movimentos}
                    </div>
                  </div>
                  <span style={statusBadge(l.status)}>{l.status}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Card({ label, valor, cor, destaque }: { label: string; valor: string; cor: string; destaque?: boolean }) {
  return (
    <div style={{
      background: destaque ? '#EAF3DE' : '#FFFFFF',
      border: '0.5px solid rgba(61,35,20,0.12)',
      borderLeft: `3px solid ${cor}`,
      borderRadius: 8,
      padding: '14px 16px',
    }}>
      <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: cor, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
    </div>
  )
}

function statusBadge(s: string): React.CSSProperties {
  const map: Record<string, { fg: string; bg: string }> = {
    aberto: { fg: '#BA7517', bg: '#FAEEDA' },
    em_andamento: { fg: '#BA7517', bg: '#FAEEDA' },
    conciliado: { fg: '#3B6D11', bg: '#EAF3DE' },
    fechado: { fg: '#3B6D11', bg: '#EAF3DE' },
  }
  const tone = map[s] ?? { fg: 'rgba(61,35,20,0.65)', bg: 'rgba(61,35,20,0.08)' }
  return {
    background: tone.bg, color: tone.fg, fontSize: 10, fontWeight: 600,
    padding: '4px 10px', borderRadius: 4, letterSpacing: 0.3, textTransform: 'uppercase',
    marginLeft: 12, flexShrink: 0,
  }
}

const primaryBtn: React.CSSProperties = {
  background: '#C8941A', color: '#3D2314', border: 'none',
  padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
}


const loteCard: React.CSSProperties = {
  background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8,
  padding: '14px 16px', display: 'flex', alignItems: 'center', cursor: 'pointer', font: 'inherit',
}

const backLink: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'rgba(61,35,20,0.55)',
  fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 16,
}

const infoBox: React.CSSProperties = {
  padding: 40, background: '#FAF7F2', minHeight: '100vh', color: '#3D2314', textAlign: 'center',
}

const emptyBox: React.CSSProperties = {
  background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8,
  padding: 48, textAlign: 'center', color: 'rgba(61,35,20,0.65)',
}
