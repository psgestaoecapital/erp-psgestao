'use client'

// Onda 3.1/3.2 · Itens da NFe recebida com de-para + vinculo manual.
// Le fn_nfe_item_depara_sugerir e grava via fn_nfe_item_vincular.

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import AnexosCard from '@/components/crm/AnexosCard'

type Sugestao = {
  produto_id: string
  nome: string
  codigo?: string | null
  estoque_atual?: number | null
  criterio: 'depara' | 'ean' | 'codigo' | 'ncm_descricao' | 'descricao'
  confianca: 'exata' | 'alta' | 'media' | 'baixa'
  score?: number
}
type Alternativa = { produto_id: string; nome: string; codigo?: string | null; score?: number; mesmo_ncm?: boolean }
type Item = {
  item_id: string
  numero_item: number
  codigo_produto: string
  descricao: string
  ncm: string | null
  cfop: string | null
  quantidade: number
  valor_unitario: number
  codigo_barras?: string | null
  produto_id: string | null
  produto_nome: string | null
  vinculo_origem: string | null
  entra_estoque: boolean | null
  // COM-1 · casamento reforçado (sugestão que o humano confirma — nunca vincula sozinho)
  sugestao?: Sugestao | null
  auto_exato?: boolean
  alternativas?: Alternativa[]
}

// linguagem humana (RD inviolável): nunca "de-para", "match", "trigram"
const CRITERIO_LABEL: Record<string, string> = {
  depara: 'já aprendido deste fornecedor',
  ean: 'código de barras',
  codigo: 'código do fornecedor',
  ncm_descricao: 'mesma categoria e descrição parecida',
  descricao: 'descrição parecida',
}

type Prod = {
  id: string
  nome: string
  codigo: string | null
  ncm: string | null
  estoque_atual: number | null
}

type OSLite = {
  id: string
  numero: string
  cliente_nome: string | null
  placa: string | null
  status: string
}

interface SugerirResp {
  ok: boolean
  itens?: Item[]
  erro?: string
}

interface VincularResp {
  ok: boolean
  item_id?: string
  produto_id?: string
  entra_estoque?: boolean
  depara_fixado?: boolean
  erro?: string
}

interface Props {
  nfeId: string
  companyId: string
  onChange?: () => void
}

