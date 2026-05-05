// src/app/dashboard/compliance/epi/catalogo/page.tsx
// Catalogo de EPIs: tabs Global PS (read-only) | Meus (CRUD).
// Permite "+ Novo EPI" e "Importar do Catalogo Global" (clona).

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  espresso: '#3D2314',
  espressoLt: '#5D4534',
  offwhite: '#FAF7F2',
  gold: '#C8941A',
  beigeLt: '#f5f0e8',
  borderLt: '#ece3d2',
  ink: '#1a1a1a',
  muted: 'rgba(61, 35, 20, 0.55)',
  green: '#16a34a',
  yellow: '#eab308',
  red: '#dc2626',
}

interface Categoria {
  id: string
  nome: string
}

interface EpiItem {
  id: string
  company_id: string | null
  categoria_id: string | null
  categoria_nome?: string
  nome: string
  modelo: string | null
  descricao: string | null
  ca_numero: string
  ca_validade: string
  fabricante_nome: string
  fabricante_cnpj: string | null
  lote: string | null
  vida_util_meses: number | null
  descartavel: boolean | null
  riscos_protege: string[] | null
  is_global: boolean
  ativo: boolean
}

const RISCOS = ['mecanico', 'quimico', 'biologico', 'ergonomico', 'fisico']

