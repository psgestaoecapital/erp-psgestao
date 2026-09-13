'use client'
// Portal público do veículo (histórico). SEM valores — só o que foi feito, quando e com quanto km.
// Recarrega a cada 55min p/ reassinar as fotos (signed URL expira em 1h) sem o cliente perceber.
import { useEffect } from 'react'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.55)'
const nf = new Intl.NumberFormat('pt-BR')
const fmtData = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'
const fmtKm = (k: number | null) => k == null ? null : `${nf.format(k)} km`

export type VisitaPub = {
  data: string | null; km: number | null; servicos: string[]; defeito: string | null
  fotos: { url: string | null; anotacao: string | null }[]
}
type Veiculo = { placa?: string | null; marca?: string | null; modelo?: string | null; ano?: number | null; ultimo_km?: number | null }

export default function VeiculoPublico({ oficina, veiculo, visitas }: { oficina: string; veiculo: Veiculo; visitas: VisitaPub[] }) {
  // Reassina as fotos antes do TTL de 1h expirar (recarrega o server component).
  useEffect(() => {
    const t = setTimeout(() => { if (typeof window !== 'undefined') window.location.reload() }, 55 * 60 * 1000)
    return () => clearTimeout(t)
  }, [])

  const titulo = [veiculo.marca, veiculo.modelo, veiculo.ano].filter(Boolean).join(' · ') || 'Veículo'
  return (
    <div style={{ minHeight: '100vh', background: BG, color: ESP, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '20px 16px 48px' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 800 }}>🔧 {oficina}</div>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: '4px 0 2px', letterSpacing: 1 }}>{veiculo.placa ?? 'Seu veículo'}</h1>
        <div style={{ fontSize: 14, color: ESP60 }}>{titulo}{fmtKm(veiculo.ultimo_km ?? null) ? ` · ${fmtKm(veiculo.ultimo_km ?? null)}` : ''}</div>
        <p style={{ fontSize: 13, color: ESP60, marginTop: 10, lineHeight: 1.5 }}>
          Este é o histórico dos serviços do seu veículo com a gente. {visitas.length} passagem(ns) registrada(s).
        </p>

        {visitas.length === 0 && <div style={{ color: ESP60, fontSize: 14, marginTop: 16 }}>Sem serviços registrados ainda.</div>}

        <div style={{ marginTop: 16 }}>
          {visitas.map((v, i) => (
            <div key={i} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 16, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 15, fontWeight: 800 }}>{fmtData(v.data)}</span>
                {fmtKm(v.km) && <span style={{ fontSize: 12, color: ESP60, fontWeight: 700 }}>{fmtKm(v.km)}</span>}
              </div>

              {v.defeito && <div style={{ fontSize: 13, color: ESP, marginTop: 6 }}>{v.defeito}</div>}

              {v.servicos.length > 0 && (
                <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
                  {v.servicos.map((s, j) => (
                    <li key={j} style={{ fontSize: 13.5, color: ESP, marginBottom: 3 }}>{s}</li>
                  ))}
                </ul>
              )}

              {v.fotos.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8, marginTop: 12 }}>
                  {v.fotos.map((f, j) => (
                    <a key={j} href={f.url ?? '#'} target="_blank" rel="noreferrer" style={{ display: 'block', borderRadius: 10, overflow: 'hidden', border: `1px solid ${LINE}` }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.url ?? ''} alt={f.anotacao || 'foto do serviço'} style={{ width: '100%', height: 84, objectFit: 'cover', display: 'block' }} />
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ fontSize: 11.5, color: ESP60, textAlign: 'center', marginTop: 20, lineHeight: 1.5 }}>
          Dúvidas sobre algum serviço? Fale com a {oficina}.
        </div>
      </div>
    </div>
  )
}
