'use client'

// GE · Precificação / Markup — ENTREGA 1 (CEO 13/10, Opção A). "Destrava a venda": lista os produtos ativos com
// Custo médio · Estoque · Preço de venda · Margem real (semáforo), avisa no topo quem está sem preço, e forma preços
// em lote por MARGEM ou MARKUP com arredondamento e PRÉVIA obrigatória (nada grava sem confirmar — RD-55).
// RD-26: o cálculo é do motor que já existe no banco — fn_produtos_precos_painel (leitura, custo por permissão),
// fn_produto_margem_real ("conta do preço") e fn_produto_preco_aplicar (grava, um histórico por produto).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Tags, Loader2, AlertTriangle, Calculator, Check, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import MarkupPadraoCard from '@/components/precificacao/MarkupPadraoCard'
import MarkupProdutoCampo from '@/components/precificacao/MarkupProdutoCampo'

type Row = {
  produto_id: string; codigo: string; nome: string; unidade: string | null; estoque: number
  custo: number | null; preco_hoje: number; margem_hoje_pct: number | null
  preco_novo: number | null; margem_nova_pct: number | null
  markup_padrao_pct?: number | null; markup_origem?: 'produto' | 'geral' | null
}
type Cfg = {
  imposto_configurado?: boolean; imposto_pct?: number | null; imposto_override?: number | null
  imposto_fonte?: string | null; margem_meta_pct?: number | null; margem_minima_pct?: number | null
  markup_geral_pct?: number | null
}
type Painel = {
  ok?: boolean; erro?: string; pode_ver_custo?: boolean
  total_ativos?: number; sem_preco?: number; abaixo_custo?: number
  modo?: string | null; produtos?: Row[]; config?: Cfg | null
}
type Filtro = 'todos' | 'sem_preco' | 'margem_negativa' | 'com_custo'
type Modo = 'margem' | 'markup' | 'markup_padrao'
type Arred = 'nenhum' | 'real' | 'noventa' | 'noventa_nove'

const brl = (v: number | null | undefined) => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (v: number | null | undefined) => v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

// semáforo pela margem meta/mínima DA EMPRESA: vermelho < mínima · amarelo entre mínima e meta · verde ≥ meta
// (sem config da empresa, cai para o padrão: vermelho < 0, amarelo < 10%, verde ≥ 10%)
type Nivel = 'vazio' | 'ruim' | 'medio' | 'bom'
function nivelMargem(m: number | null | undefined, meta?: number | null, min?: number | null): Nivel {
  if (m == null) return 'vazio'
  const mn = min ?? 0
  const mt = meta ?? 10
  if (m < mn) return 'ruim'
  if (m < mt) return 'medio'
  return 'bom'
}
const corMargem = (m: number | null | undefined, meta?: number | null, min?: number | null): string =>
  ({ vazio: 'text-[#3D2314]/35', ruim: 'text-[#A32D2D]', medio: 'text-[#B06A00]', bom: 'text-[#3F7012]' })[nivelMargem(m, meta, min)]
const bolaMargem = (m: number | null | undefined, meta?: number | null, min?: number | null): string =>
  ({ vazio: 'bg-[#3D2314]/15', ruim: 'bg-[#A32D2D]', medio: 'bg-[#E0A300]', bom: 'bg-[#3F7012]' })[nivelMargem(m, meta, min)]

