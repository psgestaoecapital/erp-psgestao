'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  espresso: '#3D2314',
  offwhite: '#FAF7F2',
  gold: '#C8941A',
  beigeLt: '#f5f0e8',
  borderLt: '#ece3d2',
  ink: '#1a1a1a',
  muted: 'rgba(61, 35, 20, 0.55)',
  green: '#2d6a3e',
  greenBg: '#e8f3ec',
  amber: '#8a6a10',
  amberBg: '#fdf4e0',
  red: '#a02020',
  redBg: '#fce8e8',
  gray: '#6b6b6b',
  grayBg: '#efece6',
}

type Alerta = {
  documento_id: string
  funcionario_id: string
  nome_completo: string
  tipo_nome: string
  data_validade: string | null
  dias_para_vencer: number | null
  status_final: string
}

export default function ComplianceDashboardPage() {
  const { companyIds } = useCompanyIds()
  const [loading, setLoading] = useState(true)
  const [totalFuncionarios, setTotalFuncionarios] = useState(0)
  const [docsVencendo, setDocsVencendo] = useState(0)
  const [docsVencidos, setDocsVencidos] = useState(0)
  const [docsValidos, setDocsValidos] = useState(0)
  const [alertas, setAlertas] = useState<Alerta[]>([])

  useEffect(() => {
    if (!companyIds || companyIds.length === 0) return
    let ignore = false
    ;(async () => {
      setLoading(true)

      // Funcionários ativos
      const { count: qtdFunc } = await supabase
        .from('compliance_funcionarios')
        .select('id', { count: 'exact', head: true })
        .in('company_id', companyIds)
        .eq('ativo', true)

      // Matriz — count por status_final
      const { data: matriz } = await supabase
        .from('v_compliance_matriz_funcionarios')
        .select('status_final, funcionario_ativo, obrigatorio')
        .in('company_id', companyIds)

      const m = (matriz as any[] | null) ?? []
      const ativosObrig = m.filter((x) => x.funcionario_ativo && x.obrigatorio)
      const vencendo = ativosObrig.filter((x) => x.status_final === 'vencendo').length
      const vencidos = ativosObrig.filter((x) => x.status_final === 'vencido').length
      const validos = ativosObrig.filter((x) => x.status_final === 'valido').length

      // 10 alertas mais urgentes (vencidos primeiro, depois vencendo mais próximos)
      const { data: urgentes } = await supabase
        .from('v_compliance_matriz_funcionarios')
        .select('documento_id, funcionario_id, nome_completo, tipo_nome, data_validade, dias_para_vencer, status_final')
        .in('company_id', companyIds)
        .eq('funcionario_ativo', true)
        .eq('obrigatorio', true)
        .in('status_final', ['vencido', 'vencendo'])
        .order('dias_para_vencer', { ascending: true, nullsFirst: true })
        .limit(10)

      if (!ignore) {
        setTotalFuncionarios(qtdFunc ?? 0)
        setDocsVencendo(vencendo)
        setDocsVencidos(vencidos)
        setDocsValidos(validos)
        setAlertas(((urgentes as any[] | null) ?? []) as Alerta[])
        setLoading(false)
      }
    })()
    return () => {
      ignore = true
    }
  }, [companyIds])

  const pctEmDia = useMemo(() => {
    const total = docsValidos + docsVencendo + docsVencidos
    return total > 0 ? Math.round((docsValidos / total) * 100) : 0
  }, [docsValidos, docsVencendo, docsVencidos])

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px' }}>
        <header style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>
            Compliance
          </p>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>
            Hub de Compliance
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: C.muted }}>
            Documentação de funcionários e empresa, com alertas de validade.
          </p>
        </header>

        {/* Cards */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
          <MetricCard label="Funcionários ativos" valor={totalFuncionarios} cor={C.espresso} loading={loading} />
          <MetricCard label="Vencendo (10 dias)" valor={docsVencendo} cor={C.amber} loading={loading} />
          <MetricCard label="Vencidos" valor={docsVencidos} cor={C.red} loading={loading} />
          <MetricCard label="% em dia" valor={`${pctEmDia}%`} cor={C.green} loading={loading} />
        </section>

        {/* Atalhos */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
          <AtalhoCard href="/dashboard/compliance/funcionarios" titulo="Funcionários" desc="Cadastro e documentos" />
          <AtalhoCard href="/dashboard/compliance/empresa" titulo="Documentos da Empresa" desc="Certidões, alvarás, INSS" />
          <AtalhoCard href="/dashboard/compliance/matriz" titulo="Matriz de Conformidade" desc="Grid funcionários × documentos" />
          <AtalhoCard href="/dashboard/compliance/funcionarios" titulo="Upload rápido" desc="Subir um documento" />
        </section>

        {/* Alertas urgentes */}
        <section
          style={{
            backgroundColor: 'white',
            borderRadius: 12,
            boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.borderLt}` }}>
            <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: 0 }}>
              Alertas mais urgentes
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: C.muted }}>
              10 documentos obrigatórios com menor prazo
            </p>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: C.beigeLt }}>
                  <Th>Funcionário</Th>
                  <Th>Documento</Th>
                  <Th>Validade</Th>
                  <Th>Dias</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Carregando…</td></tr>
                )}
                {!loading && alertas.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Nenhum documento vencido ou vencendo. 🎉</td></tr>
                )}
                {alertas.map((a: Alerta, i: number) => (
                  <tr key={a.documento_id || `${a.funcionario_id}-${a.tipo_nome}-${i}`} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.borderLt}` }}>
                    <Td>
                      <Link href={`/dashboard/compliance/funcionarios/${a.funcionario_id}`} style={{ color: C.espresso, textDecoration: 'none', fontWeight: 600 }}>
                        {a.nome_completo}
                      </Link>
                    </Td>
                    <Td>{a.tipo_nome}</Td>
                    <Td mono>{a.data_validade || '—'}</Td>
                    <Td mono>{a.dias_para_vencer == null ? '—' : a.dias_para_vencer}</Td>
                    <Td><StatusBadge status={a.status_final} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}

