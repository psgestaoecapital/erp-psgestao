'use client'

// DASHBOARD CONSOLIDADO (genérico) — seção da aba Início.
// Resolve o grupo da empresa via fn_grupo_empresa (sem hardcode de empresa/CNPJ)
// e consolida N empresas (grupo) ou 1 (sem grupo). Reusa a engine fn_psgc_* (DRE
// horizontal, mês corrente) pros cards e erp_receber/erp_pagar pro aberto por CNPJ.
// Multi-tenant: só as empresas do grupo que o usuário tem acesso (RLS + guard).

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const MUT = 'rgba(61,35,20,0.55)'
const GREEN = '#166534'
const RED = '#A32D2D'
const CREAM = '#F2EBDF'

type Empresa = { id: string; nome_fantasia: string; cnpj: string | null; ordem: number }
type Grupo = { ok: boolean; grupo_id: string | null; grupo_nome: string; is_grupo: boolean; company_ids: string[]; empresas: Empresa[] }
type PorEmpresa = { id: string; nome: string; receber: number; pagar: number }

const firstOfMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }
const abrev = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${(n / 1_000_000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mi`
  if (a >= 1_000) return `${(n / 1_000).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} mil`
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}
const cheio = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function DashboardConsolidado() {
  const { sel, companyIds, selInfo } = useCompanyIds()
  const empresaUnica = sel && sel !== 'consolidado' && !sel.startsWith('group_') ? sel : null

  const [grupo, setGrupo] = useState<Grupo | null>(null)
  const [dre, setDre] = useState<{ receita: number; despesa: number; resultado: number } | null>(null)
  const [porEmpresa, setPorEmpresa] = useState<PorEmpresa[]>([])
  const [totais, setTotais] = useState({ receber: 0, pagar: 0 })
  const [loading, setLoading] = useState(true)

  // 1) resolve o grupo (genérico): empresa única → fn_grupo_empresa; senão os companyIds do seletor
  useEffect(() => {
    let alive = true
    const run = async () => {
      if (empresaUnica) {
        const { data } = await supabase.rpc('fn_grupo_empresa', { p_company_id: empresaUnica })
        if (!alive) return
        const g = data as Grupo | null
        if (g?.ok) { setGrupo(g); return }
      }
      if (!alive) return
      setGrupo({ ok: true, grupo_id: null, grupo_nome: selInfo.nome, is_grupo: companyIds.length > 1, company_ids: companyIds, empresas: [] })
    }
    void run()
    return () => { alive = false }
  }, [empresaUnica, companyIds, selInfo.nome])

  const membros = useMemo(() => grupo?.company_ids ?? [], [grupo])
  const nomePorId = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of grupo?.empresas ?? []) m.set(e.id, e.nome_fantasia)
    return m
  }, [grupo])

  // 2) carrega cards (DRE mês corrente) + aberto por empresa.
  // O aberto vem de fn_grupo_aberto_por_empresa (agregação NO BANCO): somar linhas
  // no client truncava no cap de 1000 do PostgREST e subestimava empresas grandes.
  const carregar = useCallback(async () => {
    if (!membros.length) return
    setLoading(true)
    const cur = firstOfMonth()
    const ym = cur.slice(0, 7)
    const [dreRes, abertoRes] = await Promise.all([
      supabase.rpc('fn_psgc_dre_horizontal', { p_company_ids: membros, p_mes_ini: cur, p_mes_fim: cur, p_regime: 'competencia' }),
      supabase.rpc('fn_grupo_aberto_por_empresa', { p_company_ids: membros }),
    ])

    const r = dreRes.data as { ok?: boolean; linhas?: { kind: string; codigo: string; sinal: string; valores_mes: Record<string, number> }[] } | null
    if (r?.ok && r.linhas) {
      const receita = r.linhas.find((l) => l.codigo === 'ROB')?.valores_mes?.[ym] ?? 0
      const resultado = r.linhas.find((l) => l.codigo === 'LL')?.valores_mes?.[ym] ?? 0
      const despesa = r.linhas.filter((l) => l.kind === 'grupo' && l.sinal !== '+').reduce((s, l) => s + (l.valores_mes?.[ym] ?? 0), 0)
      setDre({ receita, despesa, resultado })
    } else setDre(null)

    const ab = abertoRes.data as { ok?: boolean; totais?: { receber: number; pagar: number }; por_empresa?: { company_id: string; nome_fantasia: string; receber_aberto: number; pagar_aberto: number }[] } | null
    if (ab?.ok) {
      setTotais({ receber: ab.totais?.receber ?? 0, pagar: ab.totais?.pagar ?? 0 })
      setPorEmpresa((ab.por_empresa ?? []).map((e) => ({ id: e.company_id, nome: e.nome_fantasia || nomePorId.get(e.company_id) || e.company_id.slice(0, 8), receber: e.receber_aberto, pagar: e.pagar_aberto })))
    } else {
      setTotais({ receber: 0, pagar: 0 }); setPorEmpresa([])
    }
    setLoading(false)
  }, [membros, nomePorId])

  useEffect(() => { void carregar() }, [carregar])

  const titulo = grupo
    ? (grupo.is_grupo ? `Dashboard Consolidado · ${grupo.grupo_nome}` : `Dashboard · ${grupo.grupo_nome}`)
    : 'Dashboard'
  const maxBar = useMemo(() => Math.max(1, ...porEmpresa.map((e) => Math.max(e.receber, e.pagar))), [porEmpresa])

  if (grupo && !grupo.is_grupo && membros.length <= 1 && !dre && !loading && totais.receber === 0 && totais.pagar === 0) {
    // empresa sem grupo e sem dado consolidado → não polui a home com "consolidado" vazio (Pilar 3)
    return null
  }

  return (
    <section style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 14, padding: '18px 20px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: GOLD, margin: 0 }}>
            {grupo?.is_grupo ? `${membros.length} CNPJs` : 'Empresa'}
          </p>
          <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, color: ESP, margin: '2px 0 0' }}>{titulo}</h2>
        </div>
        <Link href="/dashboard/financeiro/dre-consolidado" style={{ padding: '8px 14px', borderRadius: 8, background: GOLD, color: '#fff', fontSize: 12.5, fontWeight: 700, textDecoration: 'none' }}>
          Abrir DRE completo →
        </Link>
      </div>

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: MUT, fontSize: 13 }}>Carregando consolidado…</div>
      ) : (
        <>
          {/* Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
            <Card label="Receita do mês" valor={dre ? dre.receita : null} />
            <Card label="Despesa do mês" valor={dre ? dre.despesa : null} cor={dre && dre.despesa < 0 ? ESP : undefined} />
            <Card label="Resultado do mês" valor={dre ? dre.resultado : null} cor={dre ? (dre.resultado < 0 ? RED : GREEN) : undefined} />
            <Card label="A Receber (aberto)" valor={totais.receber} cor={GREEN} />
            <Card label="A Pagar (aberto)" valor={totais.pagar} cor={RED} />
          </div>

          {/* Quebra por empresa (só quando é grupo) */}
          {grupo?.is_grupo && porEmpresa.length > 0 && (
            <div style={{ border: `0.5px solid ${LINE}`, borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '8px 12px', background: CREAM, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT }}>
                Aberto por empresa · Receber × Pagar
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {porEmpresa.map((e) => {
                  const saldo = e.receber - e.pagar
                  return (
                    <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 2fr auto', gap: 10, alignItems: 'center', padding: '9px 12px', borderTop: `0.5px solid ${LINE}` }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: ESP, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.nome}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <Barra valor={e.receber} max={maxBar} cor={GREEN} />
                        <Barra valor={e.pagar} max={maxBar} cor={RED} />
                      </div>
                      <div title={cheio(saldo)} style={{ textAlign: 'right', fontSize: 12.5, fontWeight: 700, color: saldo < 0 ? RED : GREEN, fontVariantNumeric: 'tabular-nums', minWidth: 74 }}>
                        {saldo < 0 ? '−' : ''}R$ {abrev(Math.abs(saldo))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          <p style={{ fontSize: 11, color: MUT, margin: '10px 2px 0', fontStyle: 'italic' }}>
            Cards do mês corrente (competência, engine DRE). Aberto (a receber/a pagar) somado dos títulos em aberto/vencido dos CNPJs do grupo. Valores abreviados — hover mostra o cheio.
          </p>
        </>
      )}
    </section>
  )
}

function Card({ label, valor, cor }: { label: string; valor: number | null; cor?: string }) {
  return (
    <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: MUT, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>{label}</div>
      <div title={valor != null ? cheio(valor) : ''} style={{ fontSize: 19, fontWeight: 700, color: cor ?? ESP, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
        {valor != null ? `R$ ${abrev(valor)}` : '—'}
      </div>
    </div>
  )
}

function Barra({ valor, max, cor }: { valor: number; max: number; cor: string }) {
  return (
    <div title={cheio(valor)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 8, background: CREAM, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, (Math.abs(valor) / max) * 100)}%`, height: '100%', background: cor }} />
      </div>
      <span style={{ fontSize: 10.5, color: MUT, minWidth: 58, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>R$ {abrev(valor)}</span>
    </div>
  )
}
