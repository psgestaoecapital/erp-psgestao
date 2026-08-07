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
  const [showImportarEstoque, setShowImportarEstoque] = useState(false)
  const [importarGlobal, setImportarGlobal] = useState<EpiItem | null>(null)
  const [editarEpi, setEditarEpi] = useState<EpiItem | null>(null)
  const [editarCaEpi, setEditarCaEpi] = useState<EpiItem | null>(null)
  const [mostrarInativos, setMostrarInativos] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const ids = companyIdsKey ? companyIdsKey.split(',').filter(Boolean) : []
      let epiQuery = supabase
        .from('epi_catalogo')
        .select('id, company_id, categoria_id, nome, modelo, descricao, ca_numero, ca_validade, fabricante_nome, fabricante_cnpj, lote, vida_util_meses, descartavel, riscos_protege, is_global, ativo, epi_categoria(nome)')
        .or(`is_global.eq.true${ids.length > 0 ? `,company_id.in.(${ids.join(',')})` : ''}`)
        .order('nome')
      if (!mostrarInativos) epiQuery = epiQuery.eq('ativo', true)
      const [catR, epiR] = await Promise.all([
        supabase.from('epi_categoria').select('id, nome').eq('ativo', true).order('nome'),
        epiQuery,
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
  }, [companyIdsKey, mostrarInativos])

  async function excluirEpi(e: EpiItem) {
    if (e.is_global) return
    if (!confirm(`Excluir o EPI "${e.nome}"? Ele sai da sua lista (o histórico é preservado).`)) return
    setErro(null); setAviso(null)
    const { data, error } = await supabase.rpc('fn_epi_excluir', { p_id: e.id })
    if (error) { setErro(error.message); return }
    const j = data as { ok?: boolean; erro?: string; tinha_historico?: boolean } | null
    if (!j?.ok) { setErro(j?.erro ?? 'Não excluiu'); return }
    setAviso(j.tinha_historico
      ? `"${e.nome}" tem estoque/entregas registradas — foi INATIVADO (some da lista), mas o histórico é preservado.`
      : `EXCLUIU o EPI "${e.nome}".`)
    carregar()
  }

  async function reativarEpi(e: EpiItem) {
    setErro(null); setAviso(null)
    const { error } = await supabase.from('epi_catalogo').update({ ativo: true }).eq('id', e.id)
    if (error) { setErro(error.message); return }
    setAviso(`REATIVOU o EPI "${e.nome}".`)
    carregar()
  }

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
    if (!ca_validade) return { cor: C.muted, label: 'CA a definir' }
    const valid = new Date(ca_validade)
    if (isNaN(valid.getTime())) return { cor: C.muted, label: 'CA a definir' }
    const hoje = new Date()
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
              <>
                <button onClick={() => setShowImportarEstoque(true)} disabled={!companyAlvo} title="Puxar EPIs que a empresa já tem no estoque (GE / Indústria)" style={{ ...btnSec, opacity: companyAlvo ? 1 : 0.5, cursor: companyAlvo ? 'pointer' : 'not-allowed' }}>⬇️ Importar do estoque</button>
                <button onClick={() => setShowNovo(true)} disabled={!companyAlvo} style={{ ...btnPrim, opacity: companyAlvo ? 1 : 0.5, cursor: companyAlvo ? 'pointer' : 'not-allowed' }}>+ Novo EPI</button>
              </>
            )}
          </div>
        </header>

        {erro && <div style={{ background: '#fce8e8', color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{erro}</div>}
        {aviso && <div style={{ background: '#EAF5EE', color: C.green, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>{aviso}</span><button onClick={() => setAviso(null)} style={{ background: 'transparent', border: 'none', color: C.green, cursor: 'pointer', fontWeight: 700 }}>×</button></div>}

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
          {aba === 'meus' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.espressoLt, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} />
              Mostrar inativos
            </label>
          )}
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
                <div key={e.id} style={{ background: '#FFFFFF', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61,35,20,0.06)', borderTop: `3px solid ${ca.cor}`, opacity: e.ativo === false ? 0.6 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3 style={{ fontSize: 15, fontWeight: 600, color: C.espresso, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.nome}</h3>
                      {e.modelo && <p style={{ fontSize: 12, color: C.muted, margin: '2px 0 0' }}>{e.modelo}</p>}
                    </div>
                    {e.is_global ? (
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: C.gold + '22', color: C.gold }}>GLOBAL</span>
                    ) : e.ativo === false ? (
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: '#eee', color: C.muted }}>INATIVO</span>
                    ) : null}
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
                  {aba === 'meus' && !e.is_global && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                      {e.ativo === false ? (
                        <button onClick={() => reativarEpi(e)} style={{ ...btnSec, fontSize: 12, flex: 1 }}>↩ Reativar</button>
                      ) : (
                        <>
                          <button onClick={() => setEditarEpi(e)} style={{ ...btnSec, fontSize: 12, flex: 1 }}>✏️ Editar</button>
                          <button onClick={() => setEditarCaEpi(e)} title="Editar só o CA (número + validade)" style={{ ...btnSec, fontSize: 12, padding: '10px 10px' }}>CA</button>
                          <button onClick={() => excluirEpi(e)} title="Excluir (inativa)" style={{ ...btnSec, fontSize: 12, padding: '10px 10px', color: C.red, borderColor: '#f0d0d0' }}>🗑</button>
                        </>
                      )}
                    </div>
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
      {showImportarEstoque && companyAlvo && (
        <ModalImportarEstoque companyId={companyAlvo} onClose={() => setShowImportarEstoque(false)} onImported={() => { setShowImportarEstoque(false); carregar() }} />
      )}
      {editarEpi && (
        <ModalNovoEPI companyId={editarEpi.company_id || companyAlvo} categorias={categorias} editar={editarEpi} onClose={() => setEditarEpi(null)} onSaved={() => { setEditarEpi(null); setAviso('ALTEROU o EPI.'); carregar() }} />
      )}
      {editarCaEpi && (
        <ModalEditarCA epi={editarCaEpi} onClose={() => setEditarCaEpi(null)} onSaved={() => { setEditarCaEpi(null); setAviso('ALTEROU o CA do EPI.'); carregar() }} />
      )}
      {importarGlobal && companyAlvo && (
        <ModalNovoEPI companyId={companyAlvo} categorias={categorias} clonarDe={importarGlobal} onClose={() => setImportarGlobal(null)} onSaved={() => { setImportarGlobal(null); carregar() }} />
      )}
    </div>
  )
}

