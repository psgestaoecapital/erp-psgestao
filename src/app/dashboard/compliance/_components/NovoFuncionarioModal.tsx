'use client'

// Compliance · modal compartilhado de cadastro de funcionário (RD-26/RD-52: fonte única).
// Usado na lista de Funcionários e na aba Funcionários do Prestador. Suporta dois modos:
//   - normal: escolhe vínculo (direto/terceirizado) e, se terceirizado, o prestador.
//   - travado (prestadorFixo): abre já como Terceirizado + este prestador (company fixa).
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { authFetch } from '@/lib/authFetch'
import { supabase } from '@/lib/supabase'

const C = {
  espresso: '#3D2314',
  offwhite: '#FAF7F2',
  gold: '#C8941A',
  borderLt: '#ece3d2',
  ink: '#1a1a1a',
  muted: 'rgba(61, 35, 20, 0.55)',
  red: '#a02020',
  redBg: '#fce8e8',
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

// Prestador que trava o cadastro em Terceirizado (aba Funcionários do prestador).
export type PrestadorFixo = {
  id: string
  razao_social: string
  company_id: string
}

export default function NovoFuncionarioModal({
  empresas, companyIdInicial, onClose, onCreated, prestadorFixo,
}: {
  empresas: { id: string; nome: string }[]
  companyIdInicial: string
  onClose: () => void
  onCreated: () => void
  prestadorFixo?: PrestadorFixo
}) {
  // Quando travado, a empresa é a do prestador; o vínculo é terceirizado.
  const [companyId, setCompanyId] = useState(prestadorFixo?.company_id ?? companyIdInicial)
  const [nome, setNome] = useState('')
  const [cpf, setCpf] = useState('')
  const [cargo, setCargo] = useState('')
  const [setorId, setSetorId] = useState<string>('')
  const [empresaTomadora, setEmpresaTomadora] = useState('')
  const [obra, setObra] = useState('')
  const [vinculoTipo, setVinculoTipo] = useState<'direto' | 'terceirizado'>(prestadorFixo ? 'terceirizado' : 'direto')
  const [prestadorId, setPrestadorId] = useState<string>(prestadorFixo?.id ?? '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [setores, setSetores] = useState<Setor[]>([])
  const [carregandoSetores, setCarregandoSetores] = useState(false)
  const [showNovoSetor, setShowNovoSetor] = useState(false)

  const [prestadores, setPrestadores] = useState<Prestador[]>([])
  const [carregandoPrestadores, setCarregandoPrestadores] = useState(false)

  const travado = !!prestadorFixo
  const exigeEscolha = !travado && empresas.length > 1

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
    // No modo travado o prestador já está definido — não precisa listar.
    if (!travado && vinculoTipo === 'terceirizado') carregarPrestadores()
  }, [travado, vinculoTipo, carregarPrestadores])

  useEffect(() => {
    if (!travado && vinculoTipo === 'direto') setPrestadorId('')
  }, [travado, vinculoTipo])

  useEffect(() => {
    if (!travado) setSetorId('')
  }, [travado, companyId])

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

  function setorCriado(novo: Setor) {
    setSetores((prev) => [...prev, novo])
    setSetorId(novo.id)
    setShowNovoSetor(false)
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 24, width: 'min(560px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, margin: '0 0 16px' }}>
          {travado ? 'Novo funcionário terceirizado' : 'Novo funcionário'}
        </h2>
        {erro && (<div style={{ backgroundColor: C.redBg, color: C.red, padding: '10px 12px', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{erro}</div>)}

        {/* Contexto travado: prestador fixo */}
        {travado && (
          <div style={{ background: C.offwhite, border: `1px solid ${C.borderLt}`, borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 13 }}>
            Vínculo <strong>Terceirizado</strong> · Prestador <strong>{prestadorFixo!.razao_social}</strong>
          </div>
        )}

        {!travado && (exigeEscolha ? (
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
        ))}

        {/* Vinculo tipo (radios) — escondido no modo travado */}
        {!travado && (
          <Field label="Tipo de vínculo *">
            <div style={{ display: 'flex', gap: 16, paddingTop: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: C.ink }}>
                <input type="radio" name="vinculo" value="direto" checked={vinculoTipo === 'direto'} onChange={() => setVinculoTipo('direto')} />
                Direto (CLT da empresa)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: C.ink }}>
                <input type="radio" name="vinculo" value="terceirizado" checked={vinculoTipo === 'terceirizado'} onChange={() => setVinculoTipo('terceirizado')} />
                Terceirizado (via prestador)
              </label>
            </div>
          </Field>
        )}

        {/* Dropdown prestador (so quando terceirizado E nao travado) */}
        {!travado && vinculoTipo === 'terceirizado' && (
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
