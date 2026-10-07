'use client'

// Produtividade › Cadastro (Onda 2): PRODUTO ACABADO no topo + ÁRVORE até a origem (desmontagem). GENÉRICO: nada de código de
// produto/empresa aqui — o catálogo é prod_produto (cadastro manual ou vindo de uma fonte de produção ligada, via adaptador).
// Tudo grava pelas RPCs fn_prod_produto_* / fn_prod_estrutura_* (guarda de empresa). Arquivar, nunca apagar (RD-30).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { CelulaEditavel } from '@/components/produtividade/CelulaEditavel'

const ROTA = '/dashboard/produtividade'
const Aj = ({ k }: { k: string }) => <AjudaCampo chave={k} rota={ROTA} />
const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3', border: '#E0D8CC',
  gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FAEEDA', red: '#B42318', redBg: '#FCEBEB', blue: '#2F5AA8',
}
const inp: React.CSSProperties = { padding: '7px 9px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 7, background: C.white, color: C.esp, outline: 'none', minWidth: 0, width: '100%' }
const btn = (on = true): React.CSSProperties => ({ padding: '8px 14px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', cursor: on ? 'pointer' : 'not-allowed', background: on ? C.gold : C.espL, color: C.white })
const btnLeve: React.CSSProperties = { background: 'transparent', color: C.esp, border: `1px solid ${C.border}`, borderRadius: 7, padding: '3px 9px', fontSize: 11.5, cursor: 'pointer' }

export type Produto = { id: string; codigo: string; nome: string; unidade_id: string | null; unidade: string | null; papel: string; fonte_id: string | null; chave_externa: string | null; ativo: boolean }
export type Ligacao = {
  id: string; nivel?: number; origem_produto_id: string; origem_codigo: string; origem_nome: string; produto_id: string; produto_codigo: string; produto_nome: string
  fluxo_id: string | null; fluxo_nome: string | null; tipo_saida: string; rendimento_padrao_pct: number | null; fonte_padrao: string | null; status: string
  vigencia_inicio: string | null; vigencia_fim: string | null; ativo: boolean
}
type Fonte = { id: string; nome: string; tipo: string }
type Opt = { id: string; nome: string; codigo?: string }
type FluxoLite = { id: string; nome: string }
type ItemFonte = { descricao: string }
type Ctx = { companyId: string; plantId: string; flash: (m: string) => void; flashErr: (m: string) => void }

const PAPEIS = [{ value: 'acabado', label: 'acabado' }, { value: 'intermediario', label: 'intermediário' }, { value: 'origem', label: 'origem' }, { value: 'subproduto', label: 'subproduto' }]
const TIPOS = [{ value: 'principal', label: 'principal' }, { value: 'coproduto', label: 'coproduto' }, { value: 'subproduto', label: 'subproduto' }]
const STATUS = [{ value: 'rascunho', label: 'rascunho (a validar)' }, { value: 'validado', label: 'validado' }]

// Erros das RPCs (RAISE EXCEPTION) → frase que ensina.
export function erroRpc(msg: string): string {
  const m = msg || ''
  if (m.includes('ciclo_na_estrutura')) return 'Isso criaria um ciclo (o produto passaria a ser origem de si mesmo, direta ou indiretamente). Escolha outra origem.'
  if (m.includes('ligacao_ja_existe')) return 'Essa ligação (origem → produto, na mesma etapa) já existe.'
  if (m.includes('codigo_ja_existe')) return 'Já existe um produto com esse código nesta planta.'
  if (m.includes('rendimento_invalido')) return 'Rendimento: digite um número maior que 0 e até 100 — ou deixe em branco (a definir). Zero não vale.'
  if (m.includes('codigo_invalido')) return 'O código é obrigatório.'
  if (m.includes('nome_invalido')) return 'O nome é obrigatório.'
  if (m.includes('produto_obrigatorio')) return 'Escolha o produto.'
  if (m.includes('vigencia_invalida')) return 'A vigência termina antes de começar.'
  if (m.includes('sem_acesso') || m.includes('acesso')) return 'Sem acesso a esta empresa/planta.'
  return `Não consegui salvar: ${m}`
}

async function rpc<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<{ r: T | null; erro: string | null }> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) return { r: null, erro: erroRpc(error.message) }
  return { r: data as T, erro: null }
}

// ── adaptadores de fonte de produção (cadastro: prod_fonte_dados). Cada empresa liga o que tem; aqui só o "como listar produtos". ──
const ADAPTADORES: Record<string, (c: { companyId: string; plantId: string }) => Promise<ItemFonte[]>> = {
  atak: async ({ companyId, plantId }) => {
    const { data: d } = await supabase.rpc('fn_prod_atak_produtos', { p_company_id: companyId, p_plant_id: plantId, p_dominio: null, p_limit: null })
    const doms = ((d as { dominios?: { dominio: string }[] } | null)?.dominios ?? []).slice(0, 12)
    const todos = await Promise.all(doms.map((x) => supabase.rpc('fn_prod_atak_produtos', { p_company_id: companyId, p_plant_id: plantId, p_dominio: x.dominio, p_limit: 400 })))
    const set = new Set<string>()
    for (const t of todos) for (const it of ((t.data as { itens?: ItemFonte[] } | null)?.itens ?? [])) set.add(it.descricao)
    return [...set].map((descricao) => ({ descricao }))
  },
}
const sugerirCodigo = (descricao: string) => descricao.match(/\b\d{1,6}\b/)?.[0] ?? ''

