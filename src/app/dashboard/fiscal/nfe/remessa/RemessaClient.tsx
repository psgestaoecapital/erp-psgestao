'use client'

// fiscal-devolucao-venda-e-remessa-v1 · Parte B → #3861 (piloto FCR): NF-e avulsa com escolha de CFOP.
// Remessas (conserto, comodato, demonstração…) e outras operações: CFOP numa lista pesquisável (erp_fiscal_cfop_saida),
// natureza sugerida e editável, finalidade + chave referenciada, ICMS da operação, CFOP por item, frete e informações
// complementares. A regra 5/6/7 pela UF é a mesma da rota (src/lib/fiscal/nfeAvulsa.ts) e aparece antes de emitir.
// Os 5 tipos de erp_fiscal_remessa_tipos continuam como atalhos. Nesta etapa a nota não gera título nem mexe no estoque.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { authFetch } from '@/lib/authFetch'
import { esperaConsulta, AVISO_PROCESSANDO } from '@/lib/fiscal/consultaRetorno'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import {
  validarNFeAvulsa, cfopNoCatalogo, formatarCfop, ufDestino, soDigitos,
  ICMS_OPCOES_SIMPLES, ICMS_OPCOES_NORMAL, type CfopSaida, type FinalidadeNFe,
} from '@/lib/fiscal/nfeAvulsa'
import { termosBuscaProduto, filtroTermoProduto, filtroPrefixoProduto, juntarResultados } from '@/lib/fiscal/buscaProdutoAvulsa'
import { ArrowLeft, Loader2, AlertCircle, FileText, Plus, Trash2, Info } from 'lucide-react'

interface DestPessoa {
  id: string
  razao_social: string | null
  nome_fantasia: string | null
  cnpj_cpf: string | null
  cpf_cnpj: string | null
  uf: string | null
  ie: string | null
  contribuinte_icms: string | null
}

interface Produto {
  id: string
  codigo: string | null
  nome: string
  preco_venda: number | null
}

interface RemessaTipo {
  id: string
  nome: string
  natureza: string
  cfop_dentro: string
  cfop_fora: string
}

interface ItemRem {
  produtoId: string
  produtoLabel: string
  quantidade: number
  valorUnitarioOverride?: number
  cfop?: string
}

function resolveCompanyId(): string | null {
  if (typeof window === 'undefined') return null
  const sel = localStorage.getItem('ps_empresa_sel')
  if (!sel || sel === 'consolidado' || sel.startsWith('group_')) return null
  return sel
}

// #3861 · "Corrigir e reenviar" de nota recusada: /dashboard/fiscal/nfe/remessa?reenviar=<erp_nfe_emitidas.id>
function idReenvio(): string | null {
  if (typeof window === 'undefined') return null
  const id = new URLSearchParams(window.location.search).get('reenviar')
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null
}

interface NotaRecusada {
  natureza_operacao: string | null
  finalidade: string | null
  chave_referenciada: string | null
  destinatario_cnpj: string | null
  destinatario_cpf: string | null
  valor_frete: number | string | null
  itens: Array<{ codigo?: string; descricao?: string; quantidade?: number; valorUnitario?: number; cfop?: string; icms?: { cst?: string } }> | null
  payload_enviado: { modalidade_frete?: number; informacoes_adicionais_contribuinte?: string } | null
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

const inputCls = 'w-full px-3 py-2 text-[13px] border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]'
const rotuloCls = 'flex items-center gap-1 text-[11px] text-[#3D2314]/70 mb-1'

export default function RemessaClient() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [erroEmpresa, setErroEmpresa] = useState<string | null>(null)
  const [ufEmpresa, setUfEmpresa] = useState<string | undefined>(undefined)
  const [simples, setSimples] = useState(false)

  const [destTabela, setDestTabela] = useState<'erp_clientes' | 'erp_fornecedores'>('erp_clientes')
  const [pessoas, setPessoas] = useState<DestPessoa[]>([])
  const [destinatarioId, setDestinatarioId] = useState('')

  const [tipos, setTipos] = useState<RemessaTipo[]>([])
  const [catalogo, setCatalogo] = useState<CfopSaida[]>([])
  const [tipoId, setTipoId] = useState('')
  const [natureza, setNatureza] = useState('')
  const [cfop, setCfop] = useState('')
  const [cfopBusca, setCfopBusca] = useState('')
  const [cfopAberto, setCfopAberto] = useState(false)
  const [finalidade, setFinalidade] = useState<FinalidadeNFe>('normal')
  const [chaveRef, setChaveRef] = useState('')
  const [icmsCodigo, setIcmsCodigo] = useState('')
  const [modalidadeFrete, setModalidadeFrete] = useState(9)
  const [valorFrete, setValorFrete] = useState(0)
  const [observacoes, setObservacoes] = useState('')

