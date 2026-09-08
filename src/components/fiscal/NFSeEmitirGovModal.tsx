'use client'

// FEAT-NFSE-TELA-v1 · Modal de emissao NFS-e
// Chama edge function gov-nfse-emitir (Focus NFe gateway).
// Mobile-first · form curto · erros em linguagem humana.
// Defaults KGF: codigo tributacao 140101 · aliquota 0 (Simples Nacional).

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { X, Loader2, CheckCircle2, AlertCircle, Info } from 'lucide-react'

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
}

type Municipio = { codigo_ibge: string; nome_municipio: string; uf: string }
type Bloqueio = { codigo: string; mensagem: string; acao?: string; onde?: string }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, producaoDisponivel, tomadorTipo, tomadorDocumento, tomadorNome, descricaoServico, valorServicos, aliquotaIss, codigoServicoMunicipio, codigoLC116])

  // #32 fase 2 · a PORTA ÚNICA: valida no banco (obra + ISS) e mostra os bloqueios. Roda ao abrir e
  // quando muda o município. Só quando há servico_id (emissão de catálogo); sem ele, nada a validar.
  useEffect(() => {
    if (!aberto || !servicoId) { setBloqueios([]); setPodeEmitir(true); return }
    let vivo = true
    setValidando(true)
    void (async () => {
      try {
        const { data } = await supabase.rpc('fn_nfse_validar_emissao', {
          p_company_id: companyId,
          p_dados: { servico_id: servicoId, obra_id: obraId ?? null, municipio_prestacao_ibge: munIbge || null },
        })
        if (!vivo) return
        const v = data as { pode_emitir?: boolean; bloqueios?: Bloqueio[] } | null
        setBloqueios(v?.bloqueios ?? [])
        setPodeEmitir(v?.pode_emitir !== false)
      } finally {
        if (vivo) setValidando(false)
      }
    })()
    return () => { vivo = false }
  }, [aberto, servicoId, obraId, munIbge, companyId])

  // #32 · descobre o regime (Simples x não-Simples) da empresa ao abrir, p/ decidir se o ISS é
  // destacado. Simples (opção 2 MEI / 3 ME/EPP) → ISS no DAS, campo de alíquota some.
  useEffect(() => {
    if (!aberto || !companyId) return
    let vivo = true
    void (async () => {
      const { data } = await supabase.from('erp_fiscal_provider_config')
        .select('opcao_simples_nacional').eq('company_id', companyId)
        .eq('provider', 'gov_nfse_nacional').eq('ativo', true).maybeSingle()
      if (!vivo) return
      const op = (data as { opcao_simples_nacional?: number | null } | null)?.opcao_simples_nacional
      setEmpresaSimples(op === 2 || op === 3)
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
    setResultado(null); setErroLocal(null); setFase('form')
  }

  function fechar() {
    if (fase === 'enviando') return
    resetForm()
    onFechar()
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

  async function emitir() {
    setErroLocal(null)

    const valorNum = Number(valor.replace(/\./g, '').replace(',', '.'))
    if (!descricao.trim()) { setErroLocal('Informe a descrição do serviço.'); return }
    if (!isFinite(valorNum) || valorNum <= 0) { setErroLocal('Valor deve ser maior que zero.'); return }
    if (!codigoTrib.trim()) { setErroLocal('Informe o código de tributação ISS.'); return }
    // #32 · a trava: não deixa nem tentar enquanto houver bloqueio (o servidor barra de novo).
    if (servicoId && !podeEmitir) { setErroLocal('Resolva os itens acima antes de emitir.'); return }

    const aliquotaNum = Number(aliquota.replace(',', '.')) || 0

    const body: Record<string, unknown> = {
      company_id: companyId,
      teste_homologacao: ambiente === 'homologacao',
      // #32 · contexto da trava do servidor: o município da execução e a alíquota saem do banco.
      servico_id: servicoId,
      obra_id: obraId,
      municipio_prestacao_ibge: munIbge || undefined,
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

    setFase('enviando')
    try {
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
    } catch (e) {
      setResultado({ erro: e instanceof Error ? e.message : 'Erro inesperado' })
    } finally {
      setFase('concluido')
    }
  }

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

              <fieldset className="space-y-3 border-t border-[#3D2314]/10 pt-4">
                <legend className="text-[11px] font-medium text-[#3D2314]/70 uppercase tracking-wide">
                  Tomador (opcional)
                </legend>
                <div className="grid grid-cols-[100px_1fr] gap-2">
                  <select
                    value={tomTipo}
                    onChange={(e) => { setTomTipo(e.target.value as TomadorTipo); setTomDoc('') }}
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
                    placeholder={tomTipo === 'CPF' ? '000.000.000-00' : '00.000.000/0000-00'}
                    className="bg-white border border-[#3D2314]/15 rounded-md px-3 py-2 text-[13px] text-[#3D2314]"
                  />
                </div>
                <input
                  type="text"
                  value={tomNome}
                  onChange={(e) => setTomNome(e.target.value)}
                  placeholder="Razão social / Nome"
                  className="w-full bg-white border border-[#3D2314]/15 rounded-md px-3 py-2 text-[13px] text-[#3D2314]"
                />
              </fieldset>

              <fieldset className="space-y-3 border-t border-[#3D2314]/10 pt-4">
                <legend className="text-[11px] font-medium text-[#3D2314]/70 uppercase tracking-wide">
                  Serviço
                </legend>
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

              {/* #32 · Local da execução — quando o serviço tem ISS no local da prestação. Aparece
                  pela prop OU quando a própria porta pediu município (independe da fiação do chamador). */}
              {(issNoLocalPrestacao || bloqueios.some((b) => b.codigo === 'municipio_prestacao_ausente' || b.codigo === 'aliquota_iss_desconhecida')) && (
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
              {servicoId && bloqueios.length > 0 && (
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
              {servicoId && validando && <div className="text-[11px] text-[#3D2314]/50">Verificando obra e alíquota…</div>}

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
                  disabled={fase === 'enviando' || validando || (!!servicoId && !podeEmitir)}
                  title={(!!servicoId && !podeEmitir) ? 'Resolva os itens acima antes de emitir' : undefined}
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