export default function CatalogoEpiPage() {
  const { companyIds, companies } = useCompanyIds()
  const companyIdsKey = useMemo(() => [...(companyIds ?? [])].sort().join(','), [companyIds])
  const multiEmpresa = (companyIds?.length ?? 0) > 1

  const [companyAlvo, setCompanyAlvo] = useState<string>('')
  useEffect(() => {
    if (!companyAlvo && companyIds && companyIds.length > 0) setCompanyAlvo(companyIds[0])
  }, [companyIds, companyAlvo])

  const empresaPorId = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of companies) m.set(c.id, c.nome_fantasia || c.razao_social || 'Empresa')
    return m
  }, [companies])

  const [aba, setAba] = useState<'global' | 'meus'>('global')
  const [busca, setBusca] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [epis, setEpis] = useState<EpiItem[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [showNovo, setShowNovo] = useState(false)
  const [importarGlobal, setImportarGlobal] = useState<EpiItem | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const ids = companyIdsKey ? companyIdsKey.split(',').filter(Boolean) : []
      const [catR, epiR] = await Promise.all([
        supabase.from('epi_categoria').select('id, nome').eq('ativo', true).order('nome'),
        supabase
          .from('epi_catalogo')
          .select('id, company_id, categoria_id, nome, modelo, descricao, ca_numero, ca_validade, fabricante_nome, fabricante_cnpj, lote, vida_util_meses, descartavel, riscos_protege, is_global, ativo, epi_categoria(nome)')
          .or(`is_global.eq.true${ids.length > 0 ? `,company_id.in.(${ids.join(',')})` : ''}`)
          .eq('ativo', true)
          .order('nome'),
      ])
      if (catR.error) throw catR.error
      if (epiR.error) throw epiR.error
      setCategorias((catR.data || []) as Categoria[])
      setEpis(((epiR.data || []) as any[]).map((e) => ({
        ...e,
        categoria_nome: (e.epi_categoria as any)?.nome,
      })) as EpiItem[])
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar catalogo')
    } finally {
      setLoading(false)
    }
  }, [companyIdsKey])

  useEffect(() => { carregar() }, [carregar])

  const episFiltrados = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return epis.filter((e) => {
      if (aba === 'global' && !e.is_global) return false
      if (aba === 'meus' && e.is_global) return false
      if (filtroCategoria && e.categoria_id !== filtroCategoria) return false
      if (q) {
        const hay = `${e.nome} ${e.modelo || ''} ${e.ca_numero}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [epis, aba, busca, filtroCategoria])

  function statusCa(ca_validade: string): { cor: string; label: string } {
    const hoje = new Date()
    const valid = new Date(ca_validade)
    const diasFalt = Math.floor((valid.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24))
    if (diasFalt < 0) return { cor: C.red, label: 'CA vencido' }
    if (diasFalt < 90) return { cor: C.yellow, label: `vence em ${diasFalt}d` }
    return { cor: C.green, label: 'CA válido' }
  }

  return (
    <div style={{ background: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>EPI</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>Catálogo de EPIs</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted }}>Catálogo PS Gestão + EPIs próprios da empresa</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/dashboard/compliance/epi" style={btnSec}>← EPI</Link>
            {aba === 'meus' && (
              <button onClick={() => setShowNovo(true)} disabled={!companyAlvo} style={{ ...btnPrim, opacity: companyAlvo ? 1 : 0.5, cursor: companyAlvo ? 'pointer' : 'not-allowed' }}>+ Novo EPI</button>
            )}
          </div>
        </header>

        {erro && <div style={{ background: '#fce8e8', color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{erro}</div>}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.borderLt}` }}>
          <TabBtn ativa={aba === 'global'} onClick={() => setAba('global')}>🌐 Catálogo Global PS</TabBtn>
          <TabBtn ativa={aba === 'meus'} onClick={() => setAba('meus')}>🏢 Meus EPIs</TabBtn>
        </div>

        {aba === 'global' && (
          <div style={{ background: C.beigeLt, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13, color: C.espresso, borderLeft: `3px solid ${C.gold}` }}>
            EPIs padrão da PS Gestão (somente leitura). Use o botão <strong>Importar</strong> em qualquer card para clonar para a sua empresa e personalizar.
          </div>
        )}

        {aba === 'meus' && multiEmpresa && (
          <section style={{ background: '#FFFFFF', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(61,35,20,0.06)' }}>
            <label style={labelStyle}>Empresa-alvo</label>
            <select value={companyAlvo} onChange={(e) => setCompanyAlvo(e.target.value)} style={{ ...inputStyle, minWidth: 240 }}>
              {(companyIds || []).map((id) => <option key={id} value={id}>{empresaPorId.get(id) || id}</option>)}
            </select>
          </section>
        )}

        {/* Filtros */}
        <section style={{ background: '#FFFFFF', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61,35,20,0.06)', marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <input type="text" placeholder="Buscar por nome / modelo / CA…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ ...inputStyle, flex: '1 1 240px' }} />
          <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)} style={{ ...inputStyle, minWidth: 200 }}>
            <option value="">Todas as categorias</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </section>

        {/* Grid de cards */}
        {loading ? (
          <p style={{ textAlign: 'center', color: C.muted, padding: 40 }}>Carregando…</p>
        ) : episFiltrados.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: C.muted, background: '#FFFFFF', borderRadius: 12 }}>
            {aba === 'global' ? 'Nenhum EPI global ativo' : 'Você ainda não tem EPIs próprios. Crie ou importe do catálogo global!'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {episFiltrados.map((e) => {
              const ca = statusCa(e.ca_validade)
              return (
                <div key={e.id} style={{ background: '#FFFFFF', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61,35,20,0.06)', borderTop: `3px solid ${ca.cor}` }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3 style={{ fontSize: 15, fontWeight: 600, color: C.espresso, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.nome}</h3>
                      {e.modelo && <p style={{ fontSize: 12, color: C.muted, margin: '2px 0 0' }}>{e.modelo}</p>}
                    </div>
                    {e.is_global && (
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: C.gold + '22', color: C.gold }}>GLOBAL</span>
                    )}
                  </div>
                  {e.categoria_nome && (
                    <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: C.beigeLt, color: C.espressoLt, fontWeight: 600 }}>
                      {e.categoria_nome}
                    </span>
                  )}
                  <div style={{ marginTop: 10, fontSize: 12, color: C.espressoLt }}>
                    <div><strong style={{ color: C.espresso }}>CA</strong> {e.ca_numero}</div>
                    <div style={{ color: ca.cor, fontWeight: 600 }}>{ca.label}</div>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: C.espressoLt }}>
                    Fabricante: {e.fabricante_nome}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: C.espressoLt }}>
                    Vida útil: {e.descartavel ? 'Descartável' : (e.vida_util_meses ? `${e.vida_util_meses} meses` : '—')}
                  </div>
                  {aba === 'global' && companyAlvo && (
                    <button onClick={() => setImportarGlobal(e)} style={{ ...btnSec, marginTop: 12, width: '100%', fontSize: 12 }}>
                      📋 Importar para minha empresa
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showNovo && companyAlvo && (
        <ModalNovoEPI companyId={companyAlvo} categorias={categorias} onClose={() => setShowNovo(false)} onSaved={() => { setShowNovo(false); carregar() }} />
      )}
      {importarGlobal && companyAlvo && (
        <ModalNovoEPI companyId={companyAlvo} categorias={categorias} clonarDe={importarGlobal} onClose={() => setImportarGlobal(null)} onSaved={() => { setImportarGlobal(null); carregar() }} />
      )}
    </div>
  )
}

