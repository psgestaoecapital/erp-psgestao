'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { authFetch } from '@/lib/authFetch'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { supabase } from '@/lib/supabase'

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
  const { companyIds, companies } = useCompanyIds()
  const [funcs, setFuncs] = useState<Funcionario[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [fCargo, setFCargo] = useState('')
  const [fSetor, setFSetor] = useState('')
  const [fEmp, setFEmp] = useState('')
  const [fStatus, setFStatus] = useState<'' | 'ok' | 'pendente' | 'critico'>('')
  const [modalAberto, setModalAberto] = useState(false)
  const [importando, setImportando] = useState(false)
  const [msgImport, setMsgImport] = useState<string | null>(null)

  // useCompanyIds devolve um array novo a cada render — estabiliza pelo CSV ordenado.
  const companyIdsKey = useMemo(() => [...(companyIds ?? [])].sort().join(','), [companyIds])
  const multiEmpresa = (companyIds?.length ?? 0) > 1
  // Empresas no escopo (para coluna "Empresa" e seletor do modal)
  const empresasNoEscopo = useMemo(() => {
    const ids = companyIdsKey ? companyIdsKey.split(',') : []
    return ids
      .map((id) => {
        const c = companies.find((x) => x.id === id)
        return { id, nome: c?.nome_fantasia || c?.razao_social || 'Empresa' }
      })
      .sort((a, b) => a.nome.localeCompare(b.nome))
  }, [companyIdsKey, companies])
  const empresaPorId = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of empresasNoEscopo) m.set(e.id, e.nome)
    return m
  }, [empresasNoEscopo])
  // Modal de novo funcionario: se grupo, exige escolher; senao, primeira do escopo.
  const companyAtiva = !multiEmpresa ? (companyIds?.[0] ?? null) : null

  const carregar = useCallback(async () => {
    if (!companyIdsKey) return
    setLoading(true)
    setErro(null)
    try {
      const params = new URLSearchParams({ company_ids: companyIdsKey, ativo: 'true' })
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
  }, [companyIdsKey, busca, fCargo, fSetor, fEmp])

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
            {/* FIX-IRRIGAR-IOPOINT-COMPLIANCE (07/07): botao pra importar
                colaboradores do ponto eletronico (IO Point / provider ativo)
                pra ficha de compliance. So aparece se empresa unica selecionada.
                Preserva metadados manuais via COALESCE (Pilar 1 LGPD). */}
            {companyAtiva && (
              <button
                onClick={async () => {
                  if (!window.confirm('Importar colaboradores do IO Point pra ficha do Compliance?\n\nO que já foi preenchido à mão (RG, endereço, salário, ASO, observações) NÃO será sobrescrito — só completa os campos vazios.')) return
                  setImportando(true); setMsgImport(null); setErro(null)
                  const { data, error } = await supabase.rpc('fn_compliance_projetar_de_ind_ponto', { p_company_id: companyAtiva })
                  setImportando(false)
                  if (error) { setErro('Erro na importação: ' + error.message); return }
                  const j = data as { criados?: number; atualizados?: number; ignorados_sem_cpf?: number; total_processados?: number } | null
                  setMsgImport(`IMPORTOU ${j?.total_processados ?? 0} colaboradores · ${j?.criados ?? 0} novos · ${j?.atualizados ?? 0} atualizados${j?.ignorados_sem_cpf ? ` · ${j.ignorados_sem_cpf} sem CPF (ignorados)` : ''}`)
                  await carregar()
                  setTimeout(() => setMsgImport(null), 8000)
                }}
                disabled={importando}
                style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.gold}`, backgroundColor: 'transparent', color: C.gold, fontSize: 13, fontWeight: 600, cursor: importando ? 'not-allowed' : 'pointer', opacity: importando ? 0.6 : 1 }}
                title="Importa/atualiza a partir de ind_ponto_colaborador (IO Point). Preserva metadados manuais."
              >
                {importando ? 'Importando…' : '⬇ Importar do IO Point'}
              </button>
            )}
            <button
              onClick={() => setModalAberto(true)}
              style={{ padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              + Novo funcionário
            </button>
          </div>
        </header>

        {msgImport && (
          <div style={{ backgroundColor: C.greenBg, color: C.green, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
            ✓ {msgImport}
          </div>
        )}

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
                  {multiEmpresa && <Th>Empresa</Th>}
                  <Th>Tomadora</Th>
                  <Th>Compliance</Th>
                  <Th>Ações</Th>
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={multiEmpresa ? 7 : 6} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Carregando…</td></tr>)}
                {!loading && funcsFiltrados.length === 0 && (<tr><td colSpan={multiEmpresa ? 7 : 6} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Nenhum funcionário</td></tr>)}
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
                      {multiEmpresa && (
                        <Td>
                          <span style={{ fontSize: 12, color: C.espresso }}>{empresaPorId.get(f.company_id) || '—'}</span>
                        </Td>
                      )}
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

      {modalAberto && empresasNoEscopo.length > 0 && (
        <NovoFuncionarioModal
          empresas={empresasNoEscopo}
          companyIdInicial={companyAtiva ?? empresasNoEscopo[0].id}
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

type Setor = {
  id: string
  nome: string
  slug: string
  descricao: string | null
  is_global: boolean
  ordem_exibicao: number | null
  ativo: boolean
}

type Prestador = {
  id: string
  razao_social: string
  cnpj: string | null
}

function NovoFuncionarioModal({
  empresas, companyIdInicial, onClose, onCreated,
}: {
  empresas: { id: string; nome: string }[]
  companyIdInicial: string
  onClose: () => void
  onCreated: () => void
}) {
  const [companyId, setCompanyId] = useState(companyIdInicial)
  const [nome, setNome] = useState('')
  const [cpf, setCpf] = useState('')
  const [cargo, setCargo] = useState('')
  // Setor agora aponta pra uma linha de compliance_setores OU permanece string livre (legado)
  const [setorId, setSetorId] = useState<string>('')
  const [empresaTomadora, setEmpresaTomadora] = useState('')
  const [obra, setObra] = useState('')
  // PR A1 — vinculo direto vs terceirizado
  const [vinculoTipo, setVinculoTipo] = useState<'direto' | 'terceirizado'>('direto')
  const [prestadorId, setPrestadorId] = useState<string>('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Setores carregados (globais + da empresa selecionada)
  const [setores, setSetores] = useState<Setor[]>([])
  const [carregandoSetores, setCarregandoSetores] = useState(false)
  const [showNovoSetor, setShowNovoSetor] = useState(false)

  // Prestadores carregados quando vinculo=terceirizado
  const [prestadores, setPrestadores] = useState<Prestador[]>([])
  const [carregandoPrestadores, setCarregandoPrestadores] = useState(false)

  const exigeEscolha = empresas.length > 1

  // Carrega setores (globais + da empresa)
  const carregarSetores = useCallback(async () => {
    setCarregandoSetores(true)
    try {
      const { data, error } = await supabase
        .from('compliance_setores')
        .select('id, nome, slug, descricao, is_global, ordem_exibicao, ativo, company_id')
        .or(`is_global.eq.true,company_id.eq.${companyId}`)
        .eq('ativo', true)
        .order('is_global', { ascending: false })
        .order('ordem_exibicao', { ascending: true, nullsFirst: false })
        .order('nome', { ascending: true })
      if (error) throw error
      setSetores((data || []) as Setor[])
    } catch (e: any) {
      console.error('[setores]', e?.message)
      setSetores([])
    } finally {
      setCarregandoSetores(false)
    }
  }, [companyId])

  // Carrega prestadores da empresa quando vinculo=terceirizado
  const carregarPrestadores = useCallback(async () => {
    if (!companyId) return
    setCarregandoPrestadores(true)
    try {
      const res = await authFetch(`/api/compliance/prestadores?company_ids=${companyId}&ativo=true`)
      const j = await res.json()
      if (j.ok && Array.isArray(j.prestadores)) {
        setPrestadores(j.prestadores)
      } else {
        setPrestadores([])
      }
    } catch {
      setPrestadores([])
    } finally {
      setCarregandoPrestadores(false)
    }
  }, [companyId])

  useEffect(() => { carregarSetores() }, [carregarSetores])
  useEffect(() => {
    if (vinculoTipo === 'terceirizado') carregarPrestadores()
  }, [vinculoTipo, carregarPrestadores])

  // Reset prestador quando volta para direto
  useEffect(() => {
    if (vinculoTipo === 'direto') setPrestadorId('')
  }, [vinculoTipo])

  // Reset setor quando troca empresa (setores próprios mudam)
  useEffect(() => {
    setSetorId('')
  }, [companyId])

  function setorEscolhido(): Setor | null {
    return setores.find((s) => s.id === setorId) || null
  }

  async function salvar() {
    if (!nome.trim()) { setErro('Nome é obrigatório'); return }
    if (vinculoTipo === 'terceirizado' && !prestadorId) {
      setErro('Selecione o prestador para vínculo terceirizado')
      return
    }
    setSalvando(true)
    setErro(null)
    try {
      const setor = setorEscolhido()
      const res = await authFetch('/api/compliance/funcionarios', {
        method: 'POST',
        body: JSON.stringify({
          company_id: companyId,
          nome_completo: nome,
          cpf: cpf || null,
          cargo: cargo || null,
          // Mantem string em `setor` (compatibilidade) + envia setor_id quando ha
          setor: setor?.nome || null,
          setor_id: setor?.id || null,
          empresa_tomadora_nome: empresaTomadora || null,
          obra_nome: obra || null,
          vinculo_tipo: vinculoTipo,
          prestador_id: vinculoTipo === 'terceirizado' ? prestadorId : null,
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

  // Setor recém-criado: já vem selecionado no dropdown
  function setorCriado(novo: Setor) {
    setSetores((prev) => [...prev, novo])
    setSetorId(novo.id)
    setShowNovoSetor(false)
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 24, width: 'min(560px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, margin: '0 0 16px' }}>Novo funcionário</h2>
        {erro && (<div style={{ backgroundColor: C.redBg, color: C.red, padding: '10px 12px', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{erro}</div>)}

        {exigeEscolha ? (
          <Field label="Empresa *">
            <select value={companyId} onChange={(e: any) => setCompanyId(e.target.value)} style={inputStyle()}>
              {empresas.map((e) => (<option key={e.id} value={e.id}>{e.nome}</option>))}
            </select>
          </Field>
        ) : (
          <Field label="Empresa">
            <input
              readOnly
              value={empresas.find((e) => e.id === companyId)?.nome || ''}
              style={{ ...inputStyle(), opacity: 0.7, cursor: 'default' }}
            />
          </Field>
        )}

        {/* Vinculo tipo (radios) */}
        <Field label="Tipo de vínculo *">
          <div style={{ display: 'flex', gap: 16, paddingTop: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: C.ink }}>
              <input
                type="radio"
                name="vinculo"
                value="direto"
                checked={vinculoTipo === 'direto'}
                onChange={() => setVinculoTipo('direto')}
              />
              Direto (CLT da empresa)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: C.ink }}>
              <input
                type="radio"
                name="vinculo"
                value="terceirizado"
                checked={vinculoTipo === 'terceirizado'}
                onChange={() => setVinculoTipo('terceirizado')}
              />
              Terceirizado (via prestador)
            </label>
          </div>
        </Field>

        {/* Dropdown prestador (so quando terceirizado) */}
        {vinculoTipo === 'terceirizado' && (
          <Field label="Prestador *">
            <select
              value={prestadorId}
              onChange={(e: any) => setPrestadorId(e.target.value)}
              disabled={carregandoPrestadores}
              style={inputStyle()}
            >
              <option value="">{carregandoPrestadores ? 'Carregando…' : 'Selecione um prestador'}</option>
              {prestadores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.razao_social}{p.cnpj ? ` · ${p.cnpj}` : ''}
                </option>
              ))}
            </select>
            {!carregandoPrestadores && prestadores.length === 0 && (
              <p style={{ marginTop: 6, fontSize: 11, color: C.muted }}>
                Nenhum prestador cadastrado.{' '}
                <Link href="/dashboard/compliance/prestadores" style={{ color: C.gold, textDecoration: 'underline' }}>
                  Cadastrar prestador
                </Link>
              </p>
            )}
          </Field>
        )}

        <Field label="Nome completo *"><input value={nome} onChange={(e: any) => setNome(e.target.value)} style={inputStyle()} /></Field>
        <Field label="CPF"><input value={cpf} onChange={(e: any) => setCpf(e.target.value)} style={inputStyle()} placeholder="000.000.000-00" /></Field>
        <Field label="Cargo"><input value={cargo} onChange={(e: any) => setCargo(e.target.value)} style={inputStyle()} /></Field>

        {/* Setor: dropdown global+propios + botao + Novo Setor */}
        <Field label="Setor">
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              value={setorId}
              onChange={(e: any) => setSetorId(e.target.value)}
              disabled={carregandoSetores}
              style={{ ...inputStyle(), flex: 1 }}
            >
              <option value="">{carregandoSetores ? 'Carregando…' : 'Selecione um setor'}</option>
              {setores.filter((s) => s.is_global).length > 0 && (
                <optgroup label="Padrão PS Gestão">
                  {setores.filter((s) => s.is_global).map((s) => (
                    <option key={s.id} value={s.id}>{s.nome}</option>
                  ))}
                </optgroup>
              )}
              {setores.filter((s) => !s.is_global).length > 0 && (
                <optgroup label="Meus setores">
                  {setores.filter((s) => !s.is_global).map((s) => (
                    <option key={s.id} value={s.id}>{s.nome}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <button
              type="button"
              onClick={() => setShowNovoSetor(true)}
              style={{
                padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`,
                backgroundColor: C.offwhite, color: C.espresso, fontSize: 12, fontWeight: 600,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
              title="Criar novo setor para esta empresa"
            >
              + Novo
            </button>
          </div>
        </Field>

        <Field label="Empresa tomadora"><input value={empresaTomadora} onChange={(e: any) => setEmpresaTomadora(e.target.value)} style={inputStyle()} /></Field>
        <Field label="Obra"><input value={obra} onChange={(e: any) => setObra(e.target.value)} style={inputStyle()} /></Field>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} disabled={salvando} style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || !nome.trim()} style={{ padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: !salvando && nome.trim() ? 'pointer' : 'not-allowed', opacity: !salvando && nome.trim() ? 1 : 0.6 }}>
            {salvando ? 'Salvando…' : 'Criar'}
          </button>
        </div>

        {showNovoSetor && (
          <NovoSetorModal
            companyId={companyId}
            onClose={() => setShowNovoSetor(false)}
            onCreated={setorCriado}
          />
        )}
      </div>
    </div>
  )
}

