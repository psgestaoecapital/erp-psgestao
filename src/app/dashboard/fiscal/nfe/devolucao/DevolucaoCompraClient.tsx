'use client'

// fiscal-devolucao-compra-v1
// Tela de emissao de NFe de devolucao de compra.
// Linguagem: EMITIU NF-e de devolução de compra nº X.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { authFetch } from '@/lib/authFetch'
import { ArrowLeft, Loader2, AlertCircle, Trash2, Plus, RotateCcw } from 'lucide-react'

interface Fornecedor {
  id: string
  razao_social: string | null
  nome_fantasia: string | null
  cnpj_cpf: string | null
  cpf_cnpj: string | null
}

interface Produto {
  id: string
  codigo: string | null
  nome: string
  preco_venda: number | null
}

interface ItemDevol {
  produtoId: string
  produtoLabel: string
  quantidade: number
  valorUnitarioOverride?: number
  cfopOverride: string
  // devolucao-icms-espelho: ICMS por item, pre-preenchido da nota original e editavel.
  icmsBase?: number       // base de calculo do ICMS
  icmsAliquota?: number   // aliquota do ICMS (%)
}

function resolveCompanyId(): string | null {
  if (typeof window === 'undefined') return null
  const sel = localStorage.getItem('ps_empresa_sel')
  if (!sel || sel === 'consolidado' || sel.startsWith('group_')) return null
  return sel
}