function ModalNovoEPI({
  companyId, categorias, clonarDe, onClose, onSaved,
}: {
  companyId: string
  categorias: Categoria[]
  clonarDe?: EpiItem
  onClose: () => void
  onSaved: () => void
}) {
  const [categoriaId, setCategoriaId] = useState(clonarDe?.categoria_id || '')
  const [nome, setNome] = useState(clonarDe?.nome || '')
  const [modelo, setModelo] = useState(clonarDe?.modelo || '')
  const [descricao, setDescricao] = useState(clonarDe?.descricao || '')
  const [caNumero, setCaNumero] = useState(clonarDe?.ca_numero || '')
  const [caValidade, setCaValidade] = useState(clonarDe?.ca_validade?.split('T')[0] || '')
  const [fabricante, setFabricante] = useState(clonarDe?.fabricante_nome || '')
  const [fabricanteCnpj, setFabricanteCnpj] = useState(clonarDe?.fabricante_cnpj || '')
  const [lote, setLote] = useState(clonarDe?.lote || '')
  const [vidaUtilMeses, setVidaUtilMeses] = useState<number | ''>(clonarDe?.vida_util_meses || '')
  const [descartavel, setDescartavel] = useState(clonarDe?.descartavel || false)
  const [riscos, setRiscos] = useState<string[]>(clonarDe?.riscos_protege || [])
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function toggleRisco(r: string) {
    setRiscos((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]))
  }

  async function salvar() {
    if (!nome.trim()) { setErro('Nome obrigatório'); return }
    if (!caNumero.trim()) { setErro('CA é obrigatório'); return }
    if (!caValidade) { setErro('Validade do CA é obrigatória'); return }
    if (!fabricante.trim()) { setErro('Fabricante é obrigatório'); return }
    setSalvando(true)
    setErro(null)
    try {
      const { error } = await supabase.from('epi_catalogo').insert({
        company_id: companyId,
        categoria_id: categoriaId || null,
        nome: nome.trim(),
        modelo: modelo.trim() || null,
        descricao: descricao.trim() || null,
        ca_numero: caNumero.trim(),
        ca_validade: caValidade,
        fabricante_nome: fabricante.trim(),
        fabricante_cnpj: fabricanteCnpj.trim() || null,
        lote: lote.trim() || null,
        vida_util_meses: vidaUtilMeses === '' ? null : Number(vidaUtilMeses),
        descartavel,
        riscos_protege: riscos.length > 0 ? riscos : null,
        is_global: false,
        ativo: true,
      })
      if (error) throw error
      onSaved()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao salvar')
      setSalvando(false)
    }
  }

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.2, color: C.gold, margin: 0, textTransform: 'uppercase' }}>EPI · Catálogo</p>
        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, margin: '4px 0 16px' }}>
          {clonarDe ? 'Importar do Catálogo Global' : 'Novo EPI'}
        </h2>
        {erro && <div style={{ background: '#fce8e8', color: C.red, padding: '10px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{erro}</div>}

        <Section titulo="Identificação">
          <Field label="Categoria">
            <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} style={inputStyle}>
              <option value="">— sem categoria —</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Field>
          <Field label="Nome *"><input value={nome} onChange={(e) => setNome(e.target.value)} style={inputStyle} /></Field>
          <Field label="Modelo"><input value={modelo} onChange={(e) => setModelo(e.target.value)} style={inputStyle} /></Field>
          <Field label="Descrição"><textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} style={{ ...inputStyle, minHeight: 60 }} /></Field>
        </Section>

        <Section titulo="Conformidade NR-6">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="CA Número *"><input value={caNumero} onChange={(e) => setCaNumero(e.target.value)} style={inputStyle} placeholder="Ex: 39872" /></Field>
            <Field label="CA Validade *"><input type="date" value={caValidade} onChange={(e) => setCaValidade(e.target.value)} style={inputStyle} /></Field>
            <Field label="Fabricante Nome *"><input value={fabricante} onChange={(e) => setFabricante(e.target.value)} style={inputStyle} /></Field>
            <Field label="Fabricante CNPJ"><input value={fabricanteCnpj} onChange={(e) => setFabricanteCnpj(e.target.value)} style={inputStyle} placeholder="00.000.000/0000-00" /></Field>
          </div>
          <Field label="Lote"><input value={lote} onChange={(e) => setLote(e.target.value)} style={inputStyle} /></Field>
        </Section>

        <Section titulo="Riscos e Vida Útil">
          <Field label="Riscos que protege">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {RISCOS.map((r) => (
                <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, padding: '6px 10px', borderRadius: 8, background: riscos.includes(r) ? C.gold + '22' : C.beigeLt, color: riscos.includes(r) ? C.gold : C.espressoLt, fontWeight: riscos.includes(r) ? 700 : 500 }}>
                  <input type="checkbox" checked={riscos.includes(r)} onChange={() => toggleRisco(r)} />
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </label>
              ))}
            </div>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Vida útil (meses)">
              <input type="number" min={0} value={vidaUtilMeses} onChange={(e) => setVidaUtilMeses(e.target.value === '' ? '' : Number(e.target.value))} style={inputStyle} disabled={descartavel} placeholder="Ex: 12" />
            </Field>
            <Field label="">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: C.ink, paddingTop: 8 }}>
                <input type="checkbox" checked={descartavel} onChange={(e) => setDescartavel(e.target.checked)} />
                Descartável (uso único)
              </label>
            </Field>
          </div>
        </Section>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onClose} disabled={salvando} style={btnSec}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || !nome.trim()} style={{ ...btnPrim, opacity: !salvando && nome.trim() ? 1 : 0.6, cursor: !salvando && nome.trim() ? 'pointer' : 'not-allowed' }}>
            {salvando ? 'Salvando…' : (clonarDe ? 'Importar para empresa' : 'Criar EPI')}
          </button>
        </div>
      </div>
    </div>
  )
}

