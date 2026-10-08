'use client'

// Hub · Cockpit da obra — porta de entrada do menu: lista as obras da empresa e abre o cockpit da escolhida (1 toque).
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERM = '#B91C1C'

type Obra = { obra_id: string; numero: string; nome: string; status: string }

export default function CockpitEscolherObraPage() {
  const { companyIds } = useCompanyIds()
  const [obras, setObras] = useState<Obra[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    if (!companyIds?.length) { setLoading(false); return }
    setLoading(true); setErro('')
    try {
      const { data, error } = await comPrazo(
        async () => await supabase.from('v_obra_resultado').select('obra_id,numero,nome,status').in('company_id', companyIds).order('numero', { ascending: false }),
        { ms: 8000, tentativas: 1, label: 'cockpit-obras' },
      )
      if (error) { setErro(error.message); return }
      setObras((data ?? []) as Obra[])
    } catch { setErro(MSG_CARREGAMENTO_FALHOU) } finally { setLoading(false) }
  }, [companyIds])
  useEffect(() => { carregar() }, [carregar])

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: 16, color: ESP }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, margin: '8px 0 4px' }}>Cockpit da obra</h1>
        <p style={{ fontSize: 13, color: MUT, margin: '0 0 12px' }}>Escolha a obra: avanço, custo, margem, prazo e pendências do dia.</p>
        {loading && <p data-testid="cockpit-carregando">Carregando…</p>}
        {!loading && erro && <p role="alert" style={{ color: VERM }}>{erro} <button onClick={carregar}>Tentar de novo</button></p>}
        {!loading && !erro && obras.length === 0 && (
          <p data-testid="cockpit-vazio">Nenhuma obra ainda. A obra nasce do orçamento aprovado; depois dela o cockpit aparece aqui.</p>
        )}
        {!loading && !erro && obras.length > 0 && (
          <ul data-testid="cockpit-lista" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {obras.map(o => (
              <li key={o.obra_id}>
                <Link href={`/dashboard/projetos/obras/${o.obra_id}/cockpit?area=hub`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '12px 14px', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, color: ESP, textDecoration: 'none' }}>
                  <span><b>{o.numero}</b> · {o.nome}</span>
                  <span style={{ color: GOLD, fontWeight: 700, fontSize: 13 }}>Abrir cockpit →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
