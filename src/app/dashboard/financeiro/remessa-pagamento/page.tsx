'use client'

// Tela do operador · Remessa de Pagamento CNAB 240 (Sicoob/Sicredi). Seleciona títulos a pagar, valida por
// forma (RD-51: sem o dado exigido não entra), CONFIRMA ("confirma N pagamentos, R$ X?") e GERA o .rem.
// 🔴 DINHEIRO SAINDO: o ambiente vem da config do banco (homologacao|producao). Em HOMOLOGAÇÃO o arquivo é
// rotulado de teste; em PRODUÇÃO paga de verdade — a tarja, o nome do arquivo e a confirmação mudam conforme.
// Cada remessa fica registrada em erp_remessa_pagamento (ambiente + quem gerou + quando · RD-55).
// Anti-duplicação garantida pelo trigger no banco; a tela ainda pré-filtra títulos em remessa ativa.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { mapearRemessaSicoob, buildArquivoSicoob, mapearRemessaSicredi, buildArquivoSicredi, nomeArquivoRemessaSicredi, parseRetornoSicredi, type TituloPag, type ItemRetornoSicredi } from '@/lib/banco/cnab240'
import { normalizarCodigoBarras } from '@/lib/financeiro/boleto-parser'
import { ehPix } from '@/lib/financeiro/formasPagamento'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERDE = '#2E8B57', VERM = '#A32D2D'
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const escHtml = (s: string) => (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const hoje = () => new Date()
const ddmmaaaa = (d: Date) => `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}`
// Filtro por vencimento na tela de remessa (Jordana: pagamento por período/semana).
const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDias = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const PRESETS_VENC = [
  { v: 'a_pagar', l: 'A pagar (até domingo)' }, { v: 'semana', l: 'Esta semana' }, { v: 'd7', l: 'Próximos 7 dias' },
  { v: 'vencidos', l: 'Vencidos' }, { v: 'mes', l: 'Este mês' }, { v: 'todos', l: 'Todos' }, { v: 'custom', l: 'Personalizado' },
]
function rangeVenc(preset: string, de: string, ate: string): { de: string | null; ate: string | null } {
  const h = hoje()
  const domingo = isoLocal(addDias(addDias(h, -((h.getDay() + 6) % 7)), 6)) // domingo desta semana
  if (preset === 'custom') return { de: de || null, ate: ate || null }
  if (preset === 'todos') return { de: null, ate: null }
  // A pagar (default): TUDO que vence até o próximo domingo — inclui os já vencidos (nada atrasado escondido).
  if (preset === 'a_pagar') return { de: null, ate: domingo }
  if (preset === 'd7') return { de: isoLocal(h), ate: isoLocal(addDias(h, 6)) }
  if (preset === 'vencidos') return { de: null, ate: isoLocal(addDias(h, -1)) }
  if (preset === 'mes') return { de: isoLocal(new Date(h.getFullYear(), h.getMonth(), 1)), ate: isoLocal(new Date(h.getFullYear(), h.getMonth() + 1, 0)) }
  const seg = addDias(h, -((h.getDay() + 6) % 7)) // segunda desta semana
  return { de: isoLocal(seg), ate: isoLocal(addDias(seg, 6)) }
}
const hhmmss = (d: Date) => `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`

type Config = { id: string; ambiente: string; cooperativa: string; agencia_dv: string | null; conta: string; convenio: string }
type Empresa = { cnpj: string; razao_social: string; endereco: string | null; cidade_estado: string | null }
type Row = TituloPag & { _sel: boolean; tipo_chave_pix?: string | null; chave_pix?: string | null }
type RemessaLista = { id: string; numero_sequencial: number; status: string; ambiente: string; arquivo_nome: string | null; total_titulos: number; valor_total: number; gerado_em: string | null; retorno_importado_em: string | null; pode_cancelar: boolean }
type ExtratoItem = { item_id: string; beneficiario: string; descricao: string | null; data_vencimento: string | null; valor: number; forma: string; status_item: string }
type ExtratoResp = { sucesso: boolean; erro?: string; remessa?: { numero_sequencial: number; status: string; ambiente: string; arquivo_nome: string | null; gerado_em: string | null; retorno_importado_em: string | null }; itens?: ExtratoItem[]; total?: number; qtd?: number }
// Payload por pagamento do .RET enviado à RPC de auto-conciliação (casa por identificador, sem escolher remessa).
type RetAutoItem = { codigo_barras: string; valor: number; valor_pago: number; data_pagamento: string | null; ocorrencia: string; pago_hint: boolean }
type RetCasado = { item_id: string; remessa: number; pagar_id: string; descricao: string | null; valor: number; valor_pago: number; resultado: string; ocorrencia: string; motivo: string }
type RetSimples = { item_id?: string; remessa?: number; descricao?: string | null; valor: number; valor_pago?: number; codigo_barras?: string | null; ocorrencia?: string; motivo?: string }
type RetAutoResp = {
  ok: boolean; erro?: string; confirmado?: boolean
  casados?: RetCasado[]; nao_casados?: RetSimples[]; rejeitados?: RetSimples[]; ja_pagos?: RetSimples[]
  qtd_casados?: number; qtd_nao_casados?: number
  resumo?: { total: number; pagos: number; rejeitados: number; ja_pagos: number; erros: number; nao_casados: number }
}

export default function RemessaPagamentoPage() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null

  const [cfg, setCfg] = useState<Config | null>(null)
  const [cfgAviso, setCfgAviso] = useState('')   // config de pagamento ambígua/ausente → não escolher no escuro (RD-51/RD-52)
  const [provider, setProvider] = useState<'sicoob' | 'sicredi'>('sicoob')
  const [emp, setEmp] = useState<Empresa | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [filtro, setFiltro] = useState('')
  const [vencPreset, setVencPreset] = useState('a_pagar')
  const [vencDe, setVencDe] = useState('')
  const [vencAte, setVencAte] = useState('')
  const [confirmar, setConfirmar] = useState(false)
  const [dvInput, setDvInput] = useState('')
  const [numRemessa, setNumRemessa] = useState('')   // NSA da próxima remessa (editável pela Jordana)
  const [ultimoEnviado, setUltimoEnviado] = useState(0) // último NSA já enviado (para o aviso de sequência)
  // Importar RETORNO (baixa automática): upload → auto-conciliação → confirmar. O sistema casa cada
  // pagamento do .RET direto com o título (por código de barras / chave / valor), ATRAVESSANDO todas as
  // remessas — sem escolher remessa e nunca pelo número do arquivo (NSA). RD-52: casamento título↔pagamento.
  const [impOpen, setImpOpen] = useState(false)
  const [impBusy, setImpBusy] = useState(false)
  const [impArquivo, setImpArquivo] = useState('')
  const [impRet, setImpRet] = useState<{ nsa: number; itens: ItemRetornoSicredi[] } | null>(null) // arquivo parseado
  const [impResumo, setImpResumo] = useState<RetAutoResp | null>(null)
  const [impConfirmado, setImpConfirmado] = useState(false)
  // Gestão da remessa: lista + extrato (ver/imprimir/cancelar/remover item)
  const [remessas, setRemessas] = useState<RemessaLista[]>([])
  const [extrato, setExtrato] = useState<ExtratoResp | null>(null)
  const [extratoRem, setExtratoRem] = useState<RemessaLista | null>(null)
  const [gestBusy, setGestBusy] = useState(false)

  const carregar = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    setLoading(true); setMsg('')
    // provider-aware + ambiente-aware: pega os bancos de pagamento (Sicoob/Sicredi) da empresa — em QUALQUER
    // ambiente (homologacao|producao) — e escolhe o que tem cap_pagamento ligado; sem nenhum ligado, cai no
    // Sicoob (retrocompat). O ambiente escolhido rege a tarja/nome do arquivo. Só boleto/segmento J por ora.
    const [{ data: cs }, { data: e }] = await Promise.all([
      supabase.from('erp_banco_provider_config').select('id,provider,ambiente,cooperativa,agencia_dv,conta,convenio,cap_pagamento,ativo')
        .eq('company_id', companyId).in('provider', ['sicoob', 'sicredi']),
      supabase.from('companies').select('cnpj,razao_social,endereco,cidade_estado').eq('id', companyId).single(),
    ])
    const lista = (cs ?? []) as (Config & { provider: string; cap_pagamento: boolean; ativo: boolean })[]
    // Config PRONTA p/ pagamento = ativa + convênio preenchido + cap_pagamento. Se houver >1 ou nenhuma,
    // NÃO escolher no escuro (RD-51/RD-52): avisa e deixa o operador/admin resolver a duplicidade/config.
    const prontas = lista.filter((x) => x.ativo && (x.convenio ?? '').trim() && x.cap_pagamento)
    let escolhida: (typeof lista)[number] | null = null
    let aviso = ''
    if (prontas.length === 1) {
      escolhida = prontas[0]
    } else if (prontas.length > 1) {
      aviso = `Há ${prontas.length} configurações de pagamento prontas (convênios: ${prontas.map((p) => p.convenio).join(', ')}). Deixe só a correta ativa — o sistema não escolhe sozinho.`
    } else if (lista.length > 0) {
      const comConvenioAtivas = lista.filter((x) => x.ativo && (x.convenio ?? '').trim())
      aviso = comConvenioAtivas.length > 1
        ? `Há ${comConvenioAtivas.length} configs ativas com convênio (${comConvenioAtivas.map((p) => p.convenio).join(', ')}), mas nenhuma com "capacidade de pagamento" marcada. Marque cap_pagamento na correta e desative as demais.`
        : 'A configuração do banco não está pronta para pagamento (precisa: ativa + convênio + capacidade de pagamento). Ajuste na configuração do banco.'
    }
    setCfgAviso(aviso)
    setProvider(escolhida?.provider === 'sicredi' ? 'sicredi' : 'sicoob')
    setCfg(escolhida ?? null); setEmp((e as Empresa) ?? null); setDvInput(escolhida?.agencia_dv ?? '')

    // Número sequencial (NSA) da próxima remessa: GREATEST(nosso histórico, seed do provider)+1. A Jordana
    // pode editar antes de gerar (ex.: banco pulou um número, ou migração do Omie). ultimoEnviado = próx-1.
    if (escolhida) {
      const { data: prox } = await supabase.rpc('fn_remessa_proxima_numeracao', { p_company: companyId, p_banco: escolhida.id })
      const p = Number(prox ?? 1)
      setNumRemessa(String(p)); setUltimoEnviado(Math.max(0, p - 1))
    } else { setNumRemessa(''); setUltimoEnviado(0) }

    // títulos a pagar (aberto/vencido) + fornecedor
    const { data: tit } = await supabase.from('erp_pagar')
      .select('id,forma_pagamento,codigo_barras,valor,data_vencimento,numero_documento,descricao,fornecedor_id,tipo_chave_pix,chave_pix')
      .eq('company_id', companyId).in('status', ['aberto', 'vencido']).order('data_vencimento').limit(500)
    const titulos = (tit ?? []) as (TituloPag & { fornecedor_id: string | null; tipo_chave_pix: string | null; chave_pix: string | null })[]

    // fornecedores dos títulos
    const fids = [...new Set(titulos.map((t) => t.fornecedor_id).filter(Boolean))] as string[]
    const fmap = new Map<string, { pix: string | null; cnpj_cpf: string | null; nome: string }>()
    if (fids.length) {
      const { data: forns } = await supabase.from('erp_fornecedores').select('id,pix,cnpj_cpf,razao_social,nome_fantasia').in('id', fids)
      for (const f of (forns ?? []) as { id: string; pix: string | null; cnpj_cpf: string | null; razao_social: string | null; nome_fantasia: string | null }[])
        fmap.set(f.id, { pix: f.pix, cnpj_cpf: f.cnpj_cpf, nome: f.razao_social || f.nome_fantasia || '' })
    }

    // exclui títulos já em remessa ATIVA (cancelada libera; item removido libera). Pré-filtro de UX.
    const { data: ativas } = await supabase.from('erp_remessa_pagamento').select('id').eq('company_id', companyId).in('status', ['gerado', 'enviado', 'retorno_parcial'])
    const rids = (ativas ?? []).map((r) => (r as { id: string }).id)
    const jaEm = new Set<string>()
    if (rids.length) {
      const { data: itens } = await supabase.from('erp_remessa_pagamento_item').select('erp_pagar_id').in('remessa_id', rids).is('removido_em', null)
      for (const i of (itens ?? []) as { erp_pagar_id: string }[]) jaEm.add(i.erp_pagar_id)
    }

    // Data do Pagamento por título = vencimento no próximo dia útil, nunca no passado (evita crítica AP).
    // Fonte única da regra de feriado: RPC fn_remessa_datas_pagamento (não reimplementa feriado no front).
    const disponiveis = titulos.filter((t) => !jaEm.has(t.id))
    const dtPagMap = new Map<string, string>()
    if (disponiveis.length) {
      const { data: dps } = await supabase.rpc('fn_remessa_datas_pagamento', { p_ids: disponiveis.map((t) => t.id) })
      for (const r of (dps ?? []) as { id: string; data_pagamento: string }[]) dtPagMap.set(r.id, r.data_pagamento)
    }
    setRows(disponiveis.map((t) => ({
      ...t,
      fornecedor: t.fornecedor_id ? fmap.get(t.fornecedor_id) ?? null : null,
      data_pagamento_prevista: dtPagMap.get(t.id) ?? null,
      _sel: false,
    })))

    // lista das remessas geradas (gestão: extrato / cancelar / remover item)
    const { data: rems } = await supabase.rpc('fn_remessa_listar', { p_company_id: companyId, p_limit: 40 })
    setRemessas((rems as RemessaLista[] | null) ?? [])
    setLoading(false)
  }, [companyId])

  useEffect(() => { void carregar() }, [carregar])

  const filtradas = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    const { de: vDe, ate: vAte } = rangeVenc(vencPreset, vencDe, vencAte)
    return rows.filter((r) => {
      if (q && !((r.descricao ?? '').toLowerCase().includes(q) || (r.fornecedor?.nome ?? '').toLowerCase().includes(q) || (r.forma_pagamento ?? '').toLowerCase().includes(q))) return false
      const dv = (r.data_vencimento ?? '').slice(0, 10)
      if (vDe && dv && dv < vDe) return false
      if (vAte && dv && dv > vAte) return false
      return true
    })
  }, [rows, filtro, vencPreset, vencDe, vencAte])

  const selecionadas = useMemo(() => rows.filter((r) => r._sel), [rows])
  // Guarda (RD-51): título PIX sem chave (nem no título, nem no cadastro do fornecedor) → o banco rejeita.
  const pixSemChave = useMemo(
    () => selecionadas.filter((t) => ehPix(t.forma_pagamento) && !(t.chave_pix?.trim()) && !(t.fornecedor?.pix?.trim())),
    [selecionadas],
  )
  const preview = useMemo(() => {
    if (!cfg || !emp || !selecionadas.length) return null
    const opts = { dtPagto: hoje().toISOString().slice(0, 10), dataGer: ddmmaaaa(hoje()), horaGer: hhmmss(hoje()), seqArq: 0 }
    return provider === 'sicredi'
      ? mapearRemessaSicredi({ ...cfg, ...emp } as never, selecionadas, opts)
      : mapearRemessaSicoob({ ...cfg, ...emp } as never, selecionadas, opts)
  }, [cfg, emp, selecionadas, provider])

  function toggle(id: string) { setRows((rs) => rs.map((r) => (r.id === id ? { ...r, _sel: !r._sel } : r))) }
  function toggleAll(v: boolean) { setRows((rs) => rs.map((r) => (filtradas.some((f) => f.id === r.id) ? { ...r, _sel: v } : r))) }

  async function salvarDv() {
    if (!cfg || !dvInput.trim()) return
    setBusy(true); setMsg('')
    // A RLS de erp_banco_provider_config só dá UPDATE ao service_role — o .update() do cliente casava
    // 0 linhas sem erro (dizia "salvo" e gravava null). Persistimos via RPC SECURITY DEFINER, que retorna
    // o valor gravado; só confirmamos "salvo" se o banco confirmar.
    const { data, error } = await supabase.rpc('fn_banco_config_salvar_agencia_dv', {
      p_config_id: cfg.id, p_agencia_dv: dvInput.trim(),
    })
    setBusy(false)
    if (error) { setMsg('Erro ao salvar DV: ' + error.message); return }
    const j = data as { sucesso?: boolean; erro?: string; agencia_dv?: string | null } | null
    if (!j?.sucesso) { setMsg('Não salvou o DV: ' + (j?.erro ?? 'erro desconhecido')); return }
    setCfg({ ...cfg, agencia_dv: j.agencia_dv ?? dvInput.trim() }); setMsg('DV da agência salvo.')
  }

  async function gerar() {
    if (!companyId || !cfg || !emp) return
    setConfirmar(false); setBusy(true); setMsg('')
    try {
      // NSA da remessa: usa o número que a Jordana confirmou na tela (semeado/editado), NÃO um novo cálculo.
      // É esse número que vai pro header do arquivo (pos 158-163) e pro registro — o Sicredi controla por ele.
      const seq = Math.trunc(Number(numRemessa))
      if (!Number.isFinite(seq) || seq < 1) throw new Error('Número da remessa inválido — informe um inteiro ≥ 1.')
      const d = hoje()
      const opts = { dtPagto: d.toISOString().slice(0, 10), dataGer: ddmmaaaa(d), horaGer: hhmmss(d), seqArq: seq }
      const res = provider === 'sicredi'
        ? mapearRemessaSicredi({ ...cfg, ...emp } as never, selecionadas, opts)
        : mapearRemessaSicoob({ ...cfg, ...emp } as never, selecionadas, opts)
      if (!res.input) throw new Error('Nada válido para gerar. ' + (res.erros[0]?.motivo ?? ''))

      const isProd = cfg.ambiente === 'producao'
      const { data: authUser } = await supabase.auth.getUser()   // RD-55: quem gerou fica no registro
      // Sicredi exige nome XXXXXXXX.REM (8 díg do número, sem underscore/prefixo). Sicoob mantém o padrão antigo.
      const nomeArq = provider === 'sicredi'
        ? nomeArquivoRemessaSicredi(seq)
        : `REM_${isProd ? '' : 'HOMOLOG_'}${cfg.convenio}_${String(seq).padStart(6, '0')}.rem`
      const { data: rem, error: remErr } = await supabase.from('erp_remessa_pagamento').insert({
        company_id: companyId, banco_provider_id: cfg.id, ambiente: cfg.ambiente, numero_sequencial: seq,
        status: 'gerado', arquivo_nome: nomeArq, total_titulos: res.incluidos.length,
        valor_total: res.totalCentavos / 100, gerado_em: new Date().toISOString(), gerado_por: authUser?.user?.id ?? null,
      }).select('id').single()
      if (remErr) throw remErr
      const remessaId = (rem as { id: string }).id

      const incl = new Set(res.incluidos)
      const itens = selecionadas.filter((t) => incl.has(t.id)).map((t) => {
        const pix = ehPix(t.forma_pagamento)
        // a chave do título tem prioridade; cai pro PIX do cadastro do fornecedor (comportamento atual).
        const chave = (t.chave_pix?.trim() || t.fornecedor?.pix?.trim() || null)
        return {
          remessa_id: remessaId, erp_pagar_id: t.id,
          forma: pix ? 'pix' : (String(t.codigo_barras ?? '').replace(/\D/g, '')[0] === '8' ? 'tributo' : 'boleto'),
          valor: t.valor,
          tipo_chave_pix: pix ? (t.tipo_chave_pix ?? null) : null,
          chave_pix: pix ? chave : null,
        }
      })
      const { error: itErr } = await supabase.from('erp_remessa_pagamento_item').insert(itens)
      if (itErr) throw itErr

      // baixa o .rem em latin-1
      const conteudo = provider === 'sicredi'
        ? buildArquivoSicredi(res.input as Parameters<typeof buildArquivoSicredi>[0])
        : buildArquivoSicoob(res.input as Parameters<typeof buildArquivoSicoob>[0])
      const bytes = new Uint8Array(conteudo.length)
      for (let i = 0; i < conteudo.length; i++) bytes[i] = conteudo.charCodeAt(i) & 0xff
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
      const a = document.createElement('a'); a.href = url; a.download = nomeArq; a.click(); URL.revokeObjectURL(url)

      setMsg(`Remessa ${seq} gerada (${isProd ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO'}): ${res.incluidos.length} pagamentos · ${brl(res.totalCentavos)}. Suba o arquivo no Internet Banking ${labelBanco}${isProd ? ' (produção — paga de verdade)' : ' (ambiente de teste)'}.`)
      void carregar()
    } catch (e) {
      const m = (e as Error).message ?? ''
      // uq_remessa_numeracao_ativa: só ATIVAS colidem (cancelada libera o número). NSA já em uso por remessa ativa.
      setMsg(/uq_remessa_numeracao|duplicate key|23505/.test(m)
        ? `Já existe uma remessa ATIVA com o número ${Math.trunc(Number(numRemessa))} para este banco. Informe outro número.`
        : 'Erro ao gerar: ' + m)
    } finally { setBusy(false) }
  }

  // ── Importar RETORNO (baixa automática · auto-match por título) ───────────────────────────────────
  function abrirImportar() {
    setImpOpen(true); setImpResumo(null); setImpArquivo(''); setImpRet(null); setImpConfirmado(false); setMsg('')
  }

  // Cada pagamento do .RET vira o payload da RPC: casa por código de barras (título único), com o valor de
  // face p/ casar pix/documento, e a data/valor pagos p/ o banco confirmar (linha sem data = rejeição).
  function itensDoRet(ret: { itens: ItemRetornoSicredi[] }): RetAutoItem[] {
    return ret.itens.map((r) => ({
      codigo_barras: normalizarCodigoBarras(r.codBarras) || r.codBarras,
      valor: r.valTitulo, valor_pago: r.valPago, data_pagamento: r.dtPagamento,
      ocorrencia: r.ocorrencia, pago_hint: r.pagoHint,
    }))
  }

  // Sobe o .RET (latin-1), extrai os pagamentos e roda a AUTO-CONCILIAÇÃO (prévia, não grava): casa cada
  // pagamento direto com o título, atravessando TODAS as remessas — sem escolher remessa, nunca pelo NSA.
  async function lerRetorno(file: File) {
    if (!companyId) return
    setImpBusy(true); setImpResumo(null); setImpConfirmado(false); setImpRet(null)
    try {
      // CNAB é latin-1 e posicional: decodifica byte a byte pra não deslocar posições (acentos em nomes).
      const buf = new Uint8Array(await file.arrayBuffer())
      let raw = ''
      for (let i = 0; i < buf.length; i++) raw += String.fromCharCode(buf[i])
      setImpArquivo(file.name)
      const ret = parseRetornoSicredi(raw)
      if (!ret.itens.length) throw new Error('Nenhum pagamento (segmento J) encontrado no arquivo.')
      setImpRet({ nsa: ret.nsa, itens: ret.itens })
      const { data, error } = await supabase.rpc('fn_remessa_retorno_conciliar_auto', {
        p_company_id: companyId, p_itens: itensDoRet(ret), p_confirmar: false,
      })
      if (error) throw error
      setImpResumo(data as RetAutoResp)
    } catch (e) {
      setImpArquivo(file.name)
      setImpResumo({ ok: false, erro: (e as Error).message })
    } finally { setImpBusy(false) }
  }

  // Confirma: roda a RPC gravando (baixa os casados via fn_pagar_baixar_pagamento). Idempotente:
  // reimportar não baixa de novo (título/item já pago vira "já baixado").
  async function confirmarImportar() {
    if (!companyId || !impRet) return
    setImpBusy(true)
    try {
      const { data, error } = await supabase.rpc('fn_remessa_retorno_conciliar_auto', {
        p_company_id: companyId, p_itens: itensDoRet(impRet), p_confirmar: true,
      })
      if (error) throw error
      setImpResumo(data as RetAutoResp); setImpConfirmado(true)
      void carregar()
    } catch (e) {
      setImpResumo({ ok: false, erro: (e as Error).message })
    } finally { setImpBusy(false) }
  }

  // ── Gestão da remessa: extrato / cancelar / remover item ─────────────────────────────────────────
  async function abrirExtrato(rem: RemessaLista) {
    if (!companyId) return
    setExtratoRem(rem); setExtrato(null); setGestBusy(true)
    try {
      const { data, error } = await supabase.rpc('fn_remessa_extrato', { p_remessa_id: rem.id, p_company_id: companyId })
      if (error) throw error
      setExtrato(data as ExtratoResp)
    } catch (e) {
      setExtrato({ sucesso: false, erro: (e as Error).message })
    } finally { setGestBusy(false) }
  }

  async function cancelarRemessa(rem: RemessaLista) {
    if (!companyId) return
    const motivo = prompt(`Cancelar a remessa Nº ${rem.numero_sequencial}?\nOs ${rem.total_titulos} título(s) voltam a ficar disponíveis para uma nova remessa. Nada é apagado.\n\nMotivo (opcional):`)
    if (motivo === null) return
    setGestBusy(true); setMsg('')
    try {
      const { data, error } = await supabase.rpc('fn_remessa_cancelar', { p_remessa_id: rem.id, p_company_id: companyId, p_motivo: motivo || null })
      if (error) throw error
      const j = data as { sucesso?: boolean; erro?: string; orientacao?: string; titulos_liberados?: number } | null
      if (!j?.sucesso) { setMsg('Erro: ' + (j?.orientacao ?? j?.erro ?? 'não foi possível cancelar')); return }
      setMsg(`Remessa ${rem.numero_sequencial} cancelada · ${j.titulos_liberados ?? 0} título(s) liberado(s).`)
      setExtrato(null); setExtratoRem(null); void carregar()
    } catch (e) { setMsg('Erro ao cancelar: ' + (e as Error).message) } finally { setGestBusy(false) }
  }

  async function removerItem(it: ExtratoItem) {
    if (!companyId || !extratoRem) return
    if (!confirm(`Remover "${it.beneficiario}" (${brl(Math.round((it.valor ?? 0) * 100))}) desta remessa?\nO título volta a ficar disponível. Nada é apagado.`)) return
    setGestBusy(true)
    try {
      const { data, error } = await supabase.rpc('fn_remessa_remover_item', { p_item_id: it.item_id, p_company_id: companyId, p_motivo: 'boleto indevido' })
      if (error) throw error
      const j = data as { sucesso?: boolean; erro?: string; orientacao?: string } | null
      if (!j?.sucesso) { setMsg('Erro: ' + (j?.orientacao ?? j?.erro ?? 'não foi possível remover')); return }
      await abrirExtrato(extratoRem); void carregar()   // recarrega extrato + lista
    } catch (e) { setMsg('Erro ao remover: ' + (e as Error).message) } finally { setGestBusy(false) }
  }

  function imprimirExtrato() {
    if (!extrato?.remessa || !extrato.itens) return
    const r = extrato.remessa
    const linhas = extrato.itens.map((i) => `<tr><td>${escHtml(i.beneficiario)}</td><td>${i.data_vencimento ? i.data_vencimento.slice(0, 10).split('-').reverse().join('/') : '—'}</td><td style="text-align:right">${brl(Math.round((i.valor ?? 0) * 100))}</td></tr>`).join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Extrato remessa ${r.numero_sequencial}</title>
      <style>body{font-family:Arial,sans-serif;color:#222;margin:24px}h1{font-size:18px}table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
      th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left}th{background:#f4f0e8}tfoot td{font-weight:bold;border-top:2px solid #333}</style></head>
      <body><h1>Extrato da remessa de pagamento Nº ${r.numero_sequencial}</h1>
      <div style="font-size:12px;color:#555">${escHtml(selInfo.nome)} · ${r.ambiente === 'producao' ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO'} · gerada em ${r.gerado_em ? new Date(r.gerado_em).toLocaleString('pt-BR') : '—'}${r.arquivo_nome ? ' · ' + escHtml(r.arquivo_nome) : ''}</div>
      <table><thead><tr><th>Beneficiário</th><th>Vencimento</th><th style="text-align:right">Valor</th></tr></thead>
      <tbody>${linhas}</tbody>
      <tfoot><tr><td colspan="2">Total · ${extrato.qtd ?? extrato.itens.length} pagamento(s)</td><td style="text-align:right">${brl(Math.round((extrato.total ?? 0) * 100))}</td></tr></tfoot></table>
      <script>window.onload=function(){window.print()}</script></body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  if (!companyId) return <div style={{ background: BG, minHeight: '100vh', padding: 32, color: MUT, fontSize: 14 }}>Selecione uma empresa específica para gerar remessa de pagamento.</div>
  if (loading) return <div style={{ background: BG, minHeight: '100vh', padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div>
  if (!cfg) return (
    <div style={{ background: BG, minHeight: '100vh', padding: 32 }}>
      <div style={{ maxWidth: 560, margin: '40px auto', background: '#FFF', border: `0.5px solid ${cfgAviso ? VERM : LINE}`, borderRadius: 12, padding: 24, color: cfgAviso ? ESP : MUT, fontSize: 14 }}>
        {cfgAviso
          ? <><b>Configuração de pagamento não definida.</b><div style={{ marginTop: 8 }}>{cfgAviso}</div></>
          : 'Esta empresa não tem banco de pagamento (Sicoob ou Sicredi) configurado. Configure o banco antes de gerar remessa.'}
      </div>
    </div>
  )

  const semDv = !cfg.agencia_dv
  const labelBanco = provider === 'sicredi' ? 'Sicredi' : 'Sicoob'
  const isProd = cfg.ambiente === 'producao'
  const seqNum = Math.trunc(Number(numRemessa))
  const seqValido = Number.isFinite(seqNum) && seqNum >= 1
  const seqAbaixo = seqValido && seqNum <= ultimoEnviado   // ≤ último enviado: avisa, mas permite override
  // Duplicidade REAL só entre ATIVAS (não canceladas). Cancelada libera o número (índice parcial no banco).
  const remessaAtivaMesmoNum = seqValido ? remessas.find((r) => r.numero_sequencial === seqNum && r.status !== 'cancelado') : undefined
  const remessaCanceladaMesmoNum = seqValido && !remessaAtivaMesmoNum ? remessas.find((r) => r.numero_sequencial === seqNum && r.status === 'cancelado') : undefined

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '28px 20px' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <header style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>💸 Remessa de Pagamento · {labelBanco}</div>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, color: ESP, margin: '2px 0 0' }}>{selInfo.nome}</h1>
          {isProd ? (
            <div style={{ display: 'inline-block', marginTop: 6, fontSize: 11.5, fontWeight: 800, color: '#FFF', background: VERM, borderRadius: 6, padding: '4px 10px', letterSpacing: 0.3 }}>
              🔴 PRODUÇÃO — PAGA DE VERDADE. Confira valores e beneficiários antes de subir no banco.
            </div>
          ) : (
            <div style={{ display: 'inline-block', marginTop: 6, fontSize: 11, fontWeight: 700, color: VERM, background: '#FBEAEA', border: `0.5px solid ${LINE}`, borderRadius: 6, padding: '3px 8px' }}>
              AMBIENTE DE HOMOLOGAÇÃO — arquivo de teste, não paga de verdade
            </div>
          )}
        </header>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button onClick={abrirImportar} style={btnGhost} title="Importar o arquivo de retorno do banco e dar baixa nos títulos pagos">
            📥 Importar retorno (baixa automática)
          </button>
        </div>

        {msg && <div style={{ margin: '0 0 12px', padding: '8px 12px', borderRadius: 8, fontSize: 12.5, background: msg.startsWith('Erro') ? '#FBEAEA' : '#EAF5EE', color: msg.startsWith('Erro') ? VERM : VERDE, border: `0.5px solid ${LINE}` }}>{msg}</div>}

        {semDv && (
          <div style={{ margin: '0 0 12px', padding: 12, borderRadius: 8, background: '#FBF4E4', border: `0.5px solid ${GOLD}`, fontSize: 12.5, color: ESP }}>
            <b>Falta o DV da agência</b> (cooperativa {cfg.cooperativa}). Confirme com o {labelBanco} e informe para gerar o arquivo:
            <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={dvInput} onChange={(e) => setDvInput(e.target.value)} placeholder="DV" maxLength={2} style={{ width: 60, ...inp }} />
              <button onClick={salvarDv} disabled={busy || !dvInput.trim()} style={btnGhost}>Salvar DV</button>
            </div>
          </div>
        )}

        <div style={{ margin: '0 0 12px', padding: 12, borderRadius: 8, background: '#FFF', border: `0.5px solid ${LINE}`, fontSize: 12.5, color: ESP }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700 }}>Nº da próxima remessa</span>
            <input
              value={numRemessa}
              onChange={(e) => setNumRemessa(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric" placeholder="48"
              style={{ width: 90, textAlign: 'center', fontWeight: 700, ...inp }}
            />
            <span style={{ color: MUT }}>última enviada: <b>{ultimoEnviado}</b> ({labelBanco})</span>
          </div>
          <div style={{ marginTop: 6, color: MUT }}>
            É o número que vai no arquivo (o {labelBanco} controla a remessa por ele). Edite se o banco pulou um número ou na virada do sistema anterior.
          </div>
          {seqAbaixo && (
            <div style={{ marginTop: 6, color: VERM, fontWeight: 600 }}>
              ⚠ O número {seqNum} é ≤ ao último enviado ({ultimoEnviado}). O banco pode recusar por sequência. Confirme com a Jordana antes de gerar.
            </div>
          )}
          {/* duplicidade REAL (ativa) → trava; só cancelada → informa e permite (avisar, não impedir) */}
          {remessaAtivaMesmoNum && (
            <div style={{ marginTop: 6, color: VERM, fontWeight: 700 }}>
              ⛔ Já existe uma remessa <b>ATIVA</b> nº {seqNum}. Escolha outro número.
            </div>
          )}
          {remessaCanceladaMesmoNum && (
            <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 6, background: '#FBF4E4', border: `0.5px solid ${GOLD}`, color: ESP, fontWeight: 600 }}>
              ℹ A remessa nº {seqNum} anterior foi <b>cancelada</b>. Esta será a <b>nova remessa nº {seqNum}</b> — pode gerar.
            </div>
          )}
          {!seqValido && <div style={{ marginTop: 6, color: VERM, fontWeight: 600 }}>⚠ Informe um número inteiro ≥ 1.</div>}
        </div>

        {/* Filtro por vencimento (Jordana: pagamento por período) */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: MUT, marginRight: 2 }}>Vencimento:</span>
          {PRESETS_VENC.map((p) => {
            const on = vencPreset === p.v
            return (
              <button key={p.v} onClick={() => setVencPreset(p.v)}
                style={{ background: on ? ESP : '#FFF', color: on ? '#FFF' : ESP, border: `0.5px solid ${on ? ESP : LINE}`, padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                {p.l}
              </button>
            )
          })}
          {vencPreset === 'custom' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="date" value={vencDe} onChange={(e) => setVencDe(e.target.value)} style={{ ...inp, padding: '5px 8px', fontSize: 12 }} />
              <span style={{ fontSize: 12, color: MUT }}>até</span>
              <input type="date" value={vencAte} onChange={(e) => setVencAte(e.target.value)} style={{ ...inp, padding: '5px 8px', fontSize: 12 }} />
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar por fornecedor, descrição, forma…" style={{ ...inp, flex: 1, minWidth: 220 }} />
          <button onClick={() => toggleAll(true)} style={btnGhost}>Selecionar todos</button>
          <button onClick={() => toggleAll(false)} style={btnGhost}>Limpar</button>
        </div>

        <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
          {filtradas.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: MUT, fontSize: 13 }}>Nenhum título a pagar disponível (ou todos já estão em remessa ativa).</div>
          ) : filtradas.map((r) => {
            const erro = preview?.erros.find((e) => e.id === r.id)
            return (
              <label key={r.id} style={{ display: 'grid', gridTemplateColumns: '22px minmax(0,1fr) auto', alignItems: 'center', columnGap: 12, padding: '10px 14px', borderTop: `0.5px solid ${BG}`, cursor: 'pointer', opacity: r._sel && erro ? 0.6 : 1 }}>
                <input type="checkbox" checked={r._sel} onChange={() => toggle(r.id)} style={{ width: 16, height: 16, margin: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: ESP, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.fornecedor?.nome || r.descricao || '—'}</div>
                  <div style={{ fontSize: 11.5, color: MUT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {(r.forma_pagamento ?? '—')} · venc {r.data_vencimento?.slice(0, 10).split('-').reverse().join('/')}
                    {r.data_pagamento_prevista && <span style={{ color: VERDE }}> · paga {r.data_pagamento_prevista.slice(0, 10).split('-').reverse().join('/')}</span>}
                    {r.numero_documento ? ` · doc ${r.numero_documento}` : ''}
                    {r._sel && erro && <span style={{ color: VERM, fontWeight: 700 }}> · ⚠ {erro.motivo}</span>}
                  </div>
                </div>
                <div style={{ fontSize: 13.5, color: ESP, fontWeight: 600, whiteSpace: 'nowrap', textAlign: 'right' }}>{brl(Math.round((r.valor ?? 0) * 100))}</div>
              </label>
            )
          })}
        </div>

        <div style={{ position: 'sticky', bottom: 0, marginTop: 14, background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, color: ESP }}>
            <b>{preview?.incluidos.length ?? 0}</b> pagamentos válidos · <b>{brl(preview?.totalCentavos ?? 0)}</b>
            {preview && preview.erros.filter((e) => e.id !== '*').length > 0 && <span style={{ color: VERM, marginLeft: 8 }}>({preview.erros.filter((e) => e.id !== '*').length} excluídos)</span>}
          </div>
          <button
            onClick={() => setConfirmar(true)}
            disabled={busy || semDv || !seqValido || !!remessaAtivaMesmoNum || !preview?.input || (preview?.incluidos.length ?? 0) === 0}
            title={remessaAtivaMesmoNum ? `Já existe uma remessa ATIVA nº ${seqNum}` : undefined}
            style={{ ...btnPrimary, background: isProd ? VERM : ESP, opacity: busy || semDv || !seqValido || !!remessaAtivaMesmoNum || !preview?.input ? 0.5 : 1 }}
          >
            {busy ? 'Gerando…' : `Gerar remessa Nº ${seqValido ? seqNum : '—'} (${isProd ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO'})`}
          </button>
        </div>

        {remessas.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginBottom: 8 }}>Remessas geradas</div>
            <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
              {remessas.map((rm) => {
                const cancelada = rm.status === 'cancelado'
                return (
                  <div key={rm.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'center', gap: 10, padding: '10px 14px', borderTop: `0.5px solid ${BG}`, opacity: cancelada ? 0.55 : 1 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, color: ESP, fontWeight: 600 }}>
                        Nº {rm.numero_sequencial} · {brl(Math.round((rm.valor_total ?? 0) * 100))} · {rm.total_titulos} tít.
                        <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: cancelada ? VERM : rm.retorno_importado_em ? VERDE : MUT }}>
                          {cancelada ? 'CANCELADA' : rm.retorno_importado_em ? 'RETORNO PROCESSADO' : rm.status.toUpperCase()}
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: MUT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {rm.arquivo_nome ?? '—'} · {rm.gerado_em ? new Date(rm.gerado_em).toLocaleDateString('pt-BR') : '—'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => abrirExtrato(rm)} disabled={gestBusy} style={btnGhost}>Ver extrato</button>
                      {rm.pode_cancelar && <button onClick={() => cancelarRemessa(rm)} disabled={gestBusy} style={{ ...btnGhost, color: VERM }}>Cancelar</button>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {extratoRem && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => !gestBusy && setExtratoRem(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#FFF', borderRadius: 14, padding: 24, maxWidth: 620, width: '94%', maxHeight: '88vh', overflowY: 'auto', border: `0.5px solid ${LINE}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 400, color: ESP, margin: 0 }}>Extrato · remessa Nº {extratoRem.numero_sequencial}</h3>
              <button onClick={() => setExtratoRem(null)} style={{ ...btnGhost, padding: '4px 10px' }}>Fechar</button>
            </div>
            {gestBusy && !extrato && <div style={{ padding: 16, color: MUT, fontSize: 13 }}>Carregando…</div>}
            {extrato && !extrato.sucesso && <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#FBEAEA', color: VERM, fontSize: 12.5 }}>{extrato.erro}</div>}
            {extrato?.sucesso && (
              <>
                <div style={{ fontSize: 12, color: MUT, margin: '4px 0 10px' }}>
                  {extratoRem.arquivo_nome ?? '—'} · {extratoRem.ambiente === 'producao' ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO'} · gerada {extratoRem.gerado_em ? new Date(extratoRem.gerado_em).toLocaleString('pt-BR') : '—'}
                </div>
                <div style={{ border: `0.5px solid ${LINE}`, borderRadius: 8, overflow: 'hidden' }}>
                  {(extrato.itens ?? []).map((it, i) => (
                    <div key={it.item_id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', gap: 10, alignItems: 'center', padding: '8px 12px', borderTop: i ? `0.5px solid ${BG}` : 'none' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: ESP, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.beneficiario}</div>
                        <div style={{ fontSize: 11, color: MUT }}>venc {it.data_vencimento ? it.data_vencimento.slice(0, 10).split('-').reverse().join('/') : '—'}</div>
                      </div>
                      <div style={{ fontSize: 13, color: ESP, fontWeight: 600, whiteSpace: 'nowrap' }}>{brl(Math.round((it.valor ?? 0) * 100))}</div>
                      {extratoRem.pode_cancelar
                        ? <button onClick={() => removerItem(it)} disabled={gestBusy} title="Remover este boleto da remessa" style={{ ...btnGhost, padding: '3px 8px', color: VERM }}>Remover</button>
                        : <span />}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 14, color: ESP }}>Total · <b>{brl(Math.round((extrato.total ?? 0) * 100))}</b> ({extrato.qtd ?? 0} pagamento{(extrato.qtd ?? 0) === 1 ? '' : 's'})</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={imprimirExtrato} style={btnGhost}>Imprimir</button>
                    {extratoRem.pode_cancelar && <button onClick={() => cancelarRemessa(extratoRem)} disabled={gestBusy} style={{ ...btnPrimary, background: VERM }}>Cancelar remessa</button>}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {confirmar && preview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setConfirmar(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#FFF', borderRadius: 14, padding: 24, maxWidth: 440, width: '90%', border: `0.5px solid ${LINE}` }}>
            <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 400, color: ESP, margin: '0 0 8px' }}>Confirmar geração</h3>
            <p style={{ fontSize: 14, color: ESP, lineHeight: 1.5 }}>
              Você está gerando a <b>remessa Nº {seqNum}</b> — <b>{preview.incluidos.length} pagamentos</b>, total <b>{brl(preview.totalCentavos)}</b>, para <b>{selInfo.nome}</b> — {isProd
                ? <><b style={{ color: VERM }}>PRODUÇÃO — paga de verdade</b>. Ao subir no {labelBanco}, esses valores saem da conta.</>
                : <><b>ambiente de HOMOLOGAÇÃO</b> (arquivo de teste).</>} Confirmar?
            </p>
            {seqAbaixo && <p style={{ fontSize: 12.5, color: VERM, fontWeight: 600, margin: '0 0 8px' }}>⚠ O número {seqNum} é ≤ ao último enviado ({ultimoEnviado}) — o {labelBanco} pode recusar por sequência.</p>}
            {pixSemChave.length > 0 && (
              <p style={{ fontSize: 12.5, color: VERM, fontWeight: 600, margin: '0 0 8px' }}>
                ⚠ {pixSemChave.length} título(s) PIX sem chave (nem no título, nem no cadastro do fornecedor): {pixSemChave.slice(0, 3).map((t) => t.descricao).filter(Boolean).join(', ')}{pixSemChave.length > 3 ? '…' : ''}. Preencha a chave PIX (no título ou no fornecedor) antes de enviar — o banco rejeita PIX sem chave.
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button onClick={() => setConfirmar(false)} style={btnGhost}>Cancelar</button>
              <button onClick={gerar} style={{ ...btnPrimary, background: isProd ? VERM : ESP }}>Confirmar e gerar</button>
            </div>
          </div>
        </div>
      )}

      {impOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => !impBusy && setImpOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#FFF', borderRadius: 14, padding: 24, maxWidth: 560, width: '92%', maxHeight: '86vh', overflowY: 'auto', border: `0.5px solid ${LINE}` }}>
            <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 400, color: ESP, margin: '0 0 4px' }}>Importar retorno do banco</h3>
            <p style={{ fontSize: 12.5, color: MUT, margin: '0 0 12px', lineHeight: 1.5 }}>
              Suba o arquivo de retorno (<b>.ret</b>/.rem) que você baixou no Internet Banking. O sistema acha sozinho os títulos e dá baixa nos que o banco confirmou — <b>não precisa escolher a remessa</b> (um arquivo pode ter pagamentos de várias). Reimportar o mesmo arquivo não baixa de novo.
            </p>

            <label style={{ display: 'block', border: `1px dashed ${LINE}`, borderRadius: 10, padding: 16, textAlign: 'center', cursor: impBusy ? 'default' : 'pointer', color: ESP, fontSize: 13, background: BG }}>
              <input type="file" accept=".ret,.rem,.txt" style={{ display: 'none' }} disabled={impBusy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void lerRetorno(f) }} />
              {impBusy ? 'Processando…' : impArquivo ? `📄 ${impArquivo} — escolher outro` : '📥 Escolher arquivo de retorno'}
            </label>

            {impRet && (
              <div style={{ marginTop: 10, fontSize: 11.5, color: MUT, lineHeight: 1.45 }}>
                Arquivo nº <b>{impRet.nsa}</b> · {impRet.itens.length} pagamento{impRet.itens.length === 1 ? '' : 's'} lido{impRet.itens.length === 1 ? '' : 's'}
                <span> — o número do arquivo é só referência (contador do banco), não entra no casamento.</span>
              </div>
            )}

            {impResumo && !impResumo.ok && (
              <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, fontSize: 12.5, background: '#FBEAEA', color: VERM, border: `0.5px solid ${LINE}` }}>
                {impResumo.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : impResumo.erro}
              </div>
            )}

            {impResumo?.ok && impResumo.resumo && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: ESP, marginBottom: 6 }}>
                  {impConfirmado ? '✅ Baixa concluída' : 'Prévia — confira antes de confirmar'}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
                  <span style={{ padding: '3px 8px', borderRadius: 6, background: '#EAF5EE', color: VERDE, fontWeight: 700 }}>{impResumo.resumo.pagos} {impConfirmado ? 'baixados' : 'a baixar'}</span>
                  {impResumo.resumo.ja_pagos > 0 && <span style={{ padding: '3px 8px', borderRadius: 6, background: BG, color: MUT, fontWeight: 700 }}>{impResumo.resumo.ja_pagos} já baixados</span>}
                  {impResumo.resumo.rejeitados > 0 && <span style={{ padding: '3px 8px', borderRadius: 6, background: '#FBEAEA', color: VERM, fontWeight: 700 }}>{impResumo.resumo.rejeitados} rejeitados</span>}
                  {impResumo.resumo.erros > 0 && <span style={{ padding: '3px 8px', borderRadius: 6, background: '#FBEAEA', color: VERM, fontWeight: 700 }}>{impResumo.resumo.erros} c/ erro</span>}
                  {impResumo.resumo.nao_casados > 0 && <span style={{ padding: '3px 8px', borderRadius: 6, background: BG, color: MUT, fontWeight: 700 }}>{impResumo.resumo.nao_casados} não casados</span>}
                </div>

                {/* casados: título · remessa · valor · ocorrência */}
                {(impResumo.casados ?? []).length > 0 && (
                  <div style={{ marginTop: 10, border: `0.5px solid ${LINE}`, borderRadius: 8, overflow: 'hidden' }}>
                    {(impResumo.casados ?? []).map((c, i) => (
                      <div key={c.item_id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8, alignItems: 'center', padding: '7px 10px', borderTop: i ? `0.5px solid ${BG}` : 'none', fontSize: 12 }}>
                        <div style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <span style={{ color: ESP, fontWeight: 600 }}>{c.descricao || '—'}</span>
                          <span style={{ color: MUT }}> · remessa Nº {c.remessa}{c.ocorrencia ? ` · oc ${c.ocorrencia}` : ''}</span>
                        </div>
                        <span style={{ color: c.resultado === 'erro_baixa' ? VERM : VERDE, fontWeight: 700, whiteSpace: 'nowrap' }}>{brl(Math.round((c.valor ?? 0) * 100))}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* rejeitados pelo banco (casaram título, mas sem confirmação de pagamento) */}
                {(impResumo.rejeitados ?? []).length > 0 && (
                  <div style={{ marginTop: 8, border: `0.5px solid ${LINE}`, borderRadius: 8, overflow: 'hidden' }}>
                    {(impResumo.rejeitados ?? []).map((d, i) => (
                      <div key={i} style={{ padding: '7px 10px', borderTop: i ? `0.5px solid ${BG}` : 'none', fontSize: 12 }}>
                        <b style={{ color: VERM }}>rejeitado</b>
                        <span style={{ color: MUT }}> · {d.descricao || brl(Math.round((d.valor ?? 0) * 100))} — {d.motivo}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* não casados: pagamento do arquivo sem título correspondente (tratar manual) */}
                {(impResumo.nao_casados ?? []).length > 0 && !impConfirmado && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 12, color: MUT, marginBottom: 4 }}>⚠ {(impResumo.nao_casados ?? []).length} pagamento(s) do arquivo sem título correspondente (podem ser pagamentos de fora do sistema — trate manual):</div>
                    <div style={{ border: `0.5px solid ${LINE}`, borderRadius: 8, overflow: 'hidden' }}>
                      {(impResumo.nao_casados ?? []).map((d, i) => (
                        <div key={i} style={{ padding: '6px 10px', borderTop: i ? `0.5px solid ${BG}` : 'none', fontSize: 12, color: MUT }}>
                          {brl(Math.round((d.valor ?? 0) * 100))}{d.codigo_barras ? ` · barra …${String(d.codigo_barras).slice(-8)}` : ''} — não encontrei título correspondente
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setImpOpen(false)} disabled={impBusy} style={btnGhost}>{impConfirmado ? 'Fechar' : 'Cancelar'}</button>
              {impResumo?.ok && !impConfirmado && (impResumo.resumo?.pagos ?? 0) > 0 && (
                <button onClick={confirmarImportar} disabled={impBusy} style={btnPrimary}>
                  {impBusy ? 'Baixando…' : `Confirmar baixa de ${impResumo.resumo?.pagos}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const inp: React.CSSProperties = { fontSize: 13, padding: '7px 9px', border: `0.5px solid ${LINE}`, borderRadius: 8, background: '#FFF', color: ESP }
const btnPrimary: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#FFF', background: ESP, border: 'none', borderRadius: 9, padding: '9px 16px', cursor: 'pointer' }
const btnGhost: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: ESP, background: 'transparent', border: `0.5px solid ${LINE}`, borderRadius: 8, padding: '7px 12px', cursor: 'pointer' }
