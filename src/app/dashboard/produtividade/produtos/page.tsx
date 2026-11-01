'use client'

// Produtividade Industrial · Produtos por planta (vertical indústria). Cada linha é um produto do fluxo (código, nome,
// papel, linha, conservação, peso). Edição no lugar; "Colar lista" carrega vários de uma vez (prévia antes de gravar).
// A árvore de desmontagem abre por produto (só leitura — a edição da árvore é na tela de fluxo). CRIOU/ALTEROU/EXCLUIU,
// nunca INSERT/UPDATE/DELETE. Sem semáforo aqui — semáforo é só para desempenho.

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { CelulaEditavel } from '@/components/produtividade/CelulaEditavel'
import { ClipboardList } from 'lucide-react'

const ROTA = '/dashboard/produtividade/produtos'
const Aj = ({ k }: { k: string }) => <AjudaCampo chave={k} rota={ROTA} />

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF',
  cream: '#F0ECE3', border: '#E0D8CC', gold: '#C8941A', goldD: '#A57A15', goldBg: '#FDF7E8',
  green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FAEEDA', red: '#B42318', redBg: '#FCEBEB', blue: '#2F5AA8',
}
const inp: React.CSSProperties = { padding: '7px 9px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 7, background: C.white, color: C.esp, outline: 'none', minWidth: 0, width: '100%' }
const btn = (on = true): React.CSSProperties => ({ padding: '8px 14px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', cursor: on ? 'pointer' : 'not-allowed', background: on ? C.gold : C.espL, color: C.white })

type Plant = { id: string; nome_planta: string }
type Produto = {
  id: string; codigo: string; nome: string; papel: string | null; linha: string | null;
  secao_origem: string | null; peso_aprox_kg: number | null; conservacao: string | null; ativo: boolean
}

const PAPEIS: { value: string; label: string }[] = [
  { value: 'entrada_animal', label: 'Entrada (animal)' },
  { value: 'carcaca', label: 'Carcaça' },
  { value: 'carcaca_quarto', label: 'Carcaça (quarto)' },
  { value: 'entrada_desossa', label: 'Entrada p/ desossa' },
  { value: 'produto_final_com_osso', label: 'Produto final c/ osso' },
  { value: 'produto_final_sem_osso', label: 'Produto final s/ osso' },
  { value: 'miudo', label: 'Miúdo' },
  { value: 'subproduto', label: 'Subproduto' },
  { value: 'acabado', label: 'Acabado' },
  { value: 'ignorar', label: 'Ignorar' },
]
const LINHAS: { value: string; label: string }[] = [
  { value: 'padrao', label: 'Padrão' },
  { value: 'precoce', label: 'Precoce' },
]
const CONSERVACOES: { value: string; label: string }[] = [
  { value: 'RESFRIADO', label: 'Resfriado' },
  { value: 'CONGELADO', label: 'Congelado' },
]
const rotuloDe = (opts: { value: string; label: string }[], v: string | null): string => (v ? (opts.find((o) => o.value === v)?.label ?? v) : '—')
const erroSalvar = (code: string): string => {
  switch (code) {
    case 'codigo_invalido': return 'O código é obrigatório — informe um código para o produto.'
    case 'nome_invalido': return 'O nome é obrigatório — informe o nome do produto.'
    case 'codigo_ja_existe': return 'Já existe um produto com esse código nesta planta — escolha outro código.'
    case 'produto_nao_encontrado': return 'Produto não encontrado — recarregue a lista e tente de novo.'
    default: return `Não consegui salvar: ${code}`
  }
}

export default function ProdutosPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 60px', maxWidth: 1120, margin: '0 auto', color: C.esp }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>Indústria · Produtividade</div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 10px' }}>Produtos</h1>
      <div style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '26px 16px', textAlign: 'center', color: C.espM, fontSize: 13.5 }}>{texto}</div>
    </div>
  )
}

