'use client'

// FEAT-NFSE-TELA-v1 · Modal de emissao NFS-e
// Chama edge function gov-nfse-emitir (Focus NFe gateway).
// Mobile-first · form curto · erros em linguagem humana.
// Defaults KGF: codigo tributacao 140101 · aliquota 0 (Simples Nacional).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { authFetch } from '@/lib/authFetch'
import { X, Loader2, CheckCircle2, AlertCircle, Info, ExternalLink } from 'lucide-react'
import BlocoObraFiscal, { type ObraFiscalState, obraFiscalStateInicial } from '@/components/comum/BlocoObraFiscal'

// bloqueios da porta única que são resolvidos pelo bloco de obra (não pelos outros campos).
// obra_sem_cno saiu (CNO virou opcional); obra_endereco_incompleto é o novo — a prefeitura exige endereço.
const CODIGOS_OBRA = ['obra_obrigatoria', 'obra_nao_encontrada', 'obra_endereco_incompleto', 'obra_sem_cno']

type TomadorTipo = 'CPF' | 'CNPJ'
type Fase = 'form' | 'enviando' | 'concluido'

interface EmitirResp {
  ok?: boolean
  status_focus?: string
  status_local?: 'autorizada' | 'processando' | 'rejeitada' | string
  ref?: string
  nfse_emitida_id?: string
  chave_acesso?: string | null
  numero?: string | null
  mensagem?: string | null
  erro?: string
}

// FIX-NFSE-PEDIDO-PROVIDER-v1 · resposta da rota REST do Focus (/api/fiscal/nfse/emitir), no mesmo
// formato que o NFSePreviewModal já consome. Mapeada para EmitirResp p/ reaproveitar a tela de resultado.
interface RespFocus {
  ok?: boolean
  status?: string
  numero?: string | null
  codigoVerificacao?: string | null
  motivoRejeicao?: string | null
  mensagem?: string | null
  providerReference?: string | null
  nfseId?: string | null
}

interface Props {
  companyId: string
  aberto: boolean
  onFechar: () => void
  // FEAT-OS-ONDA3B-NFSE-FRONT-v1 · expõe provider_reference pra DrawerPedido vincular ao pedido
  onEmitida: (providerReference?: string) => void
  producaoDisponivel?: boolean
  // FEAT-OS-ONDA3B-NFSE-FRONT-v1 · valores iniciais (pre-preenche o form)
  tomadorDocumento?: string
  tomadorTipo?: 'cpf' | 'cnpj' | 'indefinido'
  tomadorNome?: string
  tomadorEmail?: string
  descricaoServico?: string
  codigoServicoMunicipio?: string
  codigoLC116?: string
  aliquotaIss?: number
  valorServicos?: number
  // #32 fase 2 · contexto da trava de emissão. Sem servicoId nada muda (validação pulada).
  servicoId?: string
  issNoLocalPrestacao?: boolean
  obraId?: string
  municipioPrestacaoIbge?: string   // vindo da obra, pré-preenchido e editável
  municipioPrestacaoLabel?: string  // ex.: "vindo da obra 0042 · Marau/RS"
  // A③ · reenvio de NFS-e rejeitada por E0370 (obra) sem obra_id: exibe o MESMO bloco de obra da venda
  // (apontar/informar/criar no Hub) para a pessoa apontar a obra na correção. Só quando não veio obraId.
  permitirObra?: boolean
  // FIX-NFSE-PEDIDO-PROVIDER-v1 · o pedido de origem, p/ resolver a parcela a receber (erp_receber) quando
  // o provedor ativo é Focus (emissão pela rota REST /api/fiscal/nfse/emitir, que emite POR parcela).
  pedidoId?: string
  pedidoNumero?: string
}

type Municipio = { codigo_ibge: string; nome_municipio: string; uf: string }
type Bloqueio = { codigo: string; mensagem: string; acao?: string; onde?: string }
// #35 · serviço cadastrado (seleção) e resultado da resolução de ISS por município
type ServicoLite = {
  id: string; codigo: string | null; descricao_resumida: string | null; descricao_detalhada: string | null
  codigo_servico_municipio: string | null; codigo_lc116: string | null
  aliquota_iss: number | null; valor_unitario: number | null; iss_no_local_prestacao: boolean | null
}
type IssResolv = { ok?: boolean; aliquota?: number; municipio?: string; fonte?: string }

function soDigitos(s: string): string {
  return s.replace(/\D/g, '')
}

function mascaraDoc(s: string, tipo: TomadorTipo): string {
  const d = soDigitos(s)
  if (tipo === 'CPF') {
    return d
      .slice(0, 11)
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})/, '$1-$2')
  }
  return d
    .slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})/, '$1-$2')
}

// Traduz erros tecnicos da Focus/prefeitura pra linguagem humana.
function mensagemAmigavel(raw: string | null | undefined): string {
  if (!raw) return 'Falha ao emitir (sem detalhes da prefeitura).'
  const s = String(raw)
  // E0037 = limitacao de convenio do sandbox (esperado em Homologacao p/ varios municipios)
  if (/E0037/i.test(s) || /convenio/i.test(s)) {
    return 'Homologação Focus sem convênio com este município (erro E0037 da prefeitura). É o esperado em testes — a tela e a integração estão funcionando. Emissão real só em Produção.'
  }
  if (/timeout|tempo esgotado/i.test(s)) {
    return 'A prefeitura demorou pra responder. Tente novamente em alguns segundos.'
  }
  if (/cnpj/i.test(s) && /(invalido|inválido)/i.test(s)) {
    return 'CNPJ do prestador ou tomador inválido. Confira os dados cadastrais.'
  }
  // Fallback: primeiros 240 chars sem aspas/colchetes estranhos
  return s.slice(0, 240)
}