// ── dados da planta ──
export function useProdutos(ctx: { companyId: string; plantId: string }) {
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [fontes, setFontes] = useState<Fonte[]>([])
  const [unidades, setUnidades] = useState<Opt[]>([])
  const carregar = useCallback(async () => {
    const [{ r }, f, u] = await Promise.all([
      rpc<{ ok?: boolean; itens?: Produto[] }>('fn_prod_produto_listar', { p_company_id: ctx.companyId, p_plant_id: ctx.plantId, p_busca: null, p_papel: null, p_incluir_arquivados: false }),
      supabase.from('prod_fonte_dados').select('id, nome, tipo').eq('company_id', ctx.companyId).eq('plant_id', ctx.plantId),
      supabase.from('prod_unidade_medida').select('id, codigo, nome').eq('company_id', ctx.companyId).eq('plant_id', ctx.plantId).order('codigo'),
    ])
    setProdutos(r?.ok ? (r.itens ?? []) : [])
    setFontes((f.data as Fonte[]) ?? [])
    setUnidades((u.data as Opt[]) ?? [])
  }, [ctx.companyId, ctx.plantId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])
  return { produtos, fontes, unidades, carregar }
}

// ── prontidão POR FLUXO (RD-58): o "Pronto para medir" só fica verde com origem, saídas, postos com turno, ponto e produção ligados. ──
export type ItemProntidao = { ok: boolean; texto: string; ir?: 'origem' | 'saidas' | 'turno' | 'novo' | null }
export function useProntidaoFluxo(ctx: { companyId: string; plantId: string } | null, fluxoId: string | null, postosComTurno: number, vinculoPonto: number, producao: number, versao: number) {
  const [origem, setOrigem] = useState<string | null>(null)
  const [saidas, setSaidas] = useState<number | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!ctx || !fluxoId) { setOrigem(null); setSaidas(null); return }
    void (async () => {
      const a = await supabase.from('prod_fluxo').select('produto_origem_id').eq('id', fluxoId).maybeSingle()
      setOrigem(a.error ? null : ((a.data as { produto_origem_id: string | null } | null)?.produto_origem_id ?? null))
      const b = await supabase.from('prod_estrutura').select('id', { count: 'exact', head: true }).eq('company_id', ctx.companyId).eq('fluxo_id', fluxoId).eq('ativo', true)
      setSaidas(b.error ? 0 : (b.count ?? 0))
    })()
  }, [ctx, fluxoId, versao])
  const itens: ItemProntidao[] = [
    { ok: !!origem, texto: 'o fluxo não tem produto de origem (a entrada da etapa)', ir: 'origem' },
    { ok: (saidas ?? 0) > 0, texto: 'nenhuma saída cadastrada para esta etapa (produtos que ela gera)', ir: 'saidas' },
    { ok: postosComTurno > 0, texto: 'nenhum posto deste fluxo tem turno e horário', ir: 'turno' },
    { ok: vinculoPonto > 0, texto: 'o setor do fluxo não está ligado a uma fonte de ponto', ir: null },
    { ok: producao > 0, texto: 'o setor do fluxo não está ligado a uma fonte de produção', ir: null },
  ]
  return { itens, falta: itens.filter((i) => !i.ok), pronto: !!fluxoId && itens.every((i) => i.ok), origem }
}

