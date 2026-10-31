'use client'

// Produtividade › Cadastro, no topo (Onda 2, CEO 07/10): PRODUTO ACABADO + ÁRVORE até a origem. Genérico — nada de código de
// produto/empresa aqui; a fonte de produção (ATAK etc.) é só uma origem possível da busca (fn_prod_produto_buscar).
// Cada nó: incluir origem, incluir saída (coproduto/subproduto), editar no lugar, arquivar (nunca apaga, RD-30).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { CelulaEditavel } from '@/components/produtividade/CelulaEditavel'

const ROTA = '/dashboard/produtividade'
const Aj = ({ k }: { k: string }) => <AjudaCampo chave={k} rota={ROTA} />
const C = { esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3', border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FAEEDA', red: '#B42318', redBg: '#FCEBEB', blue: '#2F5AA8' }
const inp: React.CSSProperties = { padding: '7px 9px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 7, background: C.white, color: C.esp, outline: 'none', minWidth: 0, width: '100%' }
const btn = (on = true): React.CSSProperties => ({ padding: '7px 12px', fontSize: 12.5, fontWeight: 700, borderRadius: 8, border: 'none', cursor: on ? 'pointer' : 'not-allowed', background: on ? C.gold : C.espL, color: C.white })
const btnL: React.CSSProperties = { ...btn(true), background: 'transparent', color: C.esp, border: `1px solid ${C.border}` }

export type FluxoOpt = { id: string; nome: string }
type Prod = { id: string; codigo: string; nome: string; papel?: string }
type Candidato = { origem: 'cadastro' | 'fonte'; id?: string; fonte_id?: string; codigo: string; nome: string }
type Linha = {
  id: string; origem_produto_id: string; produto_id: string; fluxo_id: string | null; tipo_saida: string
  rendimento_padrao_pct: number | null; fonte_padrao: string | null; status: string; vigencia_inicio: string | null; vigencia_fim: string | null
}
type No = Linha & { nivel: number; origem_codigo: string; origem_nome: string; produto_codigo: string; produto_nome: string; fluxo_nome: string | null }
type Arvore = { nos: No[]; avisos_soma: { origem_codigo: string; soma_pct: number }[] }

const ERROS: Record<string, string> = {
  ciclo_na_estrutura: 'Essa ligação formaria um ciclo (um produto gerando a si mesmo, direta ou indiretamente). Escolha outra origem ou saída.',
  rendimento_invalido: 'Rendimento: digite um número maior que 0 e até 100 (ex.: 12,5). Em branco = a definir; zero não vale.',
  ligacao_ja_existe: 'Essa ligação já existe (mesma origem, saída e etapa).',
  produto_obrigatorio: 'Escolha a origem e a saída.',
  produto_invalido: 'Produto fora desta planta — escolha um da lista.',
  codigo_ja_existe: 'Já existe um produto com esse código nesta planta.',
  codigo_invalido: 'Informe o código do produto.',
  nome_invalido: 'Informe o nome do produto.',
  fluxo_invalido: 'Etapa inválida — escolha um fluxo da lista.',
}
// as RPCs da Onda 2 levantam o código do erro na mensagem (RAISE EXCEPTION 'codigo')
const msgErro = (e?: string | null) => {
  const k = Object.keys(ERROS).find((c) => (e ?? '').includes(c))
  return k ? ERROS[k] : (e ? `Não consegui salvar: ${e}` : 'Não consegui salvar. Confira o valor e tente de novo.')
}
const fmtPct = (n: number | null) => (n == null ? 'a definir' : `${String(n).replace('.', ',')}%`)

// ───────── busca de produto (cadastro da planta + fonte ligada), com cadastro manual ─────────
function BuscaProduto({ companyId, plantId, testid, placeholder, onEscolher, papel, ajuda }: {
  companyId: string; plantId: string; testid: string; placeholder: string; papel: string; ajuda?: string
  onEscolher: (p: Prod) => void | Promise<void>
}) {
  const [q, setQ] = useState('')
  const [cands, setCands] = useState<Candidato[]>([])
  const [aviso, setAviso] = useState<string | null>(null)
  const [manual, setManual] = useState(false)
  const [man, setMan] = useState({ codigo: '', nome: '' })
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    const t = q.trim()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!t) { setCands([]); setAviso(null); return }
    const mine = ++seq.current
    const h = window.setTimeout(async () => {
      const { data } = await supabase.rpc('fn_prod_produto_buscar', { p_company_id: companyId, p_plant_id: plantId, p_q: t, p_limit: 15 })
      if (mine !== seq.current) return
      const r = data as { ok?: boolean; cadastro?: Prod[]; fonte?: { fonte_id: string; codigo: string; nome: string }[]; aviso?: string | null } | null
      if (!r?.ok) { setCands([]); return }
      setCands([
        ...(r.cadastro ?? []).map((p) => ({ origem: 'cadastro' as const, id: p.id, codigo: p.codigo, nome: p.nome })),
        ...(r.fonte ?? []).map((p) => ({ origem: 'fonte' as const, fonte_id: p.fonte_id, codigo: p.codigo, nome: p.nome })),
      ])
      setAviso(r.aviso ?? null)
    }, 250)
    return () => window.clearTimeout(h)
  }, [q, companyId, plantId])

  async function escolher(c: Candidato) {
    setBusy(true); setErro(null)
    let p: Prod = { id: c.id ?? '', codigo: c.codigo, nome: c.nome }
    if (c.origem === 'fonte') {
      const { data, error } = await supabase.rpc('fn_prod_produto_salvar', { p_company_id: companyId, p_plant_id: plantId, p_id: null, p_codigo: c.codigo, p_nome: c.nome, p_papel: papel, p_fonte_id: c.fonte_id, p_chave_externa: c.codigo })
      const r = data as { ok?: boolean; id?: string } | null
      if (error || !r?.ok || !r.id) { setBusy(false); setErro(msgErro(error?.message)); return }
      p = { id: r.id, codigo: c.codigo, nome: c.nome }
    }
    await onEscolher(p)
    setBusy(false); setQ(''); setCands([])
  }
  async function cadastrarManual() {
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_prod_produto_salvar', { p_company_id: companyId, p_plant_id: plantId, p_id: null, p_codigo: man.codigo, p_nome: man.nome, p_papel: papel })
    const r = data as { ok?: boolean; id?: string } | null
    if (error || !r?.ok || !r.id) { setBusy(false); setErro(msgErro(error?.message)); return }
    await onEscolher({ id: r.id, codigo: man.codigo.trim(), nome: man.nome.trim() })
    setBusy(false); setManual(false); setMan({ codigo: '', nome: '' }); setQ('')
  }
  return (
    <div style={{ position: 'relative' }}>
      <input data-testid={testid} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} disabled={busy} style={inp} aria-label={placeholder} />
      {ajuda && <span style={{ position: 'absolute', right: 6, top: 6 }}><Aj k={ajuda} /></span>}
      {(cands.length > 0 || q.trim()) && (
        <div data-testid={`${testid}-lista`} style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, marginTop: 4, maxHeight: 240, overflowY: 'auto' }}>
          {cands.map((c) => (
            <button key={`${c.origem}-${c.codigo}`} type="button" data-testid={`${testid}-op-${c.codigo}`} onClick={() => void escolher(c)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', fontSize: 13, background: 'none', border: 'none', borderBottom: `1px solid ${C.cream}`, cursor: 'pointer', color: C.esp }}>
              <b>{c.codigo}</b> · {c.nome} <span style={{ color: C.espL, fontSize: 11 }}>{c.origem === 'fonte' ? '(da fonte — será cadastrado)' : ''}</span>
            </button>
          ))}
          {cands.length === 0 && <div style={{ padding: '8px 10px', fontSize: 12.5, color: C.espM }}>Nada encontrado.</div>}
          {aviso && <div style={{ padding: '6px 10px', fontSize: 11.5, color: C.amber }}>{aviso}</div>}
          <button type="button" data-testid={`${testid}-manual`} onClick={() => { setManual(true); setMan({ codigo: /^\S{1,12}$/.test(q.trim()) ? q.trim() : '', nome: '' }) }}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', fontSize: 12.5, background: C.cream, border: 'none', cursor: 'pointer', color: C.blue, fontWeight: 700 }}>
            + Cadastrar um produto novo (manual)
          </button>
        </div>
      )}
      {manual && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, marginTop: 6, background: C.bg, display: 'grid', gap: 6 }}>
          <label style={{ fontSize: 12, color: C.espM }}>Código<Aj k="prod.produto.codigo" /><input data-testid={`${testid}-man-codigo`} value={man.codigo} onChange={(e) => setMan({ ...man, codigo: e.target.value })} style={inp} /></label>
          <label style={{ fontSize: 12, color: C.espM }}>Nome<Aj k="prod.produto.nome" /><input data-testid={`${testid}-man-nome`} value={man.nome} onChange={(e) => setMan({ ...man, nome: e.target.value })} style={inp} /></label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" data-testid={`${testid}-man-salvar`} disabled={busy} onClick={() => void cadastrarManual()} style={btn(!busy)}>Cadastrar e usar</button>
            <button type="button" onClick={() => { setManual(false); setErro(null) }} style={btnL}>Cancelar</button>
          </div>
        </div>
      )}
      {erro && <div data-testid={`${testid}-erro`} role="alert" style={{ background: C.redBg, color: C.red, padding: '5px 9px', borderRadius: 6, fontSize: 12, marginTop: 4 }}>{erro}</div>}
    </div>
  )
}