function maskChave(v: string): string {
  return v.replace(/\D/g, '').slice(0, 44)
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

export default function DevolucaoCompraClient() {
  const searchParams = useSearchParams()
  const recebidaId = searchParams?.get('recebida_id') ?? null
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [erroEmpresa, setErroEmpresa] = useState<string | null>(null)
  const [prefillMsg, setPrefillMsg] = useState<string | null>(null)
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [fornecedorId, setFornecedorId] = useState('')
  const [chaveCompra, setChaveCompra] = useState('')
  const [natureza, setNatureza] = useState('Devolução de compra')
  const [itens, setItens] = useState<ItemDevol[]>([])
  const [produtoBusca, setProdutoBusca] = useState('')
  // devolucao-icms-espelho: CSOSN da devolucao (default da config da empresa, editavel) e o mapa de
  // tributos da nota de compra original por produto (pre-preenchimento espelhado).
  const [csosnDevol, setCsosnDevol] = useState('900')
  const [tributosMap, setTributosMap] = useState<Record<string, { base?: number; aliquota?: number }>>({})
  // Lei Kandir: o FRETE entra na base do ICMS. A devolução precisa declarar frete/seguro/outras/desconto
  // (pré-preenchidos da nota de compra, editáveis) para o TOTAL bater com a base do ICMS.
  const [frete, setFrete] = useState(0)
  const [seguro, setSeguro] = useState(0)
  const [outras, setOutras] = useState(0)
  const [descontoNota, setDescontoNota] = useState(0)
  const [modalidadeFrete, setModalidadeFrete] = useState<number>(9)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState<{ numero: string; chave?: string } | null>(null)
  const [processandoMsg, setProcessandoMsg] = useState<string | null>(null)

  useEffect(() => {
    const cid = resolveCompanyId()
    if (!cid) {
      setErroEmpresa('Selecione uma empresa específica no trocador da TopNav.')
      return
    }
    setCompanyId(cid)
  }, [])

  // devolucao-icms-espelho: CSOSN default da empresa (editavel na tela antes de emitir).
  useEffect(() => {
    if (!companyId) return
    let alive = true
    void supabase.from('erp_fiscal_provider_config').select('csosn_devolucao')
      .eq('company_id', companyId).eq('provider', 'focusnfe').eq('ativo', true).maybeSingle()
      .then(({ data }) => { if (alive && (data as { csosn_devolucao?: string } | null)?.csosn_devolucao) setCsosnDevol((data as { csosn_devolucao: string }).csosn_devolucao) })
    return () => { alive = false }
  }, [companyId])

  // devolucao-icms-espelho: ao ter a chave (44 digitos), busca os tributos da nota de compra original
  // e monta o mapa por produto (base/aliquota do ICMS) para pre-preencher os itens.
  const chaveDig = chaveCompra.replace(/\D/g, '')
  useEffect(() => {
    if (!companyId || chaveDig.length !== 44) { setTributosMap({}); return }
    let alive = true
    void supabase.rpc('fn_nfe_devolucao_tributos', { p_company_id: companyId, p_chave: chaveDig })
      .then(({ data }) => {
        if (!alive) return
        const r = data as { ok?: boolean; itens?: Array<{ produto_id: string | null; codigo_produto: string | null; icms?: { base?: number; aliquota?: number } | null }> } | null
        if (!r?.ok) { setTributosMap({}); return }
        const m: Record<string, { base?: number; aliquota?: number }> = {}
        for (const it of r.itens ?? []) {
          const icms = it.icms ?? undefined
          if (it.produto_id) m[it.produto_id] = { base: icms?.base ?? undefined, aliquota: icms?.aliquota ?? undefined }
        }
        setTributosMap(m)
      })
    return () => { alive = false }
  }, [companyId, chaveDig])

  // Pre-preenche o ICMS dos itens que ainda nao tem, quando o mapa de tributos chega (nao sobrescreve
  // o que o operador ja editou).
  useEffect(() => {
    if (Object.keys(tributosMap).length === 0) return
    setItens((arr) => arr.map((it) => {
      if (it.icmsBase != null || it.icmsAliquota != null) return it
      const t = tributosMap[it.produtoId]
      return t ? { ...it, icmsBase: t.base, icmsAliquota: t.aliquota } : it
    }))
  }, [tributosMap])

  useEffect(() => {
    if (!companyId) return
    void (async () => {
      const [f, p] = await Promise.all([
        supabase
          .from('erp_fornecedores')
          .select('id, razao_social, nome_fantasia, cnpj_cpf, cpf_cnpj')
          .eq('company_id', companyId)
          .eq('ativo', true)
          .order('razao_social')
          .limit(500),
        supabase
          .from('erp_produtos')
          .select('id, codigo, nome, preco_venda')
          .eq('company_id', companyId)
          .eq('ativo', true)
          .order('nome')
          .limit(500),
      ])
      setFornecedores((f.data ?? []) as Fornecedor[])
      setProdutos((p.data ?? []) as Produto[])
    })()
  }, [companyId])

  // Pré-preenche a partir de uma NF-e recebida (?recebida_id=): fornecedor + chave de origem + itens.
  // Só itens com produto vinculado entram (emissão precisa de produtoId). Itens sem produto ou nota
  // ainda sem XML (resumo) são avisados — o operador completa manualmente pelo buscador de produtos.
  useEffect(() => {
    if (!companyId || !recebidaId) return
    void (async () => {
      const { data: rec } = await supabase
        .from('erp_nfe_recebidas')
        .select('id, chave_acesso, fornecedor_id, valor_frete, valor_seguro, valor_outras, valor_desconto, frete_modalidade')
        .eq('id', recebidaId)
        .eq('company_id', companyId)
        .maybeSingle()
      if (!rec) { setPrefillMsg('Nota recebida não encontrada para pré-preencher.'); return }
      if (rec.chave_acesso) setChaveCompra(maskChave(String(rec.chave_acesso)))
      if (rec.fornecedor_id) setFornecedorId(String(rec.fornecedor_id))
      // pré-preenche os valores que compõem o total (o operador confere/edita antes de emitir)
      setFrete(Number(rec.valor_frete ?? 0))
      setSeguro(Number(rec.valor_seguro ?? 0))
      setOutras(Number(rec.valor_outras ?? 0))
      setDescontoNota(Number(rec.valor_desconto ?? 0))
      // modalidade da nota (0 CIF · 1 FOB · …); se a nota veio sem, mas há frete, assume CIF (0) — senão sem frete (9)
      setModalidadeFrete(rec.frete_modalidade != null ? Number(rec.frete_modalidade) : (Number(rec.valor_frete ?? 0) > 0 ? 0 : 9))

      const { data: its } = await supabase
        .from('erp_nfe_recebidas_itens')
        .select('produto_id, codigo_produto, descricao, quantidade, valor_unitario')
        .eq('nfe_recebida_id', recebidaId)
        .order('numero_item')
      const linhas = its ?? []
      const mapeados = linhas
        .filter((i) => i.produto_id)
        .map((i) => ({
          produtoId: i.produto_id as string,
          produtoLabel: `${i.codigo_produto ? `[${i.codigo_produto}] ` : ''}${i.descricao ?? 'Item'}`,
          quantidade: Number(i.quantidade ?? 1),
          valorUnitarioOverride: Number(i.valor_unitario ?? 0),
          cfopOverride: '5202',
        }))
      if (mapeados.length > 0) setItens(mapeados)

      const semProduto = linhas.length - mapeados.length
      if (linhas.length === 0) {
        setPrefillMsg('Esta nota ainda não tem itens detalhados (XML não aplicado). Busque o XML em Documentos Recebidos, ou adicione os produtos manualmente abaixo. Fornecedor e chave já foram preenchidos.')
      } else if (semProduto > 0) {
        setPrefillMsg(`${semProduto} item(ns) da nota sem produto vinculado ficaram de fora — adicione manualmente se precisar devolvê-los.`)
      } else {
        setPrefillMsg(null)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, recebidaId])

  function adicionarItem(prod: Produto) {
    const t = tributosMap[prod.id]   // ICMS espelhado da nota original, se houver
    setItens((arr) => [
      ...arr,
      {
        produtoId: prod.id,
        produtoLabel: `${prod.codigo ? `[${prod.codigo}] ` : ''}${prod.nome}`,
        quantidade: 1,
        valorUnitarioOverride: prod.preco_venda ?? 0,
        cfopOverride: '5202',
        icmsBase: t?.base,
        icmsAliquota: t?.aliquota,
      },
    ])
    setProdutoBusca('')
  }

  function atualizarItem(idx: number, patch: Partial<ItemDevol>) {
    setItens((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  function removerItem(idx: number) {
    setItens((arr) => arr.filter((_, i) => i !== idx))
  }

  const produtosFiltrados = produtoBusca.trim().length > 0
    ? produtos.filter((p) =>
        p.nome.toLowerCase().includes(produtoBusca.toLowerCase()) ||
        (p.codigo ?? '').toLowerCase().includes(produtoBusca.toLowerCase())
      ).slice(0, 20)
    : []

  const totalItens = itens.reduce((s, it) => s + (it.valorUnitarioOverride ?? 0) * it.quantidade, 0)
  // total da nota = produtos + frete + seguro + outras − desconto (tem que bater com a base do ICMS)
  const totalNota = Number((totalItens + frete + seguro + outras - descontoNota).toFixed(2))
  // base total do ICMS informada nos itens (para o operador ver se BATE com o total)
  const baseIcmsTotal = Number(itens.reduce((s, it) => s + (it.icmsBase != null ? Number(it.icmsBase) : 0), 0).toFixed(2))
  const chaveLimpa = chaveCompra.replace(/\D/g, '')
  const podeEnviar = !!companyId && !!fornecedorId && chaveLimpa.length === 44 && itens.length > 0 && !enviando

  async function emitir() {
    if (!podeEnviar) return
    if (!confirm(`EMITIR NF-e de devolução para ${itens.length} item(ns)?\n\nCFOP / CST devem espelhar a entrada (validar com contador antes de produção).`)) return
    setEnviando(true); setErro(null); setSucesso(null); setProcessandoMsg(null)
    try {
      const resp = await authFetch('/api/fiscal/nfe/devolucao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          fornecedorId,
          chaveCompra: chaveLimpa,
          naturezaOperacao: natureza,
          csosnIcms: csosnDevol.trim() || '900',
          // Lei Kandir: frete/seguro/outras/desconto compõem o total e a base do ICMS.
          frete, seguro, outrasDespesas: outras, desconto: descontoNota, modalidadeFrete,
          itens: itens.map((it) => {
            const base = it.icmsBase != null ? Number(it.icmsBase) : undefined
            const aliq = it.icmsAliquota != null ? Number(it.icmsAliquota) : undefined
            // valor = base × aliq/100 (espelho); so manda o grupo ICMS quando ha base a devolver.
            const valor = base != null && aliq != null ? Math.round(base * aliq) / 100 : undefined
            return {
              produtoId: it.produtoId,
              quantidade: Number(it.quantidade),
              valorUnitarioOverride: Number(it.valorUnitarioOverride ?? 0),
              cfopOverride: it.cfopOverride.trim() || '5202',
              ...(base != null ? { icmsOverride: { base, aliquota: aliq, valor } } : {}),
            }
          }),
        }),
      })
      const json = await resp.json()

      // A Focus é ASSÍNCRONA: no envio ela costuma devolver 'processando' (a SEFAZ ainda não
      // autorizou/rejeitou). Isso NÃO é falha — consultamos o resultado final e mostramos o
      // motivo real. Antes, 'processando' virava "Falha ao emitir devolução" e o motivo (que
      // chega segundos depois pelo webhook) nunca aparecia na tela.
      if (resp.ok && json?.processando && json?.nfeId) {
        setProcessandoMsg(json?.mensagem ?? 'NF-e enviada — processando na SEFAZ…')
        await aguardarResultado(String(json.nfeId))
        setEnviando(false)
        return
      }
      if (!resp.ok || json?.ok === false) {
        // Sempre com motivo — nunca um "Falha" seco. Mostra o que a SEFAZ/Focus devolveu.
        setErro(
          json?.mensagem
            ?? json?.motivoRejeicao
            ?? (json?.status ? `Devolução ${json.status} (SEFAZ não informou o motivo)` : 'Falha ao emitir devolução')
        )
        setEnviando(false)
        return
      }
      setSucesso({ numero: String(json.numero ?? '?'), chave: json.chave })
      setEnviando(false)
      alert(`EMITIU NF-e de devolução de compra nº ${json.numero}.`)
    } catch (e) {
      setErro((e as Error)?.message ?? 'Erro ao emitir')
      setEnviando(false)
    }
  }

  // Consulta o resultado final de uma NF-e que voltou 'processando'. A Focus autoriza/rejeita de
  // forma assíncrona; o webhook grava status + motivo em erp_nfe_emitidas segundos depois. Aqui
  // fazemos poll do próprio registro (RLS por empresa) e surfamos autorização OU o motivo da SEFAZ.
  async function aguardarResultado(nfeId: string) {
    for (let tentativa = 0; tentativa < 12; tentativa++) {
      await new Promise((r) => setTimeout(r, 2500))
      const { data } = await supabase
        .from('erp_nfe_emitidas')
        .select('status, motivo_rejeicao, numero, chave')
        .eq('id', nfeId)
        .maybeSingle()
      const st = (data?.status as string | undefined) ?? undefined
      if (st === 'autorizada') {
        setProcessandoMsg(null)
        setSucesso({ numero: String(data?.numero ?? '?'), chave: (data?.chave as string | null) ?? undefined })
        alert(`EMITIU NF-e de devolução de compra nº ${data?.numero ?? '?'}.`)
        return
      }
      if (st === 'rejeitada' || st === 'denegada') {
        setProcessandoMsg(null)
        setErro((data?.motivo_rejeicao as string | null) ?? `Devolução ${st} pela SEFAZ (sem motivo informado)`)
        return
      }
    }
    // Ainda processando após ~30s: deixa claro que NÃO falhou, só está demorando.
    setProcessandoMsg('A SEFAZ ainda está processando. Atualize a página em instantes para ver a autorização ou o motivo da rejeição (a nota fica na lista de NF-e emitidas).')
  }

  function resetar() {
    setFornecedorId(''); setChaveCompra(''); setNatureza('Devolução de compra')
    setItens([]); setProdutoBusca(''); setErro(null); setSucesso(null); setPrefillMsg(null)
  }

  if (erroEmpresa) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-[#FCEBEB] text-[#A32D2D] p-4 rounded-lg flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <div>{erroEmpresa}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <Link href="/dashboard/fiscal/nfe" className="text-[#3D2314]/65 hover:text-[#3D2314] flex items-center gap-1.5 text-[12.5px]">
          <ArrowLeft size={14} /> NF-e
        </Link>
        <span className="text-[#3D2314]/30">/</span>
        <h1 className="text-[18px] font-semibold text-[#3D2314] flex items-center gap-1.5">
          <RotateCcw size={16} /> Devolução de compra
        </h1>
      </div>

      <div className="mb-4 p-3 bg-[#FBF3E0] border border-[#C8941A]/40 rounded-lg text-[11.5px] text-[#3D2314]/85 leading-snug">
        <strong>Atenção (Pilar 1):</strong> a devolução espelha a NF-e de compra. Ao colar a chave, <strong>base e alíquota do ICMS são pré-preenchidas por item</strong> a partir da nota original (editáveis abaixo) — é o que devolve o crédito ao fornecedor. CFOP sugerido: <strong>5202</strong> (dentro do estado) / <strong>6202</strong> (fora); ICMS-ST use <strong>5411/6411</strong>. O <strong>CSOSN</strong> vem do cadastro da empresa (900 = informa o ICMS). Confira os valores com o contador antes de emitir.
      </div>

      {prefillMsg && (
        <div className="mb-4 p-3 bg-[#EAF1FB] border border-[#2C5AA0]/30 rounded-lg text-[12px] text-[#2C5AA0] flex items-start gap-2">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{prefillMsg}</span>
        </div>
      )}

      {sucesso && (
        <div className="mb-4 p-3 bg-[#E7F4EC] border border-[#1B873F]/40 rounded-lg text-[12.5px] text-[#1B873F]">
          ✓ EMITIU NF-e de devolução de compra nº <strong>{sucesso.numero}</strong>
          {sucesso.chave && <div className="font-mono text-[10.5px] mt-1 text-[#1B873F]/85 break-all">chave: {sucesso.chave}</div>}
        </div>
      )}

      {processandoMsg && (
        <div className="mb-4 p-3 bg-[#FBF3E0] border border-[#C8941A]/50 rounded-lg text-[12.5px] text-[#7A5A0B] flex items-start gap-2">
          <Loader2 size={14} className="animate-spin flex-shrink-0 mt-0.5" />
          <span>{processandoMsg}</span>
        </div>
      )}

      <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4 sm:p-5 mb-4">
        <h2 className="text-[12.5px] font-semibold text-[#3D2314] mb-3">Dados da devolução</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-[#3D2314]/70 mb-1">Fornecedor (destinatário) *</label>
            <select
              value={fornecedorId}
              onChange={(e) => setFornecedorId(e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]"
            >
              <option value="">Selecione...</option>
              {fornecedores.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.razao_social ?? f.nome_fantasia ?? f.id} {f.cnpj_cpf || f.cpf_cnpj ? `· ${f.cnpj_cpf ?? f.cpf_cnpj}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-[#3D2314]/70 mb-1">Natureza da operação</label>
            <input
              type="text"
              value={natureza}
              onChange={(e) => setNatureza(e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]"
            />
          </div>

          <div>
            <label className="block text-[11px] text-[#3D2314]/70 mb-1">CSOSN da devolução (ICMS)</label>
            <input
              type="text"
              value={csosnDevol}
              onChange={(e) => setCsosnDevol(e.target.value.replace(/\D/g, '').slice(0, 3))}
              className="w-full px-3 py-2 text-[13px] font-mono border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]"
            />
            <div className="text-[10.5px] mt-1 text-[#3D2314]/55">Padrão da empresa. <strong>900</strong> = informa o ICMS a devolver (Simples). Confirme com o contador.</div>
          </div>

          {/* Lei Kandir: o frete entra na base do ICMS → a devolução precisa declarar estes valores para o
              total bater com a base. Pré-preenchidos da nota de compra, editáveis. */}
          <div className="sm:col-span-2 rounded-lg border border-[#C8941A]/30 bg-[#FBF4E4] p-3">
            <div className="text-[11px] font-semibold text-[#3D2314] mb-2">Valores que compõem o total <span className="font-normal text-[#3D2314]/60">(o frete entra na base do ICMS — Lei Kandir)</span></div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <label className="block text-[10.5px] text-[#3D2314]/70">Frete
                <input type="number" step="0.01" min="0" value={frete} onChange={(e) => setFrete(Number(e.target.value) || 0)} className="w-full mt-1 px-2 py-1.5 text-[13px] text-right tabular-nums border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]" />
              </label>
              <label className="block text-[10.5px] text-[#3D2314]/70">Seguro
                <input type="number" step="0.01" min="0" value={seguro} onChange={(e) => setSeguro(Number(e.target.value) || 0)} className="w-full mt-1 px-2 py-1.5 text-[13px] text-right tabular-nums border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]" />
              </label>
              <label className="block text-[10.5px] text-[#3D2314]/70">Outras desp.
                <input type="number" step="0.01" min="0" value={outras} onChange={(e) => setOutras(Number(e.target.value) || 0)} className="w-full mt-1 px-2 py-1.5 text-[13px] text-right tabular-nums border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]" />
              </label>
              <label className="block text-[10.5px] text-[#3D2314]/70">Desconto
                <input type="number" step="0.01" min="0" value={descontoNota} onChange={(e) => setDescontoNota(Number(e.target.value) || 0)} className="w-full mt-1 px-2 py-1.5 text-[13px] text-right tabular-nums border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]" />
              </label>
              <label className="block text-[10.5px] text-[#3D2314]/70">Modalidade frete
                <select value={modalidadeFrete} onChange={(e) => setModalidadeFrete(Number(e.target.value))} className="w-full mt-1 px-2 py-1.5 text-[12px] border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]">
                  <option value={0}>0 · CIF (emitente)</option>
                  <option value={1}>1 · FOB (destinatário)</option>
                  <option value={2}>2 · terceiros</option>
                  <option value={3}>3 · próprio (remetente)</option>
                  <option value={4}>4 · próprio (destinatário)</option>
                  <option value={9}>9 · sem frete</option>
                </select>
              </label>
            </div>
            <div className="text-[11px] mt-2 text-[#3D2314]/75">
              Total da devolução: <strong className="tabular-nums">{fmtBRL(totalNota)}</strong> = produtos {fmtBRL(totalItens)} + frete {fmtBRL(frete)} + seguro {fmtBRL(seguro)} + outras {fmtBRL(outras)} − desconto {fmtBRL(descontoNota)}.
              {baseIcmsTotal > 0 && (
                <span className={Math.abs(baseIcmsTotal - totalNota) <= 0.01 ? 'text-[#166534] font-semibold' : 'text-[#B42318] font-semibold'}>
                  {' '}· Base ICMS informada: {fmtBRL(baseIcmsTotal)} — {Math.abs(baseIcmsTotal - totalNota) <= 0.01 ? 'bate ✓' : 'NÃO bate com o total ✗'}
                </span>
              )}
            </div>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-[11px] text-[#3D2314]/70 mb-1">
              Chave da NF-e de compra (44 dígitos) *
            </label>
            <input
              type="text"
              value={chaveCompra}
              onChange={(e) => setChaveCompra(maskChave(e.target.value))}
              placeholder="00000000000000000000000000000000000000000000"
              className="w-full px-3 py-2 text-[13px] font-mono border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]"
            />
            <div className="text-[10.5px] mt-1 text-right">
              <span className={chaveLimpa.length === 44 ? 'text-[#1B873F]' : 'text-[#A32D2D]'}>
                {chaveLimpa.length}/44
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4 sm:p-5 mb-4">
        <h2 className="text-[12.5px] font-semibold text-[#3D2314] mb-3">Itens a devolver</h2>

        <div className="relative mb-3">
          <input
            type="text"
            value={produtoBusca}
            onChange={(e) => setProdutoBusca(e.target.value)}
            placeholder="Buscar produto por nome ou código..."
            className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]"
          />
          {produtosFiltrados.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white border border-[#3D2314]/15 rounded-lg shadow-lg">
              {produtosFiltrados.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => adicionarItem(p)}
                  className="w-full text-left px-3 py-2 hover:bg-[#FAF7F2] flex items-center justify-between gap-2 border-b border-[#3D2314]/5 last:border-0"
                >
                  <span className="text-[12.5px] text-[#3D2314]">
                    {p.codigo && <span className="font-mono text-[10.5px] text-[#3D2314]/55 mr-1.5">[{p.codigo}]</span>}
                    {p.nome}
                  </span>
                  <span className="text-[11px] text-[#3D2314]/65 tabular-nums whitespace-nowrap">{fmtBRL(p.preco_venda ?? 0)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {itens.length === 0 ? (
          <div className="text-center py-6 text-[12px] text-[#3D2314]/55">
            Busque um produto acima para adicionar.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-[#FAF7F2]">
                <tr>
                  <th className="px-2 py-1.5 text-left text-[10.5px] text-[#3D2314]/65 uppercase tracking-wide">Produto</th>
                  <th className="px-2 py-1.5 text-right text-[10.5px] text-[#3D2314]/65 uppercase tracking-wide">Qtd</th>
                  <th className="px-2 py-1.5 text-right text-[10.5px] text-[#3D2314]/65 uppercase tracking-wide">Vlr Unit (R$)</th>
                  <th className="px-2 py-1.5 text-left text-[10.5px] text-[#3D2314]/65 uppercase tracking-wide">CFOP</th>
                  <th className="px-2 py-1.5 text-right text-[10.5px] text-[#3D2314]/65 uppercase tracking-wide" title="Base de cálculo do ICMS (espelho da entrada)">Base ICMS</th>
                  <th className="px-2 py-1.5 text-right text-[10.5px] text-[#3D2314]/65 uppercase tracking-wide" title="Alíquota do ICMS (%)">ICMS %</th>
                  <th className="px-2 py-1.5 text-right text-[10.5px] text-[#3D2314]/65 uppercase tracking-wide">Subtotal</th>
                  <th className="px-2 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {itens.map((it, idx) => {
                  const subtotal = (it.valorUnitarioOverride ?? 0) * it.quantidade
                  return (
                    <tr key={idx} className="border-t border-[#3D2314]/5">
                      <td className="px-2 py-1.5 text-[#3D2314]">{it.produtoLabel}</td>
                      <td className="px-2 py-1.5 text-right">
                        <input
                          type="number" min="0.001" step="0.001"
                          value={it.quantidade}
                          onChange={(e) => atualizarItem(idx, { quantidade: Number(e.target.value) })}
                          className="w-20 px-2 py-1 text-right text-[12px] border border-[#3D2314]/15 rounded"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <input
                          type="number" min="0" step="0.01"
                          value={it.valorUnitarioOverride ?? 0}
                          onChange={(e) => atualizarItem(idx, { valorUnitarioOverride: Number(e.target.value) })}
                          className="w-24 px-2 py-1 text-right text-[12px] border border-[#3D2314]/15 rounded"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={it.cfopOverride}
                          onChange={(e) => atualizarItem(idx, { cfopOverride: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                          className="w-16 px-2 py-1 text-[12px] font-mono border border-[#3D2314]/15 rounded"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <input
                          type="number" min="0" step="0.01"
                          value={it.icmsBase ?? ''}
                          placeholder="—"
                          onChange={(e) => atualizarItem(idx, { icmsBase: e.target.value === '' ? undefined : Number(e.target.value) })}
                          className="w-24 px-2 py-1 text-right text-[12px] border border-[#3D2314]/15 rounded"
                          title="Base de cálculo do ICMS a devolver (espelho da nota de compra)"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <input
                          type="number" min="0" step="0.01"
                          value={it.icmsAliquota ?? ''}
                          placeholder="—"
                          onChange={(e) => atualizarItem(idx, { icmsAliquota: e.target.value === '' ? undefined : Number(e.target.value) })}
                          className="w-16 px-2 py-1 text-right text-[12px] border border-[#3D2314]/15 rounded"
                          title="Alíquota do ICMS (%)"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#3D2314]">{fmtBRL(subtotal)}</td>
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => removerItem(idx)}
                          className="text-[#A32D2D] hover:bg-[#A32D2D]/10 p-1 rounded"
                          aria-label="Remover"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#3D2314]/15 bg-[#FAF7F2]">
                  <td colSpan={6} className="px-2 py-2 text-right text-[#3D2314]/65 text-[11.5px] font-medium uppercase">Subtotal produtos</td>
                  <td className="px-2 py-2 text-right tabular-nums text-[#3D2314] font-semibold">{fmtBRL(totalItens)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {erro && (
        <div className="mb-4 p-3 bg-[#FCEBEB] text-[#A32D2D] text-[12.5px] rounded-lg flex items-start gap-2">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{erro}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2 justify-end">
        <button
          type="button"
          onClick={resetar}
          disabled={enviando}
          className="px-4 py-2 text-[12.5px] font-medium rounded-lg border border-[#3D2314]/20 text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-50"
        >
          Limpar
        </button>
        <button
          type="button"
          onClick={emitir}
          disabled={!podeEnviar}
          data-testid="nfe-devol-emitir"
          className="px-5 py-2 text-[12.5px] font-semibold rounded-lg bg-[#C8941A] text-white hover:bg-[#A77A12] disabled:opacity-50 flex items-center gap-1.5"
        >
          {enviando ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          {enviando ? 'Emitindo…' : 'Emitir devolução'}
        </button>
      </div>
    </div>
  )
}