function ModalNovoEPI({
  companyId, categorias, clonarDe, editar, onClose, onSaved,
}: {
  companyId: string
  categorias: Categoria[]
  clonarDe?: EpiItem
  editar?: EpiItem
  onClose: () => void
  onSaved: () => void
}) {
  const base = editar ?? clonarDe
  const [categoriaId, setCategoriaId] = useState(base?.categoria_id || '')
  const [nome, setNome] = useState(base?.nome || '')
  const [modelo, setModelo] = useState(base?.modelo || '')
  const [descricao, setDescricao] = useState(base?.descricao || '')
  // no editar, CA "A DEFINIR" (dos importados) começa vazio pra forçar o número real
  const [caNumero, setCaNumero] = useState((base?.ca_numero && base.ca_numero !== 'A DEFINIR') ? base.ca_numero : '')
  const [caValidade, setCaValidade] = useState(base?.ca_validade?.split('T')[0] || '')
  const [fabricante, setFabricante] = useState(base?.fabricante_nome || '')
  const [fabricanteCnpj, setFabricanteCnpj] = useState(base?.fabricante_cnpj || '')
  const [lote, setLote] = useState(base?.lote || '')
  const [vidaUtilMeses, setVidaUtilMeses] = useState<number | ''>(base?.vida_util_meses || '')
  const [descartavel, setDescartavel] = useState(base?.descartavel || false)
  const [riscos, setRiscos] = useState<string[]>(base?.riscos_protege || [])
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
      const payload = {
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
      }
      const { error } = editar
        ? await supabase.from('epi_catalogo').update(payload).eq('id', editar.id)
        : await supabase.from('epi_catalogo').insert({ ...payload, company_id: companyId, is_global: false, ativo: true })
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
          {editar ? 'Editar EPI' : clonarDe ? 'Importar do Catálogo Global' : 'Novo EPI'}
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
            {salvando ? 'Salvando…' : (editar ? 'Salvar alterações' : clonarDe ? 'Importar para empresa' : 'Criar EPI')}
          </button>
        </div>
      </div>
    </div>
  )
}

