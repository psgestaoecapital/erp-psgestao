'use client'
// SPEC Custeio Camada 1 · Ficha técnica de MATERIAL por procedimento. Quanto custa de insumo cada
// procedimento = Σ (qtd × preço de custo do insumo). Preço vem SEMPRE do estoque GE (erp_produtos) —
// fonte única (RD-52). [→GE] a odonto só referencia. Insumo sem preço → aviso honesto (RD-51). #819.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ShellOdonto, PageHeaderOdonto, CardOdonto, EmptyStateOdonto, TOK } from '@/components/odonto/ui'
import { Calculator, Search, Plus, Trash2, ChevronLeft, AlertTriangle, Package } from 'lucide-react'

const brl = (n: number) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type ProcCusto = { id: string; nome: string; valor: number; duracao_min: number | null; custo_material: number; incompleto: boolean; n_insumos: number }
type Item = { id: string; produto_id: string; nome: string; unidade: string | null; quantidade: number; preco_unit: number | null; subtotal: number; sem_preco: boolean }
type Detalhe = { ok?: boolean; custo_material: number; incompleto: boolean; itens: Item[] }
type Produto = { id: string; nome: string; unidade: string | null; preco_custo: number | null; preco_custo_medio: number | null }

function useCompanyId(): string | null {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => { if (typeof window === 'undefined') return null; const v = localStorage.getItem('ps_empresa_sel'); return (!v || v === 'consolidado' || v.startsWith('group_')) ? null : v }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setId(read())
    const t = setInterval(() => { const v = read(); setId((p) => (p === v ? p : v)) }, 800)
    return () => clearInterval(t)
  }, [])
  return id
}

const precoDe = (p: Produto) => (p.preco_custo_medio && p.preco_custo_medio > 0 ? p.preco_custo_medio : (p.preco_custo && p.preco_custo > 0 ? p.preco_custo : null))
const margemPct = (valor: number, custo: number) => (valor > 0 ? Math.round(((valor - custo) / valor) * 100) : null)
function corMargem(pct: number | null): string { if (pct === null) return TOK.mut; if (pct < 0) return TOK.red; if (pct < 40) return '#B45309'; return TOK.green }

export default function CusteioPage() {
  const companyId = useCompanyId()
  const [procs, setProcs] = useState<ProcCusto[]>([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<ProcCusto | null>(null)

  const carregar = useCallback(async (cid: string) => {
    setLoading(true)
    const { data } = await supabase.rpc('fn_odonto_procedimentos_custo', { p_company_id: cid })
    setProcs((data as ProcCusto[] | null) ?? [])
    setLoading(false)
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (companyId) void carregar(companyId) }, [companyId, carregar])

  if (!companyId) return <ShellOdonto><EmptyStateOdonto titulo="Escolha uma clínica" linha="Selecione uma empresa específica no topo do menu para ver o custeio." /></ShellOdonto>

  if (sel) return <FichaTecnica companyId={companyId} proc={sel} onVoltar={() => { setSel(null); void carregar(companyId) }} />

  return (
    <ShellOdonto>
      <PageHeaderOdonto icon={<Calculator size={20} />} titulo="Custeio de procedimentos"
        subtitulo="Quanto cada procedimento gasta de material — e a margem sobre o preço (Camada 1: insumos)" />
      <div style={{ fontSize: 11.5, color: TOK.mut, marginBottom: 10 }}>
        <Package size={12} style={{ display: 'inline', verticalAlign: -1 }} /> Os insumos e preços vivem no <strong>Estoque (Gestão Empresarial)</strong> <span style={{ color: TOK.gold, fontWeight: 700 }}>[→GE]</span>. Aqui você monta a ficha técnica; o custo acompanha o preço de lá.
      </div>

      {loading ? (
        <CardOdonto><div style={{ fontSize: 13, color: TOK.mut }}>Carregando…</div></CardOdonto>
      ) : procs.length === 0 ? (
        <EmptyStateOdonto titulo="Sem procedimentos" linha="Cadastre procedimentos odontológicos para montar a ficha técnica de material." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {procs.map((p) => {
            const margem = p.valor - p.custo_material
            const pct = margemPct(p.valor, p.custo_material)
            return (
              <CardOdonto key={p.id} style={{ padding: 14, cursor: 'pointer' }} className="hover:opacity-90">
                <button onClick={() => setSel(p)} style={{ all: 'unset', width: '100%', cursor: 'pointer', display: 'block' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 700, color: TOK.esp }}>{p.nome}</div>
                      <div style={{ fontSize: 11.5, color: TOK.mut }}>{p.n_insumos} insumo(s){p.duracao_min ? ` · ${p.duracao_min} min` : ''} · toque para editar a ficha</div>
                    </div>
                    <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 10.5, color: TOK.mut }}>Preço</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: TOK.esp }}>{brl(p.valor)}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 10.5, color: TOK.mut }}>Material</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: TOK.esp }}>{brl(p.custo_material)}{p.incompleto && <AlertTriangle size={12} style={{ color: '#B45309', display: 'inline', marginLeft: 3, verticalAlign: -1 }} />}</div>
                      </div>
                      <div style={{ textAlign: 'right', minWidth: 90 }}>
                        <div style={{ fontSize: 10.5, color: TOK.mut }}>Margem material</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: corMargem(p.valor > 0 ? pct : null) }}>{p.valor > 0 ? `${brl(margem)} · ${pct}%` : '—'}</div>
                      </div>
                    </div>
                  </div>
                </button>
              </CardOdonto>
            )
          })}
        </div>
      )}
    </ShellOdonto>
  )
}