export function ItensNfeRecebida({ nfeId, companyId, onChange }: Props) {
  const [itens, setItens] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [buscaItem, setBuscaItem] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [res, setRes] = useState<Prod[]>([])
  const [busy, setBusy] = useState(false)
  // RD-26 · vincular o item da NF a uma OS (baixa automática do estoque no faturamento da OS)
  const [buscaOS, setBuscaOS] = useState<string | null>(null)
  const [qOS, setQOS] = useState('')
  const [resOS, setResOS] = useState<OSLite[]>([])
  // #11b · ações da nota (entrada de estoque / enviar pro financeiro / concluir) + feedback
  const [acaoBusy, setAcaoBusy] = useState<'estoque' | 'financeiro' | 'concluir' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  // NFE-F0 · E0 · CFOP de entrada + categoria por item (derivados no servidor); E4 · navegação item a item
  const [extras, setExtras] = useState<Record<string, { cfop_entrada: string | null; categoria_codigo: string | null }>>({})
  const [idxAtual, setIdxAtual] = useState(0)
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    const { data, error } = await supabase.rpc('fn_nfe_item_depara_sugerir', {
      p_nfe_recebida_id: nfeId,
    })
    setLoading(false)
    if (error) { setErro(error.message); return }
    const r = data as SugerirResp | null
    if (!r?.ok) { setErro(r?.erro ?? 'Erro ao sugerir'); setItens([]); return }
    setItens(r.itens ?? [])
    // E0 · CFOP de entrada + categoria (colunas preenchidas pelo trigger/backfill)
    const { data: ex } = await supabase.from('erp_nfe_recebidas_itens')
      .select('id, cfop_entrada, categoria_codigo').eq('nfe_recebida_id', nfeId)
    const m: Record<string, { cfop_entrada: string | null; categoria_codigo: string | null }> = {}
    for (const row of (ex ?? []) as { id: string; cfop_entrada: string | null; categoria_codigo: string | null }[]) {
      m[row.id] = { cfop_entrada: row.cfop_entrada, categoria_codigo: row.categoria_codigo }
    }
    setExtras(m)
  }, [nfeId])

  // E4 · navega até o item N e o destaca (nota com 40 itens fica viável)
  function irParaItem(idx: number) {
    if (itens.length === 0) return
    const i = Math.max(0, Math.min(idx, itens.length - 1))
    setIdxAtual(i)
    const el = itemRefs.current[itens[i].item_id]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // E1 · concluir a nota (itens resolvidos → estoque → financeiro, atômico) num clique
  async function concluir() {
    setAcaoBusy('concluir'); setErro(null); setMsg(null)
    const { data, error } = await supabase.rpc('fn_nfe_recebida_concluir', { p_nfe_id: nfeId })
    setAcaoBusy(null)
    if (error) { setErro(error.message); return }
    const r = data as { ok?: boolean; erro?: string; faltam?: { item: number; descricao: string }[];
      estoque?: { itens_movidos?: number }; financeiro?: { pagar_criadas?: number; valor_total?: number } } | null
    if (!r?.ok) {
      if (r?.erro === 'itens_nao_resolvidos') {
        const lista = (r.faltam ?? []).map((f) => `#${f.item} ${f.descricao}`).join(' · ')
        setErro(`Faltam itens para concluir (vincule um produto ou marque "não entra"): ${lista}`)
      } else setErro('Não consegui concluir: ' + (r?.erro ?? 'falhou'))
      return
    }
    setMsg(`✅ Nota concluída — ${r.estoque?.itens_movidos ?? 0} item(ns) no estoque · ${r.financeiro?.pagar_criadas ?? 0} conta(s) a pagar.`)
    await carregar(); onChange?.()
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  async function buscarProduto(termo: string) {
    setQ(termo)
    if (termo.trim().length < 2) { setRes([]); return }
    const { data } = await supabase
      .from('erp_produtos')
      .select('id, nome, codigo, ncm, estoque_atual')
      .eq('company_id', companyId)
      .eq('ativo', true)
      .ilike('nome', `%${termo.trim()}%`)
      .limit(20)
    setRes((data as Prod[]) ?? [])
  }

  async function vincular(itemId: string, produtoId: string) {
    setBusy(true)
    setErro(null)
    const { data, error } = await supabase.rpc('fn_nfe_item_vincular', {
      p_item_id: itemId,
      p_produto_id: produtoId,
      p_fixar_depara: true,
    })
    setBusy(false)
    if (error) { setErro(error.message); return }
    const r = data as VincularResp | null
    if (!r?.ok) { setErro(r?.erro ?? 'Erro ao vincular'); return }
    setBuscaItem(null); setQ(''); setRes([])
    await carregar()
    onChange?.()
  }

  // COM-1 · um clique: item da nota vira produto no estoque (herda EAN/NCM/custo do XML), já vinculado.
  async function criarProduto(itemId: string) {
    setBusy(true); setErro(null); setMsg(null)
    const { data, error } = await supabase.rpc('fn_nfe_item_criar_produto', {
      p_item_id: itemId, p_dados: null,
    })
    setBusy(false)
    if (error) { setErro(error.message); return }
    const r = data as { ok: boolean; erro?: string; produto_id?: string } | null
    if (!r?.ok) { setErro(r?.erro ?? 'Não consegui criar o produto'); return }
    await carregar(); onChange?.()
  }

  // #11b · override do flag "movimenta estoque" por item (fn_nfe_item_set_entra_estoque, gated).
  async function setEntra(itemId: string, entra: boolean) {
    setBusy(true); setErro(null); setMsg(null)
    const { data, error } = await supabase.rpc('fn_nfe_item_set_entra_estoque', {
      p_item_id: itemId, p_entra: entra,
    })
    setBusy(false)
    if (error) { setErro(error.message); return }
    const r = data as { ok: boolean; erro?: string; entra_estoque?: boolean } | null
    if (!r?.ok) { setErro(r?.erro ?? 'Não consegui alterar o item'); return }
    setItens((prev) => prev.map((x) =>
      x.item_id === itemId ? { ...x, entra_estoque: r.entra_estoque ?? entra } : x))
    onChange?.()
  }

  // #11b · dar entrada no estoque (respeita entra_estoque por item; local único resolvido no servidor)
  async function darEntradaEstoque() {
    setAcaoBusy('estoque'); setErro(null); setMsg(null)
    const { data, error } = await supabase.rpc('fn_nfe_recebida_dar_entrada_estoque', {
      p_nfe_recebida_id: nfeId,
    })
    setAcaoBusy(null)
    if (error) { setErro(error.message); return }
    const r = data as { ok: boolean; erro?: string; itens_movidos?: number; pendentes_vinculo?: number } | null
    if (!r?.ok) { setErro(r?.erro ?? 'Não consegui dar entrada'); return }
    const partes = [`${r.itens_movidos ?? 0} item(ns) deram entrada no estoque`]
    if ((r.pendentes_vinculo ?? 0) > 0) {
      partes.push(`${r.pendentes_vinculo} marcado(s) p/ estoque ainda SEM produto vinculado — vincule e repita`)
    }
    setMsg('✅ ' + partes.join(' · '))
    await carregar(); onChange?.()
  }

  // #11b · enviar pro financeiro (gera a pagar) — independente da entrada de estoque, decisão do operador
  async function enviarFinanceiro() {
    setAcaoBusy('financeiro'); setErro(null); setMsg(null)
    const { data, error } = await supabase.rpc('fn_nfe_recebida_enviar_financeiro', {
      p_nfe_recebida_id: nfeId,
    })
    setAcaoBusy(null)
    if (error) { setErro(error.message); return }
    const r = data as { ok: boolean; erro?: string; pagar_criadas?: number; ja_lancado?: boolean } | null
    if (!r?.ok) { setErro(r?.erro ?? 'Não consegui enviar pro financeiro'); return }
    setMsg(r.ja_lancado
      ? 'Esta nota já tinha sido enviada ao financeiro.'
      : `✅ ${r.pagar_criadas ?? 0} conta(s) a pagar criada(s).`)
    await carregar(); onChange?.()
  }

  // RD-26 · busca de OS (por número/cliente/placa) para vincular o item da NF
  async function buscarOS(termo: string) {
    setQOS(termo)
    if (termo.trim().length < 2) { setResOS([]); return }
    const t = `%${termo.trim()}%`
    const { data } = await supabase
      .from('erp_os')
      .select('id, numero, cliente_nome, placa, status')
      .eq('company_id', companyId)
      .not('status', 'in', '(cancelada,excluida)')
      .or(`numero.ilike.${t},cliente_nome.ilike.${t},placa.ilike.${t}`)
      .order('created_at', { ascending: false })
      .limit(20)
    setResOS((data as OSLite[]) ?? [])
  }

  async function vincularOS(itemId: string, osId: string) {
    setBusy(true)
    setErro(null)
    // p_diag_item_id opcional (null): vincula à OS; a peça específica pode ser refinada depois
    const { data, error } = await supabase.rpc('fn_nfe_item_vincular_os', {
      p_item_id: itemId, p_os_id: osId, p_diag_item_id: null,
    })
    setBusy(false)
    if (error) { setErro(error.message); return }
    const r = data as { ok?: boolean; erro?: string } | null
    if (!r?.ok) { setErro(r?.erro ?? 'Erro ao vincular à OS'); return }
    setBuscaOS(null); setQOS(''); setResOS([])
    await carregar()
    onChange?.()
  }

  function chipVinculo(it: Item) {
    if (it.produto_id) {
      const sufixo = it.vinculo_origem === 'sugerido'
        ? ' (sugestão)'
        : it.vinculo_origem === 'depara'
        ? ' (de-para)'
        : ''
      return (
        <span className="text-[10.5px] px-2 py-0.5 rounded-full font-medium bg-[#F3E9DD] text-[#3D2314]">
          ✓ {it.produto_nome ?? 'vinculado'}{sufixo}
        </span>
      )
    }
    return <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#FAEEDA] text-[#BA7517] font-medium">pendente de vínculo</span>
  }

  if (loading) {
    return <div className="text-[12px] text-[#3D2314]/55 py-2">Carregando itens…</div>
  }
  if (erro) {
    return <div className="text-[12px] text-[#A32D2D] py-2">Não consegui carregar itens: {erro}</div>
  }
  if (itens.length === 0) {
    return <div className="text-[12px] text-[#3D2314]/55 py-2 italic">Sem itens — nota ainda sem XML completo.</div>
  }

  const casados = itens.filter((x) => x.produto_id).length
  const naoEstoque = itens.filter((x) => !x.produto_id && x.entra_estoque === false).length
  const pendentes = itens.length - casados - naoEstoque

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[12px] font-medium text-[#3D2314]">
          Conferência de entrada — {itens.length} {itens.length === 1 ? 'item' : 'itens'}
        </div>
        {casados > 0 && (
          <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#E8F4DC] text-[#3F7012] font-medium">✅ {casados} no seu estoque</span>
        )}
        {pendentes > 0 && (
          <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#FAEEDA] text-[#BA7517] font-medium">⚠️ {pendentes} para conferir</span>
        )}
        {naoEstoque > 0 && (
          <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#3D2314]/8 text-[#3D2314]/65 font-medium">{naoEstoque} não entra(m)</span>
        )}
      </div>
      {/* E4 · navegação item a item (viável com 40 itens) */}
      {itens.length > 1 && (
        <div className="flex items-center gap-2 text-[11px] text-[#3D2314]/70">
          <button type="button" onClick={() => irParaItem(idxAtual - 1)} disabled={idxAtual === 0}
            className="px-2 py-1 rounded-md border border-[#3D2314]/15 hover:bg-[#3D2314]/5 disabled:opacity-40">← anterior</button>
          <span className="tabular-nums font-medium">{idxAtual + 1} de {itens.length}</span>
          <button type="button" onClick={() => irParaItem(idxAtual + 1)} disabled={idxAtual >= itens.length - 1}
            className="px-2 py-1 rounded-md border border-[#3D2314]/15 hover:bg-[#3D2314]/5 disabled:opacity-40">próximo →</button>
        </div>
      )}
      {itens.map((it, i) => (
        <div key={it.item_id} ref={(el) => { itemRefs.current[it.item_id] = el }}
          className={
            'rounded-lg border p-3 bg-[#FAF7F2]/40 ' +
            (i === idxAtual && itens.length > 1 ? 'border-[#C8941A] ring-1 ring-[#C8941A]/40' : 'border-[#3D2314]/10')
          }>
          <div className="flex justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium text-[#3D2314] truncate">
                {it.descricao}
              </div>
              <div className="text-[10.5px] text-[#3D2314]/60 mt-0.5">
                cód {it.codigo_produto} · NCM {it.ncm ?? '—'} · CFOP {it.cfop ?? '—'}
                {extras[it.item_id]?.cfop_entrada ? <> <span className="text-[#3F7012] font-medium">→ entrada {extras[it.item_id]!.cfop_entrada}</span></> : null}
                {' · '}{Number(it.quantidade ?? 0).toLocaleString('pt-BR')}× R${' '}
                {Number(it.valor_unitario ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
              {extras[it.item_id]?.categoria_codigo && (
                <div className="text-[10.5px] text-[#3D2314]/60 mt-0.5">
                  categoria sugerida <span className="font-medium text-[#3D2314]">{extras[it.item_id]!.categoria_codigo}</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {/* #11b · toggle "movimenta estoque" por item (override do CFOP) */}
            <button
              type="button"
              disabled={busy}
              onClick={() => void setEntra(it.item_id, !(it.entra_estoque === true))}
              title="Define se este item movimenta o estoque na entrada. Clique para alternar."
              className={
                it.entra_estoque === true
                  ? 'text-[10.5px] px-2 py-0.5 rounded-full bg-[#E8F4DC] text-[#3F7012] font-medium hover:brightness-95 disabled:opacity-50'
                  : it.entra_estoque === false
                  ? 'text-[10.5px] px-2 py-0.5 rounded-full bg-[#3D2314]/8 text-[#3D2314]/65 font-medium hover:brightness-95 disabled:opacity-50'
                  : 'text-[10.5px] px-2 py-0.5 rounded-full bg-[#FAEEDA] text-[#BA7517] font-medium hover:brightness-95 disabled:opacity-50'
              }
            >
              {it.entra_estoque === true ? '☑ entra no estoque' : it.entra_estoque === false ? '☐ não entra' : '☐ classificar CFOP'}
            </button>
            {chipVinculo(it)}
            {it.vinculo_origem?.startsWith('os:') && (
              <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#E8EEF9] text-[#2F5AA8] font-medium">✓ vinculado à OS</span>
            )}
            <button
              type="button"
              onClick={() => { setBuscaItem(it.item_id); setQ(''); setRes([]) }}
              className="text-[10.5px] px-2.5 py-1 rounded-md bg-[#C8941A] text-white font-medium hover:bg-[#A87810]"
            >
              {it.produto_id ? 'Trocar produto' : 'Vincular produto'}
            </button>
            <button
              type="button"
              onClick={() => { setBuscaOS(it.item_id); setQOS(''); setResOS([]) }}
              className="text-[10.5px] px-2.5 py-1 rounded-md border border-[#2F5AA8] text-[#2F5AA8] font-medium hover:bg-[#E8EEF9]"
              title="Vincular esta peça a uma OS — no faturamento da OS o estoque baixa automático"
            >
              {it.vinculo_origem?.startsWith('os:') ? 'Trocar OS' : 'Vincular à OS'}
            </button>
          </div>

          {/* COM-1 · sugestão de produto (nunca vincula sozinho — o humano confirma) */}
          {!it.produto_id && it.sugestao && (
            <div
              className={
                it.auto_exato
                  ? 'mt-2 rounded-md border border-[#3F7012]/30 bg-[#E8F4DC]/60 p-2'
                  : 'mt-2 rounded-md border border-[#C8941A]/30 bg-[#FAEEDA]/50 p-2'
              }
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <div className="text-[10.5px] font-medium" style={{ color: it.auto_exato ? '#3F7012' : '#BA7517' }}>
                    {it.auto_exato ? '✅ casa por ' : '💡 sugestão · '}{CRITERIO_LABEL[it.sugestao.criterio] ?? 'parecido'}
                    {!it.auto_exato && it.sugestao.score ? ` (${Math.round(it.sugestao.score * 100)}%)` : ''}
                  </div>
                  <div className="text-[12px] text-[#3D2314] truncate">{it.sugestao.nome}</div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void vincular(it.item_id, it.sugestao!.produto_id)}
                  className={
                    it.auto_exato
                      ? 'text-[10.5px] px-2.5 py-1 rounded-md bg-[#3F7012] text-white font-medium hover:bg-[#2F5510] disabled:opacity-50'
                      : 'text-[10.5px] px-2.5 py-1 rounded-md bg-[#C8941A] text-white font-medium hover:bg-[#A87810] disabled:opacity-50'
                  }
                >
                  {it.auto_exato ? 'Confirmar' : 'Usar esta'}
                </button>
              </div>
              {(it.alternativas?.length ?? 0) > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {it.alternativas!.map((a) => (
                    <button
                      key={a.produto_id}
                      type="button"
                      disabled={busy}
                      onClick={() => void vincular(it.item_id, a.produto_id)}
                      title="Usar este produto no lugar da sugestão"
                      className="text-[10px] px-2 py-0.5 rounded-full bg-white border border-[#3D2314]/12 text-[#3D2314]/80 hover:border-[#C8941A] disabled:opacity-50"
                    >
                      {a.nome.length > 34 ? a.nome.slice(0, 34) + '…' : a.nome}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {!it.produto_id && !it.sugestao && (
            <div className="mt-2 flex items-center gap-2 text-[10.5px] text-[#3D2314]/60">
              <span>Nenhum parecido no seu estoque.</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void criarProduto(it.item_id)}
                className="px-2.5 py-1 rounded-md bg-[#3F7012] text-white font-medium hover:bg-[#2F5510] disabled:opacity-50"
              >
                + Criar produto novo
              </button>
            </div>
          )}
          {!it.produto_id && it.sugestao && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void criarProduto(it.item_id)}
              className="mt-1 text-[10.5px] text-[#3F7012] hover:underline disabled:opacity-50"
            >
              + Nenhum serve — criar produto novo
            </button>
          )}

          {buscaItem === it.item_id && (
            <div className="mt-2 rounded-md bg-white border border-[#3D2314]/10 p-2">
              <input
                autoFocus
                value={q}
                onChange={(e) => void buscarProduto(e.target.value)}
                placeholder="Buscar produto pelo nome…"
                className="w-full text-[12px] border border-[#3D2314]/15 rounded-md px-2 py-1 outline-none text-[#3D2314]"
              />
              <div className="max-h-48 overflow-auto mt-1">
                {res.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void vincular(it.item_id, p.id)}
                    className="w-full text-left text-[12px] px-2 py-1 hover:bg-[#3D2314]/5 rounded text-[#3D2314] disabled:opacity-50"
                  >
                    {p.nome}{' '}
                    <span className="text-[10.5px] text-[#3D2314]/50">
                      · estoque {Number(p.estoque_atual ?? 0).toLocaleString('pt-BR')}
                    </span>
                  </button>
                ))}
                {q.length >= 2 && res.length === 0 && (
                  <div className="text-[10.5px] text-[#3D2314]/50 px-2 py-1">
                    Nenhum produto encontrado.
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => { setBuscaItem(null); setQ(''); setRes([]) }}
                className="text-[10.5px] text-[#3D2314]/55 mt-1 hover:underline"
              >
                Cancelar
              </button>
            </div>
          )}

          {buscaOS === it.item_id && (
            <div className="mt-2 rounded-md bg-white border border-[#2F5AA8]/30 p-2">
              <input
                autoFocus
                value={qOS}
                onChange={(e) => void buscarOS(e.target.value)}
                placeholder="Buscar OS por número, cliente ou placa…"
                className="w-full text-[12px] border border-[#3D2314]/15 rounded-md px-2 py-1 outline-none text-[#3D2314]"
              />
              <div className="max-h-48 overflow-auto mt-1">
                {resOS.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void vincularOS(it.item_id, o.id)}
                    className="w-full text-left text-[12px] px-2 py-1 hover:bg-[#2F5AA8]/5 rounded text-[#3D2314] disabled:opacity-50"
                  >
                    <span className="font-medium">{o.numero}</span>{' '}
                    <span className="text-[10.5px] text-[#3D2314]/55">
                      · {o.cliente_nome ?? 'sem cliente'}{o.placa ? ` · ${o.placa}` : ''} · {o.status}
                    </span>
                  </button>
                ))}
                {qOS.length >= 2 && resOS.length === 0 && (
                  <div className="text-[10.5px] text-[#3D2314]/50 px-2 py-1">Nenhuma OS encontrada.</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => { setBuscaOS(null); setQOS(''); setResOS([]) }}
                className="text-[10.5px] text-[#3D2314]/55 mt-1 hover:underline"
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      ))}

      {/* #11b · ações da nota: entrada de estoque e/ou financeiro (independentes, decisão do operador) */}
      {msg && (
        <div className="text-[11.5px] px-3 py-2 rounded-md bg-[#E8F4DC] text-[#1B3608] border border-[#3F7012]/20">
          {msg}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          disabled={acaoBusy !== null}
          onClick={() => void darEntradaEstoque()}
          title="Movimenta o estoque só dos itens marcados 'entra no estoque' e com produto vinculado."
          className="inline-flex items-center gap-1.5 text-[11.5px] px-3 py-1.5 rounded-md bg-[#3F7012] text-white font-medium hover:bg-[#2F5510] disabled:opacity-50 min-h-[36px]"
        >
          {acaoBusy === 'estoque' ? 'Dando entrada…' : '📦 Dar entrada no estoque'}
        </button>
        <button
          type="button"
          disabled={acaoBusy !== null}
          onClick={() => void enviarFinanceiro()}
          title="Gera as contas a pagar desta nota (duplicatas). Independente da entrada de estoque."
          className="inline-flex items-center gap-1.5 text-[11.5px] px-3 py-1.5 rounded-md bg-[#3D2314] text-[#FAF7F2] font-medium hover:bg-[#5A3520] disabled:opacity-50 min-h-[36px]"
        >
          {acaoBusy === 'financeiro' ? 'Enviando…' : '💰 Enviar pro financeiro'}
        </button>
        {/* NFE-F0 · E1 · um clique: estoque + financeiro (atômico). Bloqueia se algum item não estiver resolvido. */}
        <button
          type="button"
          disabled={acaoBusy !== null}
          onClick={() => void concluir()}
          title="Faz a entrada no estoque e gera o financeiro de uma vez. Exige todos os itens resolvidos (vinculados ou 'não entra')."
          className="inline-flex items-center gap-1.5 text-[11.5px] px-3 py-1.5 rounded-md bg-[#3F7012] text-white font-medium hover:bg-[#2F5510] disabled:opacity-50 min-h-[36px]"
        >
          {acaoBusy === 'concluir' ? 'Concluindo…' : '✅ Concluir nota'}
        </button>
      </div>

      {/* NFE-F0 · E3 · anexos na nota (boleto, comprovante, foto) — reusa o <AnexosCard> (vínculo 'nfe') */}
      <AnexosCard companyId={companyId} vinculoTipo="nfe" vinculoId={nfeId} />
    </div>
  )
}
