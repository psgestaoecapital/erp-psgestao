'use client'

// Hub de BI — índice de cards navegáveis por tema. Cada card leva à TELA daquele BI (não expande inline).
// Ativo/em-breve vem da CONTAGEM real da fonte (RD-58: badge que mente é violação; acende sozinho quando
// o dado chegar). Card "em breve" nunca some do índice (RD-33). Gente vive na aba Gente do painel de
// produção (RD-52: uma fonte de verdade — a /inteligencia deixa de duplicar o painel de gente).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const MUT = 'rgba(61,35,20,0.55)'
const VERDE = '#2E8B57'
const menos7 = () => new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)

type Tema = {
  key: string; label: string; sub: string; icone: string
  rota: string | null; count: number
  resumo?: (n: number) => string; aguarda?: string
}

export default function InteligenciaHubPage() {
  const router = useRouter()
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null

  const [c, setC] = useState<{ prod: number; gente: number; qual: number }>({ prod: 0, gente: 0, qual: 0 })
  const [especie, setEspecie] = useState<string>('')
  const [loading, setLoading] = useState(true)

  const carregar = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    setLoading(true)
    const [prod, gente, qual, pl] = await Promise.all([
      supabase.from('v_ind_producao_abate').select('*', { count: 'exact', head: true }).eq('company_id', companyId).gte('data_abate', menos7()),
      supabase.from('ind_ponto_dia').select('*', { count: 'exact', head: true }).eq('company_id', companyId),
      supabase.from('ind_qualidade_sif').select('*', { count: 'exact', head: true }),
      supabase.from('industrial_plants').select('especies').eq('company_id', companyId).eq('is_active', true).limit(1),
    ])
    setC({ prod: prod.count ?? 0, gente: gente.count ?? 0, qual: qual.count ?? 0 })
    const esp = (pl.data as { especies: string[] }[] | null)?.[0]?.especies?.[0]
    setEspecie(esp ?? '')
    setLoading(false)
  }, [companyId])

  useEffect(() => { void carregar() }, [carregar])

  const temas: Tema[] = useMemo(() => [
    { key: 'producao', label: 'Produção', sub: 'Abate, peso, lotes', icone: '🏭', rota: '/dashboard/industrial/producao', count: c.prod, resumo: (n) => `${n.toLocaleString('pt-BR')} cabeças · 7 dias` },
    { key: 'gente', label: 'Gente', sub: 'Jornada, headcount, infrações', icone: '👥', rota: '/dashboard/industrial/producao?aba=gente', count: c.gente, resumo: (n) => `${n.toLocaleString('pt-BR')} registros de ponto` },
    { key: 'qualidade', label: 'Qualidade · SIF', sub: 'Inspeção, condenações', icone: '🔬', rota: null, count: c.qual, aguarda: 'aguarda dados' },
    { key: 'abastecimento', label: 'Abastecimento', sub: 'Gado vivo · entrada', icone: '🐂', rota: null, count: 0, aguarda: 'aguarda dados' },
    { key: 'desossa', label: 'Desossa · RPS', sub: 'Saída F630 · entrada F621', icone: '🔪', rota: null, count: 0, aguarda: 'aguarda F630/F621' },
    { key: 'camaras', label: 'Câmaras · Estoque', sub: 'Ocupação, giro', icone: '❄️', rota: null, count: 0, aguarda: 'aguarda dados' },
  ], [c])

  if (!companyId) {
    return <div style={{ background: BG, minHeight: '100vh', padding: 32, color: MUT, fontSize: 14 }}>Selecione uma empresa específica no topo para ver a Inteligência.</div>
  }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '28px 20px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <header style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>
            📊 Inteligência · Industrial{especie ? ` · ${especie[0].toUpperCase() + especie.slice(1)}` : ''}
          </div>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: ESP, margin: '2px 0 0' }}>Análise de Dados</h1>
          <p style={{ fontSize: 13, color: MUT, margin: '4px 0 0' }}>Escolha um tema. Você vê só o que seu escopo permite.</p>
        </header>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: MUT, fontSize: 13 }}>Carregando…</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              {temas.map((t) => {
                const ativo = t.count > 0 && !!t.rota
                return (
                  <div key={t.key}
                    onClick={ativo ? () => router.push(t.rota!) : undefined}
                    style={{
                      background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16,
                      display: 'flex', flexDirection: 'column', minHeight: 130,
                      cursor: ativo ? 'pointer' : 'default', opacity: ativo ? 1 : 0.7,
                      transition: 'border-color .15s',
                    }}
                    onMouseEnter={(e) => { if (ativo) e.currentTarget.style.borderColor = GOLD }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = LINE }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 22, filter: ativo ? 'none' : 'grayscale(1)' }}>{t.icone}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: ativo ? VERDE : MUT }}>{ativo ? '● ativo' : '○ em breve'}</span>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 15, fontWeight: 600, color: ativo ? ESP : MUT }}>{t.label}</div>
                    <div style={{ fontSize: 12, color: MUT }}>{t.sub}</div>
                    <div style={{ marginTop: 'auto', paddingTop: 10, fontSize: 12, color: ativo ? ESP : MUT, fontWeight: ativo ? 600 : 400 }}>
                      {ativo && t.resumo ? t.resumo(t.count) : (t.aguarda ?? 'aguarda dados')}
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ marginTop: 16, fontSize: 11, color: MUT }}>
              ● card clicável leva à tela do tema · ○ aparece mas ainda sem dado (acende sozinho quando a fonte carregar)
            </div>
          </>
        )}
      </div>
    </div>
  )
}
