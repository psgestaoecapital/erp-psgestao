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

// NFE-F0/F1/F2 · colunas derivadas/conferência do item
type ItemExtra = {
  cfop_entrada: string | null; categoria_codigo: string | null; custo_unitario_real: number | null
  quantidade_recebida: number | null; divergencia_motivo: string | null; gera_financeiro: boolean; unidade: string | null
}
const EXTRA0: ItemExtra = { cfop_entrada: null, categoria_codigo: null, custo_unitario_real: null, quantidade_recebida: null, divergencia_motivo: null, gera_financeiro: true, unidade: null }
const MOTIVOS = ['faltou', 'avaria', 'sobra', 'recusado']

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
  // NFE-F0 · E0 · CFOP de entrada + categoria por item; E4 · navegação item a item
  // NFE-F1 · E5 · custo real; NFE-F2 · E1/E2/E6 · recebido, motivo, fator, gera_financeiro
  const [extras, setExtras] = useState<Record<string, ItemExtra>>({})
  const [memoria, setMemoria] = useState<Record<string, { natureza?: string; aviso?: string | null; memoria?: Record<string, unknown> } | null>>({})
  const [idxAtual, setIdxAtual] = useState(0)
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({})
  // NFE-F2 · dados da nota p/ conferência (fornecedor p/ o fator, transp) + parcelas
  const [notaInfo, setNotaInfo] = useState<{ emitente_cnpj: string | null; valor_total: number | null; lancado_pagar: boolean | null } | null>(null)
  const [parcelas, setParcelas] = useState<{ id: string; numero_dup: string | null; data_vencimento: string | null; valor: number | null; pagar_id: string | null; forma_pagamento: string | null; conta_bancaria_id: string | null; codigo_barras: string | null }[]>([])
  // §5 · contas bancárias da empresa (para escolher a conta que paga a parcela)
  const [contas, setContas] = useState<{ id: string; nome: string }[]>([])

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
    // colunas do item (F0 cfop/categoria · F1 custo real · F2 recebido/motivo/fator/gera_financeiro)
    const { data: ex } = await supabase.from('erp_nfe_recebidas_itens')
      .select('id, cfop_entrada, categoria_codigo, custo_unitario_real, quantidade_recebida, divergencia_motivo, gera_financeiro, unidade').eq('nfe_recebida_id', nfeId)
    const m: Record<string, ItemExtra> = {}
    for (const row of (ex ?? []) as (ItemExtra & { id: string })[]) {
      m[row.id] = { cfop_entrada: row.cfop_entrada, categoria_codigo: row.categoria_codigo, custo_unitario_real: row.custo_unitario_real, quantidade_recebida: row.quantidade_recebida, divergencia_motivo: row.divergencia_motivo, gera_financeiro: row.gera_financeiro ?? true, unidade: row.unidade }
    }
    setExtras(m)
    // NFE-F2 · nota (fornecedor p/ fator, valor p/ parcelas) + parcelas do XML
    const { data: n } = await supabase.from('erp_nfe_recebidas').select('emitente_cnpj, valor_total, lancado_pagar, transportadora, frete_modalidade, peso_bruto').eq('id', nfeId).maybeSingle()
    setNotaInfo(n ? { emitente_cnpj: (n as { emitente_cnpj: string | null }).emitente_cnpj, valor_total: (n as { valor_total: number | null }).valor_total, lancado_pagar: (n as { lancado_pagar: boolean | null }).lancado_pagar } : null)
    const { data: dups } = await supabase.from('erp_nfe_recebidas_duplicatas').select('id, numero_dup, data_vencimento, valor, pagar_id, forma_pagamento, conta_bancaria_id, codigo_barras').eq('nfe_recebida_id', nfeId).order('numero_dup')
    setParcelas((dups ?? []) as typeof parcelas)
    // §5 · contas bancárias ativas da empresa (para o seletor de conta da parcela)
    const { data: cs } = await supabase.from('erp_banco_contas').select('id, nome').eq('company_id', companyId).eq('ativo', true).order('nome')
    setContas((cs ?? []) as { id: string; nome: string }[])
  }, [nfeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // F1 · E5 · calcula o custo real do item (server) e mostra a memória de cálculo
  async function verMemoria(itemId: string) {
    const { data } = await supabase.rpc('fn_nfe_item_custo_real', { p_item_id: itemId })
    const r = data as { ok?: boolean; natureza?: string; aviso?: string | null; custo_unitario_real?: number | null; memoria?: Record<string, unknown> } | null
    if (!r?.ok) { setMsg('Não consegui calcular o custo real deste item.'); return }
    setMemoria((mm) => ({ ...mm, [itemId]: { natureza: r.natureza, aviso: r.aviso, memoria: r.memoria } }))
    setExtras((ex) => ({ ...ex, [itemId]: { ...(ex[itemId] ?? EXTRA0), custo_unitario_real: r.custo_unitario_real ?? null } }))
  }

  // NFE-F2 · E1/E6 · conferir item (recebido + motivo + gera_financeiro)
  async function conferir(itemId: string, patch: { qtd?: number; motivo?: string | null; gera?: boolean }) {
    const { data } = await supabase.rpc('fn_nfe_item_conferir', { p_item_id: itemId, p_qtd_recebida: patch.qtd ?? null, p_motivo: patch.motivo ?? null, p_gera_financeiro: patch.gera ?? null })
    const r = data as { ok?: boolean; erro?: string; recebido?: number } | null
    if (!r?.ok) { setMsg(r?.erro === 'motivo_obrigatorio' ? 'Quantidade diferente da nota — escolha o motivo (faltou/avaria/sobra/recusado).' : 'Não consegui salvar a conferência.'); return }
    await carregar()
  }
  // NFE-F2 · E2 · fator de conversão (CX→UN) no de-para (pergunta uma vez, vale sempre)
  async function salvarFator(itemId: string, produtoId: string | null, unidadeFornecedor: string | null, fator: number) {
    if (!produtoId) { setMsg('Vincule o produto antes de definir o fator.'); return }
    const { data } = await supabase.rpc('fn_nfe_depara_fator_set', { p_company_id: companyId, p_fornecedor_cnpj: notaInfo?.emitente_cnpj ?? null, p_produto_id: produtoId, p_codigo_fornecedor: null, p_unidade_fornecedor: unidadeFornecedor, p_fator: fator })
    const r = data as { ok?: boolean } | null
    if (!r?.ok) { setMsg('Não consegui salvar o fator.'); return }
    setMsg(`Fator salvo: 1 ${unidadeFornecedor ?? 'emb.'} = ${fator} un. Vale sempre para este item deste fornecedor.`)
    await carregar()
  }
  // NFE-F2 · E3 · refazer parcelas (N × a partir de uma data)
  async function refazerParcelas(num: number, primeiroVenc: string) {
    const { data } = await supabase.rpc('fn_nfe_duplicatas_refazer', { p_nfe_id: nfeId, p_num_parcelas: num, p_primeiro_venc: primeiroVenc || null })
    const r = data as { ok?: boolean; erro?: string } | null
    if (!r?.ok) { setMsg(r?.erro === 'ja_lancado' ? 'Nota já lançada — edite na tela de Contas a Pagar.' : 'Não consegui refazer as parcelas.'); return }
    setMsg(`Parcelas refeitas em ${num}×.`); await carregar()
  }

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
    const r = data as { ok?: boolean; erro?: string; mensagem?: string;
      indecisos?: { item: number; descricao: string }[]; sem_produto?: { item: number; descricao: string }[];
      estoque?: { itens_movidos?: number }; financeiro?: { pagar_criadas?: number; valor_total?: number } } | null
    if (!r?.ok) {
      if (r?.erro === 'itens_nao_resolvidos') {
        const itens = [...(r.indecisos ?? []), ...(r.sem_produto ?? [])]
        const lista = itens.map((f) => `#${f.item} ${f.descricao}`).join(' · ')
        setErro(`${r.mensagem ?? 'Faltam itens para decidir se vão para o estoque.'}${lista ? ' — ' + lista : ''}`)
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

  // §2 · lote: marca TODOS os itens ainda "a decidir" como "não movimenta estoque" — por item,
  // sem RPC nova (reusa fn_nfe_item_set_entra_estoque). Uma nota de uso/consumo vira dois toques.
  async function marcarRestantesNaoMovimenta() {
    const restantes = itens.filter((x) => x.entra_estoque == null)
    if (restantes.length === 0) return
    setBusy(true); setErro(null); setMsg(null)
    for (const it of restantes) {
      const { data, error } = await supabase.rpc('fn_nfe_item_set_entra_estoque', { p_item_id: it.item_id, p_entra: false })
      const r = data as { ok?: boolean } | null
      if (error || !r?.ok) { setBusy(false); setErro('Não consegui marcar todos — tente item a item.'); await carregar(); return }
    }
    setBusy(false)
    setMsg(`🚫 ${restantes.length} item(ns) marcados como "não movimenta estoque".`)
    await carregar(); onChange?.()
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

  // §2 · três estados por destino de estoque (linguagem humana)
  const vaiEstoque = itens.filter((x) => x.entra_estoque === true).length
  const naoMovimenta = itens.filter((x) => x.entra_estoque === false).length
  const aDecidir = itens.filter((x) => x.entra_estoque == null).length

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[12px] font-medium text-[#3D2314]">
          Conferência de entrada — {itens.length} {itens.length === 1 ? 'item' : 'itens'}
        </div>
        {vaiEstoque > 0 && (
          <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#E8F4DC] text-[#3F7012] font-medium">📦 {vaiEstoque} para o estoque</span>
        )}
        {naoMovimenta > 0 && (
          <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#3D2314]/8 text-[#3D2314]/65 font-medium">🚫 {naoMovimenta} não movimenta(m)</span>
        )}
        {aDecidir > 0 && (
          <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#FAEEDA] text-[#BA7517] font-medium">⚪ {aDecidir} a decidir</span>
        )}
      </div>
      {/* §2 · lote: uma nota de uso/consumo vira dois toques */}
      {aDecidir > 0 && (
        <button type="button" disabled={busy} onClick={() => void marcarRestantesNaoMovimenta()}
          className="text-[11px] px-3 py-1.5 rounded-md bg-[#3D2314] text-[#FAF7F2] font-medium min-h-[36px] disabled:opacity-50 hover:bg-[#5A3520]">
          🚫 Marcar os {aDecidir} restantes como &quot;não movimenta estoque&quot;
        </button>
      )}
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
              {/* NFE-F1 · E5 · custo real (item + tributos que são custo + rateio) com memória */}
              <div className="text-[10.5px] text-[#3D2314]/60 mt-0.5 flex items-center gap-2 flex-wrap">
                {extras[it.item_id]?.custo_unitario_real != null && (
                  <span>custo real <span className="font-medium text-[#3D2314]">R$ {Number(extras[it.item_id]!.custo_unitario_real).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>/un</span>
                )}
                <button type="button" onClick={() => void verMemoria(it.item_id)} className="text-[#BA7517] font-medium hover:underline">
                  {extras[it.item_id]?.custo_unitario_real != null ? 'recalcular · ver memória' : 'calcular custo real'}
                </button>
              </div>
              {memoria[it.item_id] && (() => {
                const mm = memoria[it.item_id]!; const d = (mm.memoria ?? {}) as Record<string, unknown>
                return (
                  <div className="text-[10px] text-[#3D2314]/70 mt-1 bg-[#FBF6EA] border border-[#3D2314]/10 rounded-md px-2 py-1.5">
                    <div>natureza <strong>{mm.natureza}</strong>{mm.aviso ? <span className="text-[#BA7517]"> · {mm.aviso === 'usando_padrao' ? 'usando config padrão (empresa sem config própria)' : mm.aviso === 'sem_vprod_nao_rateia' ? 'sem valor de produtos — frete não rateado' : mm.aviso}</span> : null}</div>
                    <div>item R$ {Number(d.valor_item ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} + tributos R$ {Number(d.tributos_custo ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} + rateio R$ {Number(d.rateio ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} − desconto R$ {Number(d.desconto ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ÷ {Number(d.quantidade ?? 1).toLocaleString('pt-BR')}</div>
                  </div>
                )
              })()}
              {/* NFE-F2 · E1/E2/E6 · conferência: recebido, motivo, fator, gera financeiro */}
              {(() => {
                const ex = extras[it.item_id] ?? EXTRA0
                const rec = ex.quantidade_recebida ?? it.quantidade
                const div = Number(rec) !== Number(it.quantidade)
                return (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-[#3D2314]/70">
                    <span className="flex items-center gap-1">recebido
                      <input type="number" step="any" defaultValue={rec}
                        onBlur={(e) => { const q = Number(e.target.value); if (q !== Number(rec)) void conferir(it.item_id, { qtd: q, motivo: div ? ex.divergencia_motivo : null }) }}
                        className="w-16 border border-[#3D2314]/15 rounded px-1 py-0.5 text-[11px] text-[#3D2314]" />
                      <span className="text-[#3D2314]/45">de {Number(it.quantidade).toLocaleString('pt-BR')}</span>
                    </span>
                    {div && (
                      <span className="flex items-center gap-1 text-[#BA7517] font-medium">⚠️ divergência
                        <select defaultValue={ex.divergencia_motivo ?? ''} onChange={(e) => void conferir(it.item_id, { qtd: rec, motivo: e.target.value })}
                          className="border border-[#BA7517]/40 rounded px-1 py-0.5 text-[10.5px] text-[#3D2314]">
                          <option value="">motivo…</option>
                          {MOTIVOS.map((mo) => <option key={mo} value={mo}>{mo}</option>)}
                        </select>
                      </span>
                    )}
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" checked={ex.gera_financeiro !== false} onChange={(e) => void conferir(it.item_id, { gera: e.target.checked })} /> gera financeiro
                    </label>
                    {/* E2 · fator de conversão (CX→UN) — pergunta uma vez, vale sempre */}
                    <span className="flex items-center gap-1">fator ×
                      <input type="number" step="any" min="0.000001" defaultValue={1} title="Quantas unidades do seu produto vêm em 1 unidade da nota (ex.: 1 CX = 12 UN → 12)"
                        onBlur={(e) => { const f = Number(e.target.value); if (f > 0 && f !== 1) void salvarFator(it.item_id, it.produto_id, ex.unidade, f) }}
                        className="w-14 border border-[#3D2314]/15 rounded px-1 py-0.5 text-[11px] text-[#3D2314]" />
                      {ex.custo_unitario_real != null && <span className="text-[#3D2314]/45">custo/un divide pelo fator</span>}
                    </span>
                  </div>
                )
              })()}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {/* §2 · três destinos EXPLÍCITOS do item, um toque cada. Linguagem humana (inviolável):
                nunca "entra_estoque", true/false. "Não movimenta estoque" é um toque, SEM produto. */}
            <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="Destino do estoque deste item">
              <button
                type="button" disabled={busy}
                onClick={() => void setEntra(it.item_id, true)}
                aria-pressed={it.entra_estoque === true}
                title="Este item vai movimentar o estoque — escolha ou crie o produto abaixo."
                className={
                  'text-[11px] px-2.5 py-1 rounded-full font-medium min-h-[32px] disabled:opacity-50 ' +
                  (it.entra_estoque === true ? 'bg-[#3F7012] text-white' : 'bg-[#E8F4DC]/60 text-[#3F7012] hover:brightness-95')
                }
              >📦 Vai para o estoque</button>
              <button
                type="button" disabled={busy}
                onClick={() => void setEntra(it.item_id, false)}
                aria-pressed={it.entra_estoque === false}
                title="Uso/consumo — não movimenta o estoque. Um toque, sem precisar cadastrar produto."
                className={
                  'text-[11px] px-2.5 py-1 rounded-full font-medium min-h-[32px] disabled:opacity-50 ' +
                  (it.entra_estoque === false ? 'bg-[#3D2314] text-[#FAF7F2]' : 'bg-[#3D2314]/8 text-[#3D2314]/70 hover:brightness-95')
                }
              >🚫 Não movimenta estoque</button>
              {it.entra_estoque == null && (
                <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#FAEEDA] text-[#BA7517] font-medium">⚪ a decidir</span>
              )}
            </div>
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

      {/* NFE-F2 · E3 · parcelas (duplicatas do XML) — editar/refazer antes de gerar; a soma tem que bater */}
      {!notaInfo?.lancado_pagar && (
        <ParcelasBlock parcelas={parcelas} valorNota={notaInfo?.valor_total ?? null} contas={contas}
          onRefazer={(n, venc) => void refazerParcelas(n, venc)}
          onSalvar={async (lista) => {
            const soma = lista.reduce((s, p) => s + (Number(p.valor) || 0), 0)
            if (Math.abs(soma - (notaInfo?.valor_total ?? 0)) > 0.02) { setMsg(`As parcelas somam R$ ${soma.toLocaleString('pt-BR',{minimumFractionDigits:2})} — precisa bater com o valor da nota.`); return }
            const { data } = await supabase.rpc('fn_nfe_duplicatas_editar', { p_nfe_id: nfeId, p_parcelas: lista.map((p, i) => ({ numero: String(i + 1), vencimento: p.data_vencimento, valor: p.valor, forma_pagamento: p.forma_pagamento ?? null, conta_bancaria_id: p.conta_bancaria_id ?? null, codigo_barras: p.codigo_barras ?? null })) })
            const r = data as { ok?: boolean; erro?: string; avisos_codigo_barras?: { parcela: number; codigo_barras_digitos: number }[] } | null
            if (!r?.ok) { setMsg(r?.erro === 'soma_nao_bate' ? 'A soma das parcelas não bate com o valor da nota.' : 'Não consegui salvar as parcelas.'); return }
            const avisos = r.avisos_codigo_barras ?? []
            setMsg(avisos.length > 0
              ? `Parcelas salvas. ⚠️ ${avisos.length} código(s) de barras com dígitos fora de 44/47 — confira.`
              : 'Parcelas salvas.')
            await carregar()
          }} />
      )}

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

// NFE-F2 · E3 · bloco de parcelas (duplicatas): editar valor/vencimento, adicionar/remover, refazer N×.
// A soma tem que bater com o valor da nota — o botão salvar avisa/bloqueia se não bater.
type Parcela = { id?: string; numero_dup: string | null; data_vencimento: string | null; valor: number | null; pagar_id?: string | null; forma_pagamento?: string | null; conta_bancaria_id?: string | null; codigo_barras?: string | null }
const FORMAS_PAGTO = ['boleto', 'pix', 'transferencia', 'cartao_credito', 'cartao_debito', 'dinheiro', 'cheque']
function ParcelasBlock({ parcelas, valorNota, contas, onRefazer, onSalvar }: {
  parcelas: Parcela[]; valorNota: number | null; contas: { id: string; nome: string }[]
  onRefazer: (num: number, primeiroVenc: string) => void
  onSalvar: (lista: Parcela[]) => void | Promise<void>
}) {
  const [lista, setLista] = useState<Parcela[]>(parcelas)
  const [num, setNum] = useState('1')
  const [primeiro, setPrimeiro] = useState('')
  useEffect(() => { setLista(parcelas) }, [parcelas]) // eslint-disable-line react-hooks/set-state-in-effect
  const soma = lista.reduce((s, p) => s + (Number(p.valor) || 0), 0)
  const bate = Math.abs(soma - (valorNota ?? 0)) <= 0.02
  const brl = (n: number) => 'R$ ' + Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
  function patch(i: number, p: Partial<Parcela>) { setLista((a) => a.map((x, idx) => (idx === i ? { ...x, ...p } : x))) }
  return (
    <div className="mt-3 rounded-lg border border-[#3D2314]/12 p-3 bg-white">
      <div className="text-[12px] font-medium text-[#3D2314] mb-2">🧾 Parcelas do financeiro <span className="text-[10.5px] text-[#3D2314]/55 font-normal">(edite antes de gerar; a soma tem que bater com a nota)</span></div>
      <div className="flex flex-wrap items-end gap-2 mb-2 text-[11px] text-[#3D2314]/70">
        <span className="flex items-center gap-1">refazer <input type="number" min="1" value={num} onChange={(e) => setNum(e.target.value)} className="w-14 border border-[#3D2314]/15 rounded px-1 py-0.5" />×</span>
        <span className="flex items-center gap-1">1º venc <input type="date" value={primeiro} onChange={(e) => setPrimeiro(e.target.value)} className="border border-[#3D2314]/15 rounded px-1 py-0.5" /></span>
        <button type="button" onClick={() => onRefazer(Math.max(1, Number(num) || 1), primeiro)} className="px-2.5 py-1 rounded-md bg-[#C8941A] text-white font-medium text-[11px]">Refazer</button>
      </div>
      <div className="space-y-1">
        {lista.map((p, i) => (
          <div key={p.id ?? i} className="flex flex-wrap items-center gap-2 text-[11px] border-b border-[#3D2314]/6 pb-1.5">
            <span className="text-[#3D2314]/45 w-5">{i + 1}</span>
            <input type="date" value={p.data_vencimento ?? ''} onChange={(e) => patch(i, { data_vencimento: e.target.value })} className="border border-[#3D2314]/15 rounded px-1 py-0.5 text-[#3D2314]" />
            <input type="number" step="0.01" value={p.valor ?? ''} onChange={(e) => patch(i, { valor: Number(e.target.value) })} placeholder="valor" className="w-24 border border-[#3D2314]/15 rounded px-1 py-0.5 text-right text-[#3D2314]" />
            {/* §5 · forma, conta e código de barras — opcionais; chegam completos no contas a pagar */}
            <select value={p.forma_pagamento ?? ''} onChange={(e) => patch(i, { forma_pagamento: e.target.value || null })} title="Forma de pagamento" className="border border-[#3D2314]/15 rounded px-1 py-0.5 text-[#3D2314] min-h-[30px]">
              <option value="">forma…</option>
              {FORMAS_PAGTO.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select value={p.conta_bancaria_id ?? ''} onChange={(e) => patch(i, { conta_bancaria_id: e.target.value || null })} title="Conta que paga esta parcela" className="border border-[#3D2314]/15 rounded px-1 py-0.5 text-[#3D2314] min-h-[30px]">
              <option value="">conta…</option>
              {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            <input type="text" inputMode="numeric" value={p.codigo_barras ?? ''} onChange={(e) => patch(i, { codigo_barras: e.target.value })} placeholder="código de barras" title="Linha digitável (47) ou arrecadação (44) — avisa se não bater, não bloqueia" className="w-40 border border-[#3D2314]/15 rounded px-1 py-0.5 text-[#3D2314]" />
            <button type="button" onClick={() => setLista((a) => a.filter((_, idx) => idx !== i))} className="text-[#A32D2D] hover:underline">remover</button>
          </div>
        ))}
        {lista.length === 0 && <div className="text-[11px] text-[#3D2314]/50">Sem parcelas — refaça acima ou adicione.</div>}
      </div>
      <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
        <button type="button" onClick={() => setLista((a) => [...a, { numero_dup: null, data_vencimento: null, valor: null }])} className="text-[11px] text-[#3F7012] font-medium hover:underline">+ adicionar parcela</button>
        <span className={'text-[11px] font-medium ' + (bate ? 'text-[#3F7012]' : 'text-[#A32D2D]')}>soma {brl(soma)} {bate ? '= nota ✅' : `≠ nota ${brl(valorNota ?? 0)}`}</span>
        <button type="button" disabled={!bate} onClick={() => void onSalvar(lista)} className="px-3 py-1.5 rounded-md bg-[#3F7012] text-white font-medium text-[11px] disabled:opacity-40">Salvar parcelas</button>
      </div>
    </div>
  )
}
