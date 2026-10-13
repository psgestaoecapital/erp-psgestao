'use client'
// SPEC Custeio · Custo REAL por procedimento. C1 (material) + C2 (custo fixo + MO via custo/hora × duração)
// = custo total → margem real → base do DRE. Preços/MO/folha vêm da GE (fonte única, RD-52); honesto se
// incompleto (RD-51). [→GE] a odonto só consome. #819.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ShellOdonto, PageHeaderOdonto, CardOdonto, EmptyStateOdonto, TOK } from '@/components/odonto/ui'
import { Calculator, Search, Plus, Trash2, ChevronLeft, AlertTriangle, Package, Clock, Settings2, ChevronDown } from 'lucide-react'

const brl = (n: number) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type ProcCusto = { id: string; nome: string; valor: number; duracao_min: number | null; custo_material: number; material_incompleto: boolean; custo_estrutura: number | null; custo_total: number; incompleto: boolean; n_insumos: number }
type Item = { id: string; produto_id: string; nome: string; unidade: string | null; quantidade: number; preco_unit: number | null; subtotal: number; sem_preco: boolean }
type Detalhe = { ok?: boolean; custo_material: number; incompleto: boolean; itens: Item[] }
type Total = { ok?: boolean; preco: number; duracao_min: number | null; custo_material: number; custo_estrutura: number | null; custo_hora: number | null; custo_total: number; margem: number; margem_pct: number | null; incompleto: boolean }
type CustoHora = { ok?: boolean; custo_hora: number | null; custo_fixo_mensal: number; mo_mensal: number; mo_fonte: string; competencia_folha: string | null; horas_produtivas_mes: number; usar_folha: boolean; mo_manual_mensal: number | null; configurado: boolean; incompleto: boolean }
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
    const { data } = await supabase.rpc('fn_odonto_procedimentos_custo_total', { p_company_id: cid })
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
        subtitulo="Custo real por procedimento: material + estrutura (fixo + MO) → margem real" />
      <div style={{ fontSize: 11.5, color: TOK.mut, marginBottom: 10 }}>
        <Package size={12} style={{ display: 'inline', verticalAlign: -1 }} /> Insumos/preços no <strong>Estoque</strong> e a MO na <strong>folha</strong> vivem na Gestão Empresarial <span style={{ color: TOK.gold, fontWeight: 700 }}>[→GE]</span>; o custo acompanha o que muda lá.
      </div>

      <CustoHoraConfig companyId={companyId} onMudou={() => void carregar(companyId)} />

      {loading ? (
        <CardOdonto><div style={{ fontSize: 13, color: TOK.mut }}>Carregando…</div></CardOdonto>
      ) : procs.length === 0 ? (
        <EmptyStateOdonto titulo="Sem procedimentos" linha="Cadastre procedimentos odontológicos para montar a ficha técnica e ver o custo." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {procs.map((p) => {
            const pct = margemPct(p.valor, p.custo_total)
            return (
              <CardOdonto key={p.id} style={{ padding: 14, cursor: 'pointer' }} className="hover:opacity-90">
                <button onClick={() => setSel(p)} style={{ all: 'unset', width: '100%', cursor: 'pointer', display: 'block' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 700, color: TOK.esp }}>{p.nome}</div>
                      <div style={{ fontSize: 11.5, color: TOK.mut }}>
                        mat {brl(p.custo_material)} + estrut {p.custo_estrutura === null ? '—' : brl(p.custo_estrutura)}{p.duracao_min ? ` (${p.duracao_min}min)` : ''}
                        {p.incompleto && <AlertTriangle size={11} style={{ color: '#B45309', display: 'inline', marginLeft: 4, verticalAlign: -1 }} />}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 10.5, color: TOK.mut }}>Preço</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: TOK.esp }}>{brl(p.valor)}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 10.5, color: TOK.mut }}>Custo total</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: TOK.esp }}>{brl(p.custo_total)}</div>
                      </div>
                      <div style={{ textAlign: 'right', minWidth: 96 }}>
                        <div style={{ fontSize: 10.5, color: TOK.mut }}>Margem real</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: corMargem(p.valor > 0 ? pct : null) }}>{p.valor > 0 ? `${brl(p.valor - p.custo_total)} · ${pct}%` : '—'}</div>
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