export default function PrecificacaoPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)

  const [p, setP] = useState<Painel | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [filtro, setFiltro] = useState<Filtro>('sem_preco')
  const [busca, setBusca] = useState('')
  const [modo, setModo] = useState<Modo>('margem')
  const [valor, setValor] = useState('30')
  const [arred, setArred] = useState<Arred>('noventa')

  const [previa, setPrevia] = useState(false)      // estamos vendo a prévia (preço novo calculado, nada gravado)
  const [gravando, setGravando] = useState(false)
  const [conta, setConta] = useState<{ nome: string; dados: Record<string, unknown> } | null>(null)
  const [mkProduto, setMkProduto] = useState<Row | null>(null)   // editar o markup próprio de um produto (#2710)

  // configuração da empresa (imposto da venda + margem meta/mínima do semáforo)
  const [impostoIn, setImpostoIn] = useState('')
  const [metaIn, setMetaIn] = useState('')
  const [minIn, setMinIn] = useState('')
  const [salvandoCfg, setSalvandoCfg] = useState(false)
  // última tupla (empresa + os 3 valores GRAVADOS) já refletida nos campos. Re-sincroniza quando a empresa muda ou
  // quando o que está GRAVADO muda (ex.: depois de salvar) — nunca num "Calcular prévia"/filtro/busca (o gravado não
  // muda → a digitação do usuário fica intacta). Assim o campo nunca lateja num valor velho nem volta vazio havendo valor.
  const cfgSync = useRef<string | null>(null)

  // parse pt-BR tolerante: aceita "11", "11,5" e "11.5". Vazio/!número → null.
  const num = (s: string): number | null => {
    const t = s.trim().replace(/\s/g, '').replace(',', '.')
    const n = Number(t)
    return t === '' || Number.isNaN(n) ? null : n
  }

  // carrega o painel; quando `comPrevia`, pede ao banco o preço novo (modo/valor/arred) sem gravar nada
  const carregar = useCallback(async (comPrevia: boolean) => {
    if (!empresa) { setP(null); setLoading(false); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_produtos_precos_painel', {
      p_company_id: empresa, p_filtro: filtro, p_busca: busca.trim() || null,
      p_modo: comPrevia ? modo : null, p_valor: comPrevia ? (num(valor) ?? 0) : null, p_arredondar: arred,
    })
    setLoading(false)
    if (error) { setErro(error.message); return }
    const r = data as Painel | null
    if (!r?.ok) { setErro(r?.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : (r?.erro ?? 'Erro ao carregar')); setP(null); return }
    setP(r); setPrevia(comPrevia)
  }, [empresa, filtro, busca, modo, valor, arred])

  useEffect(() => { void carregar(false) }, [empresa, filtro]) // eslint-disable-line react-hooks/exhaustive-deps

  // Prefill dos campos de CONFIG a partir do que está GRAVADO no banco — re-sincroniza quando a empresa muda ou quando
  // o valor gravado muda (depois de salvar). Um "Calcular prévia"/filtro/busca NÃO muda o gravado, então não apaga o
  // que o usuário digitou. Mostra o número com vírgula (pt-BR). (bug 13/10: imposto latejava 11,3289 / campo sumia.)
  const fmtNum = (n: number) => String(n).replace('.', ',')
  const cfg = p?.config
  useEffect(() => {
    if (!empresa || !cfg) return
    // chave = empresa + os valores GRAVADOS (imposto_override é a coluna erp_precificacao_parametros.imposto_venda_pct,
    // nunca um valor derivado do motor). Só re-sincroniza quando essa chave muda.
    const chave = [empresa, cfg.imposto_override ?? '', cfg.margem_meta_pct ?? '', cfg.margem_minima_pct ?? ''].join('|')
    if (cfgSync.current === chave) return
    cfgSync.current = chave
    setImpostoIn(cfg.imposto_override != null ? fmtNum(cfg.imposto_override) : '')
    setMetaIn(cfg.margem_meta_pct != null ? fmtNum(cfg.margem_meta_pct) : '')
    setMinIn(cfg.margem_minima_pct != null ? fmtNum(cfg.margem_minima_pct) : '')
  }, [empresa, cfg])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t) }, [toast])

  const podeCusto = p?.pode_ver_custo !== false
  const rows = p?.produtos ?? []
  const comPrecoNovo = useMemo(() => rows.filter((r) => r.preco_novo != null && r.preco_novo > 0), [rows])
  const metaN = cfg?.margem_meta_pct ?? null
  const minN = cfg?.margem_minima_pct ?? null
  // imposto da venda configurado? sem ele o motor usa 0% e o preço sai errado → bloqueia a gravação (revisão Eng. Chefe)
  const impostoOk = cfg?.imposto_configurado !== false

  async function salvarConfig() {
    if (!empresa) return
    const imp = num(impostoIn), meta = num(metaIn), mn = num(minIn)
    if (imp == null && meta == null && mn == null) { setToast('Informe ao menos um valor para salvar.'); return }
    if (mn != null && meta != null && mn > meta) { setToast('A margem mínima não pode ser maior que a meta.'); return }
    setSalvandoCfg(true)
    const { data } = await supabase.rpc('fn_preco_config_empresa_salvar', {
      p_company_id: empresa, p_imposto_pct: imp, p_margem_meta_pct: meta, p_margem_minima_pct: mn,
    })
    setSalvandoCfg(false)
    const rr = data as { ok?: boolean; erro?: string } | null
    if (!rr?.ok) {
      const msg: Record<string, string> = { imposto_invalido: 'Imposto inválido (0 a 99%).', meta_invalida: 'Informe a margem meta.', minima_maior_que_meta: 'A mínima não pode ser maior que a meta.', sem_acesso: 'Sem acesso.' }
      setToast(rr?.erro ? (msg[rr.erro] ?? 'Não consegui salvar.') : 'Não consegui salvar a configuração.'); return
    }
    setToast('Parâmetros salvos. Recalculando com o imposto e a margem da empresa…')
    // o próximo carregar traz o config gravado; a chave do cfgSync muda e os 3 campos re-sincronizam com o salvo.
    await carregar(previa)
  }

  async function gravar() {
    if (!empresa || comPrecoNovo.length === 0) return
    if (!impostoOk) { setToast('Configure o imposto sobre a venda antes de gravar — sem ele o preço sai errado.'); return }
    if (!confirm(`Gravar o preço novo de ${comPrecoNovo.length} produto(s)? Cada um fica registrado no histórico de preços e pode ser conferido depois.`)) return
    setGravando(true)
    const motivo = modo === 'markup_padrao'
      ? `Formar preços · markup padrão do produto${arred !== 'nenhum' ? ' · arred ' + arred : ''}`
      : `Formar preços · ${modo === 'markup' ? 'markup' : 'margem'} ${Number(valor) || 0}%${arred !== 'nenhum' ? ' · arred ' + arred : ''}`
    let ok = 0
    for (const r of comPrecoNovo) {
      const { data } = await supabase.rpc('fn_produto_preco_aplicar', { p_produto_id: r.produto_id, p_novo_preco: r.preco_novo, p_regra_id: null, p_motivo: motivo })
      if ((data as { ok?: boolean } | null)?.ok) ok++
    }
    setGravando(false)
    setToast(`${ok} de ${comPrecoNovo.length} preço(s) gravado(s) e registrado(s) no histórico.`)
    await carregar(false)
  }

  async function abrirConta(r: Row) {
    if (!empresa || r.custo == null || r.custo <= 0) { setToast('Sem custo cadastrado — não dá para montar a conta do preço.'); return }
    const preco = (previa && r.preco_novo) ? r.preco_novo : r.preco_hoje
    if (!preco || preco <= 0) { setToast('Produto sem preço — forme o preço primeiro.'); return }
    const { data } = await supabase.rpc('fn_preco_conta', { p_company_id: empresa, p_custo: r.custo, p_preco: preco, p_produto_id: r.produto_id })
    const d = data as Record<string, unknown> | null
    if (!d || d.ok === false) { setToast('Não consegui montar a conta do preço.'); return }
    setConta({ nome: r.nome, dados: d })
  }

  if (!empresa) return <div className="min-h-screen bg-[#FAF7F2] p-6 text-[#3D2314]">Selecione uma empresa específica no topo.</div>

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8">
        <div className="text-[11px] text-[#3D2314]/60 tracking-[1px] uppercase font-medium mb-1">Compras · Preço</div>
        <h1 className="text-[24px] sm:text-[28px] font-medium text-[#3D2314] leading-tight flex items-center gap-2">
          <Tags size={22} className="text-[#C8941A]" /> Precificação
        </h1>
        <p className="text-[13px] text-[#3D2314]/70 mt-1.5 max-w-3xl">
          Veja o custo, a margem real de hoje e forme preços em lote — por <strong>margem</strong> (quanto quer que sobre) ou por
          <strong> markup</strong> (quanto multiplicar o custo). <strong>Nada é gravado</strong> antes de você conferir a prévia e confirmar.
        </p>

        {/* Banner: produtos sem preço travam a venda */}
        {podeCusto && (p?.sem_preco ?? 0) > 0 && (
          <div className="mt-4 flex items-start gap-2.5 bg-[#FBEDD6] border border-[#C8941A]/35 rounded-xl px-4 py-3">
            <AlertTriangle size={18} className="text-[#B06A00] shrink-0 mt-0.5" />
            <div className="text-[13px] text-[#5A3A12]">
              <strong>{p?.sem_preco} produto(s) ativo(s) sem preço de venda</strong> — eles travam a venda (não dá para vender a R$ 0).
              {(p?.abaixo_custo ?? 0) > 0 && <> E <strong>{p?.abaixo_custo}</strong> está(ão) sendo vendido(s) abaixo do custo.</>}
              {' '}Use <em>Formar preços</em> abaixo.
              {filtro !== 'sem_preco' && <button type="button" onClick={() => setFiltro('sem_preco')} className="ml-1 underline text-[#A2600B]">ver só os sem preço</button>}
            </div>
          </div>
        )}

        {/* Filtro + busca */}
        <div className="mt-4 flex items-end gap-2 flex-wrap bg-white border border-[#3D2314]/10 rounded-xl p-3">
          <label className="text-[12px] text-[#3D2314]/70 flex flex-col">
            <span className="flex items-center">Mostrar <AjudaCampo chave="compras.precificacao.preco_venda" /></span>
            <select value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)} className="mt-0.5 text-[13px] border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[#3D2314]">
              <option value="sem_preco">Sem preço de venda</option>
              <option value="margem_negativa">Vendendo abaixo do custo</option>
              <option value="com_custo">Com custo cadastrado</option>
              <option value="todos">Todos os ativos</option>
            </select>
          </label>
          <label className="text-[12px] text-[#3D2314]/70 flex flex-col">
            <span className="flex items-center">Buscar<AjudaCampo chave="compras.precificacao.busca" /></span>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void carregar(previa) }} placeholder="nome ou código" className="mt-0.5 w-44 border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[13px] text-[#3D2314]" />
          </label>
          <button type="button" onClick={() => void carregar(previa)} className="text-[12px] px-3 py-1.5 rounded-md border border-[#3D2314]/15 text-[#3D2314]/70 hover:bg-[#3D2314]/5">Atualizar</button>
          <span className="ml-auto text-[11px] text-[#3D2314]/55 self-center">{p?.total_ativos ?? 0} produto(s) ativo(s)</span>
        </div>

        {/* Configuração da empresa: imposto da venda + margem meta/mínima (semáforo) */}
        {podeCusto && (
          <div className={'mt-3 bg-white border rounded-xl p-3 ' + (impostoOk ? 'border-[#3D2314]/10' : 'border-[#A32D2D]/40')}>
            <div className="flex items-center gap-2 text-[13px] font-medium text-[#3D2314] mb-2"><Tags size={15} className="text-[#C8941A]" /> Configuração de preço da empresa</div>
            {!impostoOk && (
              <div className="mb-2 flex items-start gap-2 text-[12px] text-[#A32D2D] bg-[#FBEAEA] border border-[#A32D2D]/25 rounded-md px-3 py-2">
                <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                <span><strong>Imposto sobre a venda não configurado.</strong> O cálculo está usando 0% e o preço sairia mais baixo do que deveria. Informe o imposto abaixo para destravar a gravação.</span>
              </div>
            )}
            <div className="flex items-end gap-2 flex-wrap">
              <label className="text-[12px] text-[#3D2314]/70 flex flex-col">
                <span className="flex items-center">Imposto sobre a venda<AjudaCampo chave="compras.precificacao.imposto_venda" /></span>
                <div className="mt-0.5 flex items-center gap-1">
                  <input type="number" inputMode="decimal" value={impostoIn} onChange={(e) => setImpostoIn(e.target.value)} placeholder="ex. 8,5" className={'w-24 border rounded-md px-2 py-1.5 text-[13px] text-[#3D2314] ' + (impostoOk ? 'border-[#3D2314]/15' : 'border-[#A32D2D]/50')} />
                  <span className="text-[13px] text-[#3D2314]/60">%</span>
                </div>
              </label>
              <label className="text-[12px] text-[#3D2314]/70 flex flex-col">
                <span className="flex items-center">Margem meta<AjudaCampo chave="compras.precificacao.margem_meta" /></span>
                <div className="mt-0.5 flex items-center gap-1">
                  <input type="number" inputMode="decimal" value={metaIn} onChange={(e) => setMetaIn(e.target.value)} placeholder="ex. 25" className="w-20 border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[13px] text-[#3D2314]" />
                  <span className="text-[13px] text-[#3D2314]/60">%</span>
                </div>
              </label>
              <label className="text-[12px] text-[#3D2314]/70 flex flex-col">
                <span className="flex items-center">Margem mínima<AjudaCampo chave="compras.precificacao.margem_minima" /></span>
                <div className="mt-0.5 flex items-center gap-1">
                  <input type="number" inputMode="decimal" value={minIn} onChange={(e) => setMinIn(e.target.value)} placeholder="ex. 10" className="w-20 border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[13px] text-[#3D2314]" />
                  <span className="text-[13px] text-[#3D2314]/60">%</span>
                </div>
              </label>
              <button type="button" onClick={() => void salvarConfig()} disabled={salvandoCfg} className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md bg-[#3D2314] text-white font-medium hover:bg-[#2A1810] disabled:opacity-50">
                {salvandoCfg ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Salvar configuração
              </button>
            </div>
            <div className="mt-1.5 text-[11px] text-[#3D2314]/50">O imposto entra na conta da margem (não vai para a NF-e). Semáforo: vermelho abaixo da mínima · amarelo entre a mínima e a meta · verde na meta ou acima.</div>
          </div>
        )}

        {/* Markup padrão: geral da empresa + markup próprio em massa, com prévia (chamado #2710) */}
        {podeCusto && <MarkupPadraoCard companyId={empresa} markupGeral={cfg?.markup_geral_pct} onMudou={() => void carregar(false)} />}

        {/* Formar preços (só para quem vê custo) */}
        {podeCusto && (
          <div className="mt-3 bg-white border border-[#3D2314]/10 rounded-xl p-3">
            <div className="flex items-center gap-2 text-[13px] font-medium text-[#3D2314] mb-2"><Calculator size={15} className="text-[#C8941A]" /> Formar preços <AjudaCampo chave="compras.precificacao.formar_precos" /></div>
            <div className="flex items-end gap-2 flex-wrap">
              <label className="text-[12px] text-[#3D2314]/70 flex flex-col">
                <span className="flex items-center">Pela<AjudaCampo chave="compras.precificacao.modo" /></span>
                <select value={modo} onChange={(e) => { setModo(e.target.value as Modo); setPrevia(false) }} className="mt-0.5 text-[13px] border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[#3D2314]">
                  <option value="margem">Margem que quero que sobre</option>
                  <option value="markup">Markup sobre o custo</option>
                  <option value="markup_padrao">Markup padrão de cada produto</option>
                </select>
              </label>
              {modo === 'markup_padrao' ? (
                <div className="text-[11px] text-[#3D2314]/60 self-center max-w-[220px] flex items-center">
                  Usa o markup próprio de cada produto; sem o próprio, o geral{cfg?.markup_geral_pct != null ? ` (${pct(cfg.markup_geral_pct)})` : ' (não definido)'}.
                  <AjudaCampo chave="compras.precificacao.markup_padrao_modo" />
                </div>
              ) : (
              <label className="text-[12px] text-[#3D2314]/70 flex flex-col">
                <span className="flex items-center">Percentual<AjudaCampo chave="compras.precificacao.valor" /></span>
                <div className="mt-0.5 flex items-center gap-1">
                  <input type="number" inputMode="decimal" value={valor} onChange={(e) => { setValor(e.target.value); setPrevia(false) }} className="w-20 border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[13px] text-[#3D2314]" />
                  <span className="text-[13px] text-[#3D2314]/60">%</span>
                </div>
              </label>
              )}
              <label className="text-[12px] text-[#3D2314]/70 flex flex-col">
                <span className="flex items-center">Arredondar<AjudaCampo chave="compras.precificacao.arredondar" /></span>
                <select value={arred} onChange={(e) => { setArred(e.target.value as Arred); setPrevia(false) }} className="mt-0.5 text-[13px] border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[#3D2314]">
                  <option value="nenhum">Exato (centavos)</option>
                  <option value="noventa">Terminar em ,90</option>
                  <option value="noventa_nove">Terminar em ,99</option>
                  <option value="real">Inteiro (sem centavos)</option>
                </select>
              </label>
              <button type="button" onClick={() => void carregar(true)} className="text-[12px] px-3 py-1.5 rounded-md bg-[#C8941A] text-white font-medium hover:bg-[#A87810]">Calcular prévia</button>
              {previa && comPrecoNovo.length > 0 && (
                <button type="button" onClick={() => void gravar()} disabled={gravando || !impostoOk} title={!impostoOk ? 'Configure o imposto sobre a venda primeiro' : undefined} className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md bg-[#3F7012] text-white font-medium hover:bg-[#2F5510] disabled:opacity-50 disabled:cursor-not-allowed">
                  {gravando ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Gravar preços ({comPrecoNovo.length})
                </button>
              )}
            </div>
            {previa && !impostoOk && <div className="mt-2 text-[11px] text-[#A32D2D] font-medium flex items-start gap-1"><AlertTriangle size={13} className="shrink-0 mt-0.5" /> Gravação bloqueada: o imposto sobre a venda não está configurado (o preço da prévia está calculado com imposto 0%). Informe o imposto acima e recalcule.</div>}
            {previa && impostoOk && <div className="mt-2 text-[11px] text-[#B06A00]">Prévia calculada — <strong>nada foi gravado</strong>. Confira a coluna “Preço novo” e a margem que ela dá; depois clique em “Gravar preços”.</div>}
          </div>
        )}

        {toast && <div className="mt-3 text-[12px] px-3 py-2 rounded-md bg-[#E8F4DC] text-[#1B3608] border border-[#3F7012]/20">{toast}</div>}

        {/* Tabela */}
        <div className="mt-4 bg-white border border-[#3D2314]/10 rounded-xl overflow-hidden">
          {loading ? (
            <div className="px-4 py-12 text-center text-[#3D2314]/55 flex items-center justify-center gap-2 text-[13px]"><Loader2 className="animate-spin" size={15} /> Carregando…</div>
          ) : erro ? (
            <div className="px-4 py-6 text-[12px] text-[#A32D2D]">Não consegui carregar: {erro}</div>
          ) : rows.length === 0 ? (
            <div className="px-6 py-16 text-center text-[13px] text-[#3D2314]/60">Nenhum produto neste filtro.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-[#3D2314]/55 text-left border-b border-[#3D2314]/8">
                    <th className="px-3 py-2 font-medium">Produto</th>
                    {podeCusto && <th className="px-3 py-2 font-medium text-right"><span className="inline-flex items-center justify-end">Custo médio<AjudaCampo chave="compras.precificacao.custo_medio" /></span></th>}
                    <th className="px-3 py-2 font-medium text-right"><span className="inline-flex items-center justify-end">Estoque<AjudaCampo chave="compras.precificacao.estoque" /></span></th>
                    <th className="px-3 py-2 font-medium text-right"><span className="inline-flex items-center justify-end">Preço de venda<AjudaCampo chave="compras.precificacao.preco_venda" /></span></th>
                    {podeCusto && <th className="px-3 py-2 font-medium text-right"><span className="inline-flex items-center justify-end">Markup<AjudaCampo chave="compras.precificacao.markup_produto" /></span></th>}
                    {podeCusto && <th className="px-3 py-2 font-medium text-right"><span className="inline-flex items-center justify-end">Margem real<AjudaCampo chave="compras.precificacao.margem_real" /></span></th>}
                    {previa && podeCusto && <th className="px-3 py-2 font-medium text-right text-[#3F7012]">Preço novo</th>}
                    {podeCusto && <th className="px-3 py-2"></th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.produto_id} className="border-b border-[#3D2314]/6 align-top">
                      <td className="px-3 py-2">
                        <div className="text-[#3D2314] font-medium truncate max-w-[280px]">{r.nome}</div>
                        <div className="text-[10px] text-[#3D2314]/50">cód {r.codigo}{r.preco_hoje <= 0 && <span className="ml-1.5 text-[#B06A00] font-medium">· sem preço</span>}</div>
                      </td>
                      {podeCusto && <td className="px-3 py-2 text-right tabular-nums text-[#3D2314]">{brl(r.custo)}</td>}
                      <td className="px-3 py-2 text-right tabular-nums text-[#3D2314]/70">{Number(r.estoque).toLocaleString('pt-BR')}{r.unidade ? ' ' + r.unidade : ''}</td>
                      <td className={'px-3 py-2 text-right tabular-nums ' + (r.preco_hoje <= 0 ? 'text-[#B06A00] font-medium' : 'text-[#3D2314]')}>{r.preco_hoje <= 0 ? 'sem preço' : brl(r.preco_hoje)}</td>
                      {podeCusto && (
                        <td className="px-3 py-2 text-right tabular-nums">
                          <button type="button" onClick={() => setMkProduto(r)} title="Alterar o markup deste produto" className="text-[#3D2314] hover:underline">
                            {pct(r.markup_padrao_pct)}
                          </button>
                          <div className="text-[10px] text-[#3D2314]/45">{r.markup_origem === 'produto' ? 'do produto' : r.markup_origem === 'geral' ? 'geral' : 'sem markup'}</div>
                        </td>
                      )}
                      {podeCusto && (
                        <td className={'px-3 py-2 text-right tabular-nums font-medium ' + corMargem(r.margem_hoje_pct, metaN, minN)}>
                          <span className="inline-flex items-center gap-1.5 justify-end"><span className={'w-1.5 h-1.5 rounded-full ' + bolaMargem(r.margem_hoje_pct, metaN, minN)} />{pct(r.margem_hoje_pct)}</span>
                        </td>
                      )}
                      {previa && podeCusto && (
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.preco_novo != null && r.preco_novo > 0
                            ? <div><div className="font-semibold text-[#3F7012]">{brl(r.preco_novo)}</div><div className={'text-[10px] ' + corMargem(r.margem_nova_pct, metaN, minN)}>margem {pct(r.margem_nova_pct)}</div></div>
                            : <span className="text-[#3D2314]/35">—</span>}
                        </td>
                      )}
                      {podeCusto && (
                        <td className="px-3 py-2 text-right">
                          <button type="button" onClick={() => void abrirConta(r)} className="text-[11px] px-2 py-1 rounded-md border border-[#3D2314]/15 text-[#3D2314]/70 hover:bg-[#3D2314]/5 inline-flex items-center gap-1"><Calculator size={12} /> Conta</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mt-3 text-[11px] text-[#3D2314]/55">
          Para precificação por regras com vigência, Simples por anexo e Reforma Tributária, o motor de parâmetros entra na sequência.{' '}
          <Link href="/dashboard/compras/custo-config" className="text-[#BA7517] hover:underline">Configurar imposto/comissão da venda</Link>.
        </div>
      </div>

      {/* Conta do preço */}
      {conta && <ContaPreco nome={conta.nome} dados={conta.dados} onClose={() => setConta(null)} />}

      {/* Markup próprio de um produto (bottom sheet no celular) */}
      {mkProduto && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-4" onClick={() => setMkProduto(null)}>
          <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div><div className="text-[11px] uppercase tracking-wide text-[#3D2314]/50">Markup do produto</div><div className="text-[14px] font-medium text-[#3D2314] truncate max-w-[260px]">{mkProduto.nome}</div></div>
              <button type="button" onClick={() => setMkProduto(null)} className="text-[#3D2314]/50 hover:text-[#3D2314]"><X size={18} /></button>
            </div>
            <MarkupProdutoCampo companyId={empresa} produtoId={mkProduto.produto_id} custo={mkProduto.custo} onSalvo={() => void carregar(previa)} />
          </div>
        </div>
      )}
    </div>
  )
}

// "Conta do preço": de onde vem a margem — custo + imposto + comissão + custo fixo + o que sobra.
function ContaPreco({ nome, dados, onClose }: { nome: string; dados: Record<string, unknown>; onClose: () => void }) {
  const d = dados as {
    preco?: number; custo?: number; markup_pct?: number; margem_liquida?: number; margem_liquida_pct?: number
    deducoes?: { imposto_venda?: number; comissao?: number; custo_fixo?: number }
    avisos?: string[]
  }
  const brl = (v: number | null | undefined) => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const linha = (rot: string, v: number | null | undefined, cor?: string) => (
    <div className="flex items-center justify-between py-1 border-b border-[#3D2314]/6 last:border-0">
      <span className="text-[12px] text-[#3D2314]/70">{rot}</span><span className={'text-[12px] tabular-nums font-medium ' + (cor ?? 'text-[#3D2314]')}>{brl(v)}</span>
    </div>
  )
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-2">
          <div><div className="text-[11px] uppercase tracking-wide text-[#3D2314]/50">Conta do preço</div><div className="text-[14px] font-medium text-[#3D2314] truncate max-w-[260px]">{nome}</div></div>
          <button type="button" onClick={onClose} className="text-[#3D2314]/50 hover:text-[#3D2314]"><X size={18} /></button>
        </div>
        {linha('Preço de venda', d.preco)}
        {linha('( − ) Custo', d.custo)}
        {linha('( − ) Imposto da venda', d.deducoes?.imposto_venda)}
        {linha('( − ) Comissão', d.deducoes?.comissao)}
        {linha('( − ) Custo fixo rateado', d.deducoes?.custo_fixo)}
        {linha('( = ) Margem que sobra', d.margem_liquida, corMargem(d.margem_liquida_pct ?? null))}
        <div className="mt-2 flex items-center justify-between text-[12px]">
          <span className="text-[#3D2314]/70">Margem real</span>
          <span className={'font-semibold ' + corMargem(d.margem_liquida_pct ?? null)}>{d.margem_liquida_pct == null ? '—' : Number(d.margem_liquida_pct).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'}{d.markup_pct != null && <span className="text-[#3D2314]/45 font-normal"> · markup {Number(d.markup_pct).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%</span>}</span>
        </div>
        {Array.isArray(d.avisos) && d.avisos.length > 0 && (
          <ul className="mt-2 space-y-1">{d.avisos.map((a, i) => <li key={i} className="text-[11px] text-[#B06A00] flex gap-1"><AlertTriangle size={12} className="shrink-0 mt-0.5" />{a}</li>)}</ul>
        )}
      </div>
    </div>
  )
}
