'use client'

// /dashboard/commerce/fichas — Fichas Técnicas (Comércio)
// PR M.B.1.1 — Marco M.B.1 (Comércio 100% pronto-para-venda até Junho 2026)
//
// Reusa as MESMAS tabelas usadas pela página legada /dashboard/ficha-tecnica
// (fichas_tecnicas + ficha_itens). Hub Projetos T1 consome via API
// (api/ficha-tecnica/seed, api/report/v19) — NAO QUEBRA.
//
// Identidade visual: tema CLARO Estrela Polar
//   espresso #3D2314 / off-white #FAF7F2 / dourado #C8941A
//   verde/amber/red somente como semáforo de performance

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  Plus, Search, FileText, X, Trash2, Save,
  Package, Calculator, ListChecks,
} from 'lucide-react'

const C = {
  espresso: '#3D2314',
  espressoM: '#6B5D4F',
  espressoL: '#9C8E80',
  offWhite: '#FAF7F2',
  white: '#FFFFFF',
  cream: '#F0ECE3',
  creamD: '#E8E1D3',
  border: '#E0D8CC',
  borderL: '#EDE7DA',
  gold: '#C8941A',
  goldD: '#A57A15',
  goldBg: '#FDF7E8',
  // semaforos (uso restrito)
  green: '#10B981',
  amber: '#C88A1A',
  red: '#EF4444',
  blue: '#3B82F6',
}

const CATEGORIAS = ['parede', 'forro', 'revestimento', 'divisoria', 'shaft', 'outro'] as const
const UNIDADES = ['un', 'm', 'm²', 'kg', 'L', 'rolo', 'saco', 'caixa', 'par', 'pç']

type FichaTec = {
  id: string
  company_id: string
  codigo: string | null
  nome: string
  categoria: string | null
  descricao: string | null
  unidade: string | null
  mao_obra_direta: number | null
  custos_indiretos_pct: number | null
  impostos_pct: number | null
  markup_pct: number | null
  ativo: boolean | null
  created_at: string | null
  updated_at: string | null
}

type FichaItem = {
  id: string
  ficha_id: string
  ordem: number | null
  codigo: string | null
  nome: string
  unidade: string | null
  quantidade: number | null
  preco_unitario: number | null
  fornecedor: string | null
  obs: string | null
}

