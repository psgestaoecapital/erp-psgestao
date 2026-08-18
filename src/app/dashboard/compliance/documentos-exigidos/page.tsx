'use client'
// Compliance · Documentos exigidos por empresa. Cada empresa marca num box quais documentos do catálogo
// exige, separado por Funcionários próprios × Terceiros/Prestadores, e cria documentos próprios (custom).
// Alimenta compliance_documento_exigido → a ficha de cada pessoa passa a mostrar só a seleção da empresa.
import { useState, useEffect, useCallback } from 'react'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { rpc } from '@/lib/authFetch'
import { ListChecks, Users, HardHat, Plus, Trash2, X } from 'lucide-react'

const C = {
  espresso: '#3D2314', offwhite: '#FAF7F2', gold: '#C8941A', beigeLt: '#f5f0e8', borderLt: '#ece3d2',
  ink: '#1a1a1a', green: '#2d6a3e', gray: '#6b6b6b', red: '#a02020', redBg: '#fce8e8',
}
type CatItem = { tipo_documento_id: string; nome: string; grupo: string | null; base_legal: string | null; validade_dias_padrao: number | null; obrigatorio: boolean; codigo_esocial: string | null; marcado: boolean }
type CustomItem = { exigido_id: string; nome_custom: string; obrigatorio: boolean; validade_dias: number | null; alertar_dias_antes: number | null; aplica_a: string }

