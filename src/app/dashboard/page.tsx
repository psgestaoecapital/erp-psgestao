'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

// Paleta (usa CSS vars do layout)
const styles = {
  card: {
    background: 'var(--ps-bg2)',
    border: '1px solid var(--ps-border)',
    borderRadius: 12,
    padding: 20,
  },
}

const fmtR = (v: any) => `R$ ${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`

// ═══════════════════════════════════════════════════════════════
// DASHBOARD v12.1 — RPC fn_dashboard_kpis para agregação servidor-side
// Corrige bug de limit=1000 do Supabase JS em grandes volumes
// Listas limitadas continuam via .limit() no client (ok, são 8 itens)
// ═══════════════════════════════════════════════════════════════

export default function DashboardHome() {
  const [user, setUser] = useState<any>(null)
  const [sel, setSel] = useState('')
  const [companies, setCompanies] = useState<any[]>([])
  const [groups, setGroups] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [kpis, setKpis] = useState<any>({ aReceber: 0, aPagar: 0, mrr: 0, saldoBancos: 0, aReceberQtd: 0, aPagarQtd: 0 })
  const [atividade, setAtividade] = useState<any[]>([])
  const [vencimentos, setVencimentos] = useState<any[]>([])
  const [escopoLabel, setEscopoLabel] = useState('')

  // ═══ Carrega lista de empresas e grupos (1x) ═══
  useEffect(() => {
    load()
  }, [])

  // ═══ Listener: detecta troca de empresa no seletor do layout ═══
  useEffect(() => {
    if (typeof window === 'undefined') return

    const checkSel = () => {
      const saved = localStorage.getItem('ps_empresa_sel')
      if (saved && saved !== sel) {
        setSel(saved)
      }
    }
    const interval = setInterval(checkSel, 400)
    window.addEventListener('storage', checkSel)

    return () => {
      clearInterval(interval)
      window.removeEventListener('storage', checkSel)
    }
  }, [sel])

  // ═══ Recarrega dados quando `sel` ou `companies` mudam ═══
  useEffect(() => {
    if (sel && companies.length > 0) {
      loadDados()
    }
  }, [sel, companies])

  const load = async () => {
    const { data: { user: u } } = await supabase.auth.getUser()
    if (u) setUser(u)

    const { data: up } = await supabase.from('users').select('role').eq('id', u?.id).single()

    const { data: grps } = await supabase.from('company_groups').select('*').order('nome')
    setGroups(grps || [])

    let d: any[] = []
    if (up?.role === 'adm' || up?.role === 'acesso_total' || up?.role === 'adm_investimentos') {
      const r = await supabase.from('companies').select('*').order('nome_fantasia')
      d = r.data || []
    } else {
      const r = await supabase.from('user_companies').select('companies(*)').eq('user_id', u?.id)
      d = (r.data || []).map((u: any) => u.companies).filter(Boolean)
    }
    setCompanies(d)

    if (d.length > 0) {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('ps_empresa_sel') : null
      if (saved === 'consolidado' || saved?.startsWith('group_')) {
        setSel(saved)
      } else {
        const m = saved ? d.find((c: any) => c.id === saved) : null
        setSel(m ? m.id : (d.length > 1 ? 'consolidado' : d[0].id))
      }
    }
    setLoading(false)
  }

  const resolveCompanyIds = useCallback((): string[] => {
    if (!sel) return []
    if (sel === 'consolidado') return companies.map((c: any) => c.id)
    if (sel.startsWith('group_')) {
      const gid = sel.replace('group_', '')
      return companies.filter((c: any) => c.group_id === gid).map((c: any) => c.id)
    }
    return [sel]
  }, [sel, companies])

  const computeEscopoLabel = useCallback((): string => {
    if (sel === 'consolidado') return `${companies.length} empresas · Consolidado`
    if (sel.startsWith('group_')) {
      const gid = sel.replace('group_', '')
      const grp = groups.find((g: any) => g.id === gid)
      const emps = companies.filter((c: any) => c.group_id === gid)
      return `${grp?.nome || 'Grupo'} · ${emps.length} empresas`
    }
    const c = companies.find((c: any) => c.id === sel)
    return c?.nome_fantasia || c?.razao_social || ''
  }, [sel, companies, groups])

  const loadDados = async () => {
    try {
      const ids = resolveCompanyIds()
      if (ids.length === 0) {
        setKpis({ aReceber: 0, aPagar: 0, mrr: 0, saldoBancos: 0, aReceberQtd: 0, aPagarQtd: 0 })
        setAtividade([])
        setVencimentos([])
        return
      }

      setEscopoLabel(computeEscopoLabel())

      const hoje = new Date().toISOString().slice(0, 10)
      const d7 = new Date()
      d7.setDate(d7.getDate() + 7)
      const d7s = d7.toISOString().slice(0, 10)

      // KPIs via RPC (agregação servidor-side, sem problema de limit)
      const kpisPromise = supabase.rpc('fn_dashboard_kpis', { p_company_ids: ids })

      // Listas (limit baixo, sem problema de 1000)
      const vencsReceberPromise = supabase
        .from('erp_receber')
        .select('id, cliente_nome, descricao, valor, data_vencimento, status')
        .in('company_id', ids)
        .eq('status', 'aberto')
        .gte('data_vencimento', hoje)
        .lte('data_vencimento', d7s)
        .order('data_vencimento', { ascending: true })
        .limit(20)

      const vencsPagarPromise = supabase
        .from('erp_pagar')
        .select('id, fornecedor_nome, descricao, valor, data_vencimento, status')
        .in('company_id', ids)
        .eq('status', 'aberto')
        .gte('data_vencimento', hoje)
        .lte('data_vencimento', d7s)
        .order('data_vencimento', { ascending: true })
        .limit(20)

      const recentReceberPromise = supabase
        .from('erp_receber')
        .select('id, cliente_nome, descricao, valor, data_vencimento, status, created_at')
        .in('company_id', ids)
        .order('created_at', { ascending: false })
        .limit(10)

      const recentPagarPromise = supabase
        .from('erp_pagar')
        .select('id, fornecedor_nome, descricao, valor, data_vencimento, status, created_at')
        .in('company_id', ids)
        .order('created_at', { ascending: false })
        .limit(10)

      const [
        { data: kpisData, error: kpisErr },
        { data: receberVenc },
        { data: pagarVenc },
        { data: receberRecent },
        { data: pagarRecent },
      ] = await Promise.all([kpisPromise, vencsReceberPromise, vencsPagarPromise, recentReceberPromise, recentPagarPromise])

      if (kpisErr) {
        console.warn('RPC fn_dashboard_kpis falhou, usando fallback:', kpisErr)
        // Fallback: caso a RPC não exista ainda, voltamos ao método antigo (com limit=1000, imperfeito mas não quebra)
        const [receberAb, pagarAb] = await Promise.all([
          supabase.from('erp_receber').select('valor').in('company_id', ids).eq('status', 'aberto'),
          supabase.from('erp_pagar').select('valor').in('company_id', ids).eq('status', 'aberto'),
        ])
        setKpis({
          aReceber: (receberAb.data || []).reduce((s: number, x: any) => s + Number(x.valor || 0), 0),
          aPagar:   (pagarAb.data || []).reduce((s: number, x: any) => s + Number(x.valor || 0), 0),
          mrr: 0,
          saldoBancos: 0,
          aReceberQtd: (receberAb.data || []).length,
          aPagarQtd: (pagarAb.data || []).length,
        })
      } else {
        const k = kpisData?.[0] || {}
        setKpis({
          aReceber: Number(k.a_receber_valor || 0),
          aPagar: Number(k.a_pagar_valor || 0),
          mrr: Number(k.mrr_mensal || 0),
          saldoBancos: Number(k.saldo_bancos || 0),
          aReceberQtd: Number(k.a_receber_qtd || 0),
          aPagarQtd: Number(k.a_pagar_qtd || 0),
        })
      }

      // Próximos vencimentos (unifica receber + pagar, ordena por data)
      const vencsUnified = [
        ...(receberVenc || []).map((x: any) => ({ ...x, tipo: 'receita', pessoa: x.cliente_nome })),
        ...(pagarVenc || []).map((x: any) => ({ ...x, tipo: 'despesa', pessoa: x.fornecedor_nome })),
      ]
        .sort((a, b) => (a.data_vencimento || '').localeCompare(b.data_vencimento || ''))
        .slice(0, 8)
      setVencimentos(vencsUnified)

      // Atividade recente
      const atividadeUnified = [
        ...(receberRecent || []).map((x: any) => ({ ...x, tipo: 'receita', pessoa: x.cliente_nome })),
        ...(pagarRecent || []).map((x: any) => ({ ...x, tipo: 'despesa', pessoa: x.fornecedor_nome })),
      ]
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
        .slice(0, 6)
      setAtividade(atividadeUnified)

    } catch (e) {
      console.error('Erro ao carregar dashboard:', e)
    }
  }

  const saudacao = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Bom dia'
    if (h < 18) return 'Boa tarde'
    return 'Boa noite'
  }

  const primeiroNome = user?.email?.split('@')[0]?.split('.')?.[0] || ''
  const nomeCapitalizado = primeiroNome.charAt(0).toUpperCase() + primeiroNome.slice(1)

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ps-text-d)' }}>Carregando...</div>
  }

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* HERO */}
      <div style={{ marginBottom: 32 }}>
        <div
          style={{
            fontSize: 11,
            color: 'var(--ps-text-d)',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            fontWeight: 600,
            marginBottom: 8,
          }}
        >
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
        </div>
        <h1
          style={{
            fontFamily: 'var(--ps-font-display)',
            fontSize: 36,
            fontWeight: 500,
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            color: 'var(--ps-text)',
            margin: 0,
          }}
        >
          {saudacao()}, <em style={{ fontStyle: 'italic', color: 'var(--ps-gold-d)', fontWeight: 600 }}>{nomeCapitalizado}</em>.
        </h1>
        <p style={{ fontSize: 15, color: 'var(--ps-text-m)', marginTop: 8, marginBottom: 0, maxWidth: 680 }}>
          Aqui está o panorama de hoje. Seus módulos e inteligência PS estão prontos para atuar.
          {escopoLabel && (
            <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--ps-gold-d)', fontWeight: 600 }}>
              · {escopoLabel}
            </span>
          )}
        </p>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 32 }}>
        <KPICard
          label="A Receber"
          value={fmtR(kpis.aReceber)}
          accent="green"
          desc={`${kpis.aReceberQtd} títulos em aberto`}
          href="/dashboard/contas?tipo=receber"
        />
        <KPICard
          label="A Pagar"
          value={fmtR(kpis.aPagar)}
          accent="red"
          desc={`${kpis.aPagarQtd} títulos em aberto`}
          href="/dashboard/contas?tipo=pagar"
        />
        <KPICard
          label="MRR Recorrente"
          value={fmtR(kpis.mrr)}
          accent="gold"
          desc="Receita recorrente mensal"
          href="/dashboard/contratos"
        />
        <KPICard
          label="Saldo em Bancos"
          value={fmtR(kpis.saldoBancos)}
          accent="blue"
          desc="Contas ativas"
          href="/dashboard/conciliacao"
        />
      </div>

      {/* ATALHOS RÁPIDOS */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, fontFamily: 'var(--ps-font-display)' }}>Atalhos rápidos</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <ActionCard href="/dashboard/orcamentos" label="Novo Orçamento" desc="Cliente aprova por link" />
          <ActionCard href="/dashboard/contas" label="Baixar Títulos" desc="Em lote, atualiza saldo" />
          <ActionCard href="/dashboard/conciliacao" label="Conciliação OFX" desc="Upload + match IA" />
          <ActionCard href="/dashboard/contratos" label="Gerar Faturamento" desc="Títulos do mês" />
          <ActionCard href="/dashboard/previsao" label="Previsão de Caixa" desc="90 dias com IA" highlight />
          <ActionCard href="/dashboard/score" label="Score de Clientes" desc="Análise com IA" highlight />
        </div>
      </div>

      {/* COLUNAS: Vencimentos + Atividade */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 20 }}>
        {/* Próximos vencimentos */}
        <div style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, fontFamily: 'var(--ps-font-display)' }}>Próximos 7 dias</h3>
            <Link href="/dashboard/contas" style={{ fontSize: 11, color: 'var(--ps-gold-d)', textDecoration: 'none', fontWeight: 600 }}>
              Ver todos →
            </Link>
          </div>
          {vencimentos.length === 0 ? (
            <EmptyMini icon="📭" text="Nenhum vencimento nos próximos 7 dias" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {vencimentos.map((v: any, i: number) => {
                const isReceita = v.tipo === 'receita'
                return (
                  <div
                    key={`${v.tipo}-${v.id || i}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 0',
                      borderBottom: i < vencimentos.length - 1 ? '1px solid var(--ps-border-l)' : 'none',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ps-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {v.descricao}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ps-text-d)', marginTop: 2 }}>
                        {v.pessoa || '—'} · {new Date(v.data_vencimento + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: isReceita ? 'var(--ps-green)' : 'var(--ps-red)', fontFamily: 'var(--ps-font-mono)', whiteSpace: 'nowrap' }}>
                      {isReceita ? '+' : '−'} {fmtR(v.valor)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Atividade Recente */}
        <div style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, fontFamily: 'var(--ps-font-display)' }}>Atividade recente</h3>
          </div>
          {atividade.length === 0 ? (
            <EmptyMini icon="✨" text="Nenhum lançamento recente" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {atividade.map((a: any, i: number) => {
                const isReceita = a.tipo === 'receita'
                return (
                  <div
                    key={`${a.tipo}-${a.id || i}`}
                    style={{
                      display: 'flex',
                      gap: 12,
                      padding: '10px 0',
                      borderBottom: i < atividade.length - 1 ? '1px solid var(--ps-border-l)' : 'none',
                    }}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: isReceita ? 'var(--ps-green)' : 'var(--ps-red)',
                        marginTop: 6,
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--ps-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {a.descricao}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ps-text-d)', marginTop: 2 }}>
                        {a.pessoa || '—'} · {a.created_at ? new Date(a.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: isReceita ? 'var(--ps-green)' : 'var(--ps-red)', fontFamily: 'var(--ps-font-mono)' }}>
                      {isReceita ? '+' : '−'}{fmtR(a.valor)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer com stats do ERP */}
      <div
        style={{
          marginTop: 40,
          padding: '20px 24px',
          background: 'var(--ps-bg3)',
          borderRadius: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: 'var(--ps-text-d)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            PS Gestão ERP v12.1
          </div>
          <div style={{ fontSize: 13, color: 'var(--ps-text-m)', marginTop: 4 }}>
            22 módulos · 3 sistemas com IA · Ciclo completo de comércio, compras e finanças
          </div>
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          <MiniStat label="Empresas" value={String(companies.length)} />
          <MiniStat label="Módulos Ativos" value="22" />
          <MiniStat label="IA Nativa" value="✓" />
        </div>
      </div>
    </div>
  )
}

function KPICard({ label, value, accent, desc, href }: { label: string; value: string; accent: 'green'|'red'|'gold'|'blue'; desc: string; href: string }) {
  const colorMap = {
    green: { fg: 'var(--ps-green)', bg: 'var(--ps-green-bg)' },
    red: { fg: 'var(--ps-red)', bg: 'var(--ps-red-bg)' },
    gold: { fg: 'var(--ps-gold-d)', bg: 'var(--ps-gold-bg)' },
    blue: { fg: 'var(--ps-blue)', bg: 'var(--ps-blue-bg)' },
  }
  const c = colorMap[accent]
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        background: 'var(--ps-bg2)',
        border: '1px solid var(--ps-border)',
        borderRadius: 12,
        padding: 20,
        textDecoration: 'none',
        color: 'var(--ps-text)',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = c.fg
        e.currentTarget.style.boxShadow = 'var(--ps-shadow)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--ps-border)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <div style={{ position: 'absolute', top: 0, right: 0, width: 60, height: 60, background: c.bg, borderRadius: '0 0 0 60px', opacity: 0.7 }} />
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ps-text-d)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6, position: 'relative' }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: c.fg, fontFamily: 'var(--ps-font-mono)', letterSpacing: '-0.02em', marginBottom: 4, position: 'relative' }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--ps-text-d)', position: 'relative' }}>
        {desc}
      </div>
    </Link>
  )
}

function ActionCard({ href, label, desc, highlight }: { href: string; label: string; desc: string; highlight?: boolean }) {
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        padding: '14px 16px',
        background: highlight ? 'var(--ps-gold-bg)' : 'var(--ps-bg2)',
        border: `1px solid ${highlight ? 'var(--ps-gold)' : 'var(--ps-border)'}`,
        borderRadius: 10,
        textDecoration: 'none',
        color: 'var(--ps-text)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--ps-gold-d)'
        e.currentTarget.style.boxShadow = 'var(--ps-shadow)'
        e.currentTarget.style.transform = 'translateY(-1px)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = highlight ? 'var(--ps-gold)' : 'var(--ps-border)'
        e.currentTarget.style.boxShadow = 'none'
        e.currentTarget.style.transform = 'translateY(0)'
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3, color: highlight ? 'var(--ps-gold-d)' : 'var(--ps-text)' }}>
        {label}
        {highlight && <span style={{ fontSize: 9, marginLeft: 6, padding: '1px 5px', background: 'var(--ps-gold)', color: 'var(--ps-text)', borderRadius: 3, fontWeight: 700, letterSpacing: '0.05em' }}>IA</span>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--ps-text-d)' }}>{desc}</div>
    </Link>
  )
}

function EmptyMini({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ padding: 30, textAlign: 'center' }}>
      <div style={{ fontSize: 28, marginBottom: 6, opacity: 0.5 }}>{icon}</div>
      <div style={{ fontSize: 12, color: 'var(--ps-text-d)' }}>{text}</div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ps-gold-d)', fontFamily: 'var(--ps-font-display)' }}>
        {value}
      </div>
      <div style={{ fontSize: 9, color: 'var(--ps-text-d)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, marginTop: 2 }}>
        {label}
      </div>
    </div>
  )
}
