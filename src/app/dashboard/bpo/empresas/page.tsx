'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { PSGC_COLORS } from '@/lib/psgc-tokens'
import PSGCCard from '@/components/psgc/PSGCCard'
import PSGCButton from '@/components/psgc/PSGCButton'

const C = {
  bg: PSGC_COLORS.offWhite,
  card: PSGC_COLORS.offWhite,
  bd: PSGC_COLORS.offWhiteDarker,
  tx: PSGC_COLORS.espresso,
  txm: PSGC_COLORS.espressoLight,
  go: PSGC_COLORS.dourado,
  gol: PSGC_COLORS.douradoSoft,
  alta: PSGC_COLORS.alta,
  media: PSGC_COLORS.media,
  baixa: PSGC_COLORS.baixa,
  azul: PSGC_COLORS.azul,
}

type Papel = 'titular' | 'backup' | 'supervisor'

type Empresa = {
  company_id: string
  nome_fantasia: string
  papel: Papel
  inbox_pendente: number
  inbox_em_andamento: number
  inbox_aguardando_cliente: number
  sla_vencendo: number
}

type Filtro = 'todas' | Papel

function papelCor(papel: Papel): string {
  if (papel === 'titular') return C.baixa
  if (papel === 'backup') return C.azul
  return C.txm // supervisor
}

function truncar(texto: string, max = 40): string {
  if (texto.length <= max) return texto
  return texto.slice(0, max - 3) + '...'
}

export default function EmpresasPage() {
  const [loading, setLoading] = useState(true)
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [filtro, setFiltro] = useState<Filtro>('todas')

  useEffect(() => { carregar() }, [])

  async function carregar() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const { data, error } = await supabase.rpc('fn_bpo_minhas_empresas', { p_user_id: user.id })
    if (error) {
      console.error('Erro fn_bpo_minhas_empresas:', error)
    }
    setEmpresas((data ?? []) as Empresa[])
    setLoading(false)
  }

  const contagem = useMemo(() => ({
    todas: empresas.length,
    titular: empresas.filter(e => e.papel === 'titular').length,
    backup: empresas.filter(e => e.papel === 'backup').length,
    supervisor: empresas.filter(e => e.papel === 'supervisor').length,
  }), [empresas])

  const empresasFiltradas = useMemo(() => {
    if (filtro === 'todas') return empresas
    return empresas.filter(e => e.papel === filtro)
  }, [empresas, filtro])

  if (loading) {
    return <div style={{ padding: 32, color: C.tx }}>Carregando...</div>
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: 24 }}>
      {/* Botao volta */}
      <div style={{ marginBottom: 16 }}>
        <PSGCButton variant="ghost" size="sm" onClick={() => { window.location.href = '/dashboard/bpo' }}>
          ← BPO
        </PSGCButton>
      </div>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          fontFamily: 'Georgia, serif',
          fontStyle: 'italic',
          fontSize: 32,
          color: C.tx,
          margin: 0,
        }}>
          Minhas Empresas
        </h1>
        <p style={{ fontSize: 14, color: C.txm, marginTop: 8, marginBottom: 0 }}>
          {empresas.length === 0
            ? 'Nenhuma empresa atribuida.'
            : `Voce atende ${empresas.length} ${empresas.length === 1 ? 'empresa' : 'empresas'} BPO.`}
        </p>
      </div>

      {/* Filtros (chips) */}
      {empresas.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
          {(['todas', 'titular', 'backup', 'supervisor'] as Filtro[]).map((f) => {
            const count = contagem[f]
            if (f !== 'todas' && count === 0) return null
            const ativo = filtro === f
            return (
              <button
                key={f}
                onClick={() => setFiltro(f)}
                style={{
                  background: ativo ? C.tx : 'transparent',
                  color: ativo ? C.bg : C.tx,
                  border: `1.5px solid ${ativo ? C.tx : C.bd}`,
                  padding: '8px 16px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                  letterSpacing: 0.3,
                  transition: 'all 0.15s ease',
                }}
              >
                {f} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* Grid de cards ou empty state */}
      {empresas.length === 0 ? (
        <PSGCCard variant="default">
          <p style={{ color: C.txm, fontSize: 13, margin: 0 }}>
            Voce ainda nao tem empresas atribuidas. Fale com o supervisor (Gilberto).
          </p>
        </PSGCCard>
      ) : empresasFiltradas.length === 0 ? (
        <PSGCCard variant="default">
          <p style={{ color: C.txm, fontSize: 13, margin: 0 }}>
            Nenhuma empresa nessa categoria.
          </p>
        </PSGCCard>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {empresasFiltradas.map((e) => {
            const variant = e.sla_vencendo > 0 ? 'attention' : 'default'
            const corP = papelCor(e.papel)
            return (
              <PSGCCard
                key={e.company_id + e.papel}
                variant={variant}
                onClick={() => { window.location.href = `/dashboard/bpo/inbox?company_id=${e.company_id}` }}
              >
                {/* Header card: nome + badge papel */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 8 }}>
                  <strong style={{ color: C.tx, fontSize: 14, lineHeight: 1.3 }}>
                    {truncar(e.nome_fantasia, 32)}
                  </strong>
                  <span style={{
                    background: corP,
                    color: PSGC_COLORS.offWhite,
                    fontSize: 9,
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 4,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    whiteSpace: 'nowrap',
                  }}>
                    {e.papel}
                  </span>
                </div>

                {/* Numero grande - inbox pendente */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: C.tx, lineHeight: 1 }}>
                    {e.inbox_pendente}
                  </div>
                  <div style={{ fontSize: 11, color: C.txm, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2 }}>
                    Pendente
                  </div>
                </div>

                {/* Detalhes secundarios */}
                <div style={{ display: 'flex', gap: 14, fontSize: 11, color: C.txm, flexWrap: 'wrap' }}>
                  {e.inbox_em_andamento > 0 && (
                    <span><strong style={{ color: C.tx }}>{e.inbox_em_andamento}</strong> em curso</span>
                  )}
                  {e.inbox_aguardando_cliente > 0 && (
                    <span><strong style={{ color: C.tx }}>{e.inbox_aguardando_cliente}</strong> aguardando</span>
                  )}
                  {e.sla_vencendo > 0 && (
                    <span style={{ color: C.alta, fontWeight: 700 }}>
                      ⚠ {e.sla_vencendo} SLA
                    </span>
                  )}
                </div>
              </PSGCCard>
            )
          })}
        </div>
      )}
    </div>
  )
}
