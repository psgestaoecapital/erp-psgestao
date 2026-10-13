'use client'

// Acervo de plantas analisadas — PR-FIX #2 RD-41.
// Lista todas as erp_obra_planta com aps_status IN ('radiografado','traduzindo')
// da company atual. Click -> volta pro /dashboard/projetos/takeoff carregando
// aquela planta (via localStorage bridge).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, FileText, CheckCircle2, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.55)'

type PlantaAcervo = {
  id: string
  nome: string
  aps_status: 'traduzindo' | 'radiografado' | null
  analisado_em: string | null
  aps_traduzido_em: string | null
  updated_at: string
  arquivo_tipo: string | null
  orcamento_id: string | null
  projeto_nome: string | null
  cliente_nome: string | null
  aps_diagnostico: { n_objetos?: number; total_views?: number; layers?: unknown[] } | null
}

function useEmpresaSelecionada(): { companyId: string | null } {
  const [companyId, setCompanyId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => {
      if (typeof window === 'undefined') return null
      const v = localStorage.getItem('ps_empresa_sel')
      if (!v || v === 'consolidado' || v.startsWith('group_')) return null
      return v
    }
    setCompanyId(read())
    const t = setInterval(() => {
      const v = read()
      setCompanyId((prev) => (prev === v ? prev : v))
    }, 800)
    return () => clearInterval(t)
  }, [])
  return { companyId }
}

export default function AcervoTakeoffPage() {
  const { companyId } = useEmpresaSelecionada()
  const [plantas, setPlantas] = useState<PlantaAcervo[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId) return
    let alive = true
    setLoading(true); setErro(null)
    supabase
      .from('erp_obra_planta')
      .select('id,nome,aps_status,analisado_em,aps_traduzido_em,updated_at,arquivo_tipo,orcamento_id,projeto_nome,cliente_nome,aps_diagnostico')
      .eq('company_id', companyId)
      .in('aps_status', ['radiografado', 'traduzindo'])
      .order('analisado_em', { ascending: false, nullsFirst: false })
      .then(({ data, error }) => {
        if (!alive) return
        setLoading(false)
        if (error) { setErro(error.message); return }
        setPlantas((data as PlantaAcervo[]) ?? [])
      })
    return () => { alive = false }
  }, [companyId])

  if (!companyId) {
    return (
      <div style={{ minHeight: '100vh', background: BG, padding: 24, color: ESP60, fontSize: 13 }}>
        Selecione uma empresa específica no topo do menu para ver as análises salvas.
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '24px 16px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: GOLD }}>Construção · acervo</div>
            <h1 style={{ fontSize: 24, color: ESP, margin: '4px 0 0', fontFamily: 'ui-serif,Georgia,serif' }}>Plantas analisadas</h1>
            <p style={{ fontSize: 12, color: ESP60, marginTop: 4 }}>
              As análises são permanentes. Reabrir aqui não gera nova cobrança.
            </p>
          </div>
          <Link href="/dashboard/projetos/takeoff" style={{
            background: 'transparent', color: ESP, border: `0.5px solid ${LINE}`,
            padding: '8px 14px', borderRadius: 6, fontSize: 13, textDecoration: 'none',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <ArrowLeft size={14} /> Voltar ao Takeoff
          </Link>
        </header>

        {erro && <div style={{ background: '#FEE2E2', color: '#B91C1C', padding: 12, borderRadius: 6, fontSize: 13, marginBottom: 12 }}>{erro}</div>}
        {loading && <div style={{ padding: 24, textAlign: 'center', color: ESP60, fontSize: 13 }}>Carregando análises...</div>}
        {!loading && plantas.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: ESP60, fontSize: 13, background: '#FFFFFF', border: `0.5px solid ${LINE}`, borderRadius: 12 }}>
            Nenhuma planta processada ainda. <Link href="/dashboard/projetos/takeoff" style={{ color: GOLD, fontWeight: 600 }}>Subir a primeira</Link>.
          </div>
        )}

        <div style={{ display: 'grid', gap: 10 }}>
          {plantas.map((p) => {
            const feito = p.aps_status === 'radiografado'
            const dt = p.analisado_em ?? p.aps_traduzido_em ?? p.updated_at
            const nObj = p.aps_diagnostico?.n_objetos
            const nLayers = Array.isArray(p.aps_diagnostico?.layers) ? p.aps_diagnostico!.layers!.length : null
            const nViews = p.aps_diagnostico?.total_views
            return (
              <Link
                key={p.id}
                href={`/dashboard/projetos/takeoff?planta_id=${p.id}`}
                style={{
                  background: '#FFFFFF', border: `0.5px solid ${LINE}`, borderRadius: 12,
                  padding: 14, textDecoration: 'none', display: 'flex', gap: 12,
                  alignItems: 'flex-start',
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: feito ? '#DCFCE7' : '#FEF3C7',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: feito ? '#16A34A' : '#7A5A0F', flexShrink: 0,
                }}>
                  {feito ? <CheckCircle2 size={18} /> : <Loader2 size={18} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: ESP, fontWeight: 600 }}>
                    <FileText size={12} style={{ verticalAlign: '-2px', marginRight: 6, color: GOLD }} />
                    {p.nome}
                  </div>
                  <div style={{ fontSize: 11, color: ESP60, marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <span>{feito ? 'Analisado' : 'Em processamento'} · {new Date(dt).toLocaleString('pt-BR')}</span>
                    {p.arquivo_tipo && <span>· {p.arquivo_tipo.toUpperCase()}</span>}
                    {nObj !== undefined && <span>· {nObj} objetos</span>}
                    {nLayers !== null && <span>· {nLayers} layers</span>}
                    {nViews !== undefined && <span>· {nViews} views</span>}
                  </div>
                  {(p.projeto_nome || p.cliente_nome) && (
                    <div style={{ fontSize: 11, color: ESP60, marginTop: 2 }}>
                      {p.projeto_nome && <span>{p.projeto_nome}</span>}
                      {p.projeto_nome && p.cliente_nome && <span> · </span>}
                      {p.cliente_nome && <span>{p.cliente_nome}</span>}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 10, color: feito ? '#16A34A' : '#7A5A0F', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
                  {feito ? 'PRONTA' : 'PROCESSANDO'}
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
