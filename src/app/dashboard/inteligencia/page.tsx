'use client'

// Hub de BI — CONFIG-DRIVEN e ÁREA-AWARE (RD-26/35). Lê o catálogo da área (query ?area=) via a RPC certa
// e renderiza por seção. Card "acende sozinho" quando a fonte tem dado (RD-58). Empresa = seletor global.
//   area=industrial → fn_bi_temas_industrial (não regride — RD-53)
//   area=agro       → fn_bi_temas_agro
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { usePapelUsuario, ehRhIndustrial } from '@/hooks/usePapelUsuario'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF'
const MUT = 'rgba(61,35,20,0.55)', VERDE = '#2E8B57'
const ACCENT_BG = 'rgba(200,148,26,0.12)', SURF1 = 'rgba(61,35,20,0.035)'

type Tema = {
  codigo: string; nome: string; subtitulo: string | null; icone: string | null
  secao: string; ordem: number; rota_detalhe: string | null; destaque: string | null
  previsto: boolean; tem_dado: boolean; metrica: string | null
}

// Catálogo diz o NOME do ícone (tabler); o hub mapeia p/ emoji (config-driven, sem dependência nova).
const ICONE: Record<string, string> = {
  // industrial
  truck: '🚚', fence: '🐂', meat: '🥩', 'clipboard-check': '📋', award: '🏅', snowflake: '❄️',
  cut: '🔪', droplet: '💧', package: '📦', 'truck-delivery': '🚛', 'shopping-cart': '🛒',
  'shield-check': '🛡️', users: '👥', bolt: '⚡', tools: '🛠️', coin: '🪙', cow: '🐄',
  'chart-bar': '📊', 'arrows-cross': '✳️',
  // agro
  plant: '🌱', 'chart-line': '📈', heart: '❤️', vaccine: '💉', 'building-warehouse': '🏬',
  milk: '🥛', 'report-money': '💰', 'building-bank': '🏦', 'trending-up': '💹',
}

type AreaCfg = { rpc: string; kicker: string; subtitulo: string; secoes: { key: string; label: string }[]; soRh: boolean }
const AREAS: Record<string, AreaCfg> = {
  industrial: {
    rpc: 'fn_bi_temas_industrial',
    kicker: '📊 Inteligência (BI) · industrial · bovino',
    subtitulo: 'Inteligência (BI) · industrial · bovino — você vê só o que seu escopo permite.',
    secoes: [
      { key: 'entrada', label: 'Entrada e gado' }, { key: 'abate', label: 'Abate e carcaça' },
      { key: 'frio_desossa', label: 'Frio e desossa' }, { key: 'saida', label: 'Saída e mercado' },
      { key: 'transversais', label: 'Transversais · toda a cadeia' },
    ],
    soRh: true,
  },
  agro: {
    rpc: 'fn_bi_temas_agro',
    kicker: '📊 Inteligência (BI) · agro · pecuária',
    subtitulo: 'Inteligência (BI) · agro · pecuária — você vê só o que seu escopo permite.',
    secoes: [
      { key: 'rebanho', label: 'Rebanho e campo' }, { key: 'desempenho', label: 'Desempenho' },
      { key: 'nutricao', label: 'Nutrição' }, { key: 'financeiro', label: 'Financeiro' },
      { key: 'cruzamento', label: 'Cruzamento' },
    ],
    soRh: false,
  },
}

export default function InteligenciaHubPage() {
  return (
    <Suspense fallback={<div style={{ background: BG, minHeight: '100vh', padding: 40, textAlign: 'center', color: MUT, fontSize: 13 }}>Carregando…</div>}>
      <Hub />
    </Suspense>
  )
}