// ─────────── bloco principal ───────────
export function ProdutoEstrutura({ ctx, fluxos, fluxoId, origemId, onMudou }: { ctx: Ctx; fluxos: FluxoLite[]; fluxoId: string | null; origemId: string | null; onMudou: () => void }) {
  const { produtos, fontes, unidades, carregar: recarregarProdutos } = useProdutos(ctx)
  const [acabadoId, setAcabadoId] = useState<string | null>(null)
  const [ligs, setLigs] = useState<Ligacao[]>([])
  const [irmaos, setIrmaos] = useState<Ligacao[]>([])
  const [avisos, setAvisos] = useState<{ origem_codigo: string; soma_pct: number }[]>([])
  const [mostrarArq, setMostrarArq] = useState(false)
  const [novoAcabado, setNovoAcabado] = useState(false)
  const [add, setAdd] = useState<{ modo: 'origem' | 'saida'; produto: Produto } | null>(null)
  const [colar, setColar] = useState(false)

  const porId = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos])
  const acabado = acabadoId ? porId.get(acabadoId) ?? null : null

  const carregarArvore = useCallback(async () => {
    if (!acabadoId) { setLigs([]); setIrmaos([]); setAvisos([]); return }
    const { r, erro } = await rpc<{ ok?: boolean; nos?: Ligacao[]; avisos_soma?: { origem_codigo: string; soma_pct: number }[] }>('fn_prod_estrutura_listar',
      { p_company_id: ctx.companyId, p_plant_id: ctx.plantId, p_produto_id: acabadoId, p_incluir_arquivados: mostrarArq })
    if (erro) { ctx.flashErr(erro); return }
    const nos = r?.ok ? (r.nos ?? []) : []
    setLigs(nos); setAvisos(r?.avisos_soma ?? [])
    // outras saídas das mesmas origens (coprodutos/subprodutos irmãos do caminho)
    const origens = [...new Set(nos.map((n) => n.origem_produto_id))]
    if (origens.length === 0) { setIrmaos([]); return }
    let q = supabase.from('prod_estrutura').select('id, origem_produto_id, produto_id, fluxo_id, tipo_saida, rendimento_padrao_pct, fonte_padrao, status, vigencia_inicio, vigencia_fim, ativo')
      .eq('company_id', ctx.companyId).eq('plant_id', ctx.plantId).in('origem_produto_id', origens)
    if (!mostrarArq) q = q.eq('ativo', true)
    const { data } = await q
    const idsNos = new Set(nos.map((n) => n.id))
    setIrmaos(((data as Ligacao[]) ?? []).filter((x) => !idsNos.has(x.id)))
  }, [acabadoId, mostrarArq, ctx])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregarArvore() }, [carregarArvore])

  const mudou = useCallback(async () => { await Promise.all([carregarArvore(), recarregarProdutos()]); onMudou() }, [carregarArvore, recarregarProdutos, onMudou])
  const nome = (id: string) => { const p = porId.get(id); return p ? `${p.codigo} · ${p.nome}` : '—' }

  return (
    <section data-testid="produto-estrutura" style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', margin: '12px 0' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 14 }}>Produto acabado<Aj k="prod.produto.acabado" /></b>
        <BuscaAcabado ctx={ctx} produtos={produtos} fontes={fontes} unidades={unidades} escolhido={acabado} onEscolher={(id) => { setAcabadoId(id); void recarregarProdutos() }} onNovoManual={() => setNovoAcabado(true)} />
        <button data-testid="colar-lista" onClick={() => setColar(true)} style={btnLeve}>Colar lista<Aj k="prod.estrutura.colar" /></button>
        <label style={{ fontSize: 12, color: C.espM }}><input type="checkbox" checked={mostrarArq} onChange={(e) => setMostrarArq(e.target.checked)} /> mostrar arquivados</label>
      </div>

      {fluxoId && (
        <div style={{ fontSize: 12.5, color: C.espM, marginTop: 8 }}>
          Produto de origem do fluxo (o que entra na etapa)<Aj k="prod.fluxo.origem" />{' '}
          <b style={{ color: C.esp }}><OrigemDoFluxo fluxoId={fluxoId} valor={origemId ?? ''} produtos={produtos} onSalvar={async (id) => {
            const { error } = await supabase.from('prod_fluxo').update({ produto_origem_id: id, updated_at: new Date().toISOString() }).eq('id', fluxoId)
            if (error) return `Não consegui salvar: ${error.message}`
            ctx.flash('ALTEROU o produto de origem do fluxo.'); onMudou(); return null
          }} /></b>
        </div>
      )}

      {!acabado ? (
        <p style={{ fontSize: 13, color: C.espM, margin: '10px 0 2px' }}>Escolha (ou cadastre) o produto que gera faturamento. A árvore desce dele até o produto de origem, etapa por etapa.</p>
      ) : (
        <div data-testid="arvore" style={{ marginTop: 10 }}>
          {avisos.map((a) => <div key={a.origem_codigo} role="status" style={{ background: C.amberBg, color: '#8A4B08', borderRadius: 8, padding: '6px 10px', fontSize: 12.5, marginBottom: 6 }}>Atenção: as saídas de {a.origem_codigo} somam {Number(a.soma_pct).toLocaleString('pt-BR')}% (mais de 100%). Confira os rendimentos.</div>)}
          <No ctx={ctx} produto={acabado} ligs={ligs} irmaos={irmaos} porId={porId} fluxos={fluxos} caminho={[acabado.id]} raiz onAdd={setAdd} onMudou={mudou} />
        </div>
      )}

      {novoAcabado && <ModalProduto ctx={ctx} unidades={unidades} fontes={fontes} papelInicial="acabado" onClose={() => setNovoAcabado(false)} onSalvo={(id) => { setNovoAcabado(false); setAcabadoId(id); void recarregarProdutos() }} />}
      {add && <ModalLigacao ctx={ctx} {...add} produtos={produtos} unidades={unidades} fontes={fontes} fluxos={fluxos} nome={nome} recarregar={recarregarProdutos} onClose={() => setAdd(null)} onSalvo={async () => { setAdd(null); await mudou() }} />}
      {colar && <ModalColar ctx={ctx} onClose={() => setColar(false)} onGravou={async () => { await mudou() }} />}
    </section>
  )
}