function MetricCard({ label, valor, cor, loading }: { label: string; valor: number | string; cor: string; loading: boolean }) {
  return (
    <div style={{ backgroundColor: 'white', borderRadius: 12, padding: '16px 18px', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.2, textTransform: 'uppercase', opacity: 0.55, margin: 0 }}>{label}</p>
      <p style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 0', color: cor }}>
        {loading ? '…' : valor}
      </p>
    </div>
  )
}

function AtalhoCard({ href, titulo, desc }: { href: string; titulo: string; desc: string }) {
  return (
    <Link href={href} style={{ textDecoration: 'none', color: C.ink }}>
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: 12,
          padding: '18px 20px',
          boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)',
          transition: 'transform 0.15s, box-shadow 0.15s',
          cursor: 'pointer',
        }}
        onMouseEnter={(e: any) => {
          e.currentTarget.style.transform = 'translateY(-2px)'
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(61, 35, 20, 0.1)'
        }}
        onMouseLeave={(e: any) => {
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.boxShadow = '0 1px 3px rgba(61, 35, 20, 0.06)'
        }}
      >
        <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 500, color: C.espresso }}>{titulo}</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{desc}</div>
      </div>
    </Link>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string; dot: string }> = {
    valido: { bg: C.greenBg, fg: C.green, label: 'Válido', dot: '🟢' },
    vencendo: { bg: C.amberBg, fg: C.amber, label: 'Vencendo', dot: '🟡' },
    vencido: { bg: C.redBg, fg: C.red, label: 'Vencido', dot: '🔴' },
    nao_emitido: { bg: C.grayBg, fg: C.gray, label: 'Não emitido', dot: '⚫' },
  }
  const s = map[status] || { bg: C.grayBg, fg: C.gray, label: status, dot: '⚫' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, backgroundColor: s.bg, color: s.fg }}>
      {s.dot} {s.label}
    </span>
  )
}

function Th({ children }: { children: any }) {
  return (
    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(61, 35, 20, 0.65)' }}>
      {children}
    </th>
  )
}

function Td({ children, mono }: { children: any; mono?: boolean }) {
  return (
    <td style={{ padding: '10px 16px', verticalAlign: 'top', fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined }}>
      {children}
    </td>
  )
}
