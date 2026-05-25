'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface EventoUser {
  tabela: string
  acao: string
  registro_id: string | null
  ip: string | null
  user_agent?: string | null
  created_at: string
}

interface DadosLGPD {
  titular: string | null
  dias_consultados: number
  total_eventos: number
  resultados: EventoUser[]
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '0.5px solid rgba(61,35,20,0.25)',
  borderRadius: 6,
  fontSize: 13,
  background: '#FFFFFF',
  color: '#3D2314',
  boxSizing: 'border-box',
}

export default function MeusDadosLGPD() {
  const router = useRouter()
  const [data, setData] = useState<DadosLGPD | null>(null)
  const [diasAtras, setDiasAtras] = useState(90)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ignore = false
    ;(async () => {
      setLoading(true)
      const { data: result } = await supabase.rpc('fn_audit_meus_dados', { p_dias_atras: diasAtras })
      if (!ignore) {
        setData(result as DadosLGPD | null)
        setLoading(false)
      }
    })()
    return () => { ignore = true }
  }, [diasAtras])

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'rgba(61,35,20,0.6)' }}>Consultando seus dados…</div>
  }

  const resultados = data?.resultados ?? []

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '32px 28px' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
          LGPD · Lei Geral de Proteção de Dados
        </div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, color: '#3D2314', margin: 0, fontWeight: 400 }}>
          Meus Dados
        </h1>
        <div style={{ fontSize: 13, color: 'rgba(61,35,20,0.65)', marginTop: 4 }}>
          Você tem direito de saber tudo que foi feito com seus dados (Lei 13.709/2018 · Art. 18 I).
        </div>
      </div>

      <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>
              Você é
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#3D2314', marginTop: 4, wordBreak: 'break-word' }}>
              {data?.titular ?? '— não identificado —'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>
              Período consultado
            </div>
            <select value={diasAtras} onChange={(e) => setDiasAtras(parseInt(e.target.value, 10))} style={{ ...inputStyle, marginTop: 4 }}>
              <option value={30}>Últimos 30 dias</option>
              <option value={90}>Últimos 90 dias</option>
              <option value={180}>Últimos 6 meses</option>
              <option value={365}>Último ano</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>
              Eventos registrados
            </div>
            <div style={{ fontSize: 24, fontWeight: 600, color: '#3D2314', fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>
              {(data?.total_eventos ?? 0).toLocaleString('pt-BR')}
            </div>
          </div>
        </div>
      </div>

      <div style={{ background: 'rgba(200,148,26,0.08)', border: '0.5px solid #C8941A', borderRadius: 8, padding: '14px 18px', marginBottom: 20, fontSize: 12, color: '#854F0B', lineHeight: 1.5 }}>
        🛡️ <strong>Seus direitos garantidos pela LGPD:</strong>
        <br />· Consultar seus dados (Art. 18 I)
        <br />· Corrigir dados incorretos (Art. 18 II)
        <br />· Solicitar anonimização ou eliminação (Art. 18 III)
        <br />· Revogar consentimento a qualquer momento (Art. 18 VI)
        <br />
        <br />
        Para exercer qualquer direito, entre em contato com nosso DPO: <strong>dpo@psgestao.com.br</strong>
      </div>

      {resultados.length === 0 ? (
        <div style={{ background: '#FFFFFF', borderRadius: 12, padding: 60, textAlign: 'center', color: 'rgba(61,35,20,0.6)', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
          Nenhuma ação registrada com seus dados nesse período.
        </div>
      ) : (
        <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, overflow: 'hidden' }}>
          {resultados.map((ev, i) => (
            <div
              key={`${ev.created_at}-${i}`}
              style={{ padding: '12px 20px', borderBottom: '0.5px solid rgba(61,35,20,0.08)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
            >
              <div style={{ minWidth: 130, fontSize: 11, color: 'rgba(61,35,20,0.6)', fontVariantNumeric: 'tabular-nums' }}>
                {new Date(ev.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
              <div style={{ flex: 1, fontSize: 12, color: '#3D2314', minWidth: 200 }}>
                <strong>{ev.acao}</strong> em <strong>{ev.tabela}</strong>
              </div>
              {ev.ip && (
                <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.5)', fontFamily: 'monospace' }}>IP {ev.ip}</div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 32, textAlign: 'center' }}>
        <button
          type="button"
          onClick={() => router.push('/dashboard/gestao-empresarial')}
          style={{ background: 'transparent', color: '#C8941A', border: '0.5px solid #C8941A', padding: '10px 24px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          ← Voltar ao painel
        </button>
      </div>
    </div>
  )
}