function Ligacao({ id, tipo, rend, status, fluxoId, testBase, fluxoOpts, salvar, onArquivar }: { id: string; tipo: string; rend: number | null; status: string; fluxoId: string | null; testBase: string; fluxoOpts: { value: string; label: string }[]; salvar: (patch: Record<string, unknown>) => Promise<string | null>; onArquivar: (id: string) => void }) {
  return (
    <span style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5, color: C.espM }}>
      <span>Etapa<Aj k="prod.estrutura.etapa" /> <CelulaEditavel testid={`${testBase}-etapa`} tipo="lista" valor={fluxoId ?? ''} opcoes={fluxoOpts} vazio="— sem etapa" rotuloValor={(v) => fluxoOpts.find((o) => o.value === v)?.label ?? '—'} onSalvar={(v) => salvar({ fluxo_id: v || null })} /></span>
      <span>Rendimento<Aj k="prod.estrutura.rendimento" /> <CelulaEditavel testid={`${testBase}-rend`} tipo="numero" valor={rend == null ? '' : String(rend).replace('.', ',')} vazio="a definir" rotuloValor={(v) => fmtPct(Number(v.replace(',', '.')))} onSalvar={(v) => salvar({ rendimento_padrao_pct: v })} /></span>
      <span>Saída<Aj k="prod.estrutura.tipo_saida" /> <CelulaEditavel testid={`${testBase}-tipo`} tipo="lista" obrigatorio valor={tipo} opcoes={[{ value: 'principal', label: 'principal' }, { value: 'coproduto', label: 'coproduto' }, { value: 'subproduto', label: 'subproduto' }]} onSalvar={(v) => salvar({ tipo_saida: v })} /></span>
      <span>Status<Aj k="prod.estrutura.status" /> <CelulaEditavel testid={`${testBase}-status`} tipo="lista" obrigatorio valor={status} opcoes={[{ value: 'rascunho', label: 'rascunho (a validar)' }, { value: 'validado', label: 'validado' }]} rotuloValor={(v) => (v === 'validado' ? 'validado' : 'rascunho')} onSalvar={(v) => salvar({ status: v })} /></span>
      <span>Arquivar<Aj k="prod.estrutura.arquivar" /> <button type="button" data-testid={`${testBase}-arquivar`} onClick={() => onArquivar(id)} title="Arquivar (nunca apaga)" style={{ ...btnL, padding: '2px 8px' }}>×</button></span>
    </span>
  )
}