// Config de custo/hora (uma vez): custo fixo mensal + MO (folha ou manual) + horas produtivas → custo/hora.
function CustoHoraConfig({ companyId, onMudou }: { companyId: string; onMudou: () => void }) {
  const [ch, setCh] = useState<CustoHora | null>(null)
  const [aberto, setAberto] = useState(false)
  const [fixo, setFixo] = useState(''); const [horas, setHoras] = useState(''); const [usarFolha, setUsarFolha] = useState(true); const [moManual, setMoManual] = useState('')
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    const { data } = await supabase.rpc('fn_odonto_custo_hora', { p_company_id: companyId })
    const r = data as CustoHora | null
    if (r?.ok) { setCh(r); setFixo(String(r.custo_fixo_mensal || '')); setHoras(String(r.horas_produtivas_mes || '')); setUsarFolha(r.usar_folha); setMoManual(r.mo_manual_mensal != null ? String(r.mo_manual_mensal) : '') }
  }, [companyId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const num = (s: string) => { const n = Number(s.replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : 0 }
  const salvar = async () => {
    setSalvando(true)
    const { data, error } = await supabase.rpc('fn_odonto_custo_config_salvar', { p_company_id: companyId, p_custo_fixo: num(fixo), p_horas: num(horas), p_usar_folha: usarFolha, p_mo_manual: usarFolha ? null : num(moManual) })
    setSalvando(false)
    if (error || (data as { ok?: boolean })?.ok === false) return
    await carregar(); onMudou()
  }

  return (
    <CardOdonto style={{ padding: 12, marginBottom: 12, background: 'linear-gradient(180deg,#FFFDF8,#fff)', borderColor: TOK.gold }}>
      <button onClick={() => setAberto((v) => !v)} style={{ all: 'unset', cursor: 'pointer', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 800, color: TOK.gold }}><Clock size={15} /> Custo/hora da clínica{ch?.custo_hora != null ? `: ${brl(ch.custo_hora)}/h` : ' — configure'}</span>
        <ChevronDown size={16} style={{ color: TOK.mut, transform: aberto ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
      </button>
      {!aberto && ch?.custo_hora == null && (
        <div style={{ fontSize: 11.5, color: '#B45309', marginTop: 6 }}>Sem custo/hora ainda — o custo total fica só com o material. Toque para configurar.</div>
      )}
      {aberto && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 8 }}>
            <label><span style={{ fontSize: 11, color: TOK.mut, display: 'block', marginBottom: 3 }}>Custo fixo mensal (R$)</span>
              <input value={fixo} onChange={(e) => setFixo(e.target.value)} inputMode="decimal" placeholder="aluguel, luz, software…" style={inpCh} /></label>
            <label><span style={{ fontSize: 11, color: TOK.mut, display: 'block', marginBottom: 3 }}>Horas produtivas/mês</span>
              <input value={horas} onChange={(e) => setHoras(e.target.value)} inputMode="decimal" placeholder="cadeiras × horas × dias" style={inpCh} /></label>
            {!usarFolha && (
              <label><span style={{ fontSize: 11, color: TOK.mut, display: 'block', marginBottom: 3 }}>MO mensal (R$)</span>
                <input value={moManual} onChange={(e) => setMoManual(e.target.value)} inputMode="decimal" style={inpCh} /></label>
            )}
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: TOK.esp, cursor: 'pointer' }}>
            <input type="checkbox" checked={usarFolha} onChange={(e) => setUsarFolha(e.target.checked)} style={{ accentColor: TOK.gold }} />
            Puxar a <strong>MO da folha</strong> <span style={{ color: TOK.gold }}>[→GE]</span>{ch && usarFolha ? ` — ${brl(ch.mo_mensal)}${ch.competencia_folha ? ` (${ch.competencia_folha})` : ' (sem folha ainda)'}` : ''}
          </label>
          <div style={{ fontSize: 11.5, color: TOK.mut }}>
            {ch?.custo_hora != null
              ? <>Custo/hora = ({brl(ch.custo_fixo_mensal)} fixo + {brl(ch.mo_mensal)} MO) ÷ {ch.horas_produtivas_mes}h = <strong style={{ color: TOK.esp }}>{brl(ch.custo_hora)}/h</strong></>
              : 'Informe custo fixo (ou MO) e horas produtivas para calcular o custo/hora.'}
          </div>
          <div><button onClick={() => void salvar()} disabled={salvando} style={{ background: TOK.gold, color: '#fff', border: 'none', borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: salvando ? 'not-allowed' : 'pointer' }}><Settings2 size={14} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />{salvando ? 'Salvando…' : 'Salvar custo/hora'}</button></div>
        </div>
      )}
    </CardOdonto>
  )
}
const inpCh: React.CSSProperties = { width: '100%', border: `0.5px solid ${TOK.line}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, color: TOK.esp, boxSizing: 'border-box' }

function FichaTecnica({ companyId, proc, onVoltar }: { companyId: string; proc: ProcCusto; onVoltar: () => void }) {
  const [det, setDet] = useState<Detalhe | null>(null)
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [achados, setAchados] = useState<Produto[]>([])
  const [qtd, setQtd] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [tot, setTot] = useState<Total | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    const [{ data: d }, { data: t }] = await Promise.all([
      supabase.rpc('fn_odonto_procedimento_custo_material', { p_procedimento_id: proc.id }),
      supabase.rpc('fn_odonto_procedimento_custo_total', { p_procedimento_id: proc.id }),
    ])
    setDet(d as Detalhe | null); setTot(t as Total | null)
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
  const estrutura = tot?.custo_estrutura ?? null
  const total = tot?.custo_total ?? custo
  const pct = margemPct(proc.valor, total)

  return (
    <ShellOdonto>
      <button onClick={onVoltar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: TOK.mut, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 8 }}><ChevronLeft size={16} /> voltar ao custeio</button>
      <PageHeaderOdonto icon={<Calculator size={20} />} titulo={proc.nome} subtitulo="Custo real: material + estrutura (fixo + MO) · fontes na GE" />

      {/* resumo: 3 parcelas + margem real */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <CardOdonto style={{ padding: 11, flex: 1, minWidth: 108 }}><div style={{ fontSize: 10.5, color: TOK.mut }}>Preço</div><div style={{ fontSize: 17, fontWeight: 700, color: TOK.esp }}>{brl(proc.valor)}</div></CardOdonto>
        <CardOdonto style={{ padding: 11, flex: 1, minWidth: 108 }}><div style={{ fontSize: 10.5, color: TOK.mut }}>Material</div><div style={{ fontSize: 17, fontWeight: 700, color: TOK.esp }}>{brl(custo)}</div></CardOdonto>
        <CardOdonto style={{ padding: 11, flex: 1, minWidth: 108 }}><div style={{ fontSize: 10.5, color: TOK.mut }}>Estrutura {proc.duracao_min ? `(${proc.duracao_min}min)` : ''}</div><div style={{ fontSize: 17, fontWeight: 700, color: TOK.esp }}>{estrutura === null ? '—' : brl(estrutura)}</div></CardOdonto>
        <CardOdonto style={{ padding: 11, flex: 1, minWidth: 108, borderColor: TOK.gold }}><div style={{ fontSize: 10.5, color: TOK.mut }}>Custo total</div><div style={{ fontSize: 17, fontWeight: 800, color: TOK.gold }}>{brl(total)}</div></CardOdonto>
        <CardOdonto style={{ padding: 11, flex: 1, minWidth: 120 }}><div style={{ fontSize: 10.5, color: TOK.mut }}>Margem real</div><div style={{ fontSize: 17, fontWeight: 800, color: corMargem(proc.valor > 0 ? pct : null) }}>{proc.valor > 0 ? `${brl(proc.valor - total)} · ${pct}%` : '—'}</div></CardOdonto>
      </div>
      {estrutura === null && (
        <div style={{ fontSize: 11.5, color: '#B45309', marginBottom: 12, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> Estrutura não entra ainda: falta o custo/hora configurado ou a duração do procedimento. O total mostra só o material.
        </div>
      )}

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
