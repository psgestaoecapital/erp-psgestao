'use client'

// Sincronizar ponto eletronico (multi-provider). Le ind_ponto_provider_config
// pra listar as plantas com integracao ativa, e dispara o sync via
// /api/industrial/ponto/sync com a sessao do usuario (Bearer Authorization
// do supabase.auth.getSession()) — mesmo padrao do "Gerar boleto".
// Espresso · mobile-first · linguagem UX (SINCRONIZOU).

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

type PlantaConfig = {
  plant_id: string
  company_id: string
  provider: string
  nome_planta: string
  ativo: boolean
}

const CORES = {
  espresso: '#3D2314',
  offWhite: '#FAF7F2',
  dourado: '#C8941A',
  cinzaSuave: '#E7DECF',
  verde: '#16A34A',
  vermelho: '#A32D2D',
}

const toISO = (d: Date) => d.toISOString().slice(0, 10)
const inicioMes = () => { const d = new Date(); return toISO(new Date(d.getFullYear(), d.getMonth(), 1)) }
const fimMes = () => { const d = new Date(); return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }

export default function SincronizarPontoPage() {
  const { companyIds } = useCompanyIds()
  const [plantas, setPlantas] = useState<PlantaConfig[]>([])
  const [plantId, setPlantId] = useState<string>('')
  const [beginDate, setBeginDate] = useState(inicioMes())
  const [endDate, setEndDate] = useState(fimMes())
  const [busy, setBusy] = useState(false)
  const [resultado, setResultado] = useState<null | { provider: string; colaboradores: number; horas_registros: number; total_horas: number }>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [loadingPlantas, setLoadingPlantas] = useState(false)

  useEffect(() => {
    if (companyIds.length === 0) return
    let alive = true
    setLoadingPlantas(true)
    void (async () => {
      const { data, error } = await supabase
        .from('ind_ponto_provider_config')
        .select('plant_id, company_id, provider, ativo, industrial_plants:plant_id ( nome_planta )')
        .in('company_id', companyIds)
        .eq('ativo', true)
      if (!alive) return
      if (error) {
        setErro(error.message)
        setPlantas([])
      } else {
        type Row = {
          plant_id: string; company_id: string; provider: string; ativo: boolean
          industrial_plants: { nome_planta: string | null } | { nome_planta: string | null }[] | null
        }
        const lista: PlantaConfig[] = (data as Row[] | null ?? []).map((r) => {
          const ip = Array.isArray(r.industrial_plants) ? r.industrial_plants[0] : r.industrial_plants
          return {
            plant_id: r.plant_id, company_id: r.company_id, provider: r.provider, ativo: r.ativo,
            nome_planta: ip?.nome_planta ?? '(planta sem nome)',
          }
        })
        setPlantas(lista)
        if (lista.length === 1) setPlantId(lista[0].plant_id)
      }
      setLoadingPlantas(false)
    })()
    return () => { alive = false }
  }, [companyIds])

  const plantaSel = useMemo(() => plantas.find((p) => p.plant_id === plantId) ?? null, [plantas, plantId])

  const sincronizar = async () => {
    if (!plantaSel || busy) return
    setBusy(true)
    setErro(null)
    setResultado(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setErro('Sua sessão expirou. Faça login novamente.')
        return
      }
      const params = new URLSearchParams({
        company_id: plantaSel.company_id,
        plant_id: plantaSel.plant_id,
        begin_date: beginDate,
        end_date: endDate,
      })
      const r = await fetch(`/api/industrial/ponto/sync?${params.toString()}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.access_token}`,
        },
      })
      const j = await r.json()
      if (!r.ok || !j.ok) {
        setErro(j.erro || `HTTP ${r.status}`)
        return
      }
      setResultado({
        provider: j.provider,
        colaboradores: j.colaboradores,
        horas_registros: j.horas_registros,
        total_horas: j.total_horas,
      })
    } catch (e) {
      setErro((e as Error).message || 'erro de rede')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ background: CORES.offWhite, minHeight: '100vh' }}>
      <header style={{ background: CORES.espresso, color: CORES.offWhite, padding: '20px 24px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <p style={{ margin: 0, fontSize: 11, color: CORES.dourado, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>
            Industrial · RH / Ponto
          </p>
          <h1 style={{ margin: '8px 0 0', fontSize: 22, fontWeight: 700 }}>Sincronizar ponto</h1>
        </div>
      </header>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '24px 20px' }}>
        {erro && (
          <div style={{ background: '#FCEBEB', color: CORES.vermelho, padding: '10px 14px', borderRadius: 6, marginBottom: 14, fontSize: 13 }}>
            {erro}
          </div>
        )}
        {resultado && (
          <div style={{ background: '#DCFCE7', color: CORES.verde, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14, fontWeight: 600 }}>
            ✓ SINCRONIZOU · {resultado.colaboradores} colaboradores e {resultado.horas_registros} registros de horas — total {resultado.total_horas.toFixed(2)}h ({resultado.provider}).
          </div>
        )}

        <section style={{ background: '#FFFFFF', border: `0.5px solid ${CORES.cinzaSuave}`, borderRadius: 10, padding: 20, marginBottom: 16 }}>
          <Campo label="Planta">
            {loadingPlantas ? (
              <div style={{ fontSize: 13, color: 'rgba(61,35,20,0.6)' }}>Carregando plantas com integração…</div>
            ) : plantas.length === 0 ? (
              <div style={{ fontSize: 13, color: CORES.vermelho }}>
                Nenhuma planta com integração de ponto ativa. Configure em <code>ind_ponto_provider_config</code> primeiro.
              </div>
            ) : (
              <select value={plantId} onChange={(e) => setPlantId(e.target.value)} style={inputStyle}>
                <option value="">Selecione a planta</option>
                {plantas.map((p) => (
                  <option key={p.plant_id} value={p.plant_id}>{p.nome_planta} · {p.provider}</option>
                ))}
              </select>
            )}
          </Campo>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Campo label="Início do período">
              <input type="date" value={beginDate} onChange={(e) => setBeginDate(e.target.value)} style={inputStyle} />
            </Campo>
            <Campo label="Fim do período">
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={inputStyle} />
            </Campo>
          </div>
          <p style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', margin: '4px 0 0' }}>
            Período máximo: 31 dias (limite da API IO Point).
          </p>
        </section>

        <button
          type="button"
          onClick={sincronizar}
          disabled={busy || !plantaSel}
          style={{
            width: '100%', background: busy || !plantaSel ? 'rgba(200,148,26,0.4)' : CORES.dourado,
            color: CORES.espresso, border: 'none', padding: '14px 22px',
            borderRadius: 8, fontSize: 15, fontWeight: 700,
            cursor: busy || !plantaSel ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Sincronizando…' : 'Sincronizar ponto'}
        </button>
      </main>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px',
  border: '0.5px solid rgba(61,35,20,0.25)',
  borderRadius: 6, fontSize: 13, color: '#3D2314',
  background: '#FFFFFF', boxSizing: 'border-box',
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  )
}