// ───────── componente principal ─────────
export function ArvoreProduto({ companyId, plantId, fluxos, flash, flashErr, onMudou }: {
  companyId: string; plantId: string; fluxos: FluxoOpt[]; flash: (m: string) => void; flashErr: (m: string) => void; onMudou: () => void | Promise<void>
}) {
  const [acabado, setAcabado] = useState<Prod | null>(null)
  const [recentes, setRecentes] = useState<Prod[]>([])
  const [arv, setArv] = useState<Arvore | null>(null)
  const [irmas, setIrmas] = useState<Linha[]>([])
  const [prods, setProds] = useState<Record<string, Prod>>({})
  const [inclui, setInclui] = useState<{ tipo: 'origem' | 'saida'; produtoId: string; origemId?: string } | null>(null)
  const [mostrarArquivadas, setMostrarArquivadas] = useState(false)
  const [colar, setColar] = useState(false)

  const carregarRecentes = useCallback(async () => {
    const { data } = await supabase.from('prod_produto').select('id, codigo, nome, papel').eq('company_id', companyId).eq('plant_id', plantId).eq('papel', 'acabado').eq('ativo', true).order('codigo').limit(30)
    setRecentes((data as Prod[]) ?? [])
  }, [companyId, plantId])
  useEffect(() => { void carregarRecentes(); setAcabado(null); setArv(null) }, [carregarRecentes])

  const carregarArvore = useCallback(async () => {
    if (!acabado) { setArv(null); setIrmas([]); return }
    const { data, error } = await supabase.rpc('fn_prod_estrutura_listar', { p_company_id: companyId, p_plant_id: plantId, p_produto_id: acabado.id, p_incluir_arquivados: false })
    if (error) { flashErr(msgErro(error.message)); return }
    const a = data as { ok?: boolean; nos?: No[]; avisos_soma?: Arvore['avisos_soma'] } | null
    if (!a?.ok) { flashErr('Não consegui carregar a árvore.'); setArv(null); return }
    const nos = a.nos ?? []
    setArv({ nos, avisos_soma: a.avisos_soma ?? [] })
    // outras saídas das origens da árvore (coproduto/subproduto que não estão no caminho até o acabado)
    const origens = [...new Set(nos.map((n) => n.origem_produto_id))]
    if (origens.length === 0) { setIrmas([]); return }
    const { data: ir } = await supabase.from('prod_estrutura').select('id, origem_produto_id, produto_id, fluxo_id, tipo_saida, rendimento_padrao_pct, fonte_padrao, status, vigencia_inicio, vigencia_fim')
      .eq('company_id', companyId).eq('plant_id', plantId).eq('ativo', true).in('origem_produto_id', origens)
    const noIds = new Set(nos.map((n) => n.id))
    const extras = ((ir as Linha[]) ?? []).filter((x) => !noIds.has(x.id))
    setIrmas(extras)
    const ids = [...new Set(extras.map((x) => x.produto_id))]
    if (ids.length) {
      const { data: pp } = await supabase.from('prod_produto').select('id, codigo, nome').in('id', ids)
      setProds(Object.fromEntries(((pp as Prod[]) ?? []).map((p) => [p.id, p])))
    }
  }, [acabado, companyId, plantId, flashErr])
  useEffect(() => { void carregarArvore() }, [carregarArvore])

  async function escolherAcabado(p: Prod) {
    setAcabado(p); void carregarRecentes()
  }
  // fn_prod_estrutura_salvar regrava a linha inteira: o editor manda a linha atual + o campo alterado
  async function salvarEstrutura(l: Partial<Linha> & { origem_produto_id: string; produto_id: string }): Promise<string | null> {
    const { data, error } = await supabase.rpc('fn_prod_estrutura_salvar', {
      p_company_id: companyId, p_plant_id: plantId, p_id: l.id ?? null, p_origem_produto_id: l.origem_produto_id, p_produto_id: l.produto_id,
      p_fluxo_id: l.fluxo_id ?? null, p_tipo_saida: l.tipo_saida ?? 'principal', p_rendimento_pct: l.rendimento_padrao_pct ?? null, p_fonte_padrao: l.fonte_padrao ?? null,
      p_status: l.status ?? 'rascunho', p_vigencia_inicio: l.vigencia_inicio ?? null, p_vigencia_fim: l.vigencia_fim ?? null,
    })
    const r = data as { ok?: boolean; avisos?: { tipo: string; soma_pct: number }[] } | null
    if (error || !r?.ok) return msgErro(error?.message)
    const soma = r.avisos?.find((a) => a.tipo === 'soma_acima_100')
    if (soma) flashErr(`A soma dos rendimentos desta origem é ${String(soma.soma_pct).replace('.', ',')}% — passa de 100%. Confira os padrões.`)
    await carregarArvore(); await onMudou()
    return null
  }
  const editar = (l: Linha) => async (patch: Record<string, unknown>) => {
    const p = { ...l, ...patch } as Linha
    if ('rendimento_padrao_pct' in patch) {
      const t = String(patch.rendimento_padrao_pct ?? '').trim().replace(',', '.')
      if (t !== '' && (!Number.isFinite(Number(t)) || Number(t) <= 0 || Number(t) > 100)) return msgErro('rendimento_invalido')
      p.rendimento_padrao_pct = t === '' ? null : Number(t)
    }
    return salvarEstrutura(p)
  }
  async function arquivar(id: string, arquivar = true) {
    if (!window.confirm(arquivar ? 'Arquivar esta ligação? Nada é apagado — ela só sai da árvore.' : 'Reativar esta ligação?')) return
    const { data, error } = await supabase.rpc('fn_prod_estrutura_arquivar', { p_company_id: companyId, p_id: id, p_ativo: !arquivar })
    const r = data as { ok?: boolean } | null
    if (error || !r?.ok) { flashErr(msgErro(error?.message)); return }
    flash(arquivar ? 'ARQUIVOU a ligação.' : 'REATIVOU a ligação.'); await carregarArvore(); await onMudou()
  }

  const fluxoOpts = [{ value: '', label: '— sem etapa' }, ...fluxos.map((f) => ({ value: f.id, label: f.nome }))]
  const nosPorSaida = useMemo(() => {
    const m = new Map<string, No[]>()
    for (const n of arv?.nos ?? []) m.set(n.produto_id, [...(m.get(n.produto_id) ?? []), n])
    return m
  }, [arv])
  const irmasPorOrigem = useMemo(() => {
    const m = new Map<string, Linha[]>()
    for (const i of irmas) m.set(i.origem_produto_id, [...(m.get(i.origem_produto_id) ?? []), i])
    return m
  }, [irmas])

  function renderOrigens(produtoId: string, nivel: number): React.ReactNode {
    const lista = nosPorSaida.get(produtoId) ?? []
    return (
      <div style={{ marginLeft: nivel === 0 ? 0 : 14, borderLeft: nivel === 0 ? 'none' : `2px solid ${C.cream}`, paddingLeft: nivel === 0 ? 0 : 10 }}>
        {lista.map((n) => (
          <div key={n.id} data-testid={`no-${n.origem_codigo}`} style={{ margin: '8px 0', padding: '8px 10px', background: C.white, border: `1px solid ${C.border}`, borderRadius: 10 }}>
            <div style={{ fontSize: 13.5 }}>⬇ origem: <b>{n.origem_codigo}</b> · {n.origem_nome}
              <span style={{ marginLeft: 8, fontSize: 11.5, color: n.status === 'validado' ? C.green : C.amber }}>{n.status === 'validado' ? 'validado' : 'a validar'}</span></div>
            <Ligacao id={n.id} tipo={n.tipo_saida} rend={n.rendimento_padrao_pct} status={n.status} fluxoId={n.fluxo_id} testBase={`lig-${n.origem_codigo}`} fluxoOpts={fluxoOpts} salvar={editar(n)} onArquivar={(x) => void arquivar(x)} />
            <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <button type="button" data-testid={`add-origem-${n.origem_codigo}`} onClick={() => setInclui({ tipo: 'origem', produtoId: n.origem_produto_id })} style={{ ...btnL, padding: '3px 9px' }}>+ origem de {n.origem_codigo}</button>
              <button type="button" data-testid={`add-saida-${n.origem_codigo}`} onClick={() => setInclui({ tipo: 'saida', produtoId: n.origem_produto_id, origemId: n.origem_produto_id })} style={{ ...btnL, padding: '3px 9px' }}>+ saída (coproduto/subproduto)</button>
            </div>
            {inclui && inclui.produtoId === n.origem_produto_id && renderIncluir()}
            {(irmasPorOrigem.get(n.origem_produto_id) ?? []).map((i) => (
              <div key={i.id} data-testid={`irma-${prods[i.produto_id]?.codigo ?? i.produto_id}`} style={{ marginTop: 6, padding: '6px 8px', background: C.bg, borderRadius: 8, fontSize: 12.5 }}>
                também sai: <b>{prods[i.produto_id]?.codigo}</b> · {prods[i.produto_id]?.nome}
                <div><Ligacao id={i.id} tipo={i.tipo_saida} rend={i.rendimento_padrao_pct} status={i.status} fluxoId={i.fluxo_id} testBase={`irma-${prods[i.produto_id]?.codigo ?? i.id}`} fluxoOpts={fluxoOpts} salvar={editar(i)} onArquivar={(x) => void arquivar(x)} /></div>
              </div>
            ))}
            {renderOrigens(n.origem_produto_id, nivel + 1)}
          </div>
        ))}
      </div>
    )
  }

  function renderIncluir() {
    if (!inclui) return null
    const ehOrigem = inclui.tipo === 'origem'
    return (
      <div data-testid="incluir-ligacao" style={{ marginTop: 8, padding: 10, border: `1px dashed ${C.gold}`, borderRadius: 8, background: C.bg }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>{ehOrigem ? 'Incluir origem (de onde vem este produto)' : 'Incluir saída (coproduto/subproduto da mesma origem)'}</div>
        <BuscaProduto companyId={companyId} plantId={plantId} testid="inc-busca" placeholder={ehOrigem ? 'Origem: código ou nome' : 'Saída: código ou nome'}
          papel={ehOrigem ? 'origem' : 'subproduto'} ajuda={ehOrigem ? 'prod.estrutura.origem' : 'prod.estrutura.saida'}
          onEscolher={async (p) => {
            const e = await salvarEstrutura(ehOrigem
              ? { origem_produto_id: p.id, produto_id: inclui.produtoId }
              : { origem_produto_id: inclui.origemId!, produto_id: p.id, tipo_saida: 'subproduto' })
            if (e) { flashErr(e); return }
            flash(ehOrigem ? 'INCLUIU a origem (rascunho).' : 'INCLUIU a saída (rascunho).'); setInclui(null)
          }} />
        <button type="button" onClick={() => setInclui(null)} style={{ ...btnL, marginTop: 6 }}>Cancelar</button>
      </div>
    )
  }

  return (
    <section data-testid="arvore-produto" style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', margin: '10px 0 14px' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.espM, marginBottom: 4 }}>Produto acabado<Aj k="prod.produto.acabado" /></div>
      <BuscaProduto companyId={companyId} plantId={plantId} testid="acabado-busca" placeholder="Buscar produto acabado por código ou nome…" papel="acabado" onEscolher={escolherAcabado} />
      {recentes.length > 0 && !acabado && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {recentes.map((p) => <button key={p.id} type="button" data-testid={`acabado-${p.codigo}`} onClick={() => setAcabado(p)} style={{ ...btnL, padding: '4px 10px', fontWeight: 600 }}>{p.codigo} · {p.nome}</button>)}
        </div>
      )}
      {acabado && arv && (
        <div style={{ marginTop: 12 }}>
          <div data-testid="acabado-atual" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 15 }}>
            <b>🏁 {acabado.codigo} · {acabado.nome}</b>
            <button type="button" data-testid="add-origem-raiz" onClick={() => setInclui({ tipo: 'origem', produtoId: acabado.id })} style={{ ...btn(true), padding: '4px 10px' }}>+ incluir origem</button>
            <button type="button" data-testid="colar-lista" onClick={() => setColar(true)} style={{ ...btnL, padding: '4px 10px' }}>Colar lista<Aj k="prod.estrutura.colar" /></button>
            <button type="button" onClick={() => { setAcabado(null); setArv(null) }} style={{ ...btnL, padding: '4px 10px' }}>trocar</button>
          </div>
          {inclui && inclui.produtoId === acabado.id && renderIncluir()}
          {arv.avisos_soma.map((a) => <div key={a.origem_codigo} data-testid={`aviso-soma-${a.origem_codigo}`} style={{ background: C.amberBg, color: C.amber, padding: '5px 9px', borderRadius: 6, fontSize: 12.5, margin: '6px 0' }}>⚠ A soma dos rendimentos que saem de {a.origem_codigo} é {String(a.soma_pct).replace('.', ',')}% — passa de 100%.</div>)}
          {arv.nos.length === 0 && <div style={{ fontSize: 13, color: C.espM, margin: '8px 0' }}>Ainda sem origem. Inclua de onde vem este produto (ex.: a peça que é desmontada) ou cole uma lista.</div>}
          {renderOrigens(acabado.id, 0)}
          <div style={{ marginTop: 6 }}>
            <button type="button" onClick={() => setMostrarArquivadas((v) => !v)} style={{ background: 'none', border: 'none', color: C.espM, cursor: 'pointer', fontSize: 12 }}>{mostrarArquivadas ? '▲' : '▼'} ligações arquivadas</button>
            {mostrarArquivadas && <Arquivadas companyId={companyId} plantId={plantId} onReativar={(id) => arquivar(id, false)} />}
          </div>
        </div>
      )}
      {colar && <ColarLista companyId={companyId} plantId={plantId} onClose={() => setColar(false)} onGravou={async () => { await carregarArvore(); await onMudou() }} flash={flash} />}
    </section>
  )
}

