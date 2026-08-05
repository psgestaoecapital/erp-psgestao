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
import { mapearRemessaSicoob, buildArquivoSicoob, mapearRemessaSicredi, buildArquivoSicredi, nomeArquivoRemessaSicredi, parseRetornoSicredi, type TituloPag } from '@/lib/banco/cnab240'
import { normalizarCodigoBarras } from '@/lib/financeiro/boleto-parser'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERDE = '#2E8B57', VERM = '#A32D2D'
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const hoje = () => new Date()
const ddmmaaaa = (d: Date) => `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}`
const hhmmss = (d: Date) => `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`

type Config = { id: string; ambiente: string; cooperativa: string; agencia_dv: string | null; conta: string; convenio: string }
type Empresa = { cnpj: string; razao_social: string; endereco: string | null; cidade_estado: string | null }
type Row = TituloPag & { _sel: boolean }
type RetItemPayload = { item_id: string; val_pago: number; dt_pagamento: string | null; ocorrencia: string; pago_hint: boolean }
type RetDetalhe = { resultado: string; motivo?: string; val_pago?: number; val_titulo?: number; ocorrencia?: string }
type RetornoResposta = {
  sucesso: boolean; erro?: string; confirmado?: boolean; remessa_status?: string
  resumo?: { total: number; pagos: number; rejeitados: number; divergentes: number; ja_pagos: number; erros: number }
  detalhes?: RetDetalhe[]
}