  const [produtosFiltrados, setProdutosFiltrados] = useState<Produto[]>([])
  const [itens, setItens] = useState<ItemRem[]>([])
  const [produtoBusca, setProdutoBusca] = useState('')

  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState<{ numero: string; chave?: string; danfeUrl?: string } | null>(null)
  // #3861 · 'processando' na Focus NÃO é falha: nota enviada, aguardando a SEFAZ (consulta até a resposta final)
  const [aguardando, setAguardando] = useState<{ nfeId: string; esgotou: boolean } | null>(null)
  const [reenvioDe, setReenvioDe] = useState<string | null>(null)
  const [reenvioInfo, setReenvioInfo] = useState<string | null>(null)
  // destinatário da nota recusada: escolhido depois que a lista da tabela certa carrega
  const [destPendente, setDestPendente] = useState<DestPessoa | null>(null)

  useEffect(() => {
    const cid = resolveCompanyId()
    if (!cid) { setErroEmpresa('Selecione uma empresa específica no trocador da TopNav.'); return }
    setCompanyId(cid)
    setReenvioDe(idReenvio())
  }, [])

  // #3861 · reenvio: preenche destinatário, itens, CFOP, CSOSN, frete e informações complementares da nota recusada.
  // O cadastro do destinatário é lido de novo (IE/endereço atualizados) — a rota também relê tudo ao emitir.
  useEffect(() => {
    if (!companyId || !reenvioDe) return
    void (async () => {
      const { data } = await supabase
        .from('erp_nfe_emitidas')
        .select('natureza_operacao, finalidade, chave_referenciada, destinatario_cnpj, destinatario_cpf, valor_frete, itens, payload_enviado')
        .eq('id', reenvioDe).eq('company_id', companyId).maybeSingle()
      const nota = data as NotaRecusada | null
      if (!nota) { setReenvioInfo('Não encontrei a nota recusada nesta empresa: preencha a emissão manualmente.'); return }
      const doc = soDigitos(nota.destinatario_cnpj ?? nota.destinatario_cpf)
      const colsDest = 'id, razao_social, nome_fantasia, cnpj_cpf, cpf_cnpj, uf, ie, contribuinte_icms'
      let achado: { tabela: 'erp_clientes' | 'erp_fornecedores'; pessoa: DestPessoa } | null = null
      for (const tabela of ['erp_clientes', 'erp_fornecedores'] as const) {
        if (!doc) break
        const { data: p } = await supabase.from(tabela).select(colsDest)
          .eq('company_id', companyId).eq('cnpj_cpf', doc).eq('ativo', true).limit(1).maybeSingle()
        if (p) { achado = { tabela, pessoa: p as DestPessoa }; break }
      }
      if (achado) { setDestTabela(achado.tabela); setDestPendente(achado.pessoa) }

      const itensNota = nota.itens ?? []
      const codigos = [...new Set(itensNota.map((it) => it.codigo).filter((c): c is string => !!c))]
      const { data: prods } = codigos.length
        ? await supabase.from('erp_produtos').select('id, codigo, nome, preco_venda')
          .eq('company_id', companyId).eq('ativo', true).in('codigo', codigos)
        : { data: [] as Produto[] }
      const porCodigo = new Map(((prods ?? []) as Produto[]).map((p) => [p.codigo ?? '', p]))
      const cfopNota = soDigitos(itensNota[0]?.cfop)
      const faltando: string[] = []
      const novos: ItemRem[] = []
      for (const it of itensNota) {
        const prod = it.codigo ? porCodigo.get(it.codigo) : undefined
        if (!prod) { faltando.push(it.descricao ?? it.codigo ?? '?'); continue }
        const cfopItem = soDigitos(it.cfop)
        novos.push({
          produtoId: prod.id,
          produtoLabel: `${prod.codigo ? `[${prod.codigo}] ` : ''}${prod.nome}`,
          quantidade: Number(it.quantidade ?? 1),
          valorUnitarioOverride: Number(it.valorUnitario ?? prod.preco_venda ?? 0),
          ...(cfopItem && cfopItem !== cfopNota ? { cfop: cfopItem } : {}),
        })
      }
      setItens(novos)
      if (cfopNota) setCfop(cfopNota)
      if (nota.natureza_operacao) setNatureza(nota.natureza_operacao)
      if (nota.finalidade === 'normal' || nota.finalidade === 'complementar' || nota.finalidade === 'ajuste' || nota.finalidade === 'devolucao') {
        setFinalidade(nota.finalidade)
      }
      if (nota.chave_referenciada) setChaveRef(nota.chave_referenciada)
      const csts = new Set(itensNota.map((it) => soDigitos(it.icms?.cst)).filter(Boolean))
      // só os códigos de operação sem destaque (400/900 · 41/50/90); venda (101/102…) segue o ICMS do cadastro do produto
      const opcoesOperacao = [...ICMS_OPCOES_SIMPLES, ...ICMS_OPCOES_NORMAL].map((o) => o.codigo)
      if (csts.size === 1 && opcoesOperacao.includes([...csts][0])) setIcmsCodigo([...csts][0])
      const frete = Number(nota.valor_frete ?? 0)
      const modalidade = nota.payload_enviado?.modalidade_frete
      if (typeof modalidade === 'number') setModalidadeFrete(modalidade)
      if (frete > 0) setValorFrete(frete)
      if (nota.payload_enviado?.informacoes_adicionais_contribuinte) setObservacoes(nota.payload_enviado.informacoes_adicionais_contribuinte)
      const avisos = [
        !achado ? 'destinatário não encontrado no cadastro (escolha abaixo)' : null,
        faltando.length ? `item(ns) sem produto ativo com o mesmo código: ${faltando.join(', ')}` : null,
      ].filter(Boolean)
      setReenvioInfo(`Dados da nota recusada carregados, com o cadastro atual do destinatário. Confira, corrija e emita.${avisos.length ? ` Atenção: ${avisos.join('; ')}.` : ''}`)
    })()
  }, [companyId, reenvioDe])