function Arquivadas({ companyId, plantId, onReativar }: { companyId: string; plantId: string; onReativar: (id: string) => void }) {
  const [l, setL] = useState<{ id: string; o: string; p: string }[]>([])
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('prod_estrutura').select('id, origem:prod_produto!prod_estrutura_origem_produto_id_fkey(codigo), saida:prod_produto!prod_estrutura_produto_id_fkey(codigo)').eq('company_id', companyId).eq('plant_id', plantId).eq('ativo', false).limit(50)
      setL(((data as unknown as { id: string; origem: { codigo: string } | null; saida: { codigo: string } | null }[]) ?? []).map((x) => ({ id: x.id, o: x.origem?.codigo ?? '?', p: x.saida?.codigo ?? '?' })))
    })()
  }, [companyId, plantId])
  if (l.length === 0) return <div style={{ fontSize: 12, color: C.espL }}>Nenhuma arquivada.</div>
  return <div style={{ fontSize: 12.5 }}>{l.map((x) => <div key={x.id}>{x.o} → {x.p} <button type="button" onClick={() => onReativar(x.id)} style={{ ...btnL, padding: '1px 8px' }}>reativar</button></div>)}</div>
}

const EXEMPLO = '11;47;principal;12,5;Desossa de Bola'
type ResColar = { ok?: boolean; gravado: boolean; gravadas: number; validas: { linha: number; origem: string; produto: string; tipo_saida: string; rendimento_pct: number | null; etapa: string | null }[]; nao_casaram: { linha: number; texto: string; motivo: string }[] }
// motivos devolvidos pela RPC → frase que ensina (RD-77: avisa o que não casou)
function motivoLegivel(m: string): string {
  const [cod, resto] = [m.split(':')[0], m.includes(':') ? m.slice(m.indexOf(':') + 1).trim() : '']
  switch (cod) {
    case 'origem_nao_encontrada': return `a origem "${resto}" não está cadastrada`
    case 'produto_nao_encontrado': return `o produto "${resto}" não está cadastrado`
    case 'tipo_saida_invalido': return `tipo de saída "${resto}" inválido (principal, coproduto ou subproduto)`
    case 'rendimento_invalido': return `rendimento "${resto}" inválido (maior que 0 e até 100; em branco = a definir)`
    case 'etapa_nao_encontrada': return `a etapa "${resto}" não casou com nenhum fluxo`
    case 'ciclo_na_estrutura': return 'recusada: formaria ciclo'
    case 'ligacao_ja_existe': return 'já existe esta ligação'
    case 'linha_incompleta': return 'faltam colunas (mínimo: origem;produto)'
    default: return m
  }
}
function ColarLista({ companyId, plantId, onClose, onGravou, flash }: { companyId: string; plantId: string; onClose: () => void; onGravou: () => Promise<void>; flash: (m: string) => void }) {
  const [txt, setTxt] = useState('')
  const [prev, setPrev] = useState<ResColar | null>(null)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  async function rodar(gravar: boolean) {
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_prod_estrutura_colar', { p_company_id: companyId, p_plant_id: plantId, p_linhas: txt, p_gravar: gravar })
    setBusy(false)
    const r = data as ResColar | null
    if (error || !r?.ok) { setErro(error?.message?.includes('lista_vazia') ? 'Cole ao menos uma linha.' : msgErro(error?.message)); return }
    setPrev(r)
    if (gravar) { flash(`GRAVOU ${r.gravadas} ligação(ões) como rascunho${r.nao_casaram.length ? ` · ${r.nao_casaram.length} linha(s) ficaram de fora` : ''}.`); await onGravou() }
  }
  const podeGravar = !!prev && prev.validas.length > 0 && !prev.gravado
  return (
    <div role="dialog" aria-label="Colar lista" data-testid="colar-modal" style={{ position: 'fixed', inset: 0, background: '#0006', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: C.white, borderRadius: 12, padding: 16, width: 'min(680px, 100%)', maxHeight: '90vh', overflowY: 'auto' }}>
        <b>Colar lista de estrutura</b><Aj k="prod.estrutura.colar" />
        <p style={{ fontSize: 12.5, color: C.espM, margin: '4px 0 8px' }}>Uma ligação por linha: <code>origem;produto;tipo_saida;rendimento_pct;etapa</code> (códigos já cadastrados). Exemplo: <code>{EXEMPLO}</code>. Entra como rascunho.</p>
        <textarea data-testid="colar-texto" rows={7} value={txt} onChange={(e) => { setTxt(e.target.value); setPrev(null) }} style={{ ...inp, fontFamily: 'monospace' }} />
        <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
          <button type="button" data-testid="colar-previa" disabled={busy || !txt.trim()} onClick={() => void rodar(false)} style={btn(!busy && !!txt.trim())}>Prévia</button>
          <button type="button" data-testid="colar-gravar" disabled={busy || !podeGravar} onClick={() => void rodar(true)} style={btn(!busy && podeGravar)}>Gravar como rascunho</button>
          <button type="button" onClick={onClose} style={btnL}>Fechar</button>
        </div>
        {erro && <div role="alert" style={{ background: C.redBg, color: C.red, padding: '6px 10px', borderRadius: 6, fontSize: 12.5 }}>{erro}</div>}
        {prev && (
          <div data-testid="colar-resumo">
            <div style={{ fontSize: 13, margin: '4px 0' }}><b>{prev.validas.length}</b> válida(s) · <b style={{ color: prev.nao_casaram.length ? C.red : C.espM }}>{prev.nao_casaram.length}</b> com problema{prev.gravado ? ' (gravado)' : ''}</div>
            {prev.validas.map((l) => (
              <div key={`v${l.linha}`} data-testid={`colar-linha-${l.linha}`} style={{ fontSize: 12.5, padding: '3px 6px', borderRadius: 6, background: C.greenBg, color: C.green, marginBottom: 3 }}>
                linha {l.linha}: {l.origem} → {l.produto} ({l.tipo_saida}, {l.rendimento_pct == null ? 'rendimento a definir' : `${String(l.rendimento_pct).replace('.', ',')}%`}{l.etapa ? `, etapa ${l.etapa}` : ''}) — ok
              </div>
            ))}
            {prev.nao_casaram.map((l) => (
              <div key={`n${l.linha}`} data-testid={`colar-linha-${l.linha}`} style={{ fontSize: 12.5, padding: '3px 6px', borderRadius: 6, background: C.redBg, color: C.red, marginBottom: 3 }}>
                linha {l.linha}: <code>{l.texto}</code> — {motivoLegivel(l.motivo)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ArvoreProduto