function Hub() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const area = (searchParams.get('area') ?? 'industrial') === 'agro' ? 'agro' : 'industrial'
  const cfg = AREAS[area]

  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const { papel } = usePapelUsuario()
  const soRh = cfg.soRh && ehRhIndustrial(papel) // RH industrial: só o card de RH (só na área industrial)

  const [temas, setTemas] = useState<Tema[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc(cfg.rpc, { p_company_id: companyId })
    if (error) setErro(error.message)
    setTemas((data ?? []) as Tema[])
    setLoading(false)
  }, [companyId, cfg.rpc])

  /* eslint-disable-next-line react-hooks/set-state-in-effect */
  useEffect(() => { void carregar() }, [carregar])

  const visiveis = useMemo(() => soRh ? temas.filter((t) => t.codigo === 'rh') : temas, [temas, soRh])
  const porSecao = useMemo(() => {
    const m: Record<string, Tema[]> = {}
    for (const t of visiveis) (m[t.secao] = m[t.secao] || []).push(t)
    return m
  }, [visiveis])

  if (!companyId) {
    return <div style={{ background: BG, minHeight: '100vh', padding: 32, color: MUT, fontSize: 14 }}>Selecione uma empresa específica no topo para ver a Inteligência.</div>
  }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '28px 20px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <header style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>{cfg.kicker}</div>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: ESP, margin: '2px 0 0' }}>Análise de dados</h1>
          <p style={{ fontSize: 13, color: MUT, margin: '4px 0 0' }}>{cfg.subtitulo}</p>
        </header>

        {erro && <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 12 }}>{erro}</div>}

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: MUT, fontSize: 13 }}>Carregando…</div>
        ) : (
          <>
            {cfg.secoes.filter((s) => (porSecao[s.key] ?? []).length > 0).map((s) => {
              const faixa = s.key === 'transversais' || s.key === 'cruzamento'
              return (
                <section key={s.key} style={{ marginBottom: 18, ...(faixa ? { background: SURF1, borderRadius: 12, padding: '14px 14px 4px' } : {}) }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, color: MUT, fontWeight: 700, marginBottom: 10 }}>{s.label}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(196px, 1fr))', gap: 12 }}>
                    {(porSecao[s.key] ?? []).map((t) => <Card key={t.codigo} t={t} onOpen={() => t.rota_detalhe && router.push(t.rota_detalhe)} />)}
                  </div>
                </section>
              )
            })}
            <div style={{ marginTop: 8, fontSize: 11, color: MUT }}>
              ● card aceso = a fonte já tem dado (acende sozinho) · ○ em breve = aparece mas ainda sem dado
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Card({ t, onOpen }: { t: Tema; onOpen: () => void }) {
  const fase1 = t.destaque === 'fase1' && t.tem_dado
  const novo = t.destaque === 'novo'
  const pill = t.tem_dado
    ? { txt: '● ativo', cor: VERDE, bg: 'rgba(46,139,87,0.10)' }
    : fase1 ? { txt: 'fase 1', cor: GOLD, bg: ACCENT_BG }
    : novo ? { txt: 'novo', cor: GOLD, bg: ACCENT_BG }
    : { txt: 'em breve', cor: MUT, bg: 'rgba(61,35,20,0.06)' }
  const rodape = t.tem_dado && t.metrica ? t.metrica : 'aguarda dados'
  return (
    <div
      role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen() }}
      style={{
        background: '#FFF', border: fase1 ? `2px solid ${GOLD}` : `0.5px solid ${LINE}`, borderRadius: 12,
        padding: 16, display: 'flex', flexDirection: 'column', minHeight: 132, cursor: 'pointer',
        transition: 'border-color .15s',
      }}
      onMouseEnter={(e) => { if (!fase1) e.currentTarget.style.borderColor = GOLD }}
      onMouseLeave={(e) => { if (!fase1) e.currentTarget.style.borderColor = LINE }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: ACCENT_BG, color: GOLD, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, filter: t.tem_dado ? 'none' : 'grayscale(0.35)' }}>
          {ICONE[t.icone ?? ''] ?? '📊'}
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color: pill.cor, background: pill.bg, padding: '2px 8px', borderRadius: 20 }}>{pill.txt}</span>
      </div>
      <div style={{ marginTop: 10, fontSize: 14, fontWeight: 500, color: ESP }}>{t.nome}</div>
      <div style={{ fontSize: 12, color: MUT, marginTop: 2 }}>{t.subtitulo}</div>
      <div style={{ marginTop: 'auto', paddingTop: 10, fontSize: 12, color: t.tem_dado ? VERDE : MUT, fontWeight: t.tem_dado ? 600 : 400 }}>{rodape}</div>
    </div>
  )
}