  useEffect(() => {
    if (!companyId) return
    void (async () => {
      const [t, c, e] = await Promise.all([
        supabase
          .from('erp_fiscal_remessa_tipos')
          .select('id, nome, natureza, cfop_dentro, cfop_fora')
          .eq('ativo', true)
          .or(`company_id.is.null,company_id.eq.${companyId}`)
          .order('nome'),
        supabase
          .from('erp_fiscal_cfop_saida')
          .select('cfop, descricao, natureza_sugerida, exige_referenciada')
          .eq('ativo', true)
          .order('cfop'),
        supabase.from('companies').select('uf_fiscal, regime_tributario').eq('id', companyId).maybeSingle(),
      ])
      setTipos((t.data ?? []) as RemessaTipo[])
      setCatalogo((c.data ?? []) as CfopSaida[])
      const emp = (e.data ?? {}) as { uf_fiscal?: string | null; regime_tributario?: string | null }
      setUfEmpresa(ufDestino(emp.uf_fiscal))
      setSimples(String(emp.regime_tributario ?? '').toLowerCase().includes('simples'))
    })()
  }, [companyId])

  useEffect(() => {
    if (!companyId) return
    let cancelado = false
    void (async () => {
      const { data } = await supabase
        .from(destTabela)
        .select('id, razao_social, nome_fantasia, cnpj_cpf, cpf_cnpj, uf, ie, contribuinte_icms')
        .eq('company_id', companyId)
        .eq('ativo', true)
        .order('razao_social')
        .limit(500)
      if (cancelado) return
      const lista = (data ?? []) as DestPessoa[]
      // reenvio: garante o destinatário da nota recusada na lista (a lista corta em 500)
      if (destPendente && !lista.some((p) => p.id === destPendente.id)) lista.unshift(destPendente)
      setPessoas(lista)
      setDestinatarioId(destPendente && lista.some((p) => p.id === destPendente.id) ? destPendente.id : '')
    })()
    return () => { cancelado = true }
  }, [companyId, destTabela, destPendente])

  const destinatario = pessoas.find((p) => p.id === destinatarioId)
  const ufDest = ufDestino(destinatario?.uf)

  function escolherCfop(codigo: string) {
    const c = soDigitos(codigo)
    setCfop(c)
    setCfopBusca('')
    setCfopAberto(false)
    const doCatalogo = cfopNoCatalogo(c, catalogo)
    if (doCatalogo) setNatureza(doCatalogo.natureza_sugerida)
  }

  function aplicarTipo(id: string) {
    setTipoId(id)
    const t = tipos.find((x) => x.id === id)
    if (t) {
      setCfop(soDigitos(t.cfop_dentro))
      setNatureza(t.natureza)
    }
  }

