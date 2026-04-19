'use client'

import React, { useEffect, useState } from 'react'
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
const fmtRk = (v: any) => {
  const n = Number(v) || 0
  if (Math.abs(n) >= 1000000) return `R$ ${(n / 1000000).toFixed(1)}M`
  if (Math.abs(n) >= 1000) return `R$ ${(n / 1000).toFixed(1)}k`
  return `R$ ${n.toFixed(0)}`
}

export default function DashboardHome() {
  const [user, setUser] = useState<any>(null)
  const [sel, setSel] = useState('')
  const [companies, setCompanies] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [kpis, setKpis] = useState<any>({ aReceber: 0, aPagar: 0, mrr: 0, saldoBancos: 0 })
  const [atividade, setAtividade] = useState<any[]>([])
  const [vencimentos, setVencimentos] = useState<any[]>([])

  useEffect(() => { load() }, [])
  useEffect(() => { if (sel) loadDados() }, [sel])

  const load = async () => {
    const { data: { user: u } } = await supabase.auth.getUser()
    if (u) setUser(u)
    const { data: up } = await supabase.from('users').select('role').eq('id', u?.id).single()
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
      const m = saved ? d.find((c: any) => c.id === saved) : null
      setSel(m ? m.id : d[0].id)
    }
    setLoading(false)
  }

  const loadDados = async () => {
    try {
      // KPIs financeiros (com tratamento defensivo)
      const [{ data: l }, { data: b }, { data: c }] = await Promise.all([
        supabase.from('erp_lancamentos').select('tipo, valor, status, data_vencimento, cliente_nome, fornecedor_nome, descricao, created_at').eq('company_id', sel).order('created_at', { ascending: false }).limit(50),
        supabase.from('erp_banco_contas').select('saldo_atual').eq('company_id', sel).eq('ativo', true),
        supabase.from('erp_contratos').select('valor_atual, valor_mensal, periodicidade').eq('company_id', sel).eq('status', 'ativo'),
      ])

      const aReceber = (l || []).filter((x: any) => ['receita','entrada','receber'].includes(x.tipo) && ['pendente','aberto'].includes(x.status)).reduce((s: number, x: any) => s + Number(x.valor || 0), 0)
      const aPagar = (l || []).filter((x: any) => ['despesa','saida','pagar'].includes(x.tipo) && ['pendente','aberto'].includes(x.status)).reduce((s: number, x: any) => s + Number(x.valor || 0), 0)
      const saldoBancos = (b || []).reduce((s: number, x: any) => s + Number(x.saldo_atual || 0), 0)
      const mrr = (c || []).reduce((s: number, x: any) => {
        const v = Number(x.valor_atual || x.valor_mensal || 0)
        const mult = x.periodicidade === 'anual' ? 1/12 : x.periodicidade === 'semestral' ? 1/6 : x.periodicidade === 'trimestral' ? 1/3 : x.periodicidade === 'bimestral' ? 1/2 : 1
        return s + v * mult
      }, 0)
      setKpis({ aReceber, aPagar, mrr, saldoBancos })

      // Atividade recente (últimos 6 lançamentos)
      setAtividade((l || []).slice(0, 6))

      // Próximos vencimentos (7 dias)
      const hoje = new Date().toISOString().slice(0, 10)
      const d7 = new Date()
      d7.setDate(d7.getDate() + 7)
      const d7s = d7.toISOString().slice(0, 10)
      const vencs = (l || [])
        .filter((x: any) => ['pendente','aberto'].includes(x.status) && x.data_vencimento >= hoje && x.data_vencimento <= d7s)
        .sort((a: any, b: any) => a.data_vencimento.localeCompare(b.data_vencimento))
        .slice(0, 8)
      setVencimentos(vencs)
    } catch (e) {
      // Silencioso - tabelas podem não existir ainda em alguns ambientes
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
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--ps-text-d)' }}>Carregando...</div>
    )
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
        <p style={{ fontSize: 15, color: 'var(--ps-text-m)', marginTop: 8, marginBottom: 0, maxWidth: 580 }}>
          Aqui está o panorama de hoje. Seus módulos e inteligência PS estão prontos para atuar.
        </p>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 32 }}>
        <KPICard
          label="A Receber"
          value={fmtR(kpis.aReceber)}
          accent="green"
          desc="Títulos em aberto"
          href="/dashboard/contas?tipo=receber"
        />
        <KPICard
          label="A Pagar"
          value={fmtR(kpis.aPagar)}
          accent="red"
          desc="Títulos em aberto"
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
                const isReceita = ['receita','entrada','receber'].includes(v.tipo)
                return (
                  <div
                    key={i}
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
                        {v.cliente_nome || v.fornecedor_nome || '—'} · {new Date(v.data_vencimento + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
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
                const isReceita = ['receita','entrada','receber'].includes(a.tipo)
                return (
                  <div
                    key={i}
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
                        {new Date(a.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ps-text-m)', fontFamily: 'var(--ps-font-mono)' }}>
                      {fmtR(a.valor)}
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
            PS Gestão ERP v11.0
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
