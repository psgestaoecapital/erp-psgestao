'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { authFetch } from '@/lib/authFetch'
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
}

type Funcionario = {
  id: string
  company_id: string
  nome_completo: string
  cpf: string | null
  cargo: string | null
  setor: string | null
  empresa_tomadora_nome: string | null
  obra_nome: string | null
  ativo: boolean
  compliance_resumo: { total: number; em_dia: number; pct: number }
}

export default function FuncionariosPage() {
  const { companyIds } = useCompanyIds()
  const [funcs, setFuncs] = useState<Funcionario[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [fCargo, setFCargo] = useState('')
  const [fSetor, setFSetor] = useState('')
  const [fEmp, setFEmp] = useState('')
  const [fStatus, setFStatus] = useState<'' | 'ok' | 'pendente' | 'critico'>('')
  const [modalAberto, setModalAberto] = useState(false)

  // Company ativa — usamos a primeira se o modo for consolidado.
  const companyAtiva = companyIds?.[0] ?? null

  const carregar = useCallback(async () => {
    if (!companyAtiva) return
    setLoading(true)
    setErro(null)
    try {
      const params = new URLSearchParams({ company_id: companyAtiva, ativo: 'true' })
      if (busca) params.set('q', busca)
      if (fCargo) params.set('cargo', fCargo)
      if (fSetor) params.set('setor', fSetor)
      if (fEmp) params.set('empresa_tomadora', fEmp)
      const res = await authFetch(`/api/compliance/funcionarios?${params.toString()}`)
      const j = await res.json()
      if (!j.ok) throw new Error(j.error || 'falha')
      setFuncs(j.funcionarios || [])
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setLoading(false)
    }
  }, [companyAtiva, busca, fCargo, fSetor, fEmp])

  useEffect(() => {
    carregar()
  }, [carregar])

  const funcsFiltrados = useMemo(() => {
    return funcs.filter((f: Funcionario) => {
      if (!fStatus) return true
      const p = f.compliance_resumo?.pct ?? 0
      if (fStatus === 'ok') return p === 100
      if (fStatus === 'pendente') return p > 0 && p < 100
      if (fStatus === 'critico') return p === 0
      return true
    })
  }, [funcs, fStatus])

  const cargos = useMemo(() => Array.from(new Set(funcs.map((f: Funcionario) => f.cargo).filter(Boolean) as string[])).sort(), [funcs])
  const setores = useMemo(() => Array.from(new Set(funcs.map((f: Funcionario) => f.setor).filter(Boolean) as string[])).sort(), [funcs])
  const empresas = useMemo(() => Array.from(new Set(funcs.map((f: Funcionario) => f.empresa_tomadora_nome).filter(Boolean) as string[])).sort(), [funcs])

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>Compliance</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>Funcionários</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted }}>{funcsFiltrados.length} de {funcs.length}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link
              href="/dashboard/compliance"
              style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
            >
              ← Voltar
            </Link>
            <button
              onClick={() => setModalAberto(true)}
              style={{ padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              + Novo funcionário
            </button>
          </div>
        </header>

        {erro && (
          <div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
            {erro}
          </div>
        )}

        <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <input
            type="text"
            placeholder="Buscar por nome, CPF, matrícula…"
            value={busca}
            onChange={(e: any) => setBusca(e.target.value)}
            style={{ flex: '1 1 240px', padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: C.offwhite }}
          />
          <select value={fEmp} onChange={(e: any) => setFEmp(e.target.value)} style={selectStyle()}>
            <option value="">Todas as tomadoras</option>
            {empresas.map((s: string) => (<option key={s} value={s}>{s}</option>))}
          </select>
          <select value={fCargo} onChange={(e: any) => setFCargo(e.target.value)} style={selectStyle()}>
            <option value="">Todos os cargos</option>
            {cargos.map((s: string) => (<option key={s} value={s}>{s}</option>))}
          </select>
          <select value={fSetor} onChange={(e: any) => setFSetor(e.target.value)} style={selectStyle()}>
            <option value="">Todos os setores</option>
            {setores.map((s: string) => (<option key={s} value={s}>{s}</option>))}
          </select>
          <select value={fStatus} onChange={(e: any) => setFStatus(e.target.value as any)} style={selectStyle()}>
            <option value="">Todos os status</option>
            <option value="ok">100% em dia</option>
            <option value="pendente">Pendências</option>
            <option value="critico">0% em dia</option>
          </select>
        </section>

        <section style={{ backgroundColor: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: C.beigeLt }}>
                  <Th>Nome</Th>
                  <Th>CPF</Th>
                  <Th>Cargo / Setor</Th>
                  <Th>Tomadora</Th>
                  <Th>Compliance</Th>
                  <Th>Ações</Th>
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Carregando…</td></tr>)}
                {!loading && funcsFiltrados.length === 0 && (<tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Nenhum funcionário</td></tr>)}
                {funcsFiltrados.map((f: Funcionario, i: number) => {
                  const pct = f.compliance_resumo?.pct ?? 0
                  const barColor = pct === 100 ? C.green : pct >= 50 ? C.amber : C.red
                  return (
                    <tr key={f.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.borderLt}` }}>
                      <Td>
                        <Link href={`/dashboard/compliance/funcionarios/${f.id}`} style={{ color: C.espresso, textDecoration: 'none', fontWeight: 600 }}>{f.nome_completo}</Link>
                      </Td>
                      <Td mono>{f.cpf || '—'}</Td>
                      <Td>
                        <div>{f.cargo || '—'}</div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{f.setor || '—'}</div>
                      </Td>
                      <Td>
                        <div>{f.empresa_tomadora_nome || '—'}</div>
                        {f.obra_nome && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{f.obra_nome}</div>}
                      </Td>
                      <Td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 80, height: 6, background: C.beigeLt, borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: barColor }} />
                          </div>
                          <span style={{ fontWeight: 600, color: barColor, minWidth: 36 }}>{pct}%</span>
                        </div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{f.compliance_resumo?.em_dia ?? 0} / {f.compliance_resumo?.total ?? 0} em dia</div>
                      </Td>
                      <Td>
                        <Link href={`/dashboard/compliance/funcionarios/${f.id}`} style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
                          Abrir
                        </Link>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {modalAberto && companyAtiva && (
        <NovoFuncionarioModal
          companyId={companyAtiva}
          onClose={() => setModalAberto(false)}
          onCreated={() => {
            setModalAberto(false)
            carregar()
          }}
        />
      )}
    </div>
  )
}

function NovoFuncionarioModal({ companyId, onClose, onCreated }: { companyId: string; onClose: () => void; onCreated: () => void }) {
  const [nome, setNome] = useState('')
  const [cpf, setCpf] = useState('')
  const [cargo, setCargo] = useState('')
  const [setor, setSetor] = useState('')
  const [empresaTomadora, setEmpresaTomadora] = useState('')
  const [obra, setObra] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    setSalvando(true)
    setErro(null)
    try {
      const res = await authFetch('/api/compliance/funcionarios', {
        method: 'POST',
        body: JSON.stringify({
          company_id: companyId,
          nome_completo: nome,
          cpf: cpf || null,
          cargo: cargo || null,
          setor: setor || null,
          empresa_tomadora_nome: empresaTomadora || null,
          obra_nome: obra || null,
          ativo: true,
        }),
      })
      const j = await res.json()
      if (!j.ok) throw new Error(j.error || 'falha')
      onCreated()
    } catch (e: any) {
      setErro(e.message)
      setSalvando(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 24, width: 'min(520px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, margin: '0 0 16px' }}>Novo funcionário</h2>
        {erro && (<div style={{ backgroundColor: C.redBg, color: C.red, padding: '10px 12px', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{erro}</div>)}
        <Field label="Nome completo *"><input value={nome} onChange={(e: any) => setNome(e.target.value)} style={inputStyle()} /></Field>
        <Field label="CPF"><input value={cpf} onChange={(e: any) => setCpf(e.target.value)} style={inputStyle()} placeholder="000.000.000-00" /></Field>
        <Field label="Cargo"><input value={cargo} onChange={(e: any) => setCargo(e.target.value)} style={inputStyle()} /></Field>
        <Field label="Setor"><input value={setor} onChange={(e: any) => setSetor(e.target.value)} style={inputStyle()} /></Field>
        <Field label="Empresa tomadora"><input value={empresaTomadora} onChange={(e: any) => setEmpresaTomadora(e.target.value)} style={inputStyle()} /></Field>
        <Field label="Obra"><input value={obra} onChange={(e: any) => setObra(e.target.value)} style={inputStyle()} /></Field>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} disabled={salvando} style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || !nome.trim()} style={{ padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: !salvando && nome.trim() ? 'pointer' : 'not-allowed', opacity: !salvando && nome.trim() ? 1 : 0.6 }}>
            {salvando ? 'Salvando…' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}

function inputStyle() {
  return { width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 14, background: C.offwhite, color: C.ink, boxSizing: 'border-box' } as any
}

function selectStyle() {
  return { padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', minWidth: 140 } as any
}

function Th({ children }: { children: any }) {
  return (<th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(61, 35, 20, 0.65)' }}>{children}</th>)
}

function Td({ children, mono }: { children: any; mono?: boolean }) {
  return (<td style={{ padding: '10px 16px', verticalAlign: 'top', fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined }}>{children}</td>)
}