// Busca do acabado: primeiro no catálogo (prod_produto); com fonte de produção ligada, também nela (adaptador) — ao escolher cria o prod_produto.
function BuscaAcabado({ ctx, produtos, fontes, unidades, escolhido, onEscolher, onNovoManual }: {
  ctx: Ctx; produtos: Produto[]; fontes: Fonte[]; unidades: Opt[]; escolhido: Produto | null; onEscolher: (id: string) => void; onNovoManual: () => void
}) {
  const [q, setQ] = useState('')
  const [aberto, setAberto] = useState(false)
  const [daFonte, setDaFonte] = useState<ItemFonte[] | null>(null)
  const [paraCriar, setParaCriar] = useState<{ item: ItemFonte; fonte: Fonte } | null>(null)
  const fonteProd = fontes.find((f) => f.tipo === 'producao' && ADAPTADORES[f.nome.toLowerCase()]) ?? null
  const t = q.trim().toLowerCase()
  const locais = t ? produtos.filter((p) => p.codigo.toLowerCase().includes(t) || p.nome.toLowerCase().includes(t)).slice(0, 12) : produtos.filter((p) => p.papel === 'acabado').slice(0, 12)
  useEffect(() => {
    if (!aberto || !fonteProd || daFonte) return
    void ADAPTADORES[fonteProd.nome.toLowerCase()]({ companyId: ctx.companyId, plantId: ctx.plantId }).then(setDaFonte).catch(() => setDaFonte([]))
  }, [aberto, fonteProd, daFonte, ctx.companyId, ctx.plantId])
  const jaNoCatalogo = new Set(produtos.map((p) => (p.chave_externa ?? '').toLowerCase()))
  const externos = t && daFonte ? daFonte.filter((i) => i.descricao.toLowerCase().includes(t) && !jaNoCatalogo.has(i.descricao.toLowerCase())).slice(0, 12) : []
  return (
    <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 220 }}>
      <input data-testid="acabado-busca" style={inp} placeholder={escolhido ? `${escolhido.codigo} · ${escolhido.nome}` : 'buscar por código ou nome…'} value={q}
        onFocus={() => setAberto(true)} onChange={(e) => { setQ(e.target.value); setAberto(true) }} />
      {aberto && (
        <div data-testid="acabado-opcoes" style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, maxHeight: 280, overflowY: 'auto', boxShadow: '0 6px 18px #0002' }}>
          {locais.map((p) => <button key={p.id} type="button" data-testid="acabado-opcao" onClick={() => { onEscolher(p.id); setQ(''); setAberto(false) }} style={opcaoSt}>{p.codigo} · {p.nome} <small style={{ color: C.espL }}>({p.papel})</small></button>)}
          {externos.map((i) => <button key={i.descricao} type="button" data-testid="acabado-opcao-fonte" onClick={() => { setParaCriar({ item: i, fonte: fonteProd! }); setAberto(false) }} style={opcaoSt}>{i.descricao} <small style={{ color: C.blue }}>(da fonte {fonteProd!.nome})</small></button>)}
          {t && locais.length === 0 && externos.length === 0 && <div style={{ padding: '8px 10px', fontSize: 12.5, color: C.espM }}>Nada encontrado{fonteProd && !daFonte ? ' (buscando na fonte…)' : ''}.</div>}
          <button type="button" data-testid="acabado-novo" onClick={() => { setAberto(false); onNovoManual() }} style={{ ...opcaoSt, color: C.blue, borderTop: `1px solid ${C.border}` }}>+ Cadastrar produto acabado manualmente</button>
          <button type="button" onClick={() => setAberto(false)} style={{ ...opcaoSt, color: C.espL, fontSize: 11.5 }}>fechar</button>
        </div>
      )}
      {paraCriar && <ModalProduto ctx={ctx} unidades={unidades} fontes={fontes} papelInicial="acabado" nomeInicial={paraCriar.item.descricao} codigoInicial={sugerirCodigo(paraCriar.item.descricao)} fonteId={paraCriar.fonte.id} chaveExterna={paraCriar.item.descricao}
        onClose={() => setParaCriar(null)} onSalvo={(id) => { setParaCriar(null); setQ(''); onEscolher(id) }} />}
    </div>
  )
}
const opcaoSt: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', fontSize: 13, border: 'none', background: 'transparent', cursor: 'pointer', color: C.esp }