// Atalho "Editar CA" — mini-modal só com número + validade do CA (os importados vêm com CA a definir).
function ModalEditarCA({ epi, onClose, onSaved }: { epi: EpiItem; onClose: () => void; onSaved: () => void }) {
  const [caNumero, setCaNumero] = useState(epi.ca_numero && epi.ca_numero !== 'A DEFINIR' ? epi.ca_numero : '')
  const [caValidade, setCaValidade] = useState(epi.ca_validade?.split('T')[0] || '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    if (!caNumero.trim()) { setErro('Informe o número do CA'); return }
    setSalvando(true); setErro(null)
    const { error } = await supabase.from('epi_catalogo')
      .update({ ca_numero: caNumero.trim(), ca_validade: caValidade || null }).eq('id', epi.id)
    if (error) { setErro(error.message); setSalvando(false); return }
    onSaved()
  }

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalStyle, width: 'min(420px, 95vw)' }}>
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.2, color: C.gold, margin: 0, textTransform: 'uppercase' }}>EPI · CA</p>
        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: '4px 0 4px' }}>Editar CA</h2>
        <p style={{ fontSize: 12.5, color: C.muted, margin: '0 0 14px' }}>{epi.nome}</p>
        {erro && <div style={{ background: '#fce8e8', color: C.red, padding: '10px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{erro}</div>}
        <Field label="CA Número *"><input value={caNumero} onChange={(e) => setCaNumero(e.target.value)} style={inputStyle} placeholder="Ex: 39872" /></Field>
        <Field label="CA Validade"><input type="date" value={caValidade} onChange={(e) => setCaValidade(e.target.value)} style={inputStyle} /></Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={onClose} disabled={salvando} style={btnSec}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || !caNumero.trim()} style={{ ...btnPrim, opacity: !salvando && caNumero.trim() ? 1 : 0.6, cursor: !salvando && caNumero.trim() ? 'pointer' : 'not-allowed' }}>{salvando ? 'Salvando…' : 'Salvar CA'}</button>
        </div>
      </div>
    </div>
  )
}

// Importar EPIs do estoque existente (GE / Indústria-ATAK) para "Meus EPIs".
// Puxa código + nome (+ saldo + CA sugerido) de fn_epi_candidatos_estoque, o usuário seleciona (há falsos
// positivos, ex. "MÁSCARA SUÍNA" já é barrada no backend) e importa via fn_epi_importar_estoque (idempotente).
interface Candidato {
  fonte: 'ge' | 'atak'
  codigo: string
  nome: string
  saldo: number | null
  ca_sugerido: string | null
  categoria_slug: string | null
  provavel_epi: boolean
  ja_importado: boolean
}