export default function RemessaPagamentoPage() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null

  const [cfg, setCfg] = useState<Config | null>(null)
  const [provider, setProvider] = useState<'sicoob' | 'sicredi'>('sicoob')
  const [emp, setEmp] = useState<Empresa | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [filtro, setFiltro] = useState('')
  const [confirmar, setConfirmar] = useState(false)
  const [dvInput, setDvInput] = useState('')
  const [numRemessa, setNumRemessa] = useState('')   // NSA da próxima remessa (editável pela Jordana)
  const [ultimoEnviado, setUltimoEnviado] = useState(0) // último NSA já enviado (para o aviso de sequência)
  // Importar RETORNO (baixa automática): estado do fluxo upload → prévia → confirmar.
  const [impOpen, setImpOpen] = useState(false)
  const [impBusy, setImpBusy] = useState(false)
  const [impArquivo, setImpArquivo] = useState('')
  const [impResumo, setImpResumo] = useState<RetornoResposta | null>(null)
  const [impNaoCasados, setImpNaoCasados] = useState(0)
  const [impPayload, setImpPayload] = useState<{ remessaId: string; itens: RetItemPayload[] } | null>(null)
  const [impConfirmado, setImpConfirmado] = useState(false)

  const carregar = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    setLoading(true); setMsg('')
    // provider-aware + ambiente-aware: pega os bancos de pagamento (Sicoob/Sicredi) da empresa — em QUALQUER
    // ambiente (homologacao|producao) — e escolhe o que tem cap_pagamento ligado; sem nenhum ligado, cai no
    // Sicoob (retrocompat). O ambiente escolhido rege a tarja/nome do arquivo. Só boleto/segmento J por ora.
    const [{ data: cs }, { data: e }] = await Promise.all([
      supabase.from('erp_banco_provider_config').select('id,provider,ambiente,cooperativa,agencia_dv,conta,convenio,cap_pagamento')
        .eq('company_id', companyId).in('provider', ['sicoob', 'sicredi']),
      supabase.from('companies').select('cnpj,razao_social,endereco,cidade_estado').eq('id', companyId).single(),
    ])
    const lista = (cs ?? []) as (Config & { provider: string; cap_pagamento: boolean })[]
    const escolhida = lista.find((x) => x.cap_pagamento) ?? lista.find((x) => x.provider === 'sicoob') ?? lista[0] ?? null
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
      .select('id,forma_pagamento,codigo_barras,valor,data_vencimento,numero_documento,descricao,fornecedor_id')
      .eq('company_id', companyId).in('status', ['aberto', 'vencido']).order('data_vencimento').limit(500)
    const titulos = (tit ?? []) as (TituloPag & { fornecedor_id: string | null })[]

    // fornecedores dos títulos
    const fids = [...new Set(titulos.map((t) => t.fornecedor_id).filter(Boolean))] as string[]
    const fmap = new Map<string, { pix: string | null; cnpj_cpf: string | null; nome: string }>()
    if (fids.length) {
      const { data: forns } = await supabase.from('erp_fornecedores').select('id,pix,cnpj_cpf,razao_social,nome_fantasia').in('id', fids)
      for (const f of (forns ?? []) as { id: string; pix: string | null; cnpj_cpf: string | null; razao_social: string | null; nome_fantasia: string | null }[])
        fmap.set(f.id, { pix: f.pix, cnpj_cpf: f.cnpj_cpf, nome: f.razao_social || f.nome_fantasia || '' })
    }

    // exclui títulos já em remessa ativa (pré-filtro de UX; o trigger é a trava dura)
    const { data: ativas } = await supabase.from('erp_remessa_pagamento').select('id').eq('company_id', companyId).in('status', ['gerado', 'enviado', 'retorno_parcial'])
    const rids = (ativas ?? []).map((r) => (r as { id: string }).id)
    const jaEm = new Set<string>()
    if (rids.length) {
      const { data: itens } = await supabase.from('erp_remessa_pagamento_item').select('erp_pagar_id').in('remessa_id', rids)
      for (const i of (itens ?? []) as { erp_pagar_id: string }[]) jaEm.add(i.erp_pagar_id)
    }

    setRows(titulos.filter((t) => !jaEm.has(t.id)).map((t) => ({ ...t, fornecedor: t.fornecedor_id ? fmap.get(t.fornecedor_id) ?? null : null, _sel: false })))
    setLoading(false)
  }, [companyId])

  useEffect(() => { void carregar() }, [carregar])

  const filtradas = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => (r.descricao ?? '').toLowerCase().includes(q) || (r.fornecedor?.nome ?? '').toLowerCase().includes(q) || (r.forma_pagamento ?? '').toLowerCase().includes(q))
  }, [rows, filtro])

  const selecionadas = useMemo(() => rows.filter((r) => r._sel), [rows])
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
      const itens = selecionadas.filter((t) => incl.has(t.id)).map((t) => ({
        remessa_id: remessaId, erp_pagar_id: t.id,
        forma: (t.forma_pagamento ?? '').toLowerCase() === 'pix' ? 'pix' : (String(t.codigo_barras ?? '').replace(/\D/g, '')[0] === '8' ? 'tributo' : 'boleto'),
        valor: t.valor,
      }))
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
      // uq_remessa_numeracao (company, banco, numero_sequencial): esse NSA já foi usado — não pode repetir.
      setMsg(/uq_remessa_numeracao|duplicate key|23505/.test(m)
        ? `Já existe uma remessa com o número ${Math.trunc(Number(numRemessa))} para este banco. Informe outro número.`
        : 'Erro ao gerar: ' + m)
    } finally { setBusy(false) }
  }

  // ── Importar RETORNO (baixa automática) ──────────────────────────────────────────────────────────
  function abrirImportar() {
    setImpOpen(true); setImpResumo(null); setImpPayload(null); setImpNaoCasados(0); setImpArquivo(''); setImpConfirmado(false); setMsg('')
  }

  // Lê o .ret (latin-1), casa por código de barras com os itens da remessa (pelo NSA do header) e roda a
  // PRÉVIA na RPC (não grava). O casamento é por título; a RPC revalida valor/idempotência (RD-38).
  async function analisarRetorno(file: File) {
    if (!companyId) return
    setImpBusy(true); setImpResumo(null); setImpPayload(null); setImpConfirmado(false)
    try {
      // CNAB é latin-1 e posicional: decodifica byte a byte pra não deslocar posições (acentos em nomes).
      const buf = new Uint8Array(await file.arrayBuffer())
      let raw = ''
      for (let i = 0; i < buf.length; i++) raw += String.fromCharCode(buf[i])
      setImpArquivo(file.name)
      const ret = parseRetornoSicredi(raw)
      if (!ret.itens.length) throw new Error('Nenhum pagamento (segmento J) encontrado no arquivo.')

      // acha a remessa que gerou este retorno pelo NSA do header
      const { data: rem } = await supabase.from('erp_remessa_pagamento')
        .select('id').eq('company_id', companyId).eq('numero_sequencial', ret.nsa).limit(1).maybeSingle()
      if (!rem) throw new Error(`Não encontrei a remessa nº ${ret.nsa} desta empresa. Confira se é o retorno certo.`)
      const remessaId = (rem as { id: string }).id

      // itens da remessa + código de barras do título (pra casar)
      const { data: its } = await supabase.from('erp_remessa_pagamento_item')
        .select('id,erp_pagar_id,valor,status_item').eq('remessa_id', remessaId)
      const items = (its ?? []) as { id: string; erp_pagar_id: string; valor: number; status_item: string }[]
      const pagarIds = items.map((i) => i.erp_pagar_id)
      const barraDoItem = new Map<string, string>()   // barra44 -> item_id
      if (pagarIds.length) {
        const { data: pgs } = await supabase.from('erp_pagar').select('id,codigo_barras').in('id', pagarIds)
        const pagarBarra = new Map((pgs ?? []).map((p) => [(p as { id: string }).id, (p as { codigo_barras: string | null }).codigo_barras]))
        for (const it of items) {
          const b = normalizarCodigoBarras(pagarBarra.get(it.erp_pagar_id) ?? '')
          if (b) barraDoItem.set(b, it.id)
        }
      }

      const itens: RetItemPayload[] = []
      let naoCasados = 0
      for (const r of ret.itens) {
        const itemId = barraDoItem.get(r.codBarras)
        if (!itemId) { naoCasados++; continue }
        itens.push({ item_id: itemId, val_pago: r.valPago, dt_pagamento: r.dtPagamento, ocorrencia: r.ocorrencia, pago_hint: r.pagoHint })
      }
      setImpNaoCasados(naoCasados)
      setImpPayload({ remessaId, itens })

      const { data, error } = await supabase.rpc('fn_remessa_retorno_processar', {
        p_remessa_id: remessaId, p_company_id: companyId, p_itens: itens, p_conta_bancaria_id: null, p_confirmar: false,
      })
      if (error) throw error
      setImpResumo(data as RetornoResposta)
    } catch (e) {
      setImpResumo({ sucesso: false, erro: (e as Error).message })
    } finally { setImpBusy(false) }
  }

  // Confirma: roda a RPC gravando (baixa os pagos, reusa fn_pagar_baixar_pagamento). Idempotente.
  async function confirmarImportar() {
    if (!companyId || !impPayload) return
    setImpBusy(true)
    try {
      const { data, error } = await supabase.rpc('fn_remessa_retorno_processar', {
        p_remessa_id: impPayload.remessaId, p_company_id: companyId, p_itens: impPayload.itens, p_conta_bancaria_id: null, p_confirmar: true,
      })
      if (error) throw error
      setImpResumo(data as RetornoResposta); setImpConfirmado(true)
      void carregar()
    } catch (e) {
      setImpResumo({ sucesso: false, erro: (e as Error).message })
    } finally { setImpBusy(false) }
  }

  if (!companyId) return <div style={{ background: BG, minHeight: '100vh', padding: 32, color: MUT, fontSize: 14 }}>Selecione uma empresa específica para gerar remessa de pagamento.</div>
  if (loading) return <div style={{ background: BG, minHeight: '100vh', padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div>
  if (!cfg) return (
    <div style={{ background: BG, minHeight: '100vh', padding: 32 }}>
      <div style={{ maxWidth: 560, margin: '40px auto', background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 24, color: MUT, fontSize: 14 }}>
        Esta empresa não tem banco de pagamento (Sicoob ou Sicredi) configurado. Configure o banco antes de gerar remessa.
      </div>
    </div>
  )

  const semDv = !cfg.agencia_dv
  const labelBanco = provider === 'sicredi' ? 'Sicredi' : 'Sicoob'
  const isProd = cfg.ambiente === 'producao'
  const seqNum = Math.trunc(Number(numRemessa))
  const seqValido = Number.isFinite(seqNum) && seqNum >= 1
  const seqAbaixo = seqValido && seqNum <= ultimoEnviado   // ≤ último enviado: avisa, mas permite override

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
          {!seqValido && <div style={{ marginTop: 6, color: VERM, fontWeight: 600 }}>⚠ Informe um número inteiro ≥ 1.</div>}
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
                    {(r.forma_pagamento ?? '—')} · venc {r.data_vencimento?.slice(0, 10).split('-').reverse().join('/')}{r.numero_documento ? ` · doc ${r.numero_documento}` : ''}
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
            disabled={busy || semDv || !seqValido || !preview?.input || (preview?.incluidos.length ?? 0) === 0}
            style={{ ...btnPrimary, background: isProd ? VERM : ESP, opacity: busy || semDv || !seqValido || !preview?.input ? 0.5 : 1 }}
          >
            {busy ? 'Gerando…' : `Gerar remessa Nº ${seqValido ? seqNum : '—'} (${isProd ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO'})`}
          </button>
        </div>
      </div>

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
              Suba o arquivo de retorno (<b>.ret</b>/.rem) que você baixou no Internet Banking. O sistema casa cada pagamento com o título, confere o valor e dá baixa nos que o banco confirmou. Reimportar o mesmo arquivo não baixa de novo.
            </p>

            <label style={{ display: 'block', border: `1px dashed ${LINE}`, borderRadius: 10, padding: 16, textAlign: 'center', cursor: impBusy ? 'default' : 'pointer', color: ESP, fontSize: 13, background: BG }}>
              <input type="file" accept=".ret,.rem,.txt" style={{ display: 'none' }} disabled={impBusy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void analisarRetorno(f) }} />
              {impBusy ? 'Processando…' : impArquivo ? `📄 ${impArquivo} — escolher outro` : '📥 Escolher arquivo de retorno'}
            </label>

            {impResumo && !impResumo.sucesso && (
              <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, fontSize: 12.5, background: '#FBEAEA', color: VERM, border: `0.5px solid ${LINE}` }}>{impResumo.erro}</div>
            )}

            {impResumo?.sucesso && impResumo.resumo && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: ESP, marginBottom: 6 }}>
                  {impConfirmado ? '✅ Baixa concluída' : 'Prévia — confira antes de confirmar'}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
                  <span style={{ padding: '3px 8px', borderRadius: 6, background: '#EAF5EE', color: VERDE, fontWeight: 700 }}>{impResumo.resumo.pagos} {impConfirmado ? 'baixados' : 'a baixar'}</span>
                  {impResumo.resumo.ja_pagos > 0 && <span style={{ padding: '3px 8px', borderRadius: 6, background: BG, color: MUT, fontWeight: 700 }}>{impResumo.resumo.ja_pagos} já baixados</span>}
                  {impResumo.resumo.divergentes > 0 && <span style={{ padding: '3px 8px', borderRadius: 6, background: '#FBF4E4', color: '#8a6d1a', fontWeight: 700 }}>{impResumo.resumo.divergentes} c/ valor divergente</span>}
                  {impResumo.resumo.rejeitados > 0 && <span style={{ padding: '3px 8px', borderRadius: 6, background: '#FBEAEA', color: VERM, fontWeight: 700 }}>{impResumo.resumo.rejeitados} rejeitados</span>}
                  {impResumo.resumo.erros > 0 && <span style={{ padding: '3px 8px', borderRadius: 6, background: '#FBEAEA', color: VERM, fontWeight: 700 }}>{impResumo.resumo.erros} c/ erro</span>}
                  {impNaoCasados > 0 && <span style={{ padding: '3px 8px', borderRadius: 6, background: BG, color: MUT, fontWeight: 700 }}>{impNaoCasados} não casados</span>}
                </div>

                {(impResumo.detalhes ?? []).filter((d) => d.resultado !== 'pago' && d.resultado !== 'ja_pago').length > 0 && (
                  <div style={{ marginTop: 10, border: `0.5px solid ${LINE}`, borderRadius: 8, overflow: 'hidden' }}>
                    {(impResumo.detalhes ?? []).filter((d) => d.resultado !== 'pago' && d.resultado !== 'ja_pago').map((d, i) => (
                      <div key={i} style={{ padding: '7px 10px', borderTop: i ? `0.5px solid ${BG}` : 'none', fontSize: 12 }}>
                        <b style={{ color: d.resultado === 'divergente' ? '#8a6d1a' : VERM }}>{d.resultado}</b>
                        <span style={{ color: MUT }}> · {d.motivo}</span>
                      </div>
                    ))}
                  </div>
                )}

                {impNaoCasados > 0 && !impConfirmado && (
                  <div style={{ marginTop: 8, fontSize: 12, color: MUT }}>⚠ {impNaoCasados} pagamento(s) do arquivo não bateram com títulos desta remessa — verifique se é o retorno certo.</div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setImpOpen(false)} disabled={impBusy} style={btnGhost}>{impConfirmado ? 'Fechar' : 'Cancelar'}</button>
              {impResumo?.sucesso && !impConfirmado && (impResumo.resumo?.pagos ?? 0) > 0 && (
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