function FichaTecnica({ companyId, proc, onVoltar }: { companyId: string; proc: ProcCusto; onVoltar: () => void }) {
  const [det, setDet] = useState<Detalhe | null>(null)
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [achados, setAchados] = useState<Produto[]>([])
  const [qtd, setQtd] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.rpc('fn_odonto_procedimento_custo_material', { p_procedimento_id: proc.id })
    setDet(data as Detalhe | null)
    setLoading(false)
  }, [proc.id])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  useEffect(() => {
    const q = busca.trim()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q.length < 2) { setAchados([]); return }
    let alive = true
    const t = setTimeout(() => {
      void supabase.from('erp_produtos').select('id,nome,unidade,preco_custo,preco_custo_medio').eq('company_id', companyId).ilike('nome', `%${q}%`).limit(8)
        .then(({ data }) => { if (alive) setAchados((data as Produto[] | null) ?? []) })
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [busca, companyId])

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(null), 2500) }
  const addInsumo = async (p: Produto) => {
    const q = Number((qtd[p.id] ?? '1').replace(',', '.'))
    const { data, error } = await supabase.rpc('fn_odonto_ficha_insumo_salvar', { p_company_id: companyId, p_procedimento_id: proc.id, p_produto_id: p.id, p_quantidade: isFinite(q) && q > 0 ? q : 1 })
    if (error || (data as { ok?: boolean })?.ok === false) { flash('Falha ao adicionar.'); return }
    setBusca(''); setAchados([]); void carregar()
  }
  const remover = async (id: string) => {
    const { data, error } = await supabase.rpc('fn_odonto_ficha_insumo_remover', { p_company_id: companyId, p_id: id })
    if (error || (data as { ok?: boolean })?.ok === false) { flash('Falha ao remover.'); return }
    void carregar()
  }

  const custo = det?.custo_material ?? 0
  const margem = proc.valor - custo
  const pct = margemPct(proc.valor, custo)

  return (
    <ShellOdonto>
      <button onClick={onVoltar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: TOK.mut, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 8 }}><ChevronLeft size={16} /> voltar ao custeio</button>
      <PageHeaderOdonto icon={<Calculator size={20} />} titulo={proc.nome} subtitulo="Ficha técnica de material · preço vem do estoque (GE)" />

      {/* resumo custo/margem */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <CardOdonto style={{ padding: 12, flex: 1, minWidth: 120 }}><div style={{ fontSize: 11, color: TOK.mut }}>Preço (tabela)</div><div style={{ fontSize: 18, fontWeight: 700, color: TOK.esp }}>{brl(proc.valor)}</div></CardOdonto>
        <CardOdonto style={{ padding: 12, flex: 1, minWidth: 120 }}><div style={{ fontSize: 11, color: TOK.mut }}>Custo de material</div><div style={{ fontSize: 18, fontWeight: 700, color: TOK.esp }}>{brl(custo)}</div></CardOdonto>
        <CardOdonto style={{ padding: 12, flex: 1, minWidth: 120 }}><div style={{ fontSize: 11, color: TOK.mut }}>Margem sobre material</div><div style={{ fontSize: 18, fontWeight: 800, color: corMargem(proc.valor > 0 ? pct : null) }}>{proc.valor > 0 ? `${brl(margem)} · ${pct}%` : '—'}</div></CardOdonto>
      </div>

      {det?.incompleto && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#FBF0DF', border: `0.5px solid #B45309`, borderRadius: 10, padding: '9px 11px', marginBottom: 12 }}>
          <AlertTriangle size={16} style={{ color: '#B45309', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 11.5, color: '#7A5312' }}>Custo <strong>incompleto</strong>: há insumo sem preço de custo cadastrado no estoque. Cadastre o custo em <strong>Estoque (GE)</strong> para o valor ficar correto — não assumimos zero.</div>
        </div>
      )}

      {/* adicionar insumo */}
      <CardOdonto style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: TOK.esp, marginBottom: 6 }}>Adicionar insumo <span style={{ color: TOK.gold }}>[→GE]</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, border: `0.5px solid ${TOK.line}`, borderRadius: 8, padding: '7px 10px' }}>
          <Search size={15} style={{ color: TOK.mut }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar insumo no estoque (nome)…" style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, color: TOK.esp }} />
        </div>
        {achados.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {achados.map((p) => {
              const preco = precoDe(p)
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: `0.5px solid ${TOK.line}`, borderRadius: 8, padding: '7px 9px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: TOK.esp }} className="truncate">{p.nome}</div>
                    <div style={{ fontSize: 11, color: preco === null ? TOK.red : TOK.mut }}>{preco === null ? 'sem preço no estoque' : `${brl(preco)} / ${p.unidade || 'un'}`}</div>
                  </div>
                  <input value={qtd[p.id] ?? ''} onChange={(e) => setQtd((s) => ({ ...s, [p.id]: e.target.value }))} placeholder="qtd" inputMode="decimal"
                    style={{ width: 62, border: `0.5px solid ${TOK.line}`, borderRadius: 8, padding: '6px 8px', fontSize: 13, color: TOK.esp, textAlign: 'center' }} />
                  <button onClick={() => void addInsumo(p)} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: TOK.gold, color: '#fff', border: 'none', borderRadius: 999, padding: '6px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}><Plus size={13} /> Add</button>
                </div>
              )
            })}
          </div>
        )}
        {busca.trim().length >= 2 && achados.length === 0 && <div style={{ fontSize: 12, color: TOK.mut, marginTop: 8 }}>Nenhum insumo com esse nome no estoque. Cadastre em Estoque (GE).</div>}
      </CardOdonto>

      {/* itens da ficha */}
      {loading ? (
        <div style={{ fontSize: 13, color: TOK.mut }}>Carregando ficha…</div>
      ) : (det?.itens ?? []).length === 0 ? (
        <EmptyStateOdonto titulo="Ficha técnica vazia" linha="Adicione os insumos usados neste procedimento (com a quantidade) para calcular o custo de material." />
      ) : (
        <div style={{ border: `0.5px solid ${TOK.line}`, borderRadius: 12, overflow: 'hidden' }}>
          {(det?.itens ?? []).map((it, i) => (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderTop: i ? `0.5px solid ${TOK.line}` : 'none', background: '#fff' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: TOK.esp }} className="truncate">{it.nome}</div>
                <div style={{ fontSize: 11.5, color: it.sem_preco ? TOK.red : TOK.mut }}>
                  {it.quantidade} {it.unidade || 'un'} × {it.sem_preco ? 'sem preço' : brl(it.preco_unit ?? 0)}
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: it.sem_preco ? TOK.red : TOK.esp, minWidth: 78, textAlign: 'right' }}>{it.sem_preco ? '—' : brl(it.subtotal)}</div>
              <button onClick={() => void remover(it.id)} aria-label="Remover" style={{ background: 'none', border: 'none', cursor: 'pointer', color: TOK.mut, flexShrink: 0 }}><Trash2 size={15} /></button>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', borderTop: `1px solid ${TOK.line}`, background: TOK.bg }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: TOK.esp }}>Custo de material</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: TOK.gold }}>{brl(custo)}</span>
          </div>
        </div>
      )}
      {msg && <div style={{ fontSize: 12.5, color: TOK.mut, marginTop: 8 }}>{msg}</div>}
    </ShellOdonto>
  )
}