function ModalImportarEstoque({ companyId, onClose, onImported }: { companyId: string; onClose: () => void; onImported: () => void }) {
  const [candidatos, setCandidatos] = useState<Candidato[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [fonte, setFonte] = useState<'todas' | 'ge' | 'atak'>('todas')
  const [somenteProvaveis, setSomenteProvaveis] = useState(true)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [caEdits, setCaEdits] = useState<Record<string, string>>({})
  const [importando, setImportando] = useState(false)
  const [msg, setMsg] = useState('')

  const chave = (c: Candidato) => `${c.fonte}|${c.codigo}`

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const { data, error } = await supabase.rpc('fn_epi_candidatos_estoque', {
        p_company_ids: [companyId],
        p_busca: busca.trim() || null,
        p_somente_provaveis: somenteProvaveis,
        p_limite: 500,
      })
      if (error) throw error
      setCandidatos((data || []) as Candidato[])
    } catch (e) {
      setErro((e as Error)?.message || 'Falha ao buscar candidatos')
    } finally {
      setLoading(false)
    }
  }, [companyId, busca, somenteProvaveis])

  useEffect(() => {
    const t = setTimeout(() => { void carregar() }, 300)
    return () => clearTimeout(t)
  }, [carregar])

  const lista = useMemo(
    () => candidatos.filter((c) => fonte === 'todas' || c.fonte === fonte),
    [candidatos, fonte],
  )

  function toggle(c: Candidato) {
    if (c.ja_importado) return
    const k = chave(c)
    setSel((prev) => {
      const n = new Set(prev)
      if (n.has(k)) n.delete(k); else n.add(k)
      return n
    })
  }

  async function importar() {
    const escolhidos = candidatos.filter((c) => sel.has(chave(c)) && !c.ja_importado)
    if (escolhidos.length === 0) { setMsg('Selecione ao menos 1 item.'); return }
    setImportando(true); setMsg('')
    try {
      const itens = escolhidos.map((c) => ({
        fonte: c.fonte,
        codigo: c.codigo,
        nome: c.nome,
        ca: (caEdits[chave(c)] ?? c.ca_sugerido ?? '').trim(),
        saldo: c.saldo,
      }))
      const { data, error } = await supabase.rpc('fn_epi_importar_estoque', { p_company_id: companyId, p_itens: itens })
      if (error) throw error
      const j = data as { ok?: boolean; erro?: string; importados?: number } | null
      if (!j?.ok) { setMsg('Erro: ' + (j?.erro ?? 'não importou')); setImportando(false); return }
      onImported()
    } catch (e) {
      setMsg('Erro ao importar: ' + (e as Error).message)
      setImportando(false)
    }
  }

  const nSel = candidatos.filter((c) => sel.has(chave(c)) && !c.ja_importado).length
  const fonteLabel = (f: string) => (f === 'ge' ? 'GE' : 'Indústria')

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalStyle, width: 'min(820px, 96vw)' }}>
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.2, color: C.gold, margin: 0, textTransform: 'uppercase' }}>EPI · Meus EPIs</p>
        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, margin: '4px 0 6px' }}>Importar do estoque</h2>
        <p style={{ fontSize: 12.5, color: C.muted, margin: '0 0 14px' }}>
          Puxa os EPIs que a empresa já tem no estoque (GE / Indústria) para o cadastro bater com os EPIs reais. Você escolhe o que importar.
        </p>

        {msg && <div style={{ background: msg.startsWith('Erro') ? '#fce8e8' : '#EAF5EE', color: msg.startsWith('Erro') ? C.red : C.green, padding: '10px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{msg}</div>}
        {erro && <div style={{ background: '#fce8e8', color: C.red, padding: '10px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{erro}</div>}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
          <input type="text" placeholder="Buscar por nome / código…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ ...inputStyle, flex: '1 1 220px' }} />
          <select value={fonte} onChange={(e) => setFonte(e.target.value as 'todas' | 'ge' | 'atak')} style={{ ...inputStyle, minWidth: 150 }}>
            <option value="todas">Todas as fontes</option>
            <option value="ge">GE</option>
            <option value="atak">Indústria/ATAK</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.espressoLt, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={!somenteProvaveis} onChange={(e) => setSomenteProvaveis(!e.target.checked)} />
            Mostrar todos os produtos
          </label>
        </div>

        <div style={{ border: `1px solid ${C.borderLt}`, borderRadius: 10, overflow: 'hidden', maxHeight: '48vh', overflowY: 'auto' }}>
          {loading ? (
            <p style={{ textAlign: 'center', color: C.muted, padding: 28, fontSize: 13 }}>Carregando…</p>
          ) : lista.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 28, color: C.muted, fontSize: 13 }}>
              Nenhum EPI encontrado no seu estoque.{somenteProvaveis ? ' Tente “Mostrar todos os produtos”.' : ''} Você pode cadastrar manualmente em <strong>+ Novo EPI</strong>.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: C.beigeLt, color: C.espressoLt, textAlign: 'left' }}>
                  <th style={thTd}></th>
                  <th style={thTd}>Produto</th>
                  <th style={thTd}>Fonte</th>
                  <th style={{ ...thTd, textAlign: 'right' }}>Saldo</th>
                  <th style={thTd}>CA sugerido</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((c) => {
                  const k = chave(c)
                  const marcado = sel.has(k)
                  return (
                    <tr key={k} style={{ borderTop: `1px solid ${C.borderLt}`, opacity: c.ja_importado ? 0.5 : 1, background: marcado ? '#FBF6EA' : 'transparent' }}>
                      <td style={thTd}>
                        <input type="checkbox" checked={marcado} disabled={c.ja_importado} onChange={() => toggle(c)} />
                      </td>
                      <td style={thTd}>
                        <div style={{ fontWeight: 600, color: C.espresso }}>{c.nome}</div>
                        <div style={{ fontSize: 11, color: C.muted }}>cód {c.codigo}{c.ja_importado && ' · já importado'}</div>
                      </td>
                      <td style={thTd}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: c.fonte === 'ge' ? '#e6f0ff' : '#fdeede', color: c.fonte === 'ge' ? '#1d4ed8' : '#b45309' }}>{fonteLabel(c.fonte)}</span>
                      </td>
                      <td style={{ ...thTd, textAlign: 'right', color: c.saldo != null && c.saldo < 0 ? C.red : C.espressoLt }}>{c.saldo != null ? c.saldo : '—'}</td>
                      <td style={thTd}>
                        <input
                          value={caEdits[k] ?? c.ca_sugerido ?? ''}
                          onChange={(e) => setCaEdits((prev) => ({ ...prev, [k]: e.target.value }))}
                          disabled={c.ja_importado}
                          placeholder="—"
                          style={{ ...inputStyle, padding: '5px 8px', width: 110 }}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: C.muted }}>{nSel > 0 ? `${nSel} selecionado(s)` : 'Selecione os EPIs que quer importar'}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} disabled={importando} style={btnSec}>Cancelar</button>
            <button onClick={importar} disabled={importando || nSel === 0} style={{ ...btnPrim, opacity: !importando && nSel > 0 ? 1 : 0.6, cursor: !importando && nSel > 0 ? 'pointer' : 'not-allowed' }}>
              {importando ? 'Importando…' : `Importar selecionados${nSel > 0 ? ` (${nSel})` : ''}`}
            </button>
          </div>
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
const thTd: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'middle' }