function NovoSetorModal({
  companyId, onClose, onCreated,
}: {
  companyId: string
  onClose: () => void
  onCreated: (setor: Setor) => void
}) {
  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function gerarSlug(s: string): string {
    return s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50)
  }

  async function salvar() {
    if (!nome.trim()) { setErro('Nome obrigatório'); return }
    setSalvando(true)
    setErro(null)
    try {
      const slug = gerarSlug(nome)
      const { data, error } = await supabase
        .from('compliance_setores')
        .insert({
          company_id: companyId,
          nome: nome.trim(),
          slug,
          descricao: descricao.trim() || null,
          is_global: false,
          ativo: true,
        })
        .select('id, nome, slug, descricao, is_global, ordem_exibicao, ativo')
        .single()
      if (error) throw error
      onCreated(data as Setor)
    } catch (e: any) {
      setErro(e?.message || 'Falha ao criar setor')
      setSalvando(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110 }}
    >
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 22, width: 'min(420px, 92vw)' }}>
        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 400, margin: '0 0 12px' }}>Novo setor</h3>
        {erro && (<div style={{ backgroundColor: C.redBg, color: C.red, padding: '8px 10px', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{erro}</div>)}
        <Field label="Nome *">
          <input value={nome} onChange={(e: any) => setNome(e.target.value)} style={inputStyle()} placeholder="Ex: Almoxarifado" autoFocus />
        </Field>
        <Field label="Descrição (opcional)">
          <textarea value={descricao} onChange={(e: any) => setDescricao(e.target.value)} style={{ ...inputStyle(), minHeight: 60 }} />
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onClose} disabled={salvando} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || !nome.trim()} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 12, fontWeight: 600, cursor: !salvando && nome.trim() ? 'pointer' : 'not-allowed', opacity: !salvando && nome.trim() ? 1 : 0.6 }}>
            {salvando ? 'Salvando…' : 'Criar setor'}
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
