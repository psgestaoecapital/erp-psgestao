'use client'

import { useState, useEffect } from 'react'
import { Loader2, FileCheck, AlertTriangle, X, ExternalLink } from 'lucide-react'
import { authFetch } from '@/lib/authFetch'
import { supabase } from '@/lib/supabase'
import CepEndereco from '@/components/comum/CepEndereco'

interface Props {
  open: boolean
  onClose: () => void
  companyId: string
  erpReceberId: string
  descricaoSugerida?: string
  valor?: number
  onSucesso?: (nfseId: string) => void
}

type Status = 'preview' | 'enviando' | 'consultando' | 'autorizada' | 'rejeitada'

interface RespostaEmissao {
  ok?: boolean
  nfseId?: string
  status?: string
  numero?: string
  codigoVerificacao?: string
  xmlUrl?: string
  pdfUrl?: string
  motivoRejeicao?: string
  ambiente?: string
  mensagem?: string
}

interface ServicoOpt {
  id: string
  descricao_resumida: string | null
  codigo_lc116: string | null
  codigo_servico_municipio: string | null
  aliquota_iss: number | null
}

export default function NFSePreviewModal(props: Props) {
  const [status, setStatus] = useState<Status>('preview')
  const [descricao, setDescricao] = useState(props.descricaoSugerida ?? '')
  const [aliquota, setAliquota] = useState('5')
  const [retemIss, setRetemIss] = useState(false)
  const [resposta, setResposta] = useState<RespostaEmissao | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  // receber-nfse-seletor-servico-v1: lista de servicos da empresa
  const [servicos, setServicos] = useState<ServicoOpt[]>([])
  const [servicoId, setServicoId] = useState<string>('')
  const [carregandoServicos, setCarregandoServicos] = useState(false)
  // #18 · E0370: subitens de tributação (07.02.01/07.02.02) + endereço da obra p/ serviço de construção
  const [subitens, setSubitens] = useState<Array<{ codigo: string; descricao: string }>>([])
  const [subitem, setSubitem] = useState('')
  const [obra, setObra] = useState({ logradouro: '', numero: '', bairro: '', cidade: '', cep: '', uf: '', municipio: '', cno: '' })
  // #82① · apontar a obra do Hub (opcional): ao escolher, puxa endereço/CNO já salvos e passa obra_id.
  const [obras, setObras] = useState<Array<{ id: string; numero: string; nome: string | null }>>([])
  const [obraId, setObraId] = useState('')

  useEffect(() => {
    if (props.open) {
      setStatus('preview')
      setDescricao(props.descricaoSugerida ?? '')
      setResposta(null)
      setErro(null)
    }
  }, [props.open, props.descricaoSugerida])

  useEffect(() => {
    if (!props.open || !props.companyId) return
    let alive = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCarregandoServicos(true)
    ;(async () => {
      const { data } = await supabase
        .from('erp_servicos')
        .select('id,descricao_resumida,codigo_lc116,codigo_servico_municipio,aliquota_iss')
        .eq('company_id', props.companyId)
        .eq('ativo', true)
        .order('descricao_resumida')
      if (!alive) return
      const lista = (data ?? []) as ServicoOpt[]
      setServicos(lista)
      // pre-seleciona se houver so um
      if (lista.length === 1) {
        setServicoId(lista[0].id)
        if (lista[0].aliquota_iss != null) setAliquota(String(lista[0].aliquota_iss))
      } else {
        setServicoId('')
      }
      setCarregandoServicos(false)
    })()
    return () => { alive = false }
  }, [props.open, props.companyId])

  // #18 · quando o serviço muda, busca os subitens de tributação do grupo LC116 (07.02 → 07.02.01/02).
  // Se houver subitens, o serviço é de construção (E0370) → exige endereço da obra.
  useEffect(() => {
    let alive = true
    const sel = servicos.find((s) => s.id === servicoId) ?? null
    ;(async () => {
      if (!props.open || !props.companyId || !sel?.codigo_lc116) {
        if (alive) { setSubitens([]); setSubitem('') }
        return
      }
      const { data } = await supabase.rpc('fn_fiscal_subitens_obra', { p_company_id: props.companyId, p_codigo_lc116: sel.codigo_lc116 })
      if (!alive) return
      const arr = (Array.isArray(data) ? data : []) as Array<{ codigo: string; descricao: string }>
      setSubitens(arr)
      const munic = (sel.codigo_servico_municipio ?? '').replace(/\D/g, '')
      setSubitem(arr.find((x) => x.codigo === munic)?.codigo ?? arr[0]?.codigo ?? '')
    })()
    return () => { alive = false }
  }, [props.open, props.companyId, servicoId, servicos])

  // #82① · carrega as obras da empresa para o seletor (só quando o serviço exige obra)
  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!props.open || !props.companyId || subitens.length === 0) { if (alive) setObras([]); return }
      const { data } = await supabase
        .from('projetos_obras')
        .select('id,numero,nome')
        .eq('company_id', props.companyId)
        .order('numero', { ascending: false })
      if (!alive) return
      setObras((data ?? []) as Array<{ id: string; numero: string; nome: string | null }>)
    })()
    return () => { alive = false }
  }, [props.open, props.companyId, subitens.length])

  // #82① · ao escolher uma obra do Hub, puxa os dados fiscais já salvos (endereço/CNO) para os campos
  async function escolherObra(id: string) {
    setObraId(id)
    if (!id) return
    const { data } = await supabase.rpc('fn_nfse_obra_resolver', { p_company_id: props.companyId, p_erp_receber_id: null, p_obra_id: id })
    const o = data as { encontrada?: boolean; cno?: string | null; logradouro?: string | null; numero_endereco?: string | null; bairro?: string | null; cidade?: string | null; cep?: string | null; uf?: string | null; codigo_ibge?: string | null } | null
    if (o?.encontrada) {
      setObra({
        logradouro: o.logradouro ?? '', numero: o.numero_endereco ?? '', bairro: o.bairro ?? '',
        cidade: o.cidade ?? '', cep: o.cep ?? '', uf: o.uf ?? '', municipio: o.codigo_ibge ?? '', cno: o.cno ?? '',
      })
    }
  }

  if (!props.open) return null

  async function pollStatus(nfseId: string, attempt: number) {
    if (attempt > 10) {
      setErro('Tempo esgotado · consulte depois no Hub Fiscal')
      setStatus('rejeitada')
      return
    }
    await new Promise((res) => setTimeout(res, 3000))
    try {
      const r = await authFetch(`/api/fiscal/nfse/consultar/${nfseId}`)
      const json = (await r.json()) as RespostaEmissao
      if (json.status === 'autorizada') {
        setResposta((prev) => ({ ...(prev ?? {}), ...json }))
        setStatus('autorizada')
        props.onSucesso?.(nfseId)
      } else if (json.status === 'rejeitada') {
        setErro(json.motivoRejeicao ?? 'Rejeitada')
        setStatus('rejeitada')
      } else {
        pollStatus(nfseId, attempt + 1)
      }
    } catch {
      pollStatus(nfseId, attempt + 1)
    }
  }

  async function emitir() {
    setStatus('enviando')
    setErro(null)
    try {
      const r = await authFetch('/api/fiscal/nfse/emitir', {
        method: 'POST',
        body: JSON.stringify({
          companyId: props.companyId,
          erpReceberId: props.erpReceberId,
          servicoId,
          // #18 · construção: subitem escolhido por nota + endereço da obra (E0370)
          ...(subitens.length > 0 ? {
            codigoServicoTributacao: subitem || undefined,
            obraId: obraId || undefined,
            obra: {
              cno: obra.cno.trim() || undefined,
              logradouro: obra.logradouro.trim() || undefined,
              numero: obra.numero.trim() || undefined,
              bairro: obra.bairro.trim() || undefined,
              cep: obra.cep.trim() || undefined,
              uf: obra.uf.trim() || undefined,
              codigoMunicipio: obra.municipio.trim() || undefined,
            },
          } : {}),
          overrides: {
            descricaoServico: descricao,
            aliquotaIss: parseFloat(aliquota),
            retemIss,
          },
        }),
      })
      const json = (await r.json()) as RespostaEmissao
      // 'processando_autorizacao' NÃO é erro: a nota foi enviada e aguarda a prefeitura.
      // Só trata como erro quando não é processando (rejeição real / falha HTTP).
      if ((!r.ok || !json.ok) && json.status !== 'processando') {
        setErro(json.mensagem ?? json.motivoRejeicao ?? 'Erro ao emitir')
        setStatus('rejeitada')
        return
      }
      setResposta(json)
      if (json.status === 'autorizada') {
        setStatus('autorizada')
        if (json.nfseId) props.onSucesso?.(json.nfseId)
      } else if (json.status === 'processando') {
        setStatus('consultando')
        if (json.nfseId) pollStatus(json.nfseId, 0)
      } else {
        setStatus('rejeitada')
        setErro(json.motivoRejeicao ?? 'Rejeitada pelo provider')
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro de rede')
      setStatus('rejeitada')
    }
  }

  const servicoSel = servicos.find((s) => s.id === servicoId) ?? null
  const exigeObra = subitens.length > 0
  const obraOk = !exigeObra || !!(obra.cno.trim() || obra.logradouro.trim())
  const podeEmitir = !!servicoId && descricao.trim().length >= 3 && obraOk

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="px-5 py-4 border-b border-[#3D2314]/10 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="text-[15px] font-medium text-[#3D2314]">Emitir NFSe</h2>
          <button
            type="button"
            onClick={props.onClose}
            disabled={status === 'enviando' || status === 'consultando'}
            className="text-[#3D2314]/60 hover:text-[#3D2314] p-1 rounded disabled:opacity-30"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {status === 'preview' && (
            <>
              <div className="bg-[#FAEEDA] border border-[#E8C387] rounded-lg p-3 text-[12px] text-[#633806]">
                Valor: <strong>R$ {props.valor?.toFixed(2) ?? '—'}</strong>
              </div>

              {/* receber-nfse-seletor-servico-v1: seletor de servico */}
              <div>
                <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">
                  Serviço prestado *
                </label>
                {carregandoServicos ? (
                  <div className="text-[12px] text-[#3D2314]/60 flex items-center gap-2 px-3 py-2 border border-[#3D2314]/15 rounded-lg">
                    <Loader2 size={13} className="animate-spin" /> Carregando serviços…
                  </div>
                ) : servicos.length === 0 ? (
                  <div className="text-[12px] text-[#791F1F] bg-[#FCEBEB] px-3 py-2 rounded-lg">
                    Nenhum serviço cadastrado para esta empresa.{' '}
                    <a href="/dashboard/cadastros/servicos" className="underline font-medium">
                      Cadastrar serviço
                    </a>
                  </div>
                ) : (
                  <select
                    value={servicoId}
                    onChange={(e) => {
                      const id = e.target.value
                      setServicoId(id)
                      const s = servicos.find((x) => x.id === id)
                      if (s?.aliquota_iss != null) setAliquota(String(s.aliquota_iss))
                    }}
                    className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg bg-white"
                  >
                    <option value="">— Selecione um serviço —</option>
                    {servicos.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.descricao_resumida ?? '(sem descrição)'}
                        {s.codigo_lc116 ? ` · LC ${s.codigo_lc116}` : ''}
                      </option>
                    ))}
                  </select>
                )}
                {servicoSel && (
                  <div className="text-[10.5px] text-[#3D2314]/55 mt-1">
                    Município: <strong>{servicoSel.codigo_servico_municipio ?? '—'}</strong> · LC116:{' '}
                    <strong>{servicoSel.codigo_lc116 ?? '—'}</strong>
                  </div>
                )}
              </div>

              {exigeObra && (
                <div className="border border-[#C8941A]/40 bg-[#FEF7E6] rounded-lg p-3 space-y-2.5">
                  <div className="text-[11px] text-[#7A5B12] leading-snug">
                    <strong>Serviço de construção (regra E0370).</strong> Escolha o código de tributação da obra e informe o <strong>endereço da obra</strong> (ou o CNO). Sem um dos dois, a prefeitura rejeita a nota.
                  </div>
                  {obras.length > 0 && (
                    <div>
                      <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">Obra do Hub (opcional — puxa os dados já cadastrados)</label>
                      <select
                        value={obraId}
                        onChange={(e) => void escolherObra(e.target.value)}
                        className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg bg-white"
                      >
                        <option value="">— Preencher manualmente —</option>
                        {obras.map((o) => (
                          <option key={o.id} value={o.id}>{o.numero}{o.nome ? ` · ${o.nome}` : ''}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">Código de tributação (subitem)</label>
                    <select
                      value={subitem}
                      onChange={(e) => setSubitem(e.target.value)}
                      className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg bg-white"
                    >
                      {subitens.map((s) => (
                        <option key={s.codigo} value={s.codigo}>{s.codigo} · {s.descricao}</option>
                      ))}
                    </select>
                  </div>
                  {/* #82② · endereço da obra pelo componente único (IBGE nasce do CEP, nunca digitado) */}
                  <CepEndereco
                    ibgeObrigatorio
                    value={{ cep: obra.cep, logradouro: obra.logradouro, numero: obra.numero, bairro: obra.bairro, cidade: obra.cidade, uf: obra.uf, codigo_ibge_municipio: obra.municipio }}
                    onChange={(p) => setObra((prev) => ({ ...prev,
                      ...(p.cep !== undefined ? { cep: p.cep } : {}),
                      ...(p.logradouro !== undefined ? { logradouro: p.logradouro } : {}),
                      ...(p.numero !== undefined ? { numero: p.numero } : {}),
                      ...(p.bairro !== undefined ? { bairro: p.bairro } : {}),
                      ...(p.cidade !== undefined ? { cidade: p.cidade } : {}),
                      ...(p.uf !== undefined ? { uf: p.uf } : {}),
                      ...(p.codigo_ibge_municipio !== undefined ? { municipio: p.codigo_ibge_municipio } : {}),
                    }))}
                  />
                  <input value={obra.cno} onChange={(e) => setObra({ ...obra, cno: e.target.value })} placeholder="CNO (opcional, se tiver)" className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg" />
                  {!obraOk && <div className="text-[11px] text-[#791F1F]">Informe o endereço da obra ou o CNO para emitir.</div>}
                </div>
              )}

              <div>
                <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">
                  Descricao do servico
                </label>
                <textarea
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40"
                  placeholder="Ex: Prestacao de servicos de consultoria empresarial referente a maio/2026"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">
                    Aliquota ISS (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={aliquota}
                    onChange={(e) => setAliquota(e.target.value)}
                    className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40"
                  />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">
                    Retem ISS?
                  </label>
                  <select
                    value={retemIss ? '1' : '0'}
                    onChange={(e) => setRetemIss(e.target.value === '1')}
                    className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg bg-white"
                  >
                    <option value="0">Nao</option>
                    <option value="1">Sim</option>
                  </select>
                </div>
              </div>
              {erro && (
                <div className="flex items-start gap-2 text-[12px] text-[#791F1F] bg-[#FCEBEB] p-2.5 rounded-lg">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>{erro}</span>
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={props.onClose}
                  className="flex-1 px-4 py-2.5 text-[13px] font-medium rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={emitir}
                  disabled={!podeEmitir}
                  data-testid="nfse-emitir-confirmar"
                  className="flex-1 px-4 py-2.5 text-[13px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] disabled:opacity-40"
                >
                  Emitir NFSe
                </button>
              </div>
            </>
          )}

          {(status === 'enviando' || status === 'consultando') && (
            <div className="py-8 text-center">
              <Loader2 className="animate-spin mx-auto text-[#C8941A]" size={32} />
              <p className="mt-3 text-[13px] text-[#3D2314]">
                {status === 'enviando' ? 'Enviando ao Focus NFe...' : 'Aguardando autorizacao SEFAZ...'}
              </p>
              <p className="mt-1 text-[11px] text-[#3D2314]/60">Pode levar ate 30s</p>
            </div>
          )}

          {status === 'autorizada' && resposta && (
            <div className="space-y-3">
              <div className="bg-[#E8F4DC] border border-[#C0DD97] rounded-lg p-3.5 flex items-start gap-2.5">
                <FileCheck className="text-[#3F7012] flex-shrink-0 mt-0.5" size={18} />
                <div className="flex-1">
                  <div className="text-[13.5px] font-medium text-[#1B3608]">NFSe autorizada</div>
                  <div className="text-[12px] text-[#1B3608]/85 mt-1 space-y-0.5">
                    {resposta.numero && <div>Numero: <strong>{resposta.numero}</strong></div>}
                    {resposta.codigoVerificacao && (
                      <div>Codigo verificacao: <strong>{resposta.codigoVerificacao}</strong></div>
                    )}
                    {resposta.ambiente && (
                      <div className="text-[11px] text-[#1B3608]/70">Ambiente: {resposta.ambiente}</div>
                    )}
                  </div>
                </div>
              </div>
              {(resposta.pdfUrl || resposta.xmlUrl) && (
                <div className="flex gap-2">
                  {resposta.pdfUrl && (
                    <a
                      href={resposta.pdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 px-3 py-2 text-[12px] font-medium text-center rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5 flex items-center justify-center gap-1.5"
                    >
                      <ExternalLink size={13} /> Ver PDF
                    </a>
                  )}
                  {resposta.xmlUrl && (
                    <a
                      href={resposta.xmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 px-3 py-2 text-[12px] font-medium text-center rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5 flex items-center justify-center gap-1.5"
                    >
                      <ExternalLink size={13} /> Ver XML
                    </a>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={props.onClose}
                className="w-full px-4 py-2.5 text-[13px] font-medium rounded-lg bg-[#3D2314] text-[#FAF7F2]"
              >
                Fechar
              </button>
            </div>
          )}

          {status === 'rejeitada' && (
            <div className="space-y-3">
              <div className="bg-[#FCEBEB] border border-[#E8A6A5] rounded-lg p-3.5 flex items-start gap-2.5">
                <AlertTriangle className="text-[#C94544] flex-shrink-0 mt-0.5" size={18} />
                <div>
                  <div className="text-[13.5px] font-medium text-[#791F1F]">NFSe rejeitada</div>
                  <div className="text-[12px] text-[#791F1F]/85 mt-1">{erro ?? 'Erro desconhecido'}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStatus('preview')}
                  className="flex-1 px-4 py-2.5 text-[13px] font-medium rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5"
                >
                  Tentar novamente
                </button>
                <button
                  type="button"
                  onClick={props.onClose}
                  className="flex-1 px-4 py-2.5 text-[13px] font-medium rounded-lg bg-[#3D2314] text-[#FAF7F2]"
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