const fmtBRL = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function FichasCommercePage() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [fichas, setFichas] = useState<FichaTec[]>([])
  const [itensCache, setItensCache] = useState<Record<string, FichaItem[]>>({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string>('')
  const [msg, setMsg] = useState<string>('')

  const [filtroBusca, setFiltroBusca] = useState('')
  const [filtroCat, setFiltroCat] = useState('')

  const [selFichaId, setSelFichaId] = useState<string | null>(null)
  const [showNova, setShowNova] = useState(false)

  // Carregar contexto
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setErr('Sessão expirada. Faça login.')
        setLoading(false)
        return
      }
      const saved = typeof window !== 'undefined' ? localStorage.getItem('ps_empresa_sel') : null
      let cid: string | null = null
      if (saved && saved !== 'consolidado' && !saved.startsWith('group_')) {
        cid = saved
      } else {
        const { data: ucs } = await supabase.from('user_companies').select('company_id').eq('user_id', user.id).limit(1)
        cid = ucs?.[0]?.company_id ?? null
      }
      if (!alive) return
      setCompanyId(cid)
      if (!cid) {
        setErr('Selecione uma empresa para gerenciar as fichas técnicas.')
        setLoading(false)
        return
      }
      const { data: fs, error } = await supabase
        .from('fichas_tecnicas')
        .select('*')
        .eq('company_id', cid)
        .order('categoria', { ascending: true, nullsFirst: true })
        .order('nome', { ascending: true })
      if (!alive) return
      if (error) setErr(error.message)
      else setFichas((fs ?? []) as FichaTec[])
      setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  // Carregar itens da ficha selecionada
  useEffect(() => {
    if (!selFichaId) return
    if (itensCache[selFichaId]) return
    let alive = true
    ;(async () => {
      const { data } = await supabase
        .from('ficha_itens')
        .select('*')
        .eq('ficha_id', selFichaId)
        .order('ordem', { ascending: true, nullsFirst: true })
      if (alive) setItensCache((prev) => ({ ...prev, [selFichaId]: (data ?? []) as FichaItem[] }))
    })()
    return () => { alive = false }
  }, [selFichaId, itensCache])

  const fichasFiltradas = useMemo(() => {
    const q = filtroBusca.trim().toLowerCase()
    return fichas.filter((f) => {
      if (filtroCat && f.categoria !== filtroCat) return false
      if (!q) return true
      return (
        (f.nome ?? '').toLowerCase().includes(q) ||
        (f.codigo ?? '').toLowerCase().includes(q) ||
        (f.descricao ?? '').toLowerCase().includes(q)
      )
    })
  }, [fichas, filtroBusca, filtroCat])

  const flash = (m: string) => {
    setMsg(m)
    window.setTimeout(() => setMsg(''), 3500)
  }

  // Calcula custos da ficha (materiais + mao_obra + indiretos% + impostos% + markup%)
  function calcular(ficha: FichaTec, items: FichaItem[]) {
    const materiais = items.reduce((s, i) => s + (Number(i.quantidade ?? 0) * Number(i.preco_unitario ?? 0)), 0)
    const mo = Number(ficha.mao_obra_direta ?? 0)
    const custoBase = materiais + mo
    const indiretos = custoBase * Number(ficha.custos_indiretos_pct ?? 0) / 100
    const impostos = (custoBase + indiretos) * Number(ficha.impostos_pct ?? 0) / 100
    const custoTotal = custoBase + indiretos + impostos
    const markup = custoTotal * Number(ficha.markup_pct ?? 0) / 100
    const precoVenda = custoTotal + markup
    return { materiais, mo, indiretos, impostos, custoTotal, markup, precoVenda }
  }

  async function criarFicha(nome: string, categoria: string) {
    if (!companyId) return
    const { data, error } = await supabase
      .from('fichas_tecnicas')
      .insert({
        company_id: companyId,
        nome: nome.trim(),
        categoria,
        unidade: 'm²',
        mao_obra_direta: 0,
        custos_indiretos_pct: 15,
        impostos_pct: 8.65,
        markup_pct: 30,
        ativo: true,
      })
      .select()
      .single()
    if (error) {
      flash('Erro: ' + error.message)
      return
    }
    if (data) {
      setFichas((prev) => [data as FichaTec, ...prev])
      setShowNova(false)
      setSelFichaId(data.id)
      flash('Ficha criada. Adicione os itens.')
    }
  }

  async function atualizarFicha(id: string, patch: Partial<FichaTec>) {
    const { error } = await supabase
      .from('fichas_tecnicas')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      flash('Erro ao salvar: ' + error.message)
      return
    }
    setFichas((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  }

  async function excluirFicha(id: string) {
    if (!confirm('Excluir esta ficha e todos os itens? Esta ação não pode ser desfeita.')) return
    const { error } = await supabase.from('fichas_tecnicas').delete().eq('id', id)
    if (error) {
      flash('Erro: ' + error.message)
      return
    }
    setFichas((prev) => prev.filter((f) => f.id !== id))
    setSelFichaId(null)
    flash('Ficha excluída.')
  }

  async function addItem(fichaId: string) {
    const ordemNova = (itensCache[fichaId]?.length ?? 0) + 1
    const { data, error } = await supabase
      .from('ficha_itens')
      .insert({ ficha_id: fichaId, ordem: ordemNova, nome: 'Novo item', unidade: 'un', quantidade: 1, preco_unitario: 0 })
      .select()
      .single()
    if (error) {
      flash('Erro: ' + error.message)
      return
    }
    if (data) {
      setItensCache((prev) => ({
        ...prev,
        [fichaId]: [...(prev[fichaId] ?? []), data as FichaItem],
      }))
    }
  }

  async function atualizarItem(itemId: string, fichaId: string, patch: Partial<FichaItem>) {
    const { error } = await supabase.from('ficha_itens').update(patch).eq('id', itemId)
    if (error) {
      flash('Erro: ' + error.message)
      return
    }
    setItensCache((prev) => ({
      ...prev,
      [fichaId]: (prev[fichaId] ?? []).map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
    }))
  }

  async function excluirItem(itemId: string, fichaId: string) {
    const { error } = await supabase.from('ficha_itens').delete().eq('id', itemId)
    if (error) {
      flash('Erro: ' + error.message)
      return
    }
    setItensCache((prev) => ({
      ...prev,
      [fichaId]: (prev[fichaId] ?? []).filter((i) => i.id !== itemId),
    }))
  }

  const fichaSel = selFichaId ? fichas.find((f) => f.id === selFichaId) ?? null : null
  const itensSel = selFichaId ? itensCache[selFichaId] ?? [] : []

  return (
    <div style={{ padding: 'clamp(16px, 3vw, 24px)', maxWidth: 1280, margin: '0 auto', color: C.espresso }}>
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <FileText size={26} style={{ color: C.gold }} />
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.espresso }}>Fichas Técnicas</h1>
            <p style={{ margin: 0, fontSize: 12, color: C.espressoM }}>Composições de materiais + mão de obra com markup automático</p>
          </div>
          <span
            title="Status no Manual Vivo"
            style={{
              fontSize: 10,
              padding: '3px 10px',
              borderRadius: 999,
              background: C.amber + '22',
              color: C.amber,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            Parcial · 50%
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            disabled
            title="Em breve"
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: C.cream,
              color: C.espressoL,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'not-allowed',
            }}
          >
            Importar CSV (em breve)
          </button>
          <button
            type="button"
            onClick={() => setShowNova(true)}
            disabled={!companyId}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: companyId ? C.gold : C.cream,
              color: companyId ? '#FFF' : C.espressoL,
              fontSize: 12,
              fontWeight: 600,
              cursor: companyId ? 'pointer' : 'not-allowed',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Plus size={14} /> Nova Ficha Técnica
          </button>
        </div>
      </header>

      {/* Toast */}
      {msg && (
        <div
          onClick={() => setMsg('')}
          style={{
            marginBottom: 12,
            padding: '10px 14px',
            background: C.green + '14',
            border: `1px solid ${C.green}55`,
            borderRadius: 8,
            color: C.green,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {msg}
        </div>
      )}
      {err && (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 14px',
            background: C.red + '14',
            border: `1px solid ${C.red}55`,
            borderRadius: 8,
            color: C.red,
            fontSize: 12,
          }}
        >
          {err}
        </div>
      )}

      {/* Filtros */}
      <div
        style={{
          background: C.offWhite,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: 12,
          marginBottom: 12,
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 180 }}>
          <Search
            size={14}
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.espressoL }}
          />
          <input
            type="text"
            placeholder="Buscar por nome, código ou descrição"
            value={filtroBusca}
            onChange={(e) => setFiltroBusca(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 10px 8px 32px',
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              fontSize: 13,
              background: C.white,
              color: C.espresso,
              outline: 'none',
            }}
          />
        </div>
        <select
          value={filtroCat}
          onChange={(e) => setFiltroCat(e.target.value)}
          style={{
            padding: '8px 10px',
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            fontSize: 12,
            background: C.white,
            color: C.espresso,
            cursor: 'pointer',
            minWidth: 140,
          }}
        >
          <option value="">Todas as categorias</option>
          {CATEGORIAS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: C.espressoM }}>
          {fichasFiltradas.length} de {fichas.length}
        </span>
      </div>

      {/* Tabela ou empty state */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: C.espressoM, fontSize: 13 }}>
          Carregando fichas técnicas…
        </div>
      ) : fichas.length === 0 && !err ? (
        <EmptyState onCreate={() => setShowNova(true)} disabled={!companyId} />
      ) : fichasFiltradas.length === 0 ? (
        <div
          style={{
            padding: 32,
            textAlign: 'center',
            color: C.espressoM,
            fontSize: 13,
            background: C.offWhite,
            border: `1px dashed ${C.border}`,
            borderRadius: 10,
          }}
        >
          Nenhuma ficha corresponde aos filtros aplicados.
        </div>
      ) : (
        <div style={{ background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
              <thead style={{ background: C.cream }}>
                <tr>
                  <Th>Código</Th>
                  <Th>Nome</Th>
                  <Th>Categoria</Th>
                  <Th>Unid.</Th>
                  <Th align="right">Custo total</Th>
                  <Th align="right">Preço venda</Th>
                </tr>
              </thead>
              <tbody>
                {fichasFiltradas.map((f) => {
                  const items = itensCache[f.id] ?? null
                  const calc = items ? calcular(f, items) : null
                  return (
                    <tr
                      key={f.id}
                      onClick={() => setSelFichaId(f.id)}
                      style={{
                        cursor: 'pointer',
                        borderTop: `1px solid ${C.borderL}`,
                        background: selFichaId === f.id ? C.goldBg : 'transparent',
                      }}
                      onMouseEnter={(e) => {
                        if (selFichaId !== f.id) e.currentTarget.style.background = C.cream
                      }}
                      onMouseLeave={(e) => {
                        if (selFichaId !== f.id) e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <Td><span style={{ fontFamily: 'monospace', fontSize: 11, color: C.espressoM }}>{f.codigo ?? '—'}</span></Td>
                      <Td><span style={{ fontWeight: 600 }}>{f.nome}</span></Td>
                      <Td>{f.categoria ?? '—'}</Td>
                      <Td>{f.unidade ?? '—'}</Td>
                      <Td align="right">{calc ? fmtBRL(calc.custoTotal) : '—'}</Td>
                      <Td align="right"><strong style={{ color: C.gold }}>{calc ? fmtBRL(calc.precoVenda) : '—'}</strong></Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Drawer Nova Ficha */}
      {showNova && <ModalNovaFicha onClose={() => setShowNova(false)} onCreate={criarFicha} />}

      {/* Drawer Detalhe */}
      {fichaSel && (
        <Drawer
          ficha={fichaSel}
          itens={itensSel}
          onClose={() => setSelFichaId(null)}
          onUpdate={(patch) => atualizarFicha(fichaSel.id, patch)}
          onDelete={() => excluirFicha(fichaSel.id)}
          onAddItem={() => addItem(fichaSel.id)}
          onUpdateItem={(itemId, patch) => atualizarItem(itemId, fichaSel.id, patch)}
          onDeleteItem={(itemId) => excluirItem(itemId, fichaSel.id)}
          calcular={calcular}
        />
      )}
    </div>
  )
}

function Th({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{ padding: '10px 14px', textAlign: align, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: C.espressoM }}>
      {children}
    </th>
  )
}

function Td({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <td style={{ padding: '10px 14px', textAlign: align, verticalAlign: 'middle', color: C.espresso }}>
      {children}
    </td>
  )
}

function EmptyState({ onCreate, disabled }: { onCreate: () => void; disabled: boolean }) {
  return (
    <div
      style={{
        background: C.offWhite,
        border: `1px dashed ${C.border}`,
        borderRadius: 12,
        padding: 48,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
      }}
    >
      <div style={{ width: 72, height: 72, borderRadius: '50%', background: C.goldBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <FileText size={32} style={{ color: C.gold }} />
      </div>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.espresso }}>Crie sua primeira ficha técnica</h2>
      <p style={{ margin: 0, fontSize: 13, color: C.espressoM, maxWidth: 440, lineHeight: 1.5 }}>
        Fichas técnicas combinam materiais, mão de obra e custos para gerar preço de venda automático com markup.
        Ideal para Comércio com itens compostos.
      </p>
      <button
        type="button"
        onClick={onCreate}
        disabled={disabled}
        style={{
          marginTop: 4,
          padding: '10px 20px',
          borderRadius: 8,
          border: 'none',
          background: disabled ? C.cream : C.gold,
          color: disabled ? C.espressoL : '#FFF',
          fontSize: 13,
          fontWeight: 600,
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Plus size={14} /> Nova ficha técnica
      </button>
    </div>
  )
}

function ModalNovaFicha({ onClose, onCreate }: { onClose: () => void; onCreate: (nome: string, cat: string) => void }) {
  const [nome, setNome] = useState('')
  const [cat, setCat] = useState<string>('parede')

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.offWhite,
          borderRadius: 12,
          padding: 24,
          width: '100%',
          maxWidth: 480,
          border: `1px solid ${C.border}`,
          boxShadow: '0 16px 48px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.espresso }}>Nova ficha técnica</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.espressoM, padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: C.espressoM, fontWeight: 600 }}>Nome *</span>
            <input
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Parede Drywall Simples 73mm (ST)"
              style={{ padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, color: C.espresso, background: C.white, outline: 'none' }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: C.espressoM, fontWeight: 600 }}>Categoria</span>
            <select
              value={cat}
              onChange={(e) => setCat(e.target.value)}
              style={{ padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, color: C.espresso, background: C.white, cursor: 'pointer' }}
            >
              {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.espresso, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
              Cancelar
            </button>
            <button
              onClick={() => onCreate(nome, cat)}
              disabled={!nome.trim()}
              style={{
                padding: '8px 18px',
                borderRadius: 8,
                border: 'none',
                background: nome.trim() ? C.gold : C.cream,
                color: nome.trim() ? '#FFF' : C.espressoL,
                fontSize: 12,
                fontWeight: 600,
                cursor: nome.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              Criar ficha
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

type CalcResult = {
  materiais: number
  mo: number
  indiretos: number
  impostos: number
  custoTotal: number
  markup: number
  precoVenda: number
}

function Drawer({
  ficha,
  itens,
  onClose,
  onUpdate,
  onDelete,
  onAddItem,
  onUpdateItem,
  onDeleteItem,
  calcular,
}: {
  ficha: FichaTec
  itens: FichaItem[]
  onClose: () => void
  onUpdate: (patch: Partial<FichaTec>) => void
  onDelete: () => void
  onAddItem: () => void
  onUpdateItem: (id: string, patch: Partial<FichaItem>) => void
  onDeleteItem: (id: string) => void
  calcular: (f: FichaTec, i: FichaItem[]) => CalcResult
}) {
  type SecaoKey = 'ident' | 'composicao' | 'custos'
  const [aberto, setAberto] = useState<Record<SecaoKey, boolean>>({ ident: true, composicao: true, custos: true })

  const calc = calcular(ficha, itens)

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 90, display: 'flex', justifyContent: 'flex-end' }}>
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(640px, 100%)',
          height: '100%',
          background: C.offWhite,
          borderLeft: `1px solid ${C.border}`,
          overflowY: 'auto',
          padding: 0,
          boxShadow: '-8px 0 24px rgba(0,0,0,0.15)',
        }}
      >
        <header style={{ position: 'sticky', top: 0, background: C.offWhite, borderBottom: `1px solid ${C.border}`, padding: '16px 20px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, zIndex: 1 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: C.espressoM, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, marginBottom: 4 }}>
              Ficha técnica
            </div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.espresso, wordBreak: 'break-word' }}>{ficha.nome}</h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: C.espressoM }} aria-label="Fechar">
            <X size={16} />
          </button>
        </header>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Secao 1: Identificacao */}
          <Secao
            titulo="Identificação"
            icon={<ListChecks size={16} />}
            aberto={aberto.ident}
            onToggle={() => setAberto((p) => ({ ...p, ident: !p.ident }))}
          >
            <Field label="Código">
              <input
                defaultValue={ficha.codigo ?? ''}
                onBlur={(e) => onUpdate({ codigo: e.target.value || null })}
                placeholder="Ex: PAR-DRY-073"
                style={inp}
              />
            </Field>
            <Field label="Nome">
              <input defaultValue={ficha.nome} onBlur={(e) => onUpdate({ nome: e.target.value })} style={inp} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
              <Field label="Categoria">
                <select defaultValue={ficha.categoria ?? ''} onChange={(e) => onUpdate({ categoria: e.target.value || null })} style={inp}>
                  <option value="">—</option>
                  {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Unidade">
                <select defaultValue={ficha.unidade ?? ''} onChange={(e) => onUpdate({ unidade: e.target.value || null })} style={inp}>
                  <option value="">—</option>
                  {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Descrição">
              <textarea
                defaultValue={ficha.descricao ?? ''}
                onBlur={(e) => onUpdate({ descricao: e.target.value || null })}
                rows={2}
                style={{ ...inp, resize: 'vertical' }}
              />
            </Field>
          </Secao>

          {/* Secao 2: Composicao (BOM) */}
          <Secao
            titulo={`Composição · ${itens.length} item${itens.length === 1 ? '' : 's'}`}
            icon={<Package size={16} />}
            aberto={aberto.composicao}
            onToggle={() => setAberto((p) => ({ ...p, composicao: !p.composicao }))}
            action={
              <button
                onClick={(e) => { e.stopPropagation(); onAddItem() }}
                style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.gold}`, background: C.goldBg, color: C.goldD, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <Plus size={12} /> Adicionar
              </button>
            }
          >
            {itens.length === 0 ? (
              <div style={{ padding: 18, textAlign: 'center', color: C.espressoM, fontSize: 12, fontStyle: 'italic', background: C.cream, borderRadius: 8 }}>
                Sem itens. Clique em &quot;Adicionar&quot; para incluir materiais.
              </div>
            ) : (
              <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead style={{ background: C.cream }}>
                    <tr>
                      <Th>Nome</Th>
                      <Th>Unid.</Th>
                      <Th align="right">Qtd</Th>
                      <Th align="right">Preço un.</Th>
                      <Th align="right">Subtotal</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((it) => {
                      const subtotal = Number(it.quantidade ?? 0) * Number(it.preco_unitario ?? 0)
                      return (
                        <tr key={it.id} style={{ borderTop: `1px solid ${C.borderL}` }}>
                          <Td>
                            <input
                              defaultValue={it.nome}
                              onBlur={(e) => onUpdateItem(it.id, { nome: e.target.value })}
                              style={{ ...inp, width: '100%', minWidth: 160 }}
                            />
                          </Td>
                          <Td>
                            <select defaultValue={it.unidade ?? 'un'} onChange={(e) => onUpdateItem(it.id, { unidade: e.target.value })} style={{ ...inp, width: 70 }}>
                              {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </Td>
                          <Td align="right">
                            <input
                              type="number"
                              step="0.01"
                              defaultValue={it.quantidade ?? 0}
                              onBlur={(e) => onUpdateItem(it.id, { quantidade: parseFloat(e.target.value) || 0 })}
                              style={{ ...inp, width: 80, textAlign: 'right' }}
                            />
                          </Td>
                          <Td align="right">
                            <input
                              type="number"
                              step="0.01"
                              defaultValue={it.preco_unitario ?? 0}
                              onBlur={(e) => onUpdateItem(it.id, { preco_unitario: parseFloat(e.target.value) || 0 })}
                              style={{ ...inp, width: 100, textAlign: 'right' }}
                            />
                          </Td>
                          <Td align="right"><strong>{fmtBRL(subtotal)}</strong></Td>
                          <Td>
                            <button onClick={() => onDeleteItem(it.id)} title="Remover" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.red, padding: 4 }}>
                              <Trash2 size={14} />
                            </button>
                          </Td>
                        </tr>
                      )
                    })}
                    <tr style={{ background: C.cream, borderTop: `2px solid ${C.border}` }}>
                      <Td>Subtotal materiais</Td>
                      <Td />
                      <Td />
                      <Td />
                      <Td align="right"><strong>{fmtBRL(calc.materiais)}</strong></Td>
                      <Td />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Secao>

          {/* Secao 3: Custos & Markup */}
          <Secao
            titulo="Custos & Markup"
            icon={<Calculator size={16} />}
            aberto={aberto.custos}
            onToggle={() => setAberto((p) => ({ ...p, custos: !p.custos }))}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
              <Field label="Mão de obra direta (R$)">
                <input
                  type="number"
                  step="0.01"
                  defaultValue={ficha.mao_obra_direta ?? 0}
                  onBlur={(e) => onUpdate({ mao_obra_direta: parseFloat(e.target.value) || 0 })}
                  style={inp}
                />
              </Field>
              <Field label="Custos indiretos (%)">
                <input
                  type="number"
                  step="0.01"
                  defaultValue={ficha.custos_indiretos_pct ?? 0}
                  onBlur={(e) => onUpdate({ custos_indiretos_pct: parseFloat(e.target.value) || 0 })}
                  style={inp}
                />
              </Field>
              <Field label="Impostos (%)">
                <input
                  type="number"
                  step="0.01"
                  defaultValue={ficha.impostos_pct ?? 0}
                  onBlur={(e) => onUpdate({ impostos_pct: parseFloat(e.target.value) || 0 })}
                  style={inp}
                />
              </Field>
              <Field label="Markup (%)">
                <input
                  type="number"
                  step="0.01"
                  defaultValue={ficha.markup_pct ?? 0}
                  onBlur={(e) => onUpdate({ markup_pct: parseFloat(e.target.value) || 0 })}
                  style={inp}
                />
              </Field>
            </div>

            {/* Resumo de calculo */}
            <div style={{ marginTop: 12, padding: 14, background: C.cream, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
              <CalcRow label="Materiais" value={calc.materiais} />
              <CalcRow label="Mão de obra direta" value={calc.mo} />
              <CalcRow label="Custos indiretos" value={calc.indiretos} />
              <CalcRow label="Impostos" value={calc.impostos} />
              <CalcRow label="Custo total" value={calc.custoTotal} bold />
              <CalcRow label="Markup" value={calc.markup} />
              <CalcRow label="Preço de venda" value={calc.precoVenda} accent />
            </div>
          </Secao>

          {/* Acoes destrutivas */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 11, color: C.espressoL }}>
              Alterações são salvas automaticamente ao sair do campo.
            </span>
            <button
              onClick={onDelete}
              style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.red}`, background: 'transparent', color: C.red, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Trash2 size={14} /> Excluir ficha
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}

// (CalcResult definido acima)

function Secao({ titulo, icon, aberto, onToggle, action, children }: {
  titulo: string
  icon?: React.ReactNode
  aberto: boolean
  onToggle: () => void
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section style={{ background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <header
        onClick={onToggle}
        style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', background: C.cream, justifyContent: 'space-between' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {icon && <span style={{ color: C.gold, display: 'inline-flex' }}>{icon}</span>}
          <span style={{ fontSize: 13, fontWeight: 700, color: C.espresso }}>{titulo}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
          {action}
          <span style={{ fontSize: 11, color: C.espressoM, fontWeight: 600 }}>{aberto ? '−' : '+'}</span>
        </div>
      </header>
      {aberto && <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, color: C.espressoM, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  )
}

function CalcRow({ label, value, bold, accent }: { label: string; value: number; bold?: boolean; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
      <span style={{ color: accent ? C.gold : C.espressoM, fontWeight: bold || accent ? 700 : 500 }}>{label}</span>
      <span style={{ color: accent ? C.gold : C.espresso, fontWeight: bold || accent ? 700 : 500, fontSize: accent ? 14 : 12 }}>
        {fmtBRL(value)}
      </span>
    </div>
  )
}

const inp: React.CSSProperties = {
  padding: '7px 10px',
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  fontSize: 12,
  color: C.espresso,
  background: C.white,
  outline: 'none',
}