export default function NFSeEmitirGovModal({
  companyId, aberto, onFechar, onEmitida, producaoDisponivel = false,
  tomadorDocumento, tomadorTipo, tomadorNome, tomadorEmail,
  descricaoServico, codigoServicoMunicipio, codigoLC116, aliquotaIss, valorServicos,
  servicoId, issNoLocalPrestacao = false, obraId, municipioPrestacaoIbge, municipioPrestacaoLabel,
  permitirObra = false, pedidoId, pedidoNumero,
}: Props) {
  // FIX-NFSE-AMBIENTE-SEM-ESCOLHA-v1 (chamado #16, sugestão do Rodrigo): o ambiente NÃO é escolha na
  // emissão — vem da configuração da empresa. "Pensando como leigo, essa opção de alterar de homologação
  // para produção não deveria aparecer": se a empresa já está em produção, perguntar de novo na hora de
  // emitir é convite a errar (emitir teste achando que valeu, ou o contrário). Derivado, read-only.
  const ambiente: 'homologacao' | 'producao' = producaoDisponivel ? 'producao' : 'homologacao'
  // FEAT-OS-ONDA3B-NFSE-FRONT-v1 · seeds vindas do pedido (read-only · usuario pode editar)
  const tomTipoSeed: TomadorTipo = tomadorTipo === 'cpf' ? 'CPF' : 'CNPJ'
  const tomDocSeed = tomadorDocumento ? mascaraDoc(tomadorDocumento, tomTipoSeed) : ''
  // Código de tributação = código de serviço do MUNICÍPIO (não o LC116). Desde que o LC116 passou a
  // guardar o subitem oficial ("07.02"), ele deixou de servir como codTrib — a emissão lê o do município.
  const codTribSeed = (codigoServicoMunicipio ?? '140101').trim() || '140101'
  const aliquotaSeed = aliquotaIss != null ? String(aliquotaIss).replace('.', ',') : '0'
  const valorSeed = valorServicos != null
    ? Number(valorServicos).toFixed(2).replace('.', ',')
    : ''
  const [tomTipo, setTomTipo] = useState<TomadorTipo>(tomTipoSeed)
  const [tomDoc, setTomDoc] = useState(tomDocSeed)
  const [tomNome, setTomNome] = useState(tomadorNome ?? '')
  // tomadorEmail nao tem input no modal hoje · guardamos pra payload futuro
  void tomadorEmail
  const [descricao, setDescricao] = useState(descricaoServico ?? '')
  const [valor, setValor] = useState(valorSeed)
  const [codigoTrib, setCodigoTrib] = useState(codTribSeed)
  const [aliquota, setAliquota] = useState(aliquotaSeed)
  const [fase, setFase] = useState<Fase>('form')
  const [resultado, setResultado] = useState<EmitirResp | null>(null)
  const [erroLocal, setErroLocal] = useState<string | null>(null)
  // #32 fase 2 · local da execução (só quando iss_no_local) + bloqueios da porta única
  const [munIbge, setMunIbge] = useState(municipioPrestacaoIbge ?? '')
  const [munLabel, setMunLabel] = useState(municipioPrestacaoLabel ?? '')
  const [munBusca, setMunBusca] = useState('')
  const [munResultados, setMunResultados] = useState<Municipio[]>([])
  const [bloqueios, setBloqueios] = useState<Bloqueio[]>([])
  const [podeEmitir, setPodeEmitir] = useState(true)
  const [validando, setValidando] = useState(false)
  // #32 · regime da empresa: no Simples Nacional o ISS vai no DAS e a NFS-e não destaca —
  // o campo de alíquota some (a edge grava 0). Não-Simples (Lucro Real/Presumido) mantém o campo.
  const [empresaSimples, setEmpresaSimples] = useState(false)
  // FIX-NFSE-PEDIDO-PROVIDER-v1 · provedor fiscal ATIVO da empresa. undefined = ainda carregando;
  // null = nenhum ativo (não dá pra emitir, leva pra Config Fiscal). Roteia a emissão: 'focusnfe' pela
  // rota REST; 'gov_nfse_nacional' pela edge. Era o gargalo do chamado: o modal chamava a edge do gov
  // pra todo mundo e a edge devolvia 404 para empresas Focus (R.R).
  const [providerAtivo, setProviderAtivo] = useState<string | null | undefined>(undefined)
  // #35 · serviços cadastrados (seleção rápida) + serviço escolhido no próprio modal
  const [servicos, setServicos] = useState<ServicoLite[]>([])
  const [servicoSelId, setServicoSelId] = useState('')
  const [servicoIssLocal, setServicoIssLocal] = useState(false)
  // #32 · alíquota buscada do município da execução (o sistema busca, como faz o portal nacional)
  const [issInfo, setIssInfo] = useState('')
  // #35 · busca do tomador por CNPJ/CPF (cadastro do cliente ou Receita) + endereço para conferência
  const [tomEndereco, setTomEndereco] = useState('')
  const [buscandoDoc, setBuscandoDoc] = useState(false)
  const [buscaDocMsg, setBuscaDocMsg] = useState('')
  // A③ / print Rodrigo 21/09 · obra escolhida no modal. Antes só aparecia no reenvio (permitirObra); agora
  // também quando a PRÓPRIA porta única diz que o serviço EXIGE obra (E0370) — senão o usuário via o
  // bloqueio sem ter como vincular a obra (o beco sem saída do print). Mesmo componente da venda/reenvio.
  const [obraFiscal, setObraFiscal] = useState<ObraFiscalState>(obraFiscalStateInicial)
  const [exigeObra, setExigeObra] = useState(false)
  // aviso (não bloqueia): produção + tomador é um usuário da própria empresa → "nota REAL pra você mesmo"
  const [avisoAutoTomador, setAvisoAutoTomador] = useState(false)
  // NFS-e PRIMEIRO → financeiro pelo LÍQUIDO. Após a nota AUTORIZADA, o passo "Gerar financeiro desta
  // nota" cria o contas a receber pelo líquido (bruto − deduções − desconto − retenções). Entrega 1:
  // retenções INFORMADAS PELO USUÁRIO. nfseIdGerado = id da nota registrada (erp_nfse_emitidas.id).
  const [nfseIdGerado, setNfseIdGerado] = useState<string | null>(null)
  const [finRet, setFinRet] = useState({ iss: '', irrf: '', pis: '', cofins: '', csll: '', inss: '', deducoes: '', desconto: '' })
  const [finVenc, setFinVenc] = useState('')
  const [finFase, setFinFase] = useState<'idle' | 'enviando' | 'ok' | 'erro'>('idle')
  const [finMsg, setFinMsg] = useState<string | null>(null)
  const obraIdEff = obraId ?? (obraFiscal.modo === 'apontar' ? (obraFiscal.obraSel?.id ?? undefined) : undefined)
  const mostrarObra = !obraId && (permitirObra || exigeObra)

  // #32/#35 · servico_id efetivo: o que veio do pedido/OS (prop) OU o escolhido aqui no modal.
  // issNoLocalEff idem — habilita o seletor de município e a busca de alíquota também na emissão avulsa.
  const servicoIdEff = servicoId || servicoSelId || undefined
  const issNoLocalEff = issNoLocalPrestacao || servicoIssLocal

  // FIX-O3B-NFSE-MODAL-SEED-v1
  // useState so roda no mount · se o pai renderiza com aberto=false antes
  // dos dados chegarem, o state fica vazio. Esse useEffect ressincroniza
  // TODO o form quando o modal abre (aberto vira true).
  useEffect(() => {
    if (!aberto) return
    setTomTipo(tomTipoSeed)
    setTomDoc(tomDocSeed)
    setTomNome(tomadorNome ?? '')
    setDescricao(descricaoServico ?? '')
    setValor(valorSeed)
    setCodigoTrib(codTribSeed)
    setAliquota(aliquotaSeed)
    setFase('form')
    setResultado(null)
    setErroLocal(null)
    setMunIbge(municipioPrestacaoIbge ?? '')
    setMunLabel(municipioPrestacaoLabel ?? '')
    setMunBusca(''); setMunResultados([]); setBloqueios([]); setPodeEmitir(true)
    setServicoSelId(''); setServicoIssLocal(false); setIssInfo('')
    setTomEndereco(''); setBuscaDocMsg(''); setBuscandoDoc(false)
    setObraFiscal(obraFiscalStateInicial)
    setExigeObra(false); setAvisoAutoTomador(false); setProviderAtivo(undefined)
    setNfseIdGerado(null); setFinRet({ iss: '', irrf: '', pis: '', cofins: '', csll: '', inss: '', deducoes: '', desconto: '' })
    setFinVenc(''); setFinFase('idle'); setFinMsg(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, producaoDisponivel, tomadorTipo, tomadorDocumento, tomadorNome, descricaoServico, valorServicos, aliquotaIss, codigoServicoMunicipio, codigoLC116])

  // Item 2 (print Rodrigo) · em PRODUÇÃO, se o tomador for um usuário da própria empresa (mesmo CPF),
  // avisa que a nota é REAL para si mesmo — não bloqueia, só alerta (best-effort; falha silenciosa = sem aviso).
  useEffect(() => {
    if (!aberto || ambiente !== 'producao' || !companyId) { setAvisoAutoTomador(false); return }
    const doc = soDigitos(tomDoc)
    if (tomTipo !== 'CPF' || doc.length !== 11) { setAvisoAutoTomador(false); return }
    let vivo = true
    const t = setTimeout(async () => {
      try {
        const { data } = await supabase.from('user_companies').select('user:users(cpf)').eq('company_id', companyId)
        if (!vivo) return
        const rows = (data ?? []) as { user?: { cpf?: string | null } | { cpf?: string | null }[] | null }[]
        const bate = rows.some((r) => {
          const u = Array.isArray(r.user) ? r.user : (r.user ? [r.user] : [])
          return u.some((x) => soDigitos(x?.cpf ?? '') === doc)
        })
        setAvisoAutoTomador(bate)
      } catch { if (vivo) setAvisoAutoTomador(false) }
    }, 300)
    return () => { vivo = false; clearTimeout(t) }
  }, [aberto, ambiente, companyId, tomDoc, tomTipo])

  // #32 fase 2 · a PORTA ÚNICA: valida no banco (obra + ISS) e mostra os bloqueios. Roda ao abrir e
  // quando muda o município. Só quando há servico_id (emissão de catálogo); sem ele, nada a validar.
  useEffect(() => {
    if (!aberto || !servicoIdEff) { setBloqueios([]); setPodeEmitir(true); setIssInfo(''); return }
    let vivo = true
    setValidando(true)
    void (async () => {
      try {
        const { data } = await supabase.rpc('fn_nfse_validar_emissao', {
          p_company_id: companyId,
          p_dados: { servico_id: servicoIdEff, obra_id: obraIdEff ?? null, municipio_prestacao_ibge: munIbge || null },
        })
        if (!vivo) return
        const v = data as { pode_emitir?: boolean; bloqueios?: Bloqueio[]; iss?: IssResolv; exige_obra?: boolean } | null
        setBloqueios(v?.bloqueios ?? [])
        setPodeEmitir(v?.pode_emitir !== false)
        setExigeObra(!!v?.exige_obra) // mantém o bloco de obra visível enquanto o serviço exigir obra
        // #32 · o sistema BUSCA a alíquota do município da execução (fn_fiscal_iss_resolver) e preenche o
        // campo — como Jordana pediu ("hoje o portal nacional faz isso"). Se o município não tem alíquota
        // cadastrada, a própria porta única já devolve o bloqueio 'aliquota_iss_desconhecida' (não chuta).
        if (v?.iss?.ok && v.iss.aliquota != null) {
          setAliquota(String(v.iss.aliquota).replace('.', ','))
          setIssInfo(`Alíquota buscada de ${v.iss.municipio ?? 'município da execução'}: ${String(v.iss.aliquota).replace('.', ',')}%${v.iss.fonte ? ` · ${v.iss.fonte}` : ''}`)
        } else {
          setIssInfo('')
        }
      } finally {
        if (vivo) setValidando(false)
      }
    })()
    return () => { vivo = false }
  }, [aberto, servicoIdEff, obraIdEff, munIbge, companyId])

  // #32 · descobre o PROVEDOR ATIVO e o regime (Simples x não-Simples) da empresa ao abrir. Lê a config
  // fiscal ATIVA sem filtrar por provider (o filtro fixo em 'gov_nfse_nacional' era o bug: pra empresa
  // Focus a config nunca casava, e a emissão caía sempre na edge do gov — 404). O provider roteia a
  // emissão; opção 2 (MEI) / 3 (ME/EPP) do Simples → ISS no DAS, campo de alíquota some.
  useEffect(() => {
    if (!aberto || !companyId) return
    let vivo = true
    void (async () => {
      const { data } = await supabase.from('erp_fiscal_provider_config')
        .select('provider, opcao_simples_nacional').eq('company_id', companyId)
        .eq('ativo', true).maybeSingle()
      if (!vivo) return
      const cfg = data as { provider?: string | null; opcao_simples_nacional?: number | null } | null
      setProviderAtivo(cfg?.provider ?? null)
      setEmpresaSimples(cfg?.opcao_simples_nacional === 2 || cfg?.opcao_simples_nacional === 3)
    })()
    return () => { vivo = false }
  }, [aberto, companyId])

  // #35 · serviços cadastrados da empresa, pra seleção rápida (traz LC116/código/alíquota/ISS-no-local).
  useEffect(() => {
    if (!aberto || !companyId) return
    let vivo = true
    void (async () => {
      const { data } = await supabase.from('erp_servicos')
        .select('id,codigo,descricao_resumida,descricao_detalhada,codigo_servico_municipio,codigo_lc116,aliquota_iss,valor_unitario,iss_no_local_prestacao')
        .eq('company_id', companyId).eq('ativo', true).order('descricao_resumida', { nullsFirst: false })
      if (vivo) setServicos((data ?? []) as ServicoLite[])
    })()
    return () => { vivo = false }
  }, [aberto, companyId])

  // busca de município da execução (só relevante quando iss_no_local)
  useEffect(() => {
    const q = munBusca.trim()
    if (q.length < 2) { setMunResultados([]); return }
    let vivo = true
    const t = setTimeout(async () => {
      const { data } = await supabase.from('erp_gov_nfse_municipios')
        .select('codigo_ibge,nome_municipio,uf').ilike('nome_municipio', `${q}%`).order('nome_municipio').limit(15)
      if (vivo) setMunResultados((data ?? []) as Municipio[])
    }, 250)
    return () => { vivo = false; clearTimeout(t) }
  }, [munBusca])

  if (!aberto) return null

  function resetForm() {
    // FEAT-OS-ONDA3B-NFSE-FRONT-v1 · reset volta pros seeds (se houver) ou vazio
    setTomDoc(tomDocSeed); setTomNome(tomadorNome ?? '')
    setDescricao(descricaoServico ?? '')
    setValor(valorSeed)
    setCodigoTrib(codTribSeed); setAliquota(aliquotaSeed)
    setServicoSelId(''); setServicoIssLocal(false); setIssInfo('')
    setTomEndereco(''); setBuscaDocMsg('')
    setResultado(null); setErroLocal(null); setFase('form')
  }

  function fechar() {
    if (fase === 'enviando') return
    resetForm()
    onFechar()
  }

  // #35 · escolher um serviço cadastrado preenche descrição, valor, código de tributação, alíquota e o
  // regime de ISS no local. Guardar servicoSelId liga a porta única (validação + busca de alíquota).
  function aplicarServico(id: string) {
    setServicoSelId(id)
    setIssInfo('')
    const s = servicos.find((x) => x.id === id)
    if (!s) { setServicoIssLocal(false); return }
    if (s.descricao_detalhada || s.descricao_resumida) setDescricao(s.descricao_detalhada || s.descricao_resumida || '')
    if (s.valor_unitario != null && Number(s.valor_unitario) > 0) setValor(Number(s.valor_unitario).toFixed(2).replace('.', ','))
    if ((s.codigo_servico_municipio ?? '').trim()) setCodigoTrib((s.codigo_servico_municipio as string).trim())
    if (s.aliquota_iss != null) setAliquota(String(s.aliquota_iss).replace('.', ','))
    setServicoIssLocal(!!s.iss_no_local_prestacao)
  }

  // #35 · buscar o tomador pelo documento: primeiro no cadastro de clientes (traz o endereço já
  // conferido); se não houver, consulta a Receita por CNPJ. Só preenche — nada é gravado aqui.
  async function buscarTomador() {
    const doc = soDigitos(tomDoc)
    setBuscaDocMsg('')
    if (tomTipo === 'CNPJ' && doc.length !== 14) { setBuscaDocMsg('Informe o CNPJ completo (14 dígitos).'); return }
    if (tomTipo === 'CPF' && doc.length !== 11) { setBuscaDocMsg('Informe o CPF completo (11 dígitos).'); return }
    setBuscandoDoc(true)
    try {
      const { data: cli } = await supabase.from('erp_clientes')
        .select('razao_social,nome_fantasia,logradouro,numero,bairro,cidade,uf,cep,endereco,cidade_estado')
        .eq('company_id', companyId).or(`cpf_cnpj.eq.${doc},cnpj_cpf.eq.${doc}`).limit(1).maybeSingle()
      if (cli) {
        const c = cli as Record<string, string | null>
        setTomNome(c.razao_social || c.nome_fantasia || tomNome)
        const endCad = [c.logradouro, c.numero, c.bairro, (c.cidade && c.uf) ? `${c.cidade}/${c.uf}` : (c.cidade || c.cidade_estado), c.cep]
          .filter(Boolean).join(', ')
        setTomEndereco(endCad || (c.endereco ?? ''))
        setBuscaDocMsg('Cliente encontrado no cadastro.')
        return
      }
      if (tomTipo === 'CNPJ') {
        const r = await fetch(`/api/cnpj-lookup?cnpj=${doc}`)
        const d = await r.json().catch(() => null) as Record<string, string> | null
        if (r.ok && d && (d.razao_social || d.nome_fantasia)) {
          setTomNome(d.razao_social || d.nome_fantasia)
          setTomEndereco([d.logradouro, d.numero, d.bairro, (d.cidade && d.uf) ? `${d.cidade}/${d.uf}` : d.cidade, d.cep].filter(Boolean).join(', '))
          setBuscaDocMsg('Dados encontrados na Receita — confira antes de emitir.')
          return
        }
        setBuscaDocMsg('CNPJ não encontrado no cadastro nem na Receita — preencha manualmente.')
      } else {
        setBuscaDocMsg('CPF não está no cadastro — preencha o nome manualmente.')
      }
    } catch {
      setBuscaDocMsg('Falha na busca — preencha os dados manualmente.')
    } finally {
      setBuscandoDoc(false)
    }
  }

  // FIX-NFSE-MODAL-CLIQUE-FORA-v1 · clicar fora do card NÃO pode descartar dados de nota fiscal sem avisar
  // (chamado #16: "ao clicar fora, o card fecha" → perda de trabalho). Só fecha por clique no overlay se
  // não houver nada preenchido; havendo, pede confirmação. X e Cancelar continuam fechando direto.
  function fecharPorOverlay() {
    if (fase === 'enviando') return
    const temDados = !!(descricao.trim() || valor.trim() || tomDoc.trim() || tomNome.trim())
    if (fase === 'form' && temDados && !window.confirm('Descartar os dados preenchidos e fechar?')) return
    fechar()
  }

  // FIX-NFSE-PEDIDO-PROVIDER-v1 · resolve a parcela a receber (erp_receber) do pedido para emitir via Focus.
  // 1º pela FK pedido_id; se não achar, cai no nº do pedido na descrição — o fn_faturar legado gravou o
  // vínculo só no texto ("Pedido PED-… - parcela N/M"), não no pedido_id (a ser corrigido à parte). Havendo
  // várias parcelas, prefere uma SEM NFS-e ativa (autorizada/processando); senão, a primeira.
  async function resolverReceberDoPedido(): Promise<string | undefined> {
    if (!pedidoId && !pedidoNumero) return undefined
    let ids: string[] = []
    if (pedidoId) {
      const { data } = await supabase.from('erp_receber')
        .select('id').eq('company_id', companyId).eq('pedido_id', pedidoId).is('deleted_at', null)
      ids = (data ?? []).map((r) => (r as { id: string }).id)
    }
    if (ids.length === 0 && pedidoNumero) {
      const { data } = await supabase.from('erp_receber')
        .select('id').eq('company_id', companyId).ilike('descricao', `%${pedidoNumero}%`).is('deleted_at', null)
      ids = (data ?? []).map((r) => (r as { id: string }).id)
    }
    if (ids.length === 0) return undefined
    if (ids.length === 1) return ids[0]
    const { data: comNota } = await supabase.from('erp_nfse_emitidas')
      .select('erp_receber_id').in('erp_receber_id', ids).in('status', ['autorizada', 'processando'])
    const usados = new Set((comNota ?? []).map((n) => (n as { erp_receber_id: string }).erp_receber_id))
    return ids.find((id) => !usados.has(id)) ?? ids[0]
  }

  async function emitir() {
    setErroLocal(null)

    const valorNum = Number(valor.replace(/\./g, '').replace(',', '.'))
    if (!descricao.trim()) { setErroLocal('Informe a descrição do serviço.'); return }
    if (!isFinite(valorNum) || valorNum <= 0) { setErroLocal('Valor deve ser maior que zero.'); return }
    if (!codigoTrib.trim()) { setErroLocal('Informe o código de tributação ISS.'); return }
    // #32 · a trava: não deixa nem tentar enquanto houver bloqueio (o servidor barra de novo). Exceção: só
    // faltava a obra e o usuário vai criá-la agora (informar + cadastrar no Hub) — a criação é no resolve abaixo.
    if (emissaoTravada) { setErroLocal('Resolva os itens acima antes de emitir.'); return }

    // A③ · reenvio E0370 sem obra: resolve a obra escolhida (apontar/informar/criar no Hub) → obra_id +
    // município da obra. É o mesmo BlocoObraFiscal/resolver da venda (sem terceira implementação).
    let obraIdFinal = obraId
    let munIbgeFinal = munIbge
    if (mostrarObra) {
      if (obraFiscal.modo === 'apontar') {
        obraIdFinal = obraFiscal.obraSel?.id ?? undefined
        if (!munIbgeFinal) munIbgeFinal = obraFiscal.obraSel?.codigo_ibge_municipio ?? ''
        if (!obraIdFinal) { setErroLocal('Aponte uma obra cadastrada ou informe o endereço da obra.'); return }
      } else {
        // "informar": cadastra/reaproveita a obra pelo endereço digitado (mesmo caminho da NFSePreviewModal).
        // CNO opcional — o E0370 é atendido pelo endereço. Endereço incompleto → mensagem clara.
        const ee = obraFiscal.obraEnd
        const { data: rObra } = await supabase.rpc('fn_hub_obra_resolver_endereco', {
          p_company_id: companyId,
          p_logradouro: (ee.logradouro || '').trim() || null,
          p_numero: (ee.numero || '').trim() || null,
          p_bairro: (ee.bairro || '').trim() || null,
          p_cidade: (ee.cidade || '').trim() || null,
          p_uf: (ee.uf || '').trim() || null,
          p_cep: (ee.cep || '').trim() || null,
          p_codigo_ibge: (ee.codigo_ibge_municipio || '').trim() || null,
          p_cno: (obraFiscal.obraCno || '').trim() || null,
        })
        const rr = rObra as { ok?: boolean; obra_id?: string; erro?: string } | null
        if (!rr?.ok || !rr.obra_id) {
          setErroLocal(rr?.erro === 'obra_endereco_incompleto'
            ? 'Complete o endereço da obra (rua, número, bairro, CEP e município).'
            : 'Não foi possível vincular a obra. Aponte uma obra do Hub ou complete o endereço.')
          return
        }
        obraIdFinal = rr.obra_id
        if (!munIbgeFinal) munIbgeFinal = (ee.codigo_ibge_municipio || '').trim()
      }
    }

    const aliquotaNum = Number(aliquota.replace(',', '.')) || 0

    // FIX-NFSE-PEDIDO-PROVIDER-v1 · ROTEAMENTO POR PROVEDOR (o coração do chamado).
    // Sem provedor ativo não há como emitir — leva pra Config Fiscal (não tenta e falha no escuro).
    if (providerAtivo == null) {
      setErroLocal('Configure o emissor fiscal da empresa antes de emitir (Configurações › Fiscal).')
      return
    }

    // DECISÃO DO CEO (23/09): emissão fiscal EXCLUSIVAMENTE via Focus. ETAPA 1 (reversível, sem remoção):
    // toda emissão vai pela rota REST /api/fiscal/nfse/emitir — a edge gov-nfse-emitir deixa de ser
    // chamada, sem exceção nem bifurcação por município. O branch gov (else) fica INTACTO, só inalcançável.
    // Reverter = trocar por `providerAtivo === 'focusnfe'`. (RD-38: 0 nota já saiu pelo gov; todas via Focus.)
    const emitirViaFocus = providerAtivo != null

    // Focus → rota REST /api/fiscal/nfse/emitir, que emite POR parcela a receber (erp_receber). Resolve
    // a parcela do pedido AGORA (antes de "enviando"), pra falha de resolução aparecer no formulário.
    // NFS-e PRIMEIRO: se o pedido ainda NÃO tem parcela a receber, emite pelo caminho 'manual' (tomador +
    // serviço + valor) — o financeiro nasce DEPOIS, da nota, pelo LÍQUIDO. Se já houver título (fluxo atual),
    // emite por erp_receber e vincula sem duplicar. Sem tomador não emite (CEO: nem sem tomador nem sem serviço).
    let erpReceberIdFocus: string | undefined
    if (emitirViaFocus) {
      erpReceberIdFocus = await resolverReceberDoPedido()
      if (!erpReceberIdFocus && !soDigitos(tomDoc)) {
        setErroLocal('Informe o tomador (CNPJ/CPF) para emitir a NFS-e antes de faturar.')
        return
      }
    }

    setFase('enviando')
    try {
      if (emitirViaFocus) {
        // Mesmo formato do NFSePreviewModal/EmitirNFSeButton: authFetch (Bearer) + emissão por erp_receber.
        // A rota já roteia internamente (Focus municipal/nacional), aplica travas (obra E0370, duplicidade,
        // Simples) e devolve a mensagem da prefeitura JÁ em português (humanizarErroFiscal) — nunca o
        // "Edge Function returned a non-2xx status code".
        const bodyFocus: Record<string, unknown> = {
          companyId,
          servicoId: servicoIdEff,
          codigoServicoTributacao: codigoTrib.trim() || undefined,
          obraId: obraIdFinal || undefined,
          tipoRetencaoIss: 1,
        }
        if (erpReceberIdFocus) {
          bodyFocus.erpReceberId = erpReceberIdFocus
          bodyFocus.overrides = { descricaoServico: descricao.trim(), aliquotaIss: aliquotaNum, retemIss: false }
        } else {
          // NFS-e PRIMEIRO (pedido não faturado): emite sem título; o financeiro nasce da nota depois.
          const docDig = soDigitos(tomDoc)
          bodyFocus.manual = {
            descricaoServico: descricao.trim(),
            valorServicos: valorNum,
            aliquotaIss: aliquotaNum,
            retemIss: false,
            codigoServico: codigoTrib.trim() || undefined,
            tomador: {
              razaoSocial: tomNome.trim() || (tomTipo === 'CPF' ? 'Pessoa Física' : 'Pessoa Jurídica'),
              cnpj: tomTipo === 'CNPJ' && docDig ? docDig : undefined,
              cpf: tomTipo === 'CPF' && docDig ? docDig : undefined,
            },
          }
        }
        const resp = await authFetch('/api/fiscal/nfse/emitir', {
          method: 'POST',
          body: JSON.stringify(bodyFocus),
        })
        const json = (await resp.json().catch(() => null)) as RespFocus | null
        if (!json) {
          setResultado({ erro: 'Sem resposta do emissor fiscal.' })
        } else {
          const st = json.status
          const okEmissao = resp.ok && (json.ok || st === 'processando' || st === 'autorizada')
          if (!okEmissao) {
            setResultado({ erro: json.motivoRejeicao ?? json.mensagem ?? 'Falha ao emitir NFS-e.' })
          } else {
            const ref = json.providerReference ?? json.nfseId ?? undefined
            setResultado({
              ok: json.ok,
              status_local: st === 'autorizada' ? 'autorizada' : st === 'rejeitada' ? 'rejeitada' : 'processando',
              ref: ref ?? undefined,
              numero: json.numero ?? null,
              chave_acesso: json.codigoVerificacao ?? null,
              mensagem: json.motivoRejeicao ?? json.mensagem ?? null,
            })
            setNfseIdGerado(json.nfseId ?? null)
            if (ref) onEmitida(ref)
          }
        }
      } else {
        // gov_nfse_nacional (ou outro provedor gov) → edge function atual, inalterada.
        const body: Record<string, unknown> = {
          company_id: companyId,
          teste_homologacao: ambiente === 'homologacao',
          // #32 · contexto da trava do servidor: o município da execução e a alíquota saem do banco.
          servico_id: servicoIdEff,
          obra_id: obraIdFinal,
          municipio_prestacao_ibge: munIbgeFinal || undefined,
          servico: {
            descricao: descricao.trim(),
            valor: valorNum,
            codigo_tributacao_nacional_iss: codigoTrib.trim(),
            aliquota_iss: aliquotaNum,
          },
        }
        const docDigitos = soDigitos(tomDoc)
        if (docDigitos.length === 11 || docDigitos.length === 14) {
          body.tomador = {
            cpf_cnpj: docDigitos,
            razao_social: tomNome.trim() || (tomTipo === 'CPF' ? 'Pessoa Física' : 'Pessoa Jurídica'),
          }
        }
        const { data, error } = await supabase.functions.invoke<EmitirResp>('gov-nfse-emitir', { body })
        // FIX-NFSE-TRIBUTOS-SIMPLES-v1: preferimos data quando existir
        // (mesmo com error setado, o body pode trazer mensagem real da Focus)
        if (data) {
          setResultado(data)
          // FIX-O3B-NFSE-VINCULO-PROCESSANDO-v1
          // Vincula pedido<->NFS-e assim que a edge retorna ref (autorizada OU
          // processando OU rejeitada). Antes so disparava se usuario clicasse
          // "Fechar" · agora pedido_id grava sozinho · idempotente.
          if (data.ref) onEmitida(data.ref)
        } else if (error) {
          setResultado({ erro: error.message })
        } else {
          setResultado({ erro: 'Sem resposta da função.' })
        }
      }
    } catch (e) {
      setResultado({ erro: e instanceof Error ? e.message : 'Erro inesperado' })
    } finally {
      setFase('concluido')
    }
  }

  // NFS-e PRIMEIRO → financeiro pelo LÍQUIDO. numBR parseia "1.234,56" → 1234.56. Prévia da tela:
  // a receber = bruto − deduções − desconto incondicionado − Σretenções (informadas pelo usuário).
  const numBR = (s: string) => {
    const t = String(s || '').trim()
    if (!t) return 0
    const n = Number(t.replace(/\./g, '').replace(',', '.'))
    return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0
  }
  const finBruto = numBR(valor)
  const finRetTotal = numBR(finRet.iss) + numBR(finRet.irrf) + numBR(finRet.pis) + numBR(finRet.cofins) + numBR(finRet.csll) + numBR(finRet.inss)
  const finLiquido = Math.max(0, finBruto - numBR(finRet.deducoes) - numBR(finRet.desconto) - finRetTotal)
  const fmtBRL = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  async function gerarFinanceiro() {
    if (!nfseIdGerado) return
    setFinFase('enviando'); setFinMsg(null)
    try {
      const resp = await authFetch('/api/fiscal/nfse/gerar-financeiro', {
        method: 'POST',
        body: JSON.stringify({
          companyId, nfseId: nfseIdGerado,
          deducoes: numBR(finRet.deducoes), descontoIncondicionado: numBR(finRet.desconto),
          retencoes: { iss: numBR(finRet.iss), irrf: numBR(finRet.irrf), pis: numBR(finRet.pis), cofins: numBR(finRet.cofins), csll: numBR(finRet.csll), inss: numBR(finRet.inss) },
          primeiroVencimento: finVenc || null,
        }),
      })
      const j = (await resp.json().catch(() => null)) as { ok?: boolean; mensagem?: string; modo?: string; valor_liquido?: number } | null
      if (resp.ok && j?.ok !== false) {
        setFinFase('ok')
        setFinMsg(j?.modo === 'vinculado'
          ? 'Financeiro vinculado ao título já existente do pedido (sem duplicar).'
          : `Título gerado pelo líquido${j?.valor_liquido != null ? ` (${fmtBRL(Number(j.valor_liquido))})` : ''}.`)
      } else {
        setFinFase('erro')
        setFinMsg(j?.mensagem ?? 'Não foi possível gerar o financeiro.')
      }
    } catch (e) {
      setFinFase('erro'); setFinMsg(e instanceof Error ? e.message : 'Erro inesperado')
    }
  }

  // gating da emissão (item 1): quando o único bloqueio é obra e o usuário vai CRIAR a obra (informar +
  // "cadastrar no Hub" + IBGE + CNO), libera — a obra é criada no emit e o servidor revalida. Apontar uma
  // obra já cadastrada é validado ao vivo (obraIdEff entra na porta única), então não precisa de exceção.
  const bloqueiosNaoObra = bloqueios.filter((b) => !CODIGOS_OBRA.includes(b.codigo))
  // CNO é opcional (a prefeitura aceita endereço) — a obra informada precisa é do endereço COMPLETO.
  const e = obraFiscal.obraEnd
  // informar: basta o endereço COMPLETO (a obra é criada/reaproveitada no emit). CNO e "criar no Hub" não
  // são mais exigência — a prefeitura aceita o endereço (regra da porta única).
  const obraInformarOk = mostrarObra && obraFiscal.modo === 'informar'
    && !!e.codigo_ibge_municipio && !!(e.logradouro || '').trim() && !!(e.numero || '').trim()
    && !!(e.bairro || '').trim() && !!(e.cep || '').trim()
  const emissaoTravada = !!servicoIdEff && !podeEmitir && !(obraInformarOk && bloqueiosNaoObra.length === 0)
  // item 3 · ISS: Simples não destaca (vai no DAS) — nudge pra confirmar regime/alíquota com o contador;
  // fora do Simples, alíquota 0 sem resolução do município é provável configuração faltando.
  const aliquotaNumView = Number(aliquota.replace(',', '.')) || 0
  const avisoAliquotaZero = !empresaSimples && aliquotaNumView === 0 && !issInfo

  const statusLocal = resultado?.status_local
  const sucessoFinal = statusLocal === 'autorizada'
  const processando = statusLocal === 'processando'
  const rejeitado = statusLocal === 'rejeitada' || (resultado && !resultado.ok && !!resultado.erro) || (resultado?.status_local && !['autorizada', 'processando'].includes(resultado.status_local))

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="nfse-emitir-modal"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4 py-0 sm:py-6"
      onClick={(e) => { if (e.target === e.currentTarget) fecharPorOverlay() }}
    >
      <div className="w-full sm:max-w-lg bg-[#FAF7F2] sm:rounded-xl shadow-xl max-h-full overflow-y-auto">
        <div className="sticky top-0 bg-[#FAF7F2] border-b border-[#3D2314]/10 px-5 py-4 flex items-center justify-between">
          <h2 className="text-[18px] font-medium text-[#3D2314]">Emitir NFS-e</h2>
          <button
            type="button"
            onClick={fechar}
            disabled={fase === 'enviando'}
            className="text-[#3D2314]/60 hover:text-[#3D2314] disabled:opacity-40"
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {fase !== 'concluido' && (
            <>
              {/* FIX-NFSE-PEDIDO-PROVIDER-v1 · sem emissor fiscal ativo não há como emitir — leva pra Config Fiscal. */}
              {providerAtivo === null && (
                <div className="flex items-start gap-2 rounded-lg border border-[#C94544]/40 bg-[#FCEBEB] px-3 py-2 text-[12px] text-[#791F1F]">
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                  <span>Nenhum emissor fiscal ativo para esta empresa. Configure o emissor fiscal antes de emitir.{' '}
                    <Link href="/dashboard/configuracoes/fiscal" className="text-[#8B5612] underline underline-offset-2 inline-flex items-center gap-0.5">
                      Configuração Fiscal <ExternalLink size={10} />
                    </Link>
                  </span>
                </div>
              )}

              {/* Ambiente é READ-ONLY: vem da configuração da empresa, não se escolhe na emissão (chamado #16).
                  Produção = nota real; Homologação = teste. Trocar em Administração, não aqui. */}
              {ambiente === 'producao' ? (
                <div className="rounded-lg border border-[#3B6D11]/25 bg-[#EAF3DE] px-3 py-2 text-[12px] text-[#234D08]">
                  <span className="font-medium">Ambiente: Produção</span> — esta emissão gera <b>nota fiscal real</b>. Para testar, mude a empresa para Homologação em Administração.
                </div>
              ) : (
                <div className="rounded-lg border border-[#BA7517]/30 bg-[#FAEEDA] px-3 py-2 text-[12px] text-[#5C3B0B]">
                  <span className="font-medium">Ambiente: Homologação</span> — emissão de <b>teste</b>, não vale como nota fiscal. Para emitir de verdade, configure Produção em Administração.
                </div>
              )}

              {/* item 2 (print Rodrigo) · produção + tomador é usuário da própria empresa → nota REAL pra si mesmo */}
              {avisoAutoTomador && (
                <div className="flex items-start gap-2 rounded-lg border border-[#C94544]/40 bg-[#FCEBEB] px-3 py-2 text-[12px] text-[#791F1F]">
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                  <span>O tomador é um usuário desta empresa: isto gera uma <b>nota fiscal REAL para você mesmo</b>. Para testar, use <b>Homologação</b>.</span>
                </div>
              )}

              <fieldset className="space-y-3 border-t border-[#3D2314]/10 pt-4">
                <legend className="text-[11px] font-medium text-[#3D2314]/70 uppercase tracking-wide">
                  Tomador (opcional)
                </legend>
                <div className="grid grid-cols-[92px_1fr_auto] gap-2">
                  <select
                    value={tomTipo}
                    onChange={(e) => { setTomTipo(e.target.value as TomadorTipo); setTomDoc(''); setTomEndereco(''); setBuscaDocMsg('') }}
                    className="bg-white border border-[#3D2314]/15 rounded-md px-2 py-2 text-[13px] text-[#3D2314]"
                  >
                    <option value="CNPJ">CNPJ</option>
                    <option value="CPF">CPF</option>
                  </select>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={tomDoc}
                    onChange={(e) => setTomDoc(mascaraDoc(e.target.value, tomTipo))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void buscarTomador() } }}
                    placeholder={tomTipo === 'CPF' ? '000.000.000-00' : '00.000.000/0000-00'}
                    className="bg-white border border-[#3D2314]/15 rounded-md px-3 py-2 text-[13px] text-[#3D2314]"
                  />
                  {/* #35 · busca o tomador pelo documento (cadastro → Receita) */}
                  <button
                    type="button"
                    onClick={() => void buscarTomador()}
                    disabled={buscandoDoc}
                    data-testid="nfse-buscar-tomador"
                    className="px-3 py-2 rounded-md border border-[#3D2314]/15 text-[12.5px] text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    {buscandoDoc ? <Loader2 size={13} className="animate-spin" /> : 'Buscar'}
                  </button>
                </div>
                <input
                  type="text"
                  value={tomNome}
                  onChange={(e) => setTomNome(e.target.value)}
                  placeholder="Razão social / Nome"
                  className="w-full bg-white border border-[#3D2314]/15 rounded-md px-3 py-2 text-[13px] text-[#3D2314]"
                />
                {/* #35 · endereço do cliente para conferência (não vai no corpo da nota — o provedor
                    usa o endereço do cadastro/Receita; aqui é só pra Jordana confirmar que é o cliente certo). */}
                {tomEndereco && (
                  <div className="text-[11.5px] text-[#3D2314]/70 bg-white border border-[#3D2314]/12 rounded-md px-3 py-2">
                    <span className="text-[#3D2314]/50">Endereço:</span> {tomEndereco}
                  </div>
                )}
                {buscaDocMsg && <div className="text-[11px] text-[#3D2314]/60">{buscaDocMsg}</div>}
              </fieldset>

              <fieldset className="space-y-3 border-t border-[#3D2314]/10 pt-4">
                <legend className="text-[11px] font-medium text-[#3D2314]/70 uppercase tracking-wide">
                  Serviço
                </legend>
                {/* #35 · selecionar um serviço já cadastrado (traz descrição, valor, código e alíquota).
                    Escolher também liga a busca de ISS por município quando o serviço é "fora do município". */}
                {servicos.length > 0 && (
                  <label className="block">
                    <span className="block text-[11px] text-[#3D2314]/60 mb-1">Serviço cadastrado (opcional)</span>
                    <select
                      value={servicoSelId}
                      onChange={(e) => aplicarServico(e.target.value)}
                      data-testid="nfse-servico-select"
                      className="w-full bg-white border border-[#3D2314]/15 rounded-md px-3 py-2 text-[13px] text-[#3D2314]"
                    >
                      <option value="">— selecionar ou preencher manualmente —</option>
                      {servicos.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.codigo ? `${s.codigo} · ` : ''}{s.descricao_resumida || s.descricao_detalhada || 'serviço'}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <textarea
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Descrição do serviço prestado"
                  rows={2}
                  className="w-full bg-white border border-[#3D2314]/15 rounded-md px-3 py-2 text-[13px] text-[#3D2314]"
                />
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="block text-[11px] text-[#3D2314]/60 mb-1">Valor (R$)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={valor}
                      onChange={(e) => setValor(e.target.value)}
                      placeholder="0,00"
                      className="w-full bg-white border border-[#3D2314]/15 rounded-md px-3 py-2 text-[13px] text-[#3D2314]"
                    />
                  </label>
                  {empresaSimples ? (
                    <div className="flex items-end">
                      <p className="text-[11px] text-[#3D2314]/55 leading-snug pb-1">
                        <b>Simples Nacional:</b> ISS recolhido no DAS — não destacado na nota.
                      </p>
                    </div>
                  ) : (
                    <label className="block">
                      <span className="block text-[11px] text-[#3D2314]/60 mb-1">Alíquota ISS (%)</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={aliquota}
                        onChange={(e) => setAliquota(e.target.value)}
                        className="w-full bg-white border border-[#3D2314]/15 rounded-md px-3 py-2 text-[13px] text-[#3D2314]"
                      />
                    </label>
                  )}
                </div>
                {/* #32 · quando o ISS é devido no município da execução, a alíquota é buscada de lá. */}
                {!empresaSimples && issInfo && (
                  <p className="text-[11px] text-[#234D08] bg-[#EAF3DE] border border-[#3B6D11]/25 rounded-md px-2.5 py-1.5">
                    {issInfo}
                  </p>
                )}
                {/* item 3 · Simples: ISS no DAS. Nudge pra confirmar regime/alíquota do mês com o contador. */}
                {empresaSimples && (
                  <p className="text-[11px] text-[#3D2314]/60">
                    O contador ainda não confirmou o regime/alíquota do mês?{' '}
                    <Link href="/dashboard/configuracoes/fiscal" className="text-[#BA7517] hover:text-[#8B5612] underline underline-offset-2 inline-flex items-center gap-0.5">
                      Conferir na Configuração Fiscal <ExternalLink size={10} />
                    </Link>
                  </p>
                )}
                {/* item 3 · fora do Simples com alíquota 0 e sem resolução do município: provável config faltando. */}
                {avisoAliquotaZero && (
                  <div className="flex items-start gap-2 rounded-md border border-[#BA7517]/40 bg-[#FAEEDA] px-2.5 py-1.5 text-[11.5px] text-[#5C3B0B]">
                    <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                    <span>Alíquota de ISS não configurada (0%) — confirme com o contador.{' '}
                      <Link href="/dashboard/configuracoes/fiscal" className="text-[#8B5612] underline underline-offset-2 inline-flex items-center gap-0.5">
                        Configuração Fiscal <ExternalLink size={10} />
                      </Link>
                    </span>
                  </div>
                )}
                <label className="block">
                  <span className="block text-[11px] text-[#3D2314]/60 mb-1">Código tributação nacional ISS</span>
                  <input
                    type="text"
                    value={codigoTrib}
                    onChange={(e) => setCodigoTrib(e.target.value)}
                    placeholder="140101"
                    className="w-full bg-white border border-[#3D2314]/15 rounded-md px-3 py-2 text-[13px] text-[#3D2314]"
                  />
                </label>
              </fieldset>

              {/* A③ · obra no reenvio de nota rejeitada por E0370 sem obra (mesmo bloco da venda) */}
              {mostrarObra && (
                <BlocoObraFiscal companyId={companyId} value={obraFiscal} onChange={setObraFiscal} />
              )}

              {/* #32 · Local da execução — quando o serviço tem ISS no local da prestação. Aparece
                  pela prop OU quando a própria porta pediu município (independe da fiação do chamador). */}
              {(issNoLocalEff || bloqueios.some((b) => b.codigo === 'municipio_prestacao_ausente' || b.codigo === 'aliquota_iss_desconhecida')) && (
                <fieldset className="space-y-2 border-t border-[#3D2314]/10 pt-4">
                  <legend className="text-[11px] font-medium text-[#3D2314]/70 uppercase tracking-wide">Local da execução do serviço</legend>
                  {munIbge ? (
                    <div className="flex items-center justify-between bg-white border border-[#3D2314]/15 rounded-md px-3 py-2 text-[13px] text-[#3D2314]">
                      <span>{munLabel || `IBGE ${munIbge}`}</span>
                      <button type="button" className="text-[#3D2314]/50 hover:text-[#3D2314] text-[12px]"
                        onClick={() => { setMunIbge(''); setMunLabel(''); setMunBusca('') }}>trocar</button>
                    </div>
                  ) : (
                    <div className="relative">
                      <input value={munBusca} onChange={(e) => setMunBusca(e.target.value)} placeholder="digite o município onde o serviço foi prestado…"
                        className="w-full bg-white border border-[#3D2314]/15 rounded-md px-3 py-2 text-[13px] text-[#3D2314]" />
                      {munResultados.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-[#3D2314]/15 rounded-md shadow-lg">
                          {munResultados.map((m) => (
                            <button key={m.codigo_ibge} type="button"
                              onClick={() => { setMunIbge(m.codigo_ibge); setMunLabel(`${m.nome_municipio}/${m.uf}`); setMunResultados([]); setMunBusca('') }}
                              className="block w-full text-left px-3 py-2 text-[13px] text-[#3D2314] hover:bg-[#FAF7F2]">
                              {m.nome_municipio}/{m.uf} <span className="text-[#3D2314]/45">· {m.codigo_ibge}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {obraId && munLabel && <div className="text-[11px] text-[#3D2314]/55">Vindo da obra — editável se o canteiro for outro.</div>}
                </fieldset>
              )}

              {/* #32 · bloqueios da porta única — cada um leva ao lugar de resolver */}
              {servicoIdEff && bloqueios.length > 0 && (
                <div className="rounded-md border border-[#C94544] bg-[#FCEBEB] px-3 py-2.5">
                  <div className="flex items-center gap-2 text-[12.5px] font-medium text-[#791F1F] mb-1.5">
                    <AlertCircle size={14} /> Esta nota não pode ser emitida ainda
                  </div>
                  <ul className="space-y-1.5">
                    {bloqueios.map((b, i) => (
                      <li key={i} className="text-[12px] text-[#791F1F]">
                        • {b.mensagem}{b.acao ? <span className="text-[#3D2314]/60"> — {b.acao}{b.onde ? ` (${b.onde})` : ''}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {servicoIdEff && validando && <div className="text-[11px] text-[#3D2314]/50">Verificando obra e alíquota…</div>}

              {erroLocal && (
                <div className="flex items-start gap-2 bg-[#FCEBEB] border-l-4 border-[#C94544] rounded-md px-3 py-2 text-[12px] text-[#791F1F]">
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                  <span>{erroLocal}</span>
                </div>
              )}

              <div className="border-t border-[#3D2314]/10 pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={fechar}
                  disabled={fase === 'enviando'}
                  className="flex-1 px-4 py-2.5 rounded-md border border-[#3D2314]/15 text-[13px] text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-40"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={emitir}
                  disabled={fase === 'enviando' || validando || emissaoTravada || providerAtivo === null}
                  title={providerAtivo === null ? 'Configure o emissor fiscal da empresa' : emissaoTravada ? 'Resolva os itens acima antes de emitir' : undefined}
                  data-testid="nfse-emitir-submit"
                  className="flex-1 px-4 py-2.5 rounded-md bg-[#C8941A] text-[#3D2314] font-medium text-[13px] hover:bg-[#B07F12] disabled:opacity-50 inline-flex items-center justify-center gap-2"
                >
                  {fase === 'enviando' ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Emitindo…
                    </>
                  ) : (
                    'Emitir NFS-e'
                  )}
                </button>
              </div>
            </>
          )}

          {fase === 'concluido' && resultado && (
            <div className="space-y-4" data-testid="nfse-emitir-result">
              {sucessoFinal && (
                <div className="flex items-start gap-3 bg-[#EAF3DE] border-l-4 border-[#3B6D11] rounded-md px-4 py-3">
                  <CheckCircle2 className="text-[#3B6D11] mt-0.5 flex-shrink-0" size={18} />
                  <div className="text-[13px] text-[#234D08]">
                    <div className="font-medium">NFS-e autorizada</div>
                    {resultado.numero && <div className="mt-1">Número: <strong>{resultado.numero}</strong></div>}
                    {resultado.chave_acesso && <div className="text-[11px] mt-0.5 break-all">Chave: {resultado.chave_acesso}</div>}
                  </div>
                </div>
              )}

              {/* NFS-e PRIMEIRO → financeiro pelo LÍQUIDO. Após autorizada, gera o contas a receber pela
                  nota (retenções informadas pelo usuário nesta entrega). Prévia bruto · retenções · a receber. */}
              {sucessoFinal && nfseIdGerado && (
                <div className="rounded-md border border-[#C8941A]/40 bg-[#FAEEDA]/60 px-4 py-3 space-y-3" data-testid="nfse-gerar-financeiro">
                  <div className="text-[12.5px] font-medium text-[#5C3B0B]">Gerar financeiro desta nota</div>
                  {finFase !== 'ok' ? (
                    <>
                      <p className="text-[11px] text-[#5C3B0B]/80">Informe as retenções (quando houver). O título a receber nasce pelo <b>valor líquido</b>.</p>
                      <div className="grid grid-cols-3 gap-2">
                        {(['iss', 'irrf', 'pis', 'cofins', 'csll', 'inss'] as const).map((k) => (
                          <label key={k} className="block">
                            <span className="block text-[10.5px] text-[#3D2314]/60 mb-0.5">{k === 'iss' ? 'ISS retido' : k.toUpperCase()}</span>
                            <input type="text" inputMode="decimal" value={finRet[k]} onChange={(e) => setFinRet((p) => ({ ...p, [k]: e.target.value }))} placeholder="0,00" className="w-full bg-white border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[12.5px] text-[#3D2314]" />
                          </label>
                        ))}
                        <label className="block"><span className="block text-[10.5px] text-[#3D2314]/60 mb-0.5">Deduções</span><input type="text" inputMode="decimal" value={finRet.deducoes} onChange={(e) => setFinRet((p) => ({ ...p, deducoes: e.target.value }))} placeholder="0,00" className="w-full bg-white border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[12.5px] text-[#3D2314]" /></label>
                        <label className="block"><span className="block text-[10.5px] text-[#3D2314]/60 mb-0.5">Desconto</span><input type="text" inputMode="decimal" value={finRet.desconto} onChange={(e) => setFinRet((p) => ({ ...p, desconto: e.target.value }))} placeholder="0,00" className="w-full bg-white border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[12.5px] text-[#3D2314]" /></label>
                        <label className="block"><span className="block text-[10.5px] text-[#3D2314]/60 mb-0.5">1º vencimento</span><input type="date" value={finVenc} onChange={(e) => setFinVenc(e.target.value)} className="w-full bg-white border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[12.5px] text-[#3D2314]" /></label>
                      </div>
                      <div className="text-[12px] text-[#234D08] bg-[#EAF3DE] border border-[#3B6D11]/25 rounded-md px-3 py-2">
                        Valor da nota <b>{fmtBRL(finBruto)}</b> · retenções <b>{fmtBRL(finRetTotal)}</b> · a receber <b>{fmtBRL(finLiquido)}</b>
                        {(numBR(finRet.deducoes) + numBR(finRet.desconto)) > 0 && (
                          <span className="text-[#234D08]/70"> (inclui deduções/desconto {fmtBRL(numBR(finRet.deducoes) + numBR(finRet.desconto))})</span>
                        )}
                      </div>
                      {finFase === 'erro' && finMsg && (
                        <div className="flex items-start gap-2 text-[11.5px] text-[#791F1F]"><AlertCircle size={13} className="mt-0.5 flex-shrink-0" /><span>{finMsg}</span></div>
                      )}
                      <button type="button" onClick={() => void gerarFinanceiro()} disabled={finFase === 'enviando'} data-testid="nfse-gerar-financeiro-submit" className="w-full px-4 py-2.5 rounded-md bg-[#C8941A] text-[#3D2314] font-medium text-[13px] hover:bg-[#B07F12] disabled:opacity-50 inline-flex items-center justify-center gap-2">
                        {finFase === 'enviando' ? (<><Loader2 size={14} className="animate-spin" /> Gerando…</>) : 'Gerar financeiro desta nota'}
                      </button>
                    </>
                  ) : (
                    <div className="flex items-start gap-2 text-[12.5px] text-[#234D08]"><CheckCircle2 size={15} className="mt-0.5 flex-shrink-0 text-[#3B6D11]" /><span>{finMsg}</span></div>
                  )}
                </div>
              )}

              {processando && (
                <div className="flex items-start gap-3 bg-[#FAEEDA] border-l-4 border-[#BA7517] rounded-md px-4 py-3">
                  <Info className="text-[#BA7517] mt-0.5 flex-shrink-0" size={18} />
                  <div className="text-[13px] text-[#5C3B0B]">
                    <div className="font-medium">Processando na prefeitura</div>
                    <div className="mt-1 text-[12px]">Quando a prefeitura responder, o status na listagem se atualiza sozinho.</div>
                  </div>
                </div>
              )}

              {rejeitado && (
                <div className="flex items-start gap-3 bg-[#FCEBEB] border-l-4 border-[#C94544] rounded-md px-4 py-3">
                  <AlertCircle className="text-[#C94544] mt-0.5 flex-shrink-0" size={18} />
                  <div className="text-[13px] text-[#791F1F]">
                    <div className="font-medium">Falha ao emitir</div>
                    <div className="mt-1 text-[12px]">
                      {mensagemAmigavel(resultado.mensagem ?? resultado.erro ?? null)}
                    </div>
                  </div>
                </div>
              )}

              {resultado.ref && (
                <div className="text-[11px] text-[#3D2314]/60">
                  Referência: <code className="bg-[#3D2314]/5 px-1.5 py-0.5 rounded">{resultado.ref}</code>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="flex-1 px-4 py-2.5 rounded-md border border-[#3D2314]/15 text-[13px] text-[#3D2314] hover:bg-[#3D2314]/5"
                >
                  Emitir outra
                </button>
                <button
                  type="button"
                  onClick={() => { onEmitida(resultado?.ref); fechar() }}
                  className="flex-1 px-4 py-2.5 rounded-md bg-[#3D2314] text-[#FAF7F2] text-[13px] font-medium hover:bg-[#2A1810]"
                >
                  Fechar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
