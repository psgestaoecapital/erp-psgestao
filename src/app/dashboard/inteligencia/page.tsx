'use client'

// Área "Inteligência / Análise de Dados" — BI modular por ABAS, hierárquico (RBAC 2D).
// Aba 1: Indicadores de Gente (Painel de Jornada migrado do Ponto). Cada aba filtra por
// escopo do usuário (fn_bi_gente_setores_visiveis → só os setores permitidos; bypass vê tudo).
// Ponto Eletrônico virou SÓ captura; a análise vive aqui.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import PainelGente, { type ColaboradorBI, type HoraRowBI } from '@/components/inteligencia/PainelGente'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const MUT = 'rgba(61,35,20,0.55)'
const inp: React.CSSProperties = { padding: '9px 12px', border: '0.5px solid rgba(61,35,20,0.25)', borderRadius: 6, fontSize: 13, color: ESP, background: '#FFF', boxSizing: 'border-box' }

const toISO = (d: Date) => d.toISOString().slice(0, 10)
const inicioMes = () => { const d = new Date(); return toISO(new Date(d.getFullYear(), d.getMonth(), 1)) }

type Aba = 'gente'
const ABAS: { key: Aba; label: string; icone: string }[] = [
  { key: 'gente', label: 'Indicadores de Gente', icone: '👥' },
]

export default function InteligenciaPage() {
  const { selInfo, sel } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && sel ? sel : null

  const [aba, setAba] = useState<Aba>('gente')
  const [dataIni, setDataIni] = useState(inicioMes())
  const [dataFim, setDataFim] = useState(toISO(new Date()))
  const [colabs, setColabs] = useState<ColaboradorBI[]>([])
  const [horas, setHoras] = useState<HoraRowBI[]>([])
  const [setoresPermitidos, setSetoresPermitidos] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(true)

  const carregar = useCallback(async () => {
    if (!empresaUnica) { setLoading(false); return }
    setLoading(true)
    const [colabRes, horasRes, scopeRes] = await Promise.all([
      supabase.from('ind_ponto_colaborador').select('cpf, departamento').eq('company_id', empresaUnica).limit(1000),
      supabase.from('ind_ponto_horas').select('cpf, raw').eq('company_id', empresaUnica).order('periodo_inicio', { ascending: false }).limit(500),
      supabase.rpc('fn_bi_gente_setores_visiveis', { p_company_id: empresaUnica }),
    ])
    setColabs((colabRes.data ?? []) as ColaboradorBI[])
    setHoras((horasRes.data ?? []) as HoraRowBI[])
    const scope = scopeRes.data as { ve_tudo?: boolean; setores?: string[] } | null
    setSetoresPermitidos(scope?.ve_tudo ? null : (scope?.setores ?? []))
    setLoading(false)
  }, [empresaUnica])

  useEffect(() => { void carregar() }, [carregar])

  const tab = (on: boolean): React.CSSProperties => ({
    padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    background: on ? ESP : '#FFF', color: on ? BG : ESP, border: `0.5px solid ${on ? ESP : LINE}`,
  })

  const conteudo = useMemo(() => {
    if (aba === 'gente') {
      return <PainelGente companyId={empresaUnica} dataIni={dataIni} dataFim={dataFim} colabs={colabs} horas={horas} setoresPermitidos={setoresPermitidos} />
    }
    return null
  }, [aba, empresaUnica, dataIni, dataFim, colabs, horas, setoresPermitidos])

  if (!empresaUnica) {
    return <div style={{ background: BG, minHeight: '100vh', padding: 32, color: MUT, fontSize: 14 }}>Selecione uma empresa específica no topo para ver a Inteligência.</div>
  }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '28px 20px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <header style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>📊 Inteligência</div>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: ESP, margin: '2px 0 0' }}>Análise de Dados</h1>
          <p style={{ fontSize: 13, color: MUT, margin: '4px 0 0' }}>BI modular por domínio. Você vê só o que seu escopo permite.</p>
        </header>

        {/* Abas (preparadas pra crescer: Manutenção, Qualidade, SST, Produção, Financeiro, Frota) */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          {ABAS.map((a) => (
            <button key={a.key} onClick={() => setAba(a.key)} style={tab(aba === a.key)}>{a.icone} {a.label}</button>
          ))}
        </div>

        {/* Período */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: MUT }}>Período:</span>
          <input type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} style={inp} />
          <span style={{ color: MUT }}>→</span>
          <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} style={inp} />
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: MUT, fontSize: 13 }}>Carregando…</div>
        ) : conteudo}
      </div>
    </div>
  )
}