export default function DocumentosExigidosPage() {
  const { sel, selInfo, loading } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' ? sel : null
  const [aba, setAba] = useState<'funcionario' | 'prestador'>('funcionario')

  if (loading) return <Wrap><div style={{ color: C.gray, padding: 40 }}>Carregando…</div></Wrap>
  if (!companyId) return <Wrap><Header /><Vazio titulo="Selecione uma empresa" texto="A lista de documentos exigidos é por empresa. Escolha uma empresa específica no topo (não Consolidado/Grupo)." /></Wrap>

  return (
    <Wrap>
      <Header />
      <p style={{ fontSize: 12.5, color: C.gray, marginBottom: 14 }}>Marque quais documentos <b>a sua empresa</b> exige. O catálogo é uma biblioteca comum (base legal/eSocial); aqui você monta a lista da sua realidade — separada entre próprios e terceiros. A ficha de cada pessoa passa a mostrar só o que você marcar.</p>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.borderLt}`, flexWrap: 'wrap' }}>
        {([['funcionario', 'Funcionários próprios', Users], ['prestador', 'Terceiros / Prestadores', HardHat]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setAba(k)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, fontWeight: aba === k ? 700 : 500, color: aba === k ? C.espresso : C.gray, borderBottom: `2px solid ${aba === k ? C.gold : 'transparent'}`, marginBottom: -1 }}><Icon size={16} /> {label}</button>
        ))}
      </div>
      <Selecao companyId={companyId} aplicaA={aba} />
    </Wrap>
  )
}

function Selecao({ companyId, aplicaA }: { companyId: string; aplicaA: 'funcionario' | 'prestador' }) {
  const [catalogo, setCatalogo] = useState<CatItem[]>([])
  const [custom, setCustom] = useState<CustomItem[]>([])
  const [loading, setLoading] = useState(true)
  const [novoCustom, setNovoCustom] = useState<{ nome: string; obrigatorio: boolean; validade_dias: string } | null>(null)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const r = await rpc<{ catalogo: CatItem[]; custom: CustomItem[] }>('fn_compliance_exigidos_listar', { p_company_id: companyId, p_aplica_a: aplicaA })
      setCatalogo(r.catalogo || []); setCustom(r.custom || [])
    } catch (e) { setErro((e as Error).message) } finally { setLoading(false) }
  }, [companyId, aplicaA])
  useEffect(() => { void carregar() }, [carregar])

  const toggle = async (item: CatItem, on: boolean) => {
    setCatalogo(cs => cs.map(c => c.tipo_documento_id === item.tipo_documento_id ? { ...c, marcado: on } : c))
    try { await rpc('fn_compliance_exigido_toggle', { p_company_id: companyId, p_tipo_id: item.tipo_documento_id, p_aplica_a: aplicaA, p_on: on }) }
    catch (e) { alert((e as Error).message); void carregar() }
  }
  const salvarCustom = async () => {
    if (!novoCustom || !novoCustom.nome.trim()) return
    setErro('')
    try {
      await rpc('fn_compliance_exigido_custom_salvar', { p_company_id: companyId, p_nome: novoCustom.nome, p_aplica_a: aplicaA, p_obrigatorio: novoCustom.obrigatorio, p_validade_dias: novoCustom.validade_dias ? Number(novoCustom.validade_dias) : null })
      setNovoCustom(null); void carregar()
    } catch (e) { setErro((e as Error).message) }
  }
  const removerCustom = async (c: CustomItem) => {
    if (!confirm(`Remover "${c.nome_custom}"?`)) return
    try { await rpc('fn_compliance_exigido_remover', { p_company_id: companyId, p_exigido_id: c.exigido_id }); void carregar() } catch (e) { alert((e as Error).message) }
  }

  if (loading) return <Load />
  const grupos = Array.from(new Set(catalogo.map(c => c.grupo || 'Outros')))
  const marcados = catalogo.filter(c => c.marcado).length

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 13, color: C.gray }}>{marcados} de {catalogo.length} do catálogo marcados · {custom.length} próprio(s)</div>
        <Btn onClick={() => setNovoCustom({ nome: '', obrigatorio: true, validade_dias: '' })}><Plus size={15} /> Adicionar documento próprio</Btn>
      </div>

      {custom.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.espresso, marginBottom: 6 }}>Documentos próprios (fora do catálogo)</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {custom.map(c => (
              <div key={c.exigido_id} style={{ display: 'flex', gap: 10, alignItems: 'center', background: '#fff', border: `1px solid ${C.borderLt}`, borderRadius: 10, padding: '10px 12px' }}>
                <span style={{ flex: 1, fontWeight: 600, color: C.espresso, fontSize: 13.5 }}>{c.nome_custom}</span>
                <span style={{ fontSize: 11.5, color: C.gray }}>{c.obrigatorio ? 'obrigatório' : 'opcional'}{c.validade_dias ? ` · validade ${c.validade_dias}d` : ''}</span>
                <button title="Remover" onClick={() => removerCustom(c)} style={{ border: `1px solid ${C.borderLt}`, background: '#fff', color: C.red, borderRadius: 8, width: 32, height: 32, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {catalogo.length === 0 ? (
        <Vazio titulo="Catálogo sem itens para este perfil" texto="Nenhum tipo do catálogo se aplica a este perfil. Adicione um documento próprio." />
      ) : grupos.map(g => (
        <div key={g} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: C.gold, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>{g}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 6 }}>
            {catalogo.filter(c => (c.grupo || 'Outros') === g).map(item => (
              <label key={item.tipo_documento_id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#fff', border: `1px solid ${item.marcado ? C.gold : C.borderLt}`, borderRadius: 10, padding: '10px 12px', cursor: 'pointer' }}>
                <input type="checkbox" checked={item.marcado} onChange={e => toggle(item, e.target.checked)} style={{ marginTop: 2 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: C.espresso, fontSize: 13.5 }}>{item.nome}</div>
                  <div style={{ fontSize: 11, color: C.gray }}>{item.base_legal || '—'}{item.codigo_esocial ? ` · eSocial ${item.codigo_esocial}` : ''}{item.validade_dias_padrao ? ` · validade ${item.validade_dias_padrao}d` : ''}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      ))}

      {novoCustom && (
        <div onClick={() => setNovoCustom(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8vh 16px', zIndex: 50 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 20, width: '100%', maxWidth: 440 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.espresso }}>Documento próprio</h3>
              <button onClick={() => setNovoCustom(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: C.gray }}><X size={18} /></button>
            </div>
            <Campo label="Nome do documento *"><input style={inp()} value={novoCustom.nome} onChange={e => setNovoCustom({ ...novoCustom, nome: e.target.value })} placeholder="Ex.: Ficha de integração interna" /></Campo>
            <Campo label="Validade (dias, opcional)"><input type="number" style={inp()} value={novoCustom.validade_dias} onChange={e => setNovoCustom({ ...novoCustom, validade_dias: e.target.value })} /></Campo>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, color: C.espresso, cursor: 'pointer', marginTop: 4 }}>
              <input type="checkbox" checked={novoCustom.obrigatorio} onChange={e => setNovoCustom({ ...novoCustom, obrigatorio: e.target.checked })} /> Obrigatório
            </label>
            <div style={{ fontSize: 11.5, color: C.gray, marginTop: 6 }}>Aplica a: <b>{aplicaA === 'funcionario' ? 'Funcionários próprios' : 'Terceiros / Prestadores'}</b> (a aba atual).</div>
            {erro && <div style={{ background: C.redBg, color: C.red, borderRadius: 8, padding: '8px 10px', fontSize: 12.5, marginTop: 10 }}>{erro}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button onClick={() => setNovoCustom(null)} style={{ border: `1px solid ${C.borderLt}`, background: '#fff', color: C.espresso, borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
              <Btn onClick={salvarCustom}>Salvar</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Wrap({ children }: { children: React.ReactNode }) { return <div style={{ background: C.offwhite, minHeight: '100vh', padding: '24px clamp(14px,4vw,36px)' }}><div style={{ maxWidth: 1000, margin: '0 auto' }}>{children}</div></div> }
function Header() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      <span style={{ width: 42, height: 42, borderRadius: 12, background: '#F3E6C9', color: C.gold, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><ListChecks size={22} /></span>
      <div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 23, fontWeight: 400, color: C.espresso, margin: 0 }}>Documentos Exigidos</h1>
        <div style={{ fontSize: 12, color: C.gray }}>Configure quais documentos a sua empresa exige — próprios × terceiros</div>
      </div>
    </div>
  )
}
function Vazio({ titulo, texto }: { titulo: string; texto: string }) { return <div style={{ background: '#fff', border: `1px dashed ${C.borderLt}`, borderRadius: 14, padding: '32px 20px', textAlign: 'center' }}><div style={{ fontSize: 15, fontWeight: 600, color: C.espresso }}>{titulo}</div><div style={{ fontSize: 13, color: C.gray, marginTop: 5, maxWidth: 460, marginInline: 'auto' }}>{texto}</div></div> }
function Load() { return <div style={{ color: C.gray, padding: 30, textAlign: 'center', fontSize: 13 }}>Carregando…</div> }
function inp(): React.CSSProperties { return { width: '100%', border: `1px solid ${C.borderLt}`, borderRadius: 8, padding: '8px 10px', fontSize: 13.5, color: C.ink, background: '#fff' } }
function Campo({ label, children }: { label: string; children: React.ReactNode }) { return <div style={{ marginBottom: 10 }}><label style={{ display: 'block', fontSize: 12, color: C.gray, marginBottom: 4 }}>{label}</label>{children}</div> }
function Btn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) { return <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: C.gold, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{children}</button> }
