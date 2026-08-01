'use client'

// RD-41 · Home da Oficina — 100% do banco do tenant (fim dos placeholders).
// Métricas por company_id via fn_oficina_home_metricas; faturamento [→GE] (lê de GE).
// Sem número fixo, sem estado fantasia, sem percentual que engana (RD-51/52/58).
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { Wrench, Car, ClipboardList, CalendarDays, DollarSign, Clock } from 'lucide-react'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E0D8CC', ESP60 = '#6B5D4F', ESP40 = '#9C8E80', OK = '#166534'

type Metricas = {
  ok?: boolean
  os_abertas?: number; veiculos_patio?: number; os_mes?: number
  faturamento_mes?: number | string; ultima_atividade?: string | null
  clientes?: number; telas_total?: number; telas_prontas?: number
}
type Atalho = { id: string; label: string; href: string }

const brl = (v: number | string | null | undefined) =>
  v == null ? '—' : (typeof v === 'string' ? parseFloat(v) : v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function fmtQuando(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const hoje = new Date()
  const mesmoDia = d.toDateString() === hoje.toDateString()
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (mesmoDia) return `hoje ${hora}`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ` ${hora}`
}

export default function OficinaHome() {
  const { companyIds } = useCompanyIds()
  const companyId = companyIds[0] ?? null
  const [m, setM] = useState<Metricas | null>(null)
  const [atalhos, setAtalhos] = useState<Atalho[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!companyId) { setM(null); setLoading(false); return }
    let alive = true
    setLoading(true)
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      const [met, mods] = await Promise.all([
        supabase.rpc('fn_oficina_home_metricas', { p_company_id: companyId }),
        supabase.rpc('fn_modulos_sidebar_por_area', { p_area_id: 'oficina', p_company_id: companyId, p_user_id: user?.id ?? null }),
      ])
      if (!alive) return
      setM((met.data as Metricas) ?? null)
      const vistos = new Set<string>(); const lista: Atalho[] = []
      for (const r of (Array.isArray(mods.data) ? mods.data : [])) {
        const href = r.rota as string | null
        if (!href || href === '#' || vistos.has(r.modulo_id)) continue
        vistos.add(r.modulo_id); lista.push({ id: r.modulo_id, label: r.nome, href })
      }
      setAtalhos(lista)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [companyId])

  // estado real (RD-58): última atividade recente = piloto ativo; senão, honesto.
  const ativo = !!m?.ultima_atividade
  const telasTxt = (m?.telas_total ?? 0) > 0 ? `${m?.telas_prontas ?? 0} de ${m?.telas_total} telas prontas` : null

  return (
    <div style={{ padding: 'clamp(16px, 4vw, 32px)', maxWidth: 920, margin: '0 auto', color: ESP }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ color: GOLD, display: 'inline-flex' }}><Wrench size={24} /></span>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Oficina</h1>
        {ativo && (
          <span style={{ fontSize: 11, padding: '4px 10px', borderRadius: 999, background: OK + '22', color: OK, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Piloto ativo em produção
          </span>
        )}
      </div>
      <p style={{ color: ESP60, fontSize: 13, marginTop: 0, marginBottom: 18 }}>
        {m?.ultima_atividade ? `Última atividade: ${fmtQuando(m.ultima_atividade)}` : 'Sem OS registrada ainda.'}
        {telasTxt ? ` · ${telasTxt}` : ''}
      </p>

      {loading ? (
        <p style={{ color: ESP60, fontSize: 13 }}>Carregando…</p>
      ) : !companyId ? (
        <p style={{ color: ESP60, fontSize: 13 }}>Selecione uma empresa específica no topo para ver a operação.</p>
      ) : (
        <>
          {/* Cards — todos por company_id, do banco do tenant */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 22 }}>
            <Stat icon={<ClipboardList size={16} />} label="OS abertas" value={m?.os_abertas ?? '—'} />
            <Stat icon={<Car size={16} />} label="Veículos no pátio" value={m?.veiculos_patio ?? '—'} />
            <Stat icon={<CalendarDays size={16} />} label="OS no mês" value={m?.os_mes ?? '—'} />
            <Stat icon={<DollarSign size={16} />} label="Faturamento do mês" value={brl(m?.faturamento_mes)} sub="via Gestão Empresarial" small />
            <Stat icon={<Clock size={16} />} label="Última atividade" value={fmtQuando(m?.ultima_atividade)} small />
          </div>

          {/* Atalhos reais das telas da oficina */}
          {atalhos.length > 0 && (
            <>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: ESP40, fontWeight: 700, marginBottom: 8 }}>Ferramentas</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                {atalhos.map((a) => (
                  <Link key={a.id} href={a.href} style={{ textDecoration: 'none' }}>
                    <div style={{ background: BG, border: `1px solid ${LINE}`, borderRadius: 10, padding: '14px 16px', color: ESP, fontSize: 14, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span>{a.label}</span><span style={{ color: GOLD }}>→</span>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ icon, label, value, sub, small }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; small?: boolean }) {
  return (
    <div style={{ background: BG, border: `1px solid ${LINE}`, borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: ESP40, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>{icon} {label}</span>
      <span style={{ fontSize: small ? 15 : 22, fontWeight: 700, color: ESP, lineHeight: 1.2, wordBreak: 'break-word' }}>{value}</span>
      {sub && <span style={{ fontSize: 10.5, color: ESP40 }}>{sub}</span>}
    </div>
  )
}