  function adicionarItem(prod: Produto) {
    setItens((arr) => [
      ...arr,
      {
        produtoId: prod.id,
        produtoLabel: `${prod.codigo ? `[${prod.codigo}] ` : ''}${prod.nome}`,
        quantidade: 1,
        valorUnitarioOverride: prod.preco_venda ?? 0,
      },
    ])
    setProdutoBusca('')
  }

  function atualizarItem(idx: number, patch: Partial<ItemRem>) {
    setItens((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  function removerItem(idx: number) {
    setItens((arr) => arr.filter((_, i) => i !== idx))
  }

  // #3861: busca no banco (todos os produtos ativos da empresa), não numa lista dos 500 primeiros.
  useEffect(() => {
    const termos = termosBuscaProduto(produtoBusca)
    if (!companyId || termos.length === 0) { setProdutosFiltrados([]); return }
    let cancelado = false
    const h = window.setTimeout(async () => {
      const consulta = () => {
        let q = supabase
          .from('erp_produtos')
          .select('id, codigo, nome, preco_venda')
          .eq('company_id', companyId)
          .eq('ativo', true)
        for (const t of termos) q = q.or(filtroTermoProduto(t))
        return q
      }
      const [comeca, contem] = await Promise.all([
        consulta().or(filtroPrefixoProduto(termos[0])).order('nome').limit(30),
        consulta().order('nome').limit(50),
      ])
      if (!cancelado) {
        setProdutosFiltrados(juntarResultados((comeca.data ?? []) as Produto[], (contem.data ?? []) as Produto[]))
      }
    }, 250)
    return () => { cancelado = true; window.clearTimeout(h) }
  }, [produtoBusca, companyId])

  const cfopsFiltrados = useMemo(() => {
    const q = cfopBusca.trim().toLowerCase()
    const qDig = soDigitos(q)
    const lista = q
      ? catalogo.filter((c) => (qDig && c.cfop.includes(qDig)) || c.descricao.toLowerCase().includes(q))
      : catalogo
    return lista.slice(0, 40)
  }, [catalogo, cfopBusca])

  // mesma regra da rota, ao vivo: troca 5↔6 pela UF, finalidade/chave e ICMS da operação
  const previa = useMemo(() => {
    if (!cfop || !destinatario) return null
    return validarNFeAvulsa({
      cfop,
      itensCfop: itens.map((it) => it.cfop),
      ufEmitente: ufEmpresa,
      ufDestino: ufDest,
      finalidade,
      chaveReferenciada: chaveRef,
      icmsCodigo,
      simples,
      catalogo,
      destinatario: { doc: destinatario.cnpj_cpf ?? destinatario.cpf_cnpj, ie: destinatario.ie, contribuinteIcms: destinatario.contribuinte_icms },
    })
  }, [cfop, destinatario, itens, ufEmpresa, ufDest, finalidade, chaveRef, icmsCodigo, simples, catalogo])

  const cfopAtual = cfopNoCatalogo(cfop, catalogo)
  const icmsOpcoes = simples ? ICMS_OPCOES_SIMPLES : ICMS_OPCOES_NORMAL
  const totalItens = itens.reduce((s, it) => s + (it.valorUnitarioOverride ?? 0) * it.quantidade, 0)
  const podeEnviar = !!companyId && !!destinatarioId && !!cfop && !!natureza && itens.length > 0 && !enviando
    && !aguardando && !!previa && previa.erros.length === 0

  async function consultarRetorno(nfeId: string, tentativa: number) {
    const espera = esperaConsulta(tentativa)
    if (espera === null) { setAguardando({ nfeId, esgotou: true }); return }
    await new Promise((r) => setTimeout(r, espera))
    try {
      const r = await authFetch(`/api/fiscal/nfe/consultar/${nfeId}`)
      const json = await r.json()
      if (json?.status === 'autorizada') {
        setAguardando(null)
        setSucesso({ numero: String(json.numero ?? '?'), chave: json.chave, danfeUrl: json.danfeUrl })
        return
      }
      if (json?.status === 'rejeitada' || json?.status === 'denegada') {
        setAguardando(null)
        setErro(`Nota ${json.status} pela SEFAZ: ${json.motivoRejeicao ?? 'motivo não informado'}. Use "Corrigir e reenviar" em Notas emitidas.`)
        return
      }
    } catch { /* falha de rede na consulta: tenta de novo no próximo degrau */ }
    void consultarRetorno(nfeId, tentativa + 1)
  }

  function consultarAgora() {
    if (!aguardando) return
    setAguardando({ nfeId: aguardando.nfeId, esgotou: false })
    void consultarRetorno(aguardando.nfeId, 0)
  }

  async function emitir() {
    if (!podeEnviar || !previa) return
    const resumo = `EMITIR NF-e avulsa · CFOP ${formatarCfop(previa.cfop)} · ${itens.length} item(ns)?`
    const avisos = previa.avisos.length ? `\n\nAvisos:\n- ${previa.avisos.join('\n- ')}` : ''
    if (!confirm(resumo + avisos)) return
    setEnviando(true); setErro(null); setSucesso(null)
    try {
      const resp = await authFetch('/api/fiscal/nfe/remessa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          destinatarioId,
          destinatarioTabela: destTabela,
          tipoId: tipoId || null,
          cfop: soDigitos(cfop),
          naturezaOperacao: natureza,
          ...(reenvioDe ? { reenvioDe } : {}),
          finalidade,
          chaveReferenciada: soDigitos(chaveRef) || undefined,
          icmsCodigo: icmsCodigo || undefined,
          observacoes: observacoes.trim() || undefined,
          modalidadeFrete,
          valorFrete,
          itens: itens.map((it) => ({
            produtoId: it.produtoId,
            quantidade: Number(it.quantidade),
            valorUnitarioOverride: Number(it.valorUnitarioOverride ?? 0),
            ...(it.cfop ? { cfop: soDigitos(it.cfop) } : {}),
          })),
        }),
      })
      const json = await resp.json()
      setEnviando(false)
      // Só HTTP != 2xx é falha da emissão. ok=false com status 'processando' é a Focus esperando a SEFAZ (#3861).
      if (!resp.ok) {
        // já há nota deste destinatário esperando a SEFAZ: acompanha essa, não envia outra
        if (json?.erro === 'nota_em_processamento' && json?.nfeId) {
          setAguardando({ nfeId: json.nfeId, esgotou: false })
          void consultarRetorno(json.nfeId, 0)
          return
        }
        setErro(json?.mensagem ?? json?.motivoRejeicao ?? 'Falha ao emitir')
        return
      }
      if (json?.status === 'autorizada') {
        setSucesso({ numero: String(json.numero ?? '?'), chave: json.chave, danfeUrl: json.danfeUrl })
      } else if (json?.status === 'rejeitada' || json?.status === 'denegada') {
        setErro(`Nota ${json.status} pela SEFAZ: ${json.motivoRejeicao ?? 'motivo não informado'}. Use "Corrigir e reenviar" em Notas emitidas.`)
      } else if (json?.nfeId) {
        setAguardando({ nfeId: json.nfeId, esgotou: false })
        void consultarRetorno(json.nfeId, 0)
      } else {
        setErro(json?.mensagem ?? 'Resposta inesperada do provedor fiscal')
      }
    } catch (e) {
      setErro((e as Error)?.message ?? 'Erro ao emitir')
      setEnviando(false)
    }
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
          <ArrowLeft size={14} /> Notas emitidas
        </Link>
        <span className="text-[#3D2314]/30">/</span>
        <h1 className="text-[18px] font-semibold text-[#3D2314] flex items-center gap-1.5">
          <FileText size={16} /> Emitir NF-e avulsa
        </h1>
      </div>

      <div className="mb-4 p-3 bg-[#FBF3E0] border border-[#C8941A]/40 rounded-lg text-[11.5px] text-[#3D2314]/85 leading-snug flex gap-2">
        <Info size={14} className="flex-shrink-0 mt-0.5 text-[#C8941A]" />
        <span>
          Para remessas e outras operações sem pedido. O CFOP segue a UF do destinatário (5 no estado, 6 em outra UF, 7 exterior)
          e o sistema avisa quando troca. Esta nota <strong>não gera título</strong> no financeiro e <strong>não movimenta o estoque</strong>.
          Teste cada operação nova em homologação e confirme o CFOP e o ICMS com a contabilidade.
        </span>
      </div>

      {reenvioInfo && (
        <div className="mb-4 p-3 bg-[#FBF3E0] border border-[#C8941A]/40 rounded-lg text-[12.5px] text-[#3D2314] flex items-start gap-2" data-testid="nfe-avulsa-reenvio">
          <Info size={14} className="flex-shrink-0 mt-0.5 text-[#C8941A]" />
          <span>{reenvioInfo}</span>
          <AjudaCampo chave="fiscal.nfe_avulsa.emitir" />
        </div>
      )}

      {aguardando && (
        <div className="mb-4 p-3 bg-[#FBF3E0] border border-[#C8941A]/40 rounded-lg text-[12.5px] text-[#3D2314]" data-testid="nfe-avulsa-aguardando">
          <div className="flex items-center gap-2 font-semibold">
            {!aguardando.esgotou && <Loader2 size={13} className="animate-spin text-[#C8941A]" />}
            Nota enviada, aguardando SEFAZ
            <AjudaCampo chave="fiscal.nfe_avulsa.emitir" />
          </div>
          <div className="mt-1 text-[11.5px] text-[#3D2314]/80">{AVISO_PROCESSANDO}</div>
          {aguardando.esgotou && (
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={consultarAgora} className="px-3 py-1.5 text-[11.5px] font-semibold rounded-lg border border-[#C8941A] text-[#3D2314]" data-testid="nfe-avulsa-consultar">
                Consultar agora
              </button>
              <AjudaCampo chave="fiscal.nfe_avulsa.consultar" />
            </div>
          )}
        </div>
      )}

      {sucesso && (
        <div className="mb-4 p-3 bg-[#E7F4EC] border border-[#1B873F]/40 rounded-lg text-[12.5px] text-[#1B873F]" data-testid="nfe-avulsa-sucesso">
          ✓ NF-e nº <strong>{sucesso.numero}</strong> enviada à SEFAZ.
          {sucesso.danfeUrl && <a href={sucesso.danfeUrl} target="_blank" rel="noreferrer" className="ml-2 underline">Abrir PDF</a>}
          {sucesso.chave && <div className="font-mono text-[10.5px] mt-1 text-[#1B873F]/85 break-all">chave: {sucesso.chave}</div>}
        </div>
      )}

      <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4 sm:p-5 mb-4">
        <h2 className="text-[12.5px] font-semibold text-[#3D2314] mb-3">Destinatário</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className={rotuloCls}>Tipo de pessoa <AjudaCampo chave="fiscal.nfe_avulsa.destinatario_tipo" /></span>
            <select
              value={destTabela}
              onChange={(e) => { setDestPendente(null); setDestTabela(e.target.value as 'erp_clientes' | 'erp_fornecedores') }}
              className={inputCls}
            >
              <option value="erp_clientes">Cliente</option>
              <option value="erp_fornecedores">Fornecedor</option>
            </select>
          </label>
          <label className="block">
            <span className={rotuloCls}>{destTabela === 'erp_clientes' ? 'Cliente' : 'Fornecedor'} * <AjudaCampo chave="fiscal.nfe_avulsa.destinatario" /></span>
            <select
              value={destinatarioId}
              onChange={(e) => setDestinatarioId(e.target.value)}
              className={inputCls}
              data-testid="nfe-avulsa-destinatario"
            >
              <option value="">Selecione...</option>
              {pessoas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.razao_social ?? p.nome_fantasia ?? p.id} {p.cnpj_cpf || p.cpf_cnpj ? `· ${p.cnpj_cpf ?? p.cpf_cnpj}` : ''}{p.uf ? ` · ${p.uf}` : ''}
                </option>
              ))}
            </select>
            {destinatario && !ufDest && (
              <span className="block text-[10.5px] text-[#A32D2D] mt-1">Cadastro sem UF: complete o endereço antes de emitir.</span>
            )}
          </label>
        </div>
      </div>

      <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4 sm:p-5 mb-4">
        <h2 className="text-[12.5px] font-semibold text-[#3D2314] mb-3">Operação</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className={rotuloCls}>Atalho de remessa <AjudaCampo chave="fiscal.nfe_avulsa.atalho" /></span>
            <select value={tipoId} onChange={(e) => aplicarTipo(e.target.value)} className={inputCls}>
              <option value="">Nenhum (escolher o CFOP)</option>
              {tipos.map((t) => (
                <option key={t.id} value={t.id}>{t.nome} · {formatarCfop(t.cfop_dentro)}</option>
              ))}
            </select>
          </label>

          <div className="relative">
            <label className="block">
              <span className={rotuloCls}>CFOP da nota * <AjudaCampo chave="fiscal.nfe_avulsa.cfop" /></span>
              <input
                type="text"
                value={cfopAberto ? cfopBusca : (cfop ? `${formatarCfop(cfop)}${cfopAtual ? ` · ${cfopAtual.descricao}` : ''}` : '')}
                onFocus={() => { setCfopAberto(true); setCfopBusca('') }}
                onBlur={() => setTimeout(() => setCfopAberto(false), 150)}
                onChange={(e) => setCfopBusca(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && soDigitos(cfopBusca).length === 4) { e.preventDefault(); escolherCfop(cfopBusca) }
                }}
                placeholder="Código ou descrição (ex.: 5949, conserto)"
                className={inputCls}
                data-testid="nfe-avulsa-cfop"
              />
            </label>
            {cfopAberto && (
              <div className="absolute z-20 left-0 right-0 mt-1 max-h-72 overflow-y-auto bg-white border border-[#3D2314]/15 rounded-lg shadow-lg">
                {soDigitos(cfopBusca).length === 4 && !cfopNoCatalogo(cfopBusca, catalogo) && (
                  <button type="button" onMouseDown={() => escolherCfop(cfopBusca)}
                    className="w-full text-left px-3 py-2 hover:bg-[#FAF7F2] text-[12px] text-[#3D2314] border-b border-[#3D2314]/5">
                    Usar <strong className="font-mono">{formatarCfop(cfopBusca)}</strong> (fora do catálogo — confira com a contabilidade)
                  </button>
                )}
                {cfopsFiltrados.map((c) => (
                  <button key={c.cfop} type="button" onMouseDown={() => escolherCfop(c.cfop)}
                    className="w-full text-left px-3 py-2 hover:bg-[#FAF7F2] border-b border-[#3D2314]/5 last:border-0 text-[12px] text-[#3D2314]">
                    <span className="font-mono font-semibold mr-2">{formatarCfop(c.cfop)}</span>{c.descricao}
                  </button>
                ))}
                {cfopsFiltrados.length === 0 && soDigitos(cfopBusca).length !== 4 && (
                  <div className="px-3 py-2 text-[12px] text-[#3D2314]/55">Nada encontrado. Digite os 4 dígitos para usar outro código.</div>
                )}
              </div>
            )}
          </div>

          <label className="block">
            <span className={rotuloCls}>Natureza da operação * <AjudaCampo chave="fiscal.nfe_avulsa.natureza" /></span>
            <input type="text" value={natureza} onChange={(e) => setNatureza(e.target.value)} className={inputCls} maxLength={60} />
          </label>

          <label className="block">
            <span className={rotuloCls}>Finalidade <AjudaCampo chave="fiscal.nfe_avulsa.finalidade" /></span>
            <select value={finalidade} onChange={(e) => setFinalidade(e.target.value as FinalidadeNFe)} className={inputCls}>
              <option value="normal">Normal</option>
              <option value="complementar">Complementar</option>
              <option value="ajuste">Ajuste</option>
              <option value="devolucao">Devolução</option>
            </select>
          </label>

          {(finalidade !== 'normal' || cfopAtual?.exige_referenciada) && (
            <label className="block sm:col-span-2">
              <span className={rotuloCls}>
                Chave da NF-e referenciada {finalidade !== 'normal' ? '*' : '(recomendada)'} <AjudaCampo chave="fiscal.nfe_avulsa.chave_ref" />
              </span>
              <input type="text" inputMode="numeric" value={chaveRef} onChange={(e) => setChaveRef(soDigitos(e.target.value).slice(0, 44))}
                placeholder="44 dígitos" className={`${inputCls} font-mono`} />
            </label>
          )}

          <label className="block">
            <span className={rotuloCls}>ICMS da operação ({simples ? 'CSOSN' : 'CST'}) <AjudaCampo chave="fiscal.nfe_avulsa.icms" /></span>
            <select value={icmsCodigo} onChange={(e) => setIcmsCodigo(e.target.value)} className={inputCls} data-testid="nfe-avulsa-icms">
              <option value="">Do cadastro do produto (venda)</option>
              {icmsOpcoes.map((o) => <option key={o.codigo} value={o.codigo}>{o.rotulo}</option>)}
            </select>
          </label>
        </div>

        {previa && (previa.erros.length > 0 || previa.avisos.length > 0) && (
          <div className="mt-3 space-y-1.5" data-testid="nfe-avulsa-validacao">
            {previa.erros.map((m) => (
              <div key={m} className="p-2 bg-[#FCEBEB] text-[#A32D2D] text-[11.5px] rounded-lg flex items-start gap-1.5">
                <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />{m}
              </div>
            ))}
            {previa.avisos.map((m) => (
              <div key={m} className="p-2 bg-[#FBF3E0] text-[#3D2314] text-[11.5px] rounded-lg flex items-start gap-1.5">
                <Info size={13} className="flex-shrink-0 mt-0.5 text-[#C8941A]" />{m}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4 sm:p-5 mb-4">
        <h2 className="text-[12.5px] font-semibold text-[#3D2314] mb-3">Itens</h2>

        <div className="relative mb-3">
          <label className="block">
            <span className={rotuloCls}>Buscar produto <AjudaCampo chave="fiscal.nfe_avulsa.produto_busca" /></span>
            <input
              type="text"
              value={produtoBusca}
              onChange={(e) => setProdutoBusca(e.target.value)}
              placeholder="Nome ou código..."
              className={inputCls}
            />
          </label>
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
                  <th className="px-2 py-1.5 text-left text-[10.5px] text-[#3D2314]/65 uppercase">Produto</th>
                  <th className="px-2 py-1.5 text-right text-[10.5px] text-[#3D2314]/65 uppercase">Qtd <AjudaCampo chave="fiscal.nfe_avulsa.item_quantidade" /></th>
                  <th className="px-2 py-1.5 text-right text-[10.5px] text-[#3D2314]/65 uppercase">Vlr Unit <AjudaCampo chave="fiscal.nfe_avulsa.item_valor" /></th>
                  <th className="px-2 py-1.5 text-left text-[10.5px] text-[#3D2314]/65 uppercase">CFOP <AjudaCampo chave="fiscal.nfe_avulsa.item_cfop" /></th>
                  <th className="px-2 py-1.5 text-right text-[10.5px] text-[#3D2314]/65 uppercase">Subtotal</th>
                  <th></th>
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
                          type="text" inputMode="numeric"
                          value={it.cfop ?? ''}
                          placeholder={cfop ? formatarCfop(cfop) : 'da nota'}
                          onChange={(e) => atualizarItem(idx, { cfop: soDigitos(e.target.value).slice(0, 4) || undefined })}
                          className="w-20 px-2 py-1 text-[12px] font-mono border border-[#3D2314]/15 rounded"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#3D2314]">{fmtBRL(subtotal)}</td>
                      <td className="px-2 py-1.5">
                        <button type="button" onClick={() => removerItem(idx)} className="text-[#A32D2D] hover:bg-[#A32D2D]/10 p-1 rounded" aria-label="Remover item">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#3D2314]/15 bg-[#FAF7F2]">
                  <td colSpan={4} className="px-2 py-2 text-right text-[#3D2314]/65 text-[11.5px] font-medium uppercase">Total dos itens</td>
                  <td className="px-2 py-2 text-right tabular-nums text-[#3D2314] font-semibold">{fmtBRL(totalItens)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4 sm:p-5 mb-4">
        <h2 className="text-[12.5px] font-semibold text-[#3D2314] mb-3">Transporte e informações complementares</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className={rotuloCls}>Frete <AjudaCampo chave="fiscal.nfe_avulsa.modalidade_frete" /></span>
            <select value={modalidadeFrete} onChange={(e) => { const m = Number(e.target.value); setModalidadeFrete(m); if (m === 9) setValorFrete(0) }} className={inputCls}>
              <option value={9}>Sem frete</option>
              <option value={0}>Por conta do emitente (CIF)</option>
              <option value={1}>Por conta do destinatário (FOB)</option>
              <option value={2}>Por conta de terceiros</option>
            </select>
          </label>
          <label className="block">
            <span className={rotuloCls}>Valor do frete <AjudaCampo chave="fiscal.nfe_avulsa.valor_frete" /></span>
            <input type="number" min="0" step="0.01" value={valorFrete} disabled={modalidadeFrete === 9}
              onChange={(e) => setValorFrete(Math.max(0, Number(e.target.value)))} className={`${inputCls} disabled:bg-[#FAF7F2]`} />
          </label>
          <label className="block sm:col-span-2">
            <span className={rotuloCls}>Informações complementares <AjudaCampo chave="fiscal.nfe_avulsa.observacoes" /></span>
            <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={3} maxLength={2000} className={inputCls} />
          </label>
        </div>
      </div>

      {erro && (
        <div className="mb-4 p-3 bg-[#FCEBEB] text-[#A32D2D] text-[12.5px] rounded-lg flex items-start gap-2">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{erro}</span>
        </div>
      )}

      <div className="flex justify-end items-center gap-2">
        <AjudaCampo chave="fiscal.nfe_avulsa.emitir" />
        <button
          type="button"
          onClick={emitir}
          disabled={!podeEnviar}
          data-testid="nfe-remessa-emitir"
          className="px-5 py-2 text-[12.5px] font-semibold rounded-lg bg-[#C8941A] text-white hover:bg-[#A77A12] disabled:opacity-50 flex items-center gap-1.5"
        >
          {enviando ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          {enviando ? 'Emitindo…' : aguardando ? 'Aguardando SEFAZ…' : `Emitir NF-e${previa?.cfop ? ` · ${formatarCfop(previa.cfop)}` : ''}`}
        </button>
      </div>
    </div>
  )
}