function Inner() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [plants, setPlants] = useState<Plant[]>([])
  const [plantId, setPlantId] = useState<string | null>(null)
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [carregando, setCarregando] = useState(false)
  const [busca, setBusca] = useState('')
  const [filtroPapel, setFiltroPapel] = useState('')
  const [novoAberto, setNovoAberto] = useState(false)
  const [colarAberto, setColarAberto] = useState(false)
  const [expandido, setExpandido] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const flash = useCallback((m: string) => { setMsg(m); setErro(null); window.setTimeout(() => setMsg(null), 3500) }, [])
  const flashErr = useCallback((m: string) => { setErro(m); try { window.scrollTo({ top: 0, behavior: 'smooth' }) } catch { /* */ } window.setTimeout(() => setErro(null), 6000) }, [])

  // plantas da empresa
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!companyId) { setPlants([]); setPlantId(null); return }
    void (async () => {
      const { data } = await supabase.from('industrial_plants').select('id, nome_planta').eq('company_id', companyId).eq('is_active', true).order('nome_planta')
      const ps = (data as Plant[]) ?? []
      setPlants(ps); setPlantId((prev) => prev && ps.some((p) => p.id === prev) ? prev : (ps[0]?.id ?? null))
    })()
  }, [companyId])

  const carregar = useCallback(async () => {
    if (!companyId || !plantId) { setProdutos([]); return }
    setCarregando(true)
    const { data, error } = await supabase.from('prod_produto')
      .select('id,codigo,nome,papel,linha,secao_origem,peso_aprox_kg,conservacao,ativo')
      .eq('company_id', companyId).eq('plant_id', plantId).eq('ativo', true).order('codigo')
    setCarregando(false)
    if (error) { flashErr(`Não consegui carregar os produtos: ${error.message}`); return }
    setProdutos((data as Produto[]) ?? [])
  }, [companyId, plantId, flashErr])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return produtos.filter((p) => {
      if (filtroPapel && p.papel !== filtroPapel) return false
      if (!q) return true
      return p.codigo.toLowerCase().includes(q) || p.nome.toLowerCase().includes(q)
    })
  }, [produtos, busca, filtroPapel])

  async function salvarCampo(prod: Produto, patch: Partial<Produto>, rotulo: string): Promise<string | null> {
    if (!companyId || !plantId) return 'Selecione uma empresa e planta antes.'
    const merge = { ...prod, ...patch }
    const { data, error } = await supabase.rpc('fn_prod_produto_f1_salvar', {
      p_company_id: companyId, p_plant_id: plantId, p_id: prod.id,
      p_codigo: merge.codigo, p_nome: merge.nome, p_papel: merge.papel, p_linha: merge.linha,
      p_secao_origem: merge.secao_origem, p_peso_aprox_kg: merge.peso_aprox_kg, p_conservacao: merge.conservacao,
    })
    if (error) return erroSalvar(error.message)
    const r = data as { ok?: boolean } | null
    if (!r?.ok) return 'Não consegui salvar agora. Tente de novo.'
    flash(`ALTEROU ${rotulo}.`); await carregar(); return null
  }

  async function arquivar(prod: Produto) {
    if (!companyId) return
    if (!window.confirm(`Arquivar o produto "${prod.codigo} — ${prod.nome}"?\n\nEle sai da lista, mas o histórico não é apagado.`)) return
    const { error } = await supabase.rpc('fn_prod_produto_arquivar', { p_company_id: companyId, p_id: prod.id, p_ativo: false })
    if (error) { flashErr(`Não consegui arquivar: ${error.message}`); return }
    flash(`EXCLUIU ${prod.codigo} da lista (arquivado).`); await carregar()
  }

  if (!companyId) return <Aviso texto="Selecione uma empresa específica no topo — o cadastro é por planta." />
  if (plants.length === 0) return <Aviso texto="Esta empresa não tem planta industrial cadastrada." />

  const papelFiltroOpts = [{ value: '', label: 'Todos os papéis' }, ...PAPEIS]

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 60px', maxWidth: 1120, margin: '0 auto', color: C.esp }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>Indústria · Produtividade</div>
      <div style={{ display: 'flex', gap: 14, fontSize: 14, margin: '6px 0' }}>
        <Link href="/dashboard/produtividade" style={{ color: C.espM }}>Cadastro</Link>
        <b style={{ borderBottom: `2px solid ${C.gold}` }}>Produtos</b>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Produtos da planta</h1>
      <p style={{ color: C.espM, fontSize: 13, margin: '6px 0 12px' }}>Cada linha é um produto do fluxo. Clique para editar no lugar. Use “Colar lista” para carregar vários códigos de uma vez.</p>

      {msg && <div style={{ background: C.greenBg, color: C.green, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{msg}</div>}
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{erro}</div>}

      {/* Seletores + ações */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '14px 0 10px' }}>
        {plants.length > 1 && (
          <label data-ajuda="prod.produto.planta" style={{ fontSize: 12, color: C.espM, display: 'inline-flex', alignItems: 'center' }}>Planta<Aj k="prod.produto.planta" />&nbsp;
            <select data-testid="produtos-planta" value={plantId ?? ''} onChange={(e) => setPlantId(e.target.value)} style={{ ...inp, width: 'auto' }}>
              {plants.map((p) => <option key={p.id} value={p.id}>{p.nome_planta}</option>)}
            </select>
          </label>
        )}
        <label data-ajuda="prod.produto.busca" style={{ fontSize: 12, color: C.espM, display: 'inline-flex', alignItems: 'center' }}>
          Buscar<Aj k="prod.produto.busca" />&nbsp;
          <input data-testid="produtos-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="código ou nome" style={{ ...inp, width: 200 }} />
        </label>
        <label data-ajuda="prod.produto.filtro_papel" style={{ fontSize: 12, color: C.espM, display: 'inline-flex', alignItems: 'center' }}>
          Papel<Aj k="prod.produto.filtro_papel" />&nbsp;
          <select data-testid="produtos-filtro-papel" value={filtroPapel} onChange={(e) => setFiltroPapel(e.target.value)} style={{ ...inp, width: 'auto' }}>
            {papelFiltroOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <button data-testid="produtos-novo" onClick={() => setNovoAberto(true)} style={{ ...btn(true), padding: '7px 12px', fontSize: 12.5 }}>+ Novo produto</button>
        <button data-testid="produtos-colar" onClick={() => setColarAberto(true)} style={{ ...btn(true), background: 'transparent', color: C.esp, border: `1px solid ${C.border}`, padding: '7px 12px', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 5 }}><ClipboardList size={14} strokeWidth={1.5} />Colar lista</button>
      </div>

      {carregando && produtos.length === 0 ? (
        <div style={{ fontSize: 13, color: C.espM, padding: 20 }}>Carregando os produtos…</div>
      ) : produtos.length === 0 ? (
        <div style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '28px 16px', textAlign: 'center', color: C.espM }}>
          Nenhum produto ainda — use <b>“Colar lista”</b> para carregar os códigos, ou <b>“Novo produto”</b>.
          <div style={{ marginTop: 8, fontSize: 12.5 }}>Próximo passo: cole a planilha de produtos (código;nome;papel;linha;seção;peso;conservação) e confira a prévia antes de gravar.</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', background: C.white, border: `1px solid ${C.border}`, borderRadius: 12 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 820, fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.cream, color: C.espM, textAlign: 'left' }}>
                <Th>Código<Aj k="prod.produto.codigo" /></Th>
                <Th>Nome<Aj k="prod.produto.nome" /></Th>
                <Th>Papel<Aj k="prod.produto.papel" /></Th>
                <Th>Linha<Aj k="prod.produto.linha" /></Th>
                <Th>Conservação<Aj k="prod.produto.conservacao" /></Th>
                <Th>Peso aprox.<Aj k="prod.produto.peso_aprox" /></Th>
                <Th>Ações</Th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 18, color: C.espM, textAlign: 'center' }}>Nenhum produto corresponde à busca/filtro.</td></tr>
              ) : filtrados.map((p) => (
                <LinhaProduto key={p.id} p={p} expandido={expandido === p.id}
                  onExpandir={() => setExpandido((v) => v === p.id ? null : p.id)}
                  onSalvar={salvarCampo} onArquivar={() => void arquivar(p)}
                  companyId={companyId} plantId={plantId!} flashErr={flashErr} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {novoAberto && plantId && (
        <NovoProdutoModal companyId={companyId} plantId={plantId}
          onClose={() => setNovoAberto(false)}
          onSalvo={(cod) => { setNovoAberto(false); flash(`CRIOU o produto ${cod}.`); void carregar() }} />
      )}
      {colarAberto && plantId && (
        <ColarListaModal companyId={companyId} plantId={plantId}
          onClose={() => setColarAberto(false)}
          onGravou={(n, verbo) => { setColarAberto(false); flash(`${n} produto(s) ${verbo}.`); void carregar() }} />
      )}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: '10px 12px', fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap', borderBottom: `1px solid ${C.border}` }}>{children}</th>
}

function LinhaProduto({ p, expandido, onExpandir, onSalvar, onArquivar, companyId, plantId, flashErr }: {
  p: Produto; expandido: boolean; onExpandir: () => void
  onSalvar: (prod: Produto, patch: Partial<Produto>, rotulo: string) => Promise<string | null>
  onArquivar: () => void; companyId: string; plantId: string; flashErr: (m: string) => void
}) {
  const td: React.CSSProperties = { padding: '8px 12px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' }
  return (
    <>
      <tr data-testid={`produto-linha-${p.codigo}`}>
        <td style={td}>
          <button type="button" data-testid={`produto-expandir-${p.codigo}`} onClick={onExpandir} title="Ver árvore de desmontagem"
            style={{ background: 'none', border: 'none', color: C.espL, cursor: 'pointer', fontSize: 11, marginRight: 4 }}>{expandido ? '▾' : '▸'}</button>
          <span style={{ fontWeight: 700 }}>
            <CelulaEditavel testid={`produto-codigo-${p.codigo}`} valor={p.codigo} obrigatorio onSalvar={(v) => onSalvar(p, { codigo: v }, `o código de ${p.codigo}`)} />
          </span>
        </td>
        <td style={td}>
          <CelulaEditavel testid={`produto-nome-${p.codigo}`} valor={p.nome} obrigatorio onSalvar={(v) => onSalvar(p, { nome: v }, `o nome de ${p.codigo}`)} />
        </td>
        <td style={td}>
          <CelulaEditavel testid={`produto-papel-${p.codigo}`} tipo="lista" valor={p.papel ?? ''} opcoes={PAPEIS} vazio="— escolher"
            rotuloValor={(v) => rotuloDe(PAPEIS, v)} onSalvar={(v) => onSalvar(p, { papel: v || null }, `o papel de ${p.codigo}`)} />
        </td>
        <td style={td}>
          <CelulaEditavel testid={`produto-linha-cell-${p.codigo}`} tipo="lista" valor={p.linha ?? ''} opcoes={LINHAS} vazio="— escolher"
            rotuloValor={(v) => rotuloDe(LINHAS, v)} onSalvar={(v) => onSalvar(p, { linha: v || null }, `a linha de ${p.codigo}`)} />
        </td>
        <td style={td}>
          <CelulaEditavel testid={`produto-conservacao-${p.codigo}`} tipo="lista" valor={p.conservacao ?? ''} opcoes={CONSERVACOES} vazio="— escolher"
            rotuloValor={(v) => rotuloDe(CONSERVACOES, v)} onSalvar={(v) => onSalvar(p, { conservacao: v || null }, `a conservação de ${p.codigo}`)} />
        </td>
        <td style={td}>
          <CelulaEditavel testid={`produto-peso-${p.codigo}`} tipo="numero" valor={p.peso_aprox_kg != null ? String(p.peso_aprox_kg) : ''} vazio="— kg"
            rotuloValor={(v) => `${v} kg`}
            onSalvar={(v) => {
              const t = v.replace(',', '.').trim()
              if (t && Number.isNaN(Number(t))) return Promise.resolve('Peso inválido — informe um número (ex.: 12,5) ou deixe em branco.')
              return onSalvar(p, { peso_aprox_kg: t ? Number(t) : null }, `o peso de ${p.codigo}`)
            }} />
        </td>
        <td style={td}>
          <button type="button" data-testid={`produto-arquivar-${p.codigo}`} onClick={onArquivar}
            style={{ background: 'none', border: `1px solid ${C.border}`, color: C.red, borderRadius: 7, padding: '4px 9px', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>Arquivar</button>
        </td>
      </tr>
      {expandido && (
        <tr data-testid={`produto-arvore-${p.codigo}`}>
          <td colSpan={7} style={{ padding: '10px 14px 14px', background: C.goldBg, borderBottom: `1px solid ${C.border}` }}>
            <Arvore companyId={companyId} plantId={plantId} produtoId={p.id} flashErr={flashErr} />
          </td>
        </tr>
      )}
    </>
  )
}

type ItemArvore = { origem_nome?: string | null; produto_nome?: string | null; rendimento_pct?: number | null; [k: string]: unknown }

function Arvore({ companyId, plantId, produtoId, flashErr }: { companyId: string; plantId: string; produtoId: string; flashErr: (m: string) => void }) {
  const [itens, setItens] = useState<ItemArvore[] | null>(null)
  useEffect(() => {
    let vivo = true
    void (async () => {
      const { data, error } = await supabase.rpc('fn_prod_estrutura_listar', { p_company_id: companyId, p_plant_id: plantId, p_produto_id: produtoId, p_incluir_arquivados: false })
      if (!vivo) return
      if (error) { flashErr(`Não consegui carregar a árvore: ${error.message}`); setItens([]); return }
      const r = data as { ok?: boolean; itens?: ItemArvore[] } | null
      setItens(r?.ok ? (r.itens ?? []) : [])
    })()
    return () => { vivo = false }
  }, [companyId, plantId, produtoId, flashErr])

  return (
    <div style={{ fontSize: 12.5, color: C.esp }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: C.espM, textTransform: 'uppercase', fontSize: 11, letterSpacing: 0.4 }}>Árvore de desmontagem</div>
      {itens === null ? <div style={{ color: C.espM }}>Carregando…</div>
        : itens.length === 0 ? <div style={{ color: C.espM }}>Sem estrutura de desmontagem para este produto ainda.</div>
        : (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
            {itens.map((it, i) => {
              const origem = it.origem_nome ?? '—'
              const saida = it.produto_nome ?? '—'
              const rend = typeof it.rendimento_pct === 'number' ? `${it.rendimento_pct.toLocaleString('pt-BR')}%` : null
              return <li key={i}><b>{origem}</b> → {saida}{rend ? <span style={{ color: C.espM }}> · rendimento {rend}</span> : null}</li>
            })}
          </ul>
        )}
      <div style={{ marginTop: 8, color: C.espL, fontSize: 11.5, fontStyle: 'italic' }}>Edição da árvore na tela de fluxo.</div>
    </div>
  )
}

// ─────────── MODAL: Novo produto ───────────
function NovoProdutoModal({ companyId, plantId, onClose, onSalvo }: {
  companyId: string; plantId: string; onClose: () => void; onSalvo: (codigo: string) => void
}) {
  const [f, setF] = useState({ codigo: '', nome: '', papel: '', linha: '', secao: '', peso: '', conservacao: '' })
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    const peso = f.peso.replace(',', '.').trim()
    if (peso && Number.isNaN(Number(peso))) { setErro('Peso inválido — informe um número (ex.: 12,5) ou deixe em branco.'); return }
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_prod_produto_f1_salvar', {
      p_company_id: companyId, p_plant_id: plantId, p_id: null,
      p_codigo: f.codigo.trim(), p_nome: f.nome.trim(), p_papel: f.papel || null, p_linha: f.linha || null,
      p_secao_origem: f.secao.trim() || null, p_peso_aprox_kg: peso ? Number(peso) : null, p_conservacao: f.conservacao || null,
    })
    setBusy(false)
    if (error) { setErro(erroSalvar(error.message)); return }
    const r = data as { ok?: boolean } | null
    if (!r?.ok) { setErro('Não consegui salvar agora. Tente de novo.'); return }
    onSalvo(f.codigo.trim())
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.white, borderRadius: 12, padding: 18, width: 'min(520px,100%)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Novo produto</div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', color: C.espM, cursor: 'pointer', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: C.espM, margin: '2px 0 12px' }}>Informe ao menos o código e o nome. O resto pode ser ajustado depois, direto na tabela.</div>
        {erro && <div style={{ background: C.redBg, color: C.red, padding: '8px 11px', borderRadius: 7, fontSize: 12.5, marginBottom: 10 }}>{erro}</div>}
        <div style={{ display: 'grid', gap: 10 }}>
          <Campo rotulo="Código" ajuda="prod.produto.codigo">
            <input data-testid="novo-produto-codigo" value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} placeholder="ex.: 1001" style={inp} />
          </Campo>
          <Campo rotulo="Nome" ajuda="prod.produto.nome">
            <input data-testid="novo-produto-nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="ex.: Dianteiro com osso" style={inp} />
          </Campo>
          <Campo rotulo="Papel" ajuda="prod.produto.papel">
            <select data-testid="novo-produto-papel" value={f.papel} onChange={(e) => setF({ ...f, papel: e.target.value })} style={inp}>
              <option value="">— escolher —</option>
              {PAPEIS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Linha" ajuda="prod.produto.linha">
            <select data-testid="novo-produto-linha" value={f.linha} onChange={(e) => setF({ ...f, linha: e.target.value })} style={inp}>
              <option value="">— escolher —</option>
              {LINHAS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Conservação" ajuda="prod.produto.conservacao">
            <select data-testid="novo-produto-conservacao" value={f.conservacao} onChange={(e) => setF({ ...f, conservacao: e.target.value })} style={inp}>
              <option value="">— escolher —</option>
              {CONSERVACOES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Peso aprox. (kg)" ajuda="prod.produto.peso_aprox">
            <input data-testid="novo-produto-peso" inputMode="decimal" value={f.peso} onChange={(e) => setF({ ...f, peso: e.target.value })} placeholder="ex.: 12,5" style={inp} />
          </Campo>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={{ ...btn(true), background: 'transparent', color: C.esp, border: `1px solid ${C.border}` }}>Cancelar</button>
          <button data-testid="produto-salvar" disabled={busy || !f.codigo.trim() || !f.nome.trim()} onClick={() => void salvar()} style={btn(!busy && !!f.codigo.trim() && !!f.nome.trim())}>{busy ? 'Salvando…' : 'Salvar produto'}</button>
        </div>
      </div>
    </div>
  )
}

function Campo({ rotulo, ajuda, children }: { rotulo: string; ajuda: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 3, fontSize: 12, color: C.espM }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', fontWeight: 700 }}>{rotulo}<Aj k={ajuda} /></span>
      {children}
    </label>
  )
}

