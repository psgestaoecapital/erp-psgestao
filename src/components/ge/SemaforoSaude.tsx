'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface SaudeData {
  score: number
  classificacao: string
  cor_semaforo: 'verde' | 'amarelo' | 'vermelho'
  frases: string[]
  sem_plano?: boolean
}

const COR = {
  verde: { fg: '#3B6D11', bg: '#EAF3DE', badge: '#3B6D11' },
  amarelo: { fg: '#BA7517', bg: '#FAEEDA', badge: '#854F0B' },
  vermelho: { fg: '#A32D2D', bg: '#FCEBEB', badge: '#A32D2D' },
}

export default function SemaforoSaude({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [data, setData] = useState<SaudeData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ignore = false
    ;(async () => {
      setLoading(true)
      const { data: result } = await supabase.rpc('fn_ge_saude_financeira', { p_company_id: companyId })
      if (!ignore) {
        setData(result as SaudeData)
        setLoading(false)
      }
    })()
    return () => { ignore = true }
  }, [companyId])

  if (loading) {
    return <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, height: 128, marginBottom: 32 }} />
  }
  if (!data || data.sem_plano) return null

  const tone = COR[data.cor_semaforo] ?? COR.amarelo
  const arc = Math.round((Math.min(100, Math.max(0, data.score)) / 100) * 239)

  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 24, marginBottom: 32, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: 88, height: 88, flexShrink: 0 }}>
        <svg viewBox="0 0 88 88" width="88" height="88" aria-hidden>
          <circle cx="44" cy="44" r="38" fill="none" stroke="rgba(61,35,20,0.08)" strokeWidth="8" />
          <circle cx="44" cy="44" r="38" fill="none" stroke={tone.fg} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${arc} 239`} transform="rotate(-90 44 44)" />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 600, color: '#3D2314', fontVariantNumeric: 'tabular-nums' }}>{data.score}</div>
          <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.55)', marginTop: -2 }}>/100</div>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
            Saúde Financeira
          </span>
          <span style={{ background: tone.bg, color: tone.badge, fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, letterSpacing: 0.3 }}>
            {data.classificacao}
          </span>
        </div>
        <div style={{ fontSize: 14, color: 'rgba(61,35,20,0.85)', lineHeight: 1.55 }}>
          {(data.frases ?? []).filter(Boolean).join(' · ')}
        </div>
      </div>

      <button
        type="button"
        onClick={() => router.push('/dashboard/consultor-ia?contexto=saude')}
        style={{ background: 'transparent', color: '#C8941A', border: '0.5px solid #C8941A', padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        Ver detalhes →
      </button>
    </div>
  )
}
