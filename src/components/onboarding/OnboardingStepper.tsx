'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

type Passo = {
  id: string
  titulo: string
  descricao?: string
  link?: string
  ehConcluido: boolean
}

type Props = {
  companyId: string
  modulo: string
  passos: Passo[]
  onMaduro?: () => void
}

export default function OnboardingStepper({ companyId, modulo, passos, onMaduro }: Props) {
  const [pulados, setPulados] = useState<Set<string>>(new Set())
  const [visivel, setVisivel] = useState(true)

  useEffect(() => {
    if (!companyId) return
    let ignore = false
    ;(async () => {
      const { data } = await supabase
        .from('erp_onboarding_progresso')
        .select('passo')
        .eq('company_id', companyId)
        .eq('modulo', modulo)
        .eq('pulado', true)
      if (!ignore && data) setPulados(new Set(data.map((d: { passo: string }) => d.passo)))
    })()
    return () => { ignore = true }
  }, [companyId, modulo])

  const totalConcluidos = passos.filter((p) => p.ehConcluido).length
  const totalPulados = passos.filter((p) => pulados.has(p.id) && !p.ehConcluido).length
  const total = passos.length
  const pct = total === 0 ? 0 : Math.round(((totalConcluidos + totalPulados) / total) * 100)

  useEffect(() => {
    if (pct === 100) {
      setVisivel(false)
      onMaduro?.()
    }
  }, [pct, onMaduro])

  if (!visivel) return null

  async function pularPasso(passoId: string) {
    await supabase.from('erp_onboarding_progresso').upsert(
      { company_id: companyId, modulo, passo: passoId, pulado: true },
      { onConflict: 'company_id,modulo,passo' },
    )
    setPulados((prev) => {
      const ns = new Set(prev)
      ns.add(passoId)
      return ns
    })
  }

  async function pularTudo() {
    const restantes = passos.filter((p) => !p.ehConcluido && !pulados.has(p.id))
    if (restantes.length === 0) { setVisivel(false); return }
    await supabase.from('erp_onboarding_progresso').upsert(
      restantes.map((p) => ({ company_id: companyId, modulo, passo: p.id, pulado: true })),
      { onConflict: 'company_id,modulo,passo' },
    )
    setVisivel(false)
  }

  return (
    <div style={{
      background: '#FAF7F2',
      border: '2px solid #C8941A',
      borderRadius: 12,
      padding: 20,
      marginBottom: 20,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h3 style={{ color: '#3D2314', margin: 0, fontSize: 16, fontWeight: 700 }}>🎯 Bem-vindo! Vamos te ajudar a configurar</h3>
          <small style={{ color: 'rgba(61,35,20,0.6)', fontSize: 12 }}>
            {totalConcluidos + totalPulados} de {total} passos · {pct}% completo
          </small>
          <div style={{ marginTop: 8, height: 6, background: 'rgba(61,35,20,0.1)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: '#C8941A', transition: 'width 200ms' }} />
          </div>
        </div>
        <button
          type="button"
          onClick={pularTudo}
          style={{ background: 'transparent', border: 'none', color: 'rgba(61,35,20,0.6)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
        >
          Pular tudo →
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {passos.map((passo, i) => {
          const pulado = pulados.has(passo.id) && !passo.ehConcluido
          const ativo = !passo.ehConcluido && !pulado
          return (
            <div key={passo.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: 12,
              background: ativo ? '#FFFFFF' : 'transparent',
              borderRadius: 8,
              border: ativo ? '0.5px solid rgba(61,35,20,0.15)' : 'none',
              opacity: pulado ? 0.45 : 1,
              flexWrap: 'wrap',
            }}>
              <div style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: passo.ehConcluido ? '#16A34A' : pulado ? '#9CA3AF' : '#3D2314',
                color: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 13,
                flexShrink: 0,
              }}>
                {passo.ehConcluido ? '✓' : pulado ? '−' : i + 1}
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ color: '#3D2314', fontWeight: ativo ? 600 : 400, fontSize: 13 }}>{passo.titulo}</div>
                {passo.descricao && <small style={{ color: 'rgba(61,35,20,0.6)', fontSize: 11 }}>{passo.descricao}</small>}
              </div>
              {ativo && passo.link && (
                <a
                  href={passo.link}
                  style={{ padding: '6px 12px', background: '#C8941A', color: '#3D2314', borderRadius: 6, textDecoration: 'none', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}
                >
                  Fazer →
                </a>
              )}
              {ativo && (
                <button
                  type="button"
                  onClick={() => pularPasso(passo.id)}
                  style={{ background: 'transparent', border: 'none', color: 'rgba(61,35,20,0.5)', cursor: 'pointer', fontSize: 11 }}
                >
                  pular
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