function TabBtn({ ativa, onClick, children }: { ativa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ padding: '10px 16px', background: 'transparent', border: 'none', borderBottom: ativa ? `2px solid ${C.gold}` : '2px solid transparent', color: ativa ? C.espresso : C.muted, fontSize: 13, fontWeight: ativa ? 700 : 500, cursor: 'pointer' }}>{children}</button>
  )
}

function Section({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 11, fontWeight: 700, color: C.espressoLt, textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 10px', borderBottom: `1px solid ${C.borderLt}`, paddingBottom: 6 }}>{titulo}</h3>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <div style={{ marginBottom: 10 }}>
      {label && <label style={labelStyle}>{label}</label>}
      {children}
    </div>
  )
}

const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.55)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }
const modalStyle: React.CSSProperties = { background: '#FFFFFF', borderRadius: 12, width: 'min(620px, 95vw)', maxHeight: '92vh', overflowY: 'auto', padding: 24 }
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }
const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', background: '#FAF7F2', border: '1px solid #ece3d2', borderRadius: 8, fontSize: 13, color: '#1a1a1a', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }
const btnSec: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, border: '1px solid #ece3d2', background: '#FFFFFF', color: '#3D2314', fontSize: 13, fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }
const btnPrim: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, border: 'none', background: '#3D2314', color: '#FFFFFF', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