// Um nó = um produto. Filhos = suas ORIGENS (ligações em que ele é a saída). Em cada origem aparecem também as outras saídas dela.
function No({ ctx, produto, ligs, irmaos, porId, fluxos, caminho, raiz, ligacao, onAdd, onMudou }: {
  ctx: Ctx; produto: Produto; ligs: Ligacao[]; irmaos: Ligacao[]; porId: Map<string, Produto>; fluxos: FluxoLite[]; caminho: string[]; raiz?: boolean
  ligacao?: Ligacao; onAdd: (a: { modo: 'origem' | 'saida'; produto: Produto }) => void; onMudou: () => Promise<void>
}) {
  const filhas = ligs.filter((l) => l.produto_id === produto.id && !caminho.slice(0, -1).includes(l.origem_produto_id))
  const outrasSaidas = irmaos.filter((l) => l.origem_produto_id === produto.id && !caminho.includes(l.produto_id))
  return (
    <div style={{ marginLeft: raiz ? 0 : 14, borderLeft: raiz ? 'none' : `2px solid ${C.border}`, paddingLeft: raiz ? 0 : 10, marginTop: 6 }}>
      <div data-testid="no-arvore" data-codigo={produto.codigo} style={{ background: ligacao && !ligacao.ativo ? C.cream : C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 10px', opacity: ligacao && !ligacao.ativo ? 0.6 : 1 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <b style={{ fontSize: 13.5 }}>{produto.codigo} · {produto.nome}</b>
          <small style={{ color: C.espL }}>{raiz ? 'acabado' : produto.papel}</small>
          {ligacao && <Atributos ctx={ctx} lig={ligacao} fluxos={fluxos} onMudou={onMudou} />}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <button data-testid="incluir-origem" onClick={() => onAdd({ modo: 'origem', produto })} style={btnLeve}>+ origem</button>
          <button data-testid="incluir-saida" onClick={() => onAdd({ modo: 'saida', produto })} style={btnLeve}>+ saída (coproduto/subproduto)</button>
          {ligacao && <button data-testid="arquivar-no" onClick={async () => {
            const { erro } = await rpc('fn_prod_estrutura_arquivar', { p_company_id: ctx.companyId, p_id: ligacao.id, p_ativo: !ligacao.ativo })
            if (erro) { ctx.flashErr(erro); return }
            ctx.flash(ligacao.ativo ? 'ARQUIVOU a ligação (nada foi apagado).' : 'REATIVOU a ligação.'); await onMudou()
          }} style={btnLeve}>{ligacao.ativo ? 'arquivar' : 'reativar'}</button>}
        </div>
      </div>
      {filhas.map((l) => {
        const o = porId.get(l.origem_produto_id)
        if (!o) return null
        return <No key={l.id} ctx={ctx} produto={o} ligs={ligs} irmaos={irmaos} porId={porId} fluxos={fluxos} caminho={[...caminho, o.id]} ligacao={l} onAdd={onAdd} onMudou={onMudou} />
      })}
      {outrasSaidas.length > 0 && (
        <div style={{ marginLeft: 14, marginTop: 4 }}>
          <small style={{ color: C.espM }}>{produto.codigo} também gera:</small>
          {outrasSaidas.map((l) => {
            const s = porId.get(l.produto_id)
            return (
              <div key={l.id} data-testid="saida-irma" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5, padding: '2px 0', opacity: l.ativo ? 1 : 0.6 }}>
                <span>↳ {s ? `${s.codigo} · ${s.nome}` : '—'}</span>
                <Atributos ctx={ctx} lig={l} fluxos={fluxos} onMudou={onMudou} />
                <button onClick={async () => {
                  const { erro } = await rpc('fn_prod_estrutura_arquivar', { p_company_id: ctx.companyId, p_id: l.id, p_ativo: !l.ativo })
                  if (erro) { ctx.flashErr(erro); return }
                  ctx.flash(l.ativo ? 'ARQUIVOU a saída (nada foi apagado).' : 'REATIVOU a saída.'); await onMudou()
                }} style={btnLeve}>{l.ativo ? 'arquivar' : 'reativar'}</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Rendimento / tipo / etapa / status — edição no lugar. fn_prod_estrutura_salvar regrava a ligação inteira: manda sempre todos os campos.
function Atributos({ ctx, lig, fluxos, onMudou }: { ctx: Ctx; lig: Ligacao; fluxos: FluxoLite[]; onMudou: () => Promise<void> }) {
  async function gravar(patch: Partial<{ tipo_saida: string; rendimento: number | null; fluxo_id: string | null; status: string }>, msg: string): Promise<string | null> {
    const { erro, r } = await rpc<{ ok?: boolean; avisos?: { soma_pct: number }[] }>('fn_prod_estrutura_salvar', {
      p_company_id: ctx.companyId, p_plant_id: ctx.plantId, p_id: lig.id, p_origem_produto_id: lig.origem_produto_id, p_produto_id: lig.produto_id,
      p_fluxo_id: 'fluxo_id' in patch ? patch.fluxo_id : lig.fluxo_id, p_tipo_saida: patch.tipo_saida ?? lig.tipo_saida,
      p_rendimento_pct: 'rendimento' in patch ? patch.rendimento : lig.rendimento_padrao_pct, p_fonte_padrao: lig.fonte_padrao,
      p_status: patch.status ?? lig.status, p_vigencia_inicio: lig.vigencia_inicio, p_vigencia_fim: lig.vigencia_fim,
    })
    if (erro) return erro
    ctx.flash(r?.avisos?.length ? `${msg} Atenção: as saídas dessa origem somam ${Number(r.avisos[0].soma_pct).toLocaleString('pt-BR')}% (mais de 100%).` : msg)
    await onMudou(); return null
  }
  const etapas = [{ value: '', label: '— sem etapa' }, ...fluxos.map((f) => ({ value: f.id, label: f.nome }))]
  return (
    <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5, color: C.espM }}>
      <span>etapa<Aj k="prod.estrutura.etapa" /> <CelulaEditavel testid="est-etapa" tipo="lista" valor={lig.fluxo_id ?? ''} opcoes={etapas} vazio="sem etapa" rotuloValor={(v) => etapas.find((o) => o.value === v)?.label ?? '—'} onSalvar={(v) => gravar({ fluxo_id: v || null }, 'ALTEROU a etapa.')} /></span>
      <span>rendimento %<Aj k="prod.estrutura.rendimento" /> <CelulaEditavel testid="est-rendimento" tipo="numero" valor={lig.rendimento_padrao_pct == null ? '' : String(lig.rendimento_padrao_pct)} vazio="a definir" largura={70}
        onSalvar={async (v) => {
          const t = v.trim().replace(',', '.')
          if (!t) return gravar({ rendimento: null }, 'ALTEROU o rendimento (a definir).')
          const n = Number(t)
          if (!Number.isFinite(n)) return 'Digite só número, ex.: 12,5.'
          if (n <= 0 || n > 100) return 'Rendimento: maior que 0 e até 100. Zero não vale — deixe em branco (a definir).'
          return gravar({ rendimento: n }, 'ALTEROU o rendimento.')
        }} /></span>
      <span>tipo<Aj k="prod.estrutura.tipo_saida" /> <CelulaEditavel testid="est-tipo" tipo="lista" obrigatorio valor={lig.tipo_saida} opcoes={TIPOS} onSalvar={(v) => gravar({ tipo_saida: v }, 'ALTEROU o tipo da saída.')} /></span>
      <span>status<Aj k="prod.estrutura.status" /> <CelulaEditavel testid="est-status" tipo="lista" obrigatorio valor={lig.status} opcoes={STATUS} rotuloValor={(v) => STATUS.find((o) => o.value === v)?.label ?? v} onSalvar={(v) => gravar({ status: v }, v === 'validado' ? 'VALIDOU a ligação.' : 'Voltou para rascunho.')} /></span>
    </span>
  )
}

// ─────────── modais ───────────
function Casca({ titulo, onClose, children, testid }: { titulo: string; onClose: () => void; children: React.ReactNode; testid: string }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0007', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }} onClick={onClose}>
      <div data-testid={testid} role="dialog" aria-label={titulo} onClick={(e) => e.stopPropagation()} style={{ background: C.white, borderRadius: 12, padding: 16, width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}><b>{titulo}</b><button onClick={onClose} aria-label="Fechar" style={{ ...btnLeve, border: 'none', fontSize: 16 }}>×</button></div>
        {children}
      </div>
    </div>
  )
}
const Campo = ({ rotulo, ajuda, children }: { rotulo: string; ajuda?: string; children: React.ReactNode }) => (
  <label style={{ display: 'block', fontSize: 12, color: C.espM, marginBottom: 8 }}>{rotulo}{ajuda && <Aj k={ajuda} />}<div style={{ marginTop: 3 }}>{children}</div></label>
)

function ModalProduto({ ctx, unidades, fontes, papelInicial, nomeInicial = '', codigoInicial = '', fonteId = null, chaveExterna = null, onClose, onSalvo }: {
  ctx: Ctx; unidades: Opt[]; fontes: Fonte[]; papelInicial: string; nomeInicial?: string; codigoInicial?: string; fonteId?: string | null; chaveExterna?: string | null
  onClose: () => void; onSalvo: (id: string) => void
}) {
  const [codigo, setCodigo] = useState(codigoInicial)
  const [nome, setNome] = useState(nomeInicial)
  const [papel, setPapel] = useState(papelInicial)
  const [unidade, setUnidade] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fonte = fontes.find((f) => f.id === fonteId)
  async function salvar() {
    if (!codigo.trim()) { setErro('O código é obrigatório.'); return }
    if (!nome.trim()) { setErro('O nome é obrigatório.'); return }
    setBusy(true); setErro(null)
    const { r, erro: e } = await rpc<{ ok?: boolean; id?: string }>('fn_prod_produto_salvar', { p_company_id: ctx.companyId, p_plant_id: ctx.plantId, p_id: null, p_codigo: codigo.trim(), p_nome: nome.trim(), p_unidade_id: unidade || null, p_papel: papel, p_fonte_id: fonteId, p_chave_externa: chaveExterna })
    setBusy(false)
    if (e || !r?.id) { setErro(e ?? 'Não consegui cadastrar.'); return }   // o digitado fica na tela
    ctx.flash('CRIOU o produto.'); onSalvo(r.id)
  }
  return (
    <Casca titulo={fonte ? `Criar produto a partir da fonte ${fonte.nome}` : 'Cadastrar produto'} onClose={onClose} testid="modal-produto">
      {fonte && <p style={{ fontSize: 12, color: C.espM, marginTop: 0 }}>A fonte traz só a descrição; confirme o <b>código</b> (sugerido pelo número da descrição).</p>}
      <Campo rotulo="Código" ajuda="prod.produto.codigo"><input data-testid="produto-codigo" style={inp} value={codigo} onChange={(e) => setCodigo(e.target.value)} /></Campo>
      <Campo rotulo="Nome" ajuda="prod.produto.nome"><input data-testid="produto-nome" style={inp} value={nome} onChange={(e) => setNome(e.target.value)} /></Campo>
      <Campo rotulo="Papel" ajuda="prod.produto.papel"><select data-testid="produto-papel" style={inp} value={papel} onChange={(e) => setPapel(e.target.value)}>{PAPEIS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></Campo>
      <Campo rotulo="Unidade" ajuda="prod.produto.unidade"><select style={inp} value={unidade} onChange={(e) => setUnidade(e.target.value)}><option value="">—</option>{unidades.map((u) => <option key={u.id} value={u.id}>{u.codigo ?? u.nome}</option>)}</select></Campo>
      {erro && <div role="alert" data-testid="produto-erro" style={{ background: C.redBg, color: C.red, padding: '6px 10px', borderRadius: 8, fontSize: 12.5, marginBottom: 8 }}>{erro}</div>}
      <button data-testid="produto-salvar" disabled={busy} onClick={() => void salvar()} style={btn(!busy)}>{busy ? 'Salvando…' : 'Salvar produto'}</button>
    </Casca>
  )
}

// Incluir origem (do produto) ou saída (da origem): escolhe um produto do catálogo ou cadastra na hora.
function ModalLigacao({ ctx, modo, produto, produtos, unidades, fontes, fluxos, nome, recarregar, onClose, onSalvo }: {
  recarregar: () => Promise<void>; ctx: Ctx; modo: 'origem' | 'saida'; produto: Produto; produtos: Produto[]; unidades: Opt[]; fontes: Fonte[]; fluxos: FluxoLite[]; nome: (id: string) => string
  onClose: () => void; onSalvo: () => Promise<void>
}) {
  const [outroId, setOutroId] = useState('')
  const [novo, setNovo] = useState(false)
  const [tipo, setTipo] = useState(modo === 'saida' ? 'coproduto' : 'principal')
  const [rend, setRend] = useState('')
  const [fluxoId, setFluxoId] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const opcoes = produtos.filter((p) => p.id !== produto.id)
  async function salvar() {
    if (!outroId) { setErro('Escolha o produto (ou cadastre um novo).'); return }
    const t = rend.trim().replace(',', '.'); const n = t ? Number(t) : null
    if (n !== null && (!Number.isFinite(n) || n <= 0 || n > 100)) { setErro('Rendimento: maior que 0 e até 100 — ou em branco (a definir). Zero não vale.'); return }
    setBusy(true); setErro(null)
    const { r, erro: e } = await rpc<{ ok?: boolean; avisos?: { soma_pct: number }[] }>('fn_prod_estrutura_salvar', {
      p_company_id: ctx.companyId, p_plant_id: ctx.plantId, p_id: null,
      p_origem_produto_id: modo === 'origem' ? outroId : produto.id, p_produto_id: modo === 'origem' ? produto.id : outroId,
      p_fluxo_id: fluxoId || null, p_tipo_saida: tipo, p_rendimento_pct: n, p_fonte_padrao: null, p_status: 'rascunho', p_vigencia_inicio: null, p_vigencia_fim: null,
    })
    setBusy(false)
    if (e) { setErro(e); return }
    ctx.flash(r?.avisos?.length ? `CRIOU a ligação (rascunho). Atenção: as saídas dessa origem somam ${Number(r.avisos[0].soma_pct).toLocaleString('pt-BR')}% (mais de 100%).` : 'CRIOU a ligação (rascunho a validar).')
    await onSalvo()
  }
  return (
    <Casca titulo={modo === 'origem' ? `Incluir origem de ${produto.codigo} · ${produto.nome}` : `Incluir saída de ${produto.codigo} · ${produto.nome}`} onClose={onClose} testid="modal-ligacao">
      <Campo rotulo={modo === 'origem' ? 'Produto de origem' : 'Produto gerado'} ajuda={modo === 'origem' ? 'prod.estrutura.origem' : 'prod.estrutura.saida'}>
        <select data-testid="lig-produto" style={inp} value={outroId} onChange={(e) => setOutroId(e.target.value)}><option value="">— escolher</option>{opcoes.map((p) => <option key={p.id} value={p.id}>{nome(p.id)}</option>)}</select>
        <button type="button" data-testid="lig-novo-produto" onClick={() => setNovo(true)} style={{ ...btnLeve, marginTop: 5 }}>+ cadastrar produto novo</button>
      </Campo>
      <Campo rotulo="Tipo de saída" ajuda="prod.estrutura.tipo_saida"><select style={inp} value={tipo} onChange={(e) => setTipo(e.target.value)}>{TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></Campo>
      <Campo rotulo="Rendimento padrão % (em branco = a definir)" ajuda="prod.estrutura.rendimento"><input data-testid="lig-rendimento" style={inp} inputMode="decimal" value={rend} onChange={(e) => setRend(e.target.value)} /></Campo>
      <Campo rotulo="Etapa onde ocorre (opcional)" ajuda="prod.estrutura.etapa"><select style={inp} value={fluxoId} onChange={(e) => setFluxoId(e.target.value)}><option value="">— sem etapa</option>{fluxos.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></Campo>
      {erro && <div role="alert" data-testid="lig-erro" style={{ background: C.redBg, color: C.red, padding: '6px 10px', borderRadius: 8, fontSize: 12.5, marginBottom: 8 }}>{erro}</div>}
      <button data-testid="lig-salvar" disabled={busy} onClick={() => void salvar()} style={btn(!busy)}>{busy ? 'Salvando…' : 'Incluir (como rascunho)'}</button>
      {novo && <ModalProduto ctx={ctx} unidades={unidades} fontes={fontes} papelInicial={modo === 'origem' ? 'origem' : 'subproduto'} onClose={() => setNovo(false)} onSalvo={(id) => { setNovo(false); void recarregar().then(() => setOutroId(id)) }} />}
    </Casca>
  )
}

// Colar lista: "origem;produto;tipo_saida;rendimento_pct;etapa" (códigos). Prévia sem gravar → avisa o que não casou → grava como RASCUNHO.
function ModalColar({ ctx, onClose, onGravou }: { ctx: Ctx; onClose: () => void; onGravou: () => Promise<void> }) {
  const [texto, setTexto] = useState('')
  const [prev, setPrev] = useState<{ validas: { linha: number; origem: string; produto: string; tipo_saida: string; rendimento_pct: number | null; etapa: string | null }[]; nao_casaram: { linha: number; texto: string; motivo: string }[]; gravadas?: number; gravado?: boolean } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function rodar(gravar: boolean) {
    if (!texto.trim()) { setErro('Cole a lista: uma linha por ligação, no formato origem;produto;tipo_saida;rendimento_pct;etapa.'); return }
    setBusy(true); setErro(null)
    const { r, erro: e } = await rpc<NonNullable<typeof prev> & { ok?: boolean }>('fn_prod_estrutura_colar', { p_company_id: ctx.companyId, p_plant_id: ctx.plantId, p_linhas: texto, p_gravar: gravar })
    setBusy(false)
    if (e || !r) { setErro(e ?? 'Não consegui ler a lista.'); return }
    setPrev(r)
    if (gravar) { ctx.flash(`CRIOU ${r.gravadas ?? 0} ligação(ões) como rascunho.${r.nao_casaram.length ? ` ${r.nao_casaram.length} linha(s) não casaram e ficaram de fora.` : ''}`); await onGravou() }
  }
  return (
    <Casca titulo="Colar lista de estrutura" onClose={onClose} testid="modal-colar">
      <p style={{ fontSize: 12, color: C.espM, marginTop: 0 }}>Uma linha por ligação: <code>origem;produto;tipo_saida;rendimento_pct;etapa</code> (códigos dos produtos já cadastrados; tipo = principal, coproduto ou subproduto; rendimento e etapa são opcionais). Entra como <b>rascunho</b>.</p>
      <textarea data-testid="colar-texto" rows={8} style={{ ...inp, fontFamily: 'monospace' }} value={texto} onChange={(e) => { setTexto(e.target.value); setPrev(null) }} />
      {erro && <div role="alert" style={{ background: C.redBg, color: C.red, padding: '6px 10px', borderRadius: 8, fontSize: 12.5, margin: '8px 0' }}>{erro}</div>}
      <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
        <button data-testid="colar-previa" disabled={busy} onClick={() => void rodar(false)} style={btn(!busy)}>Prévia</button>
        <button data-testid="colar-gravar" disabled={busy || !prev || prev.validas.length === 0 || !!prev.gravado} onClick={() => void rodar(true)} style={btn(!busy && !!prev && prev.validas.length > 0 && !prev.gravado)}>Gravar {prev ? prev.validas.length : ''} como rascunho</button>
      </div>
      {prev && (
        <div data-testid="colar-resultado" style={{ fontSize: 12.5 }}>
          <div style={{ color: C.green }}>{prev.gravado ? `${prev.gravadas} gravada(s).` : `${prev.validas.length} linha(s) válida(s) — nada gravado ainda.`}</div>
          {prev.validas.map((v) => <div key={v.linha} style={{ color: C.espM }}>linha {v.linha}: {v.origem} → {v.produto} ({v.tipo_saida}{v.rendimento_pct != null ? `, ${v.rendimento_pct}%` : ', a definir'}{v.etapa ? `, ${v.etapa}` : ''})</div>)}
          {prev.nao_casaram.length > 0 && <div data-testid="colar-nao-casaram" style={{ background: C.amberBg, color: '#8A4B08', borderRadius: 8, padding: '6px 10px', marginTop: 6 }}>
            <b>{prev.nao_casaram.length} linha(s) não casaram (ficam de fora):</b>
            {prev.nao_casaram.map((n) => <div key={n.linha}>linha {n.linha}: {n.motivo} — <code>{n.texto}</code></div>)}
          </div>}
        </div>
      )}
    </Casca>
  )
}

// Produto de origem do fluxo (entrada da etapa): grava prod_fluxo.produto_origem_id. Usado no contexto do fluxo.
export function OrigemDoFluxo({ fluxoId, valor, produtos, onSalvar }: { fluxoId: string; valor: string; produtos: Produto[]; onSalvar: (id: string | null) => Promise<string | null> }) {
  const opcoes = produtos.map((p) => ({ value: p.id, label: `${p.codigo} · ${p.nome}` }))
  return <CelulaEditavel testid={`fluxo-origem-${fluxoId.slice(0, 4)}`} tipo="busca" opcoes={opcoes} valor={valor} vazio="— escolher" rotuloValor={(v) => opcoes.find((o) => o.value === v)?.label ?? '—'} onSalvar={(v) => onSalvar(v || null)} />
}
