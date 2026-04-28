'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { authFetch } from '@/lib/authFetch'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { fmtData } from '@/lib/psgc-tokens'

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
  const { companyIds, selInfo } = useCompanyIds()
  const [loading, setLoading] = useState(true)
  const [zipModalAberto, setZipModalAberto] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null
  const empresaNome = selInfo.tipo === 'empresa' ? selInfo.nome : null

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const [totalFuncionarios, setTotalFuncionarios] = useState(0)
  const [docsVencendo, setDocsVencendo] = useState(0)
  const [docsVencidos, setDocsVencidos] = useState(0)
  const [docsValidos, setDocsValidos] = useState(0)
  const [alertas, setAlertas] = useState<Alerta[]>([])

  // useCompanyIds devolve um array novo a cada render — depender da referência
  // direta gera loop de re-render. Estabiliza pelo CSV ordenado.
  const companyIdsKey = useMemo(() => [...(companyIds ?? [])].sort().join(','), [companyIds])

  useEffect(() => {
    const ids = companyIdsKey ? companyIdsKey.split(',') : []
    if (ids.length === 0) return
    let ignore = false
    ;(async () => {
      setLoading(true)

      // Funcionários ativos
      const { count: qtdFunc } = await supabase
        .from('compliance_funcionarios')
        .select('id', { count: 'exact', head: true })
        .in('company_id', ids)
        .eq('ativo', true)

      // Matriz — count por status_final
      const { data: matriz } = await supabase
        .from('v_compliance_matriz_funcionarios')
        .select('status_final, funcionario_ativo, obrigatorio')
        .in('company_id', ids)

      const m = (matriz as any[] | null) ?? []
      const ativosObrig = m.filter((x) => x.funcionario_ativo && x.obrigatorio)
      const vencendo = ativosObrig.filter((x) => x.status_final === 'vencendo').length
      const vencidos = ativosObrig.filter((x) => x.status_final === 'vencido').length
      const validos = ativosObrig.filter((x) => x.status_final === 'valido').length

      // 10 alertas mais urgentes (vencidos primeiro, depois vencendo mais próximos)
      const { data: urgentes } = await supabase
        .from('v_compliance_matriz_funcionarios')
        .select('documento_id, funcionario_id, nome_completo, tipo_nome, data_validade, dias_para_vencer, status_final')
        .in('company_id', ids)
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
  }, [companyIdsKey])

  const pctEmDia = useMemo(() => {
    const total = docsValidos + docsVencendo + docsVencidos
    return total > 0 ? Math.round((docsValidos / total) * 100) : 0
  }, [docsValidos, docsVencendo, docsVencidos])

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px' }}>
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>
              Compliance
            </p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>
              Hub de Compliance
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted }}>
              Documentação de funcionários e empresa, com alertas de validade.
            </p>
          </div>
          {empresaUnica && (
            <button
              onClick={() => setZipModalAberto(true)}
              style={{ padding: '10px 16px', borderRadius: 8, border: 'none', backgroundColor: C.gold, color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              📦 Gerar ZIP
            </button>
          )}
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
                    <Td mono>{fmtData(a.data_validade)}</Td>
                    <Td mono>{a.dias_para_vencer == null ? '—' : a.dias_para_vencer}</Td>
                    <Td><StatusBadge status={a.status_final} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {zipModalAberto && empresaUnica && (
        <GerarZipModal
          companyId={empresaUnica}
          empresaNome={empresaNome || 'empresa'}
          onClose={() => setZipModalAberto(false)}
          onSucesso={() => { setZipModalAberto(false); showToast('✓ Pacote gerado e baixado') }}
          onErro={(m: string) => showToast(m, false)}
        />
      )}

      {toast && (
        <div
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 200,
            padding: '12px 18px', borderRadius: 8,
            background: toast.ok ? C.espresso : C.red,
            color: 'white', fontSize: 13, fontWeight: 600,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            maxWidth: 'min(90vw, 420px)',
          }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}

function GerarZipModal({
  companyId, empresaNome, onClose, onSucesso, onErro,
}: {
  companyId: string
  empresaNome: string
  onClose: () => void
  onSucesso: () => void
  onErro: (msg: string) => void
}) {
  const [funcs, setFuncs] = useState<Array<{ id: string; nome_completo: string }>>([])
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [gerando, setGerando] = useState(false)

  useEffect(() => {
    let ignore = false
    ;(async () => {
      try {
        const res = await authFetch(`/api/compliance/funcionarios?company_ids=${encodeURIComponent(companyId)}&ativo=true`)
        const j = await res.json()
        if (!j.ok) throw new Error(j.error || 'falha')
        if (ignore) return
        const lista = (j.funcionarios as any[] || []).map((f: any) => ({ id: f.id, nome_completo: f.nome_completo }))
        setFuncs(lista)
        setSelecionados(new Set(lista.map((f) => f.id)))
      } catch (e: any) {
        if (!ignore) onErro(e.message || 'Falha ao carregar funcionários')
      } finally {
        if (!ignore) setLoading(false)
      }
    })()
    return () => { ignore = true }
  }, [companyId, onErro])

  function toggleAll(checked: boolean) {
    setSelecionados(checked ? new Set(funcs.map((f) => f.id)) : new Set())
  }

  function toggle(id: string) {
    setSelecionados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function gerar() {
    setGerando(true)
    try {
      const res = await authFetch('/api/compliance/zip', {
        method: 'POST',
        body: JSON.stringify({
          company_id: companyId,
          funcionario_ids: Array.from(selecionados),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.mensagem_humana || j?.error || `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const cd = res.headers.get('content-disposition') || ''
      const m = cd.match(/filename="?([^";]+)"?/)
      a.download = m?.[1] || `compliance_${empresaNome}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      onSucesso()
    } catch (e: any) {
      onErro(e.message || 'Falha ao gerar ZIP')
    } finally {
      setGerando(false)
    }
  }

  const todosMarcados = funcs.length > 0 && selecionados.size === funcs.length

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 24, width: 'min(560px, 92vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>Compliance</p>
        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, margin: '4px 0 4px' }}>
          Gerar pacote ZIP
        </h2>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: C.muted }}>
          {empresaNome}
        </p>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: C.muted, padding: '8px 12px', background: C.beigeLt, borderRadius: 6 }}>
          O ZIP incluirá <strong>todos os documentos da empresa</strong> + os documentos dos funcionários selecionados abaixo.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: C.espresso, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={todosMarcados}
              onChange={(e: any) => toggleAll(e.target.checked)}
            />
            {todosMarcados ? 'Desmarcar todos' : 'Selecionar todos'}
          </label>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: C.muted }}>
            {selecionados.size} de {funcs.length}
          </span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', border: `1px solid ${C.borderLt}`, borderRadius: 8, padding: 8, marginBottom: 16, minHeight: 100, maxHeight: 280 }}>
          {loading && <div style={{ padding: 12, color: C.muted, fontSize: 13 }}>Carregando…</div>}
          {!loading && funcs.length === 0 && <div style={{ padding: 12, color: C.muted, fontSize: 13 }}>Nenhum funcionário ativo</div>}
          {funcs.map((f) => (
            <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, fontSize: 13, color: C.ink, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={selecionados.has(f.id)}
                onChange={() => toggle(f.id)}
              />
              {f.nome_completo}
            </label>
          ))}
        </div>

        {gerando && (
          <p style={{ margin: '0 0 12px', fontSize: 12, color: C.gold, fontWeight: 600 }}>
            Empacotando documentos… pode levar alguns segundos.
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={gerando}
            style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, cursor: gerando ? 'not-allowed' : 'pointer' }}
          >
            Cancelar
          </button>
          <button
            onClick={gerar}
            disabled={gerando || loading}
            style={{ padding: '10px 18px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: gerando || loading ? 'not-allowed' : 'pointer', opacity: gerando || loading ? 0.6 : 1 }}
          >
            {gerando ? 'Gerando…' : 'Gerar e Baixar'}
          </button>
        </div>
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