// ─────────── MODAL: Colar lista ───────────
type NaoCasou = { linha: number; texto: string; motivo: string }
type PreviaColar = { ok?: boolean; gravado?: boolean; validas?: number; gravadas?: number; nao_casaram?: NaoCasou[] }

function ColarListaModal({ companyId, plantId, onClose, onGravou }: {
  companyId: string; plantId: string; onClose: () => void; onGravou: (n: number, verbo: string) => void
}) {
  const [texto, setTexto] = useState('')
  const [busy, setBusy] = useState(false)
  const [previa, setPrevia] = useState<PreviaColar | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function chamar(gravar: boolean): Promise<PreviaColar | null> {
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_prod_produto_colar', { p_company_id: companyId, p_plant_id: plantId, p_linhas: texto, p_gravar: gravar })
    setBusy(false)
    if (error) { setErro(`Não consegui processar a lista: ${error.message}`); return null }
    return (data as PreviaColar) ?? null
  }

  async function previsualizar() { const r = await chamar(false); if (r) setPrevia(r) }
  async function gravar() {
    const r = await chamar(true)
    if (!r) return
    if (r.ok) { onGravou(r.gravadas ?? 0, 'CRIADO(S)/ATUALIZADO(S)'); return }
    setPrevia(r); setErro('Algumas linhas não casaram — veja abaixo e corrija antes de gravar o restante.')
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '30px 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.white, borderRadius: 12, padding: 18, width: 'min(640px,100%)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Colar lista de produtos</div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', color: C.espM, cursor: 'pointer', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: C.espM, margin: '2px 0 4px', display: 'inline-flex', alignItems: 'center' }}>
          Uma linha por produto, colunas separadas por <code style={{ margin: '0 3px' }}>;</code> na ordem: código;nome;papel;linha;seção;peso;conservação.<Aj k="prod.produto.colar_lista" />
        </div>
        <div style={{ fontSize: 11.5, color: C.espL, marginBottom: 8 }}>A primeira linha pode ser o cabeçalho (começando por “codigo”).</div>
        {erro && <div style={{ background: C.redBg, color: C.red, padding: '8px 11px', borderRadius: 7, fontSize: 12.5, marginBottom: 10 }}>{erro}</div>}
        <div data-ajuda="prod.produto.colar_lista">
          <textarea data-testid="colar-texto" value={texto} onChange={(e) => { setTexto(e.target.value); setPrevia(null) }} rows={8}
            placeholder={'codigo;nome;papel;linha;secao;peso;conservacao\n1001;Dianteiro com osso;produto_final_com_osso;padrao;desossa;12,5;RESFRIADO'}
            style={{ ...inp, fontFamily: 'ui-monospace, monospace', fontSize: 12.5, resize: 'vertical' }} />
        </div>

        {previa && (
          <div style={{ marginTop: 12, fontSize: 12.5 }}>
            <div style={{ color: C.green, fontWeight: 700 }}>{previa.validas ?? 0} linha(s) válida(s){previa.gravado ? ` · ${previa.gravadas ?? 0} gravada(s)` : ''}.</div>
            {(previa.nao_casaram ?? []).length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ color: C.red, fontWeight: 700, marginBottom: 4 }}>{(previa.nao_casaram ?? []).length} linha(s) não casaram:</div>
                <div style={{ maxHeight: 180, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
                  {(previa.nao_casaram ?? []).map((n, i) => (
                    <div key={i} style={{ padding: '6px 10px', borderBottom: i < (previa.nao_casaram ?? []).length - 1 ? `1px solid ${C.border}` : 'none', color: C.esp }}>
                      <b>Linha {n.linha}:</b> <span style={{ color: C.espM }}>{n.texto}</span><div style={{ color: C.red, fontSize: 11.5 }}>{n.motivo}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button data-testid="colar-previa" disabled={busy || !texto.trim()} onClick={() => void previsualizar()} style={{ ...btn(!busy && !!texto.trim()), background: 'transparent', color: C.esp, border: `1px solid ${C.border}` }}>Prévia</button>
          <button data-testid="colar-gravar" disabled={busy || !texto.trim()} onClick={() => void gravar()} style={btn(!busy && !!texto.trim())}>{busy ? 'Processando…' : 'Gravar'}</button>
        </div>
      </div>
    </div>
  )
}
