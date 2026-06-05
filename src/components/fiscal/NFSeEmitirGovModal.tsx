'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { X, Loader2, FileCheck, AlertTriangle, ExternalLink, Send } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  companyId: string
  onEmitida?: () => void
}

type TipoDoc = 'CPF' | 'CNPJ'

type EstadoEmissao =
  | { fase: 'idle' }
  | { fase: 'enviando' }
  | {
      fase: 'concluido'
      ok: boolean
      status_focus?: string
      status_local?: string
      ref?: string
      chave_acesso?: string | null
      numero?: string | null
      mensagem?: string | null
      resposta_focus?: { post?: { status?: number; body?: string }; get?: { status?: number; body?: string } }
      erro?: string
    }

interface InvokeResp {
  ok?: boolean
  status_focus?: string
  status_local?: string
  ref?: string
  chave_acesso?: string | null
  numero?: string | null
  mensagem?: string | null
  ambiente?: string
  resposta_focus?: { post?: { status?: number; body?: string }; get?: { status?: number; body?: string } }
  erro?: string
  sugestao?: string
  detalhe?: string
}

function tryExtractUrl(body?: string): { url?: string; caminho_xml?: string; caminho_danfse?: string } {
  if (!body) return {}
  try {
    const j = JSON.parse(body) as Record<string, unknown>
    return {
      url: typeof j.url === 'string' ? j.url : undefined,
      caminho_xml: typeof j.caminho_xml === 'string' ? j.caminho_xml : undefined,
      caminho_danfse: typeof j.caminho_danfse === 'string' ? j.caminho_danfse : undefined,
    }
  } catch {
    return {}
  }
}

export default function NFSeEmitirGovModal({ open, onClose, companyId, onEmitida }: Props) {
  const [teste, setTeste] = useState(true)
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [codigoTribIss, setCodigoTribIss] = useState('')
  const [codigoNbs, setCodigoNbs] = useState('')
  const [aliquotaIss, setAliquotaIss] = useState('5')
  const [tomTipo, setTomTipo] = useState<TipoDoc>('CPF')
  const [tomDoc, setTomDoc] = useState('')
  const [tomNome, setTomNome] = useState('')
  const [estado, setEstado] = useState<EstadoEmissao>({ fase: 'idle' })

  if (!open) return null

  function reset() {
    setDescricao('')
    setValor('')
    setCodigoTribIss('')
    setCodigoNbs('')
    setAliquotaIss('5')
    setTomDoc('')
    setTomNome('')
    setEstado({ fase: 'idle' })
  }

  function fechar() {
    if (estado.fase === 'enviando') return
    reset()
    onClose()
  }

  const podeEmitir =
    descricao.trim().length >= 3 &&
    Number(valor.replace(',', '.')) > 0 &&
    codigoTribIss.trim().length > 0 &&
    estado.fase !== 'enviando'

  async function emitir() {
    if (!podeEmitir) return
    setEstado({ fase: 'enviando' })

    const body: Record<string, unknown> = {
      company_id: companyId,
      teste_homologacao: teste,
      servico: {
        descricao: descricao.trim(),
        valor: Number(valor.replace(',', '.')),
        codigo_tributacao_nacional_iss: codigoTribIss.trim(),
        aliquota_iss: Number(aliquotaIss.replace(',', '.')) || 0,
      },
    }
    if (codigoNbs.trim()) {
      (body.servico as Record<string, unknown>).codigo_nbs = codigoNbs.trim()
    }
    if (tomDoc.trim()) {
      body.tomador = {
        cpf_cnpj: tomDoc.replace(/\D/g, ''),
        razao_social: tomNome.trim() || (tomTipo === 'CPF' ? 'Pessoa Física' : 'Pessoa Jurídica'),
      }
    }

    try {
      const { data, error } = await supabase.functions.invoke<InvokeResp>('gov-nfse-emitir', { body })
      if (error) {
        setEstado({ fase: 'concluido', ok: false, erro: error.message })
        return
      }
      const r = data ?? {}
      const ok = r.status_local === 'autorizada' || r.status_local === 'processando'
      setEstado({
        fase: 'concluido',
        ok,
        status_focus: r.status_focus,
        status_local: r.status_local,
        ref: r.ref,
        chave_acesso: r.chave_acesso,
        numero: r.numero,
        mensagem: r.mensagem ?? r.erro ?? r.detalhe ?? null,
        resposta_focus: r.resposta_focus,
      })
      if (ok) onEmitida?.()
    } catch (e) {
      setEstado({ fase: 'concluido', ok: false, erro: e instanceof Error ? e.message : 'Erro' })
    }
  }

  // Semaforo
  const semaforoColor =
    estado.fase === 'concluido'
      ? estado.status_local === 'autorizada'
        ? 'bg-[#3F7012]'
        : estado.status_local === 'processando'
          ? 'bg-[#C8941A]'
          : 'bg-[#C94544]'
      : 'bg-[#3D2314]/20'

  const links = estado.fase === 'concluido' ? tryExtractUrl(estado.resposta_focus?.get?.body) : {}

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="px-5 py-4 border-b border-[#3D2314]/10 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <div className="text-[11px] text-[#3D2314]/55 tracking-[0.8px] uppercase font-medium">
              Emitir NFS-e {teste && '· homologação'}
            </div>
            <h2 className="text-[15px] font-medium text-[#3D2314]">Nova NFS-e</h2>
          </div>
          <button
            type="button"
            onClick={fechar}
            disabled={estado.fase === 'enviando'}
            className="text-[#3D2314]/60 hover:text-[#3D2314] disabled:opacity-30"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* FORMULARIO */}
          {(estado.fase === 'idle' || estado.fase === 'enviando') && (
            <>
              <label className="flex items-center gap-2 text-[12.5px] text-[#3D2314] cursor-pointer">
                <input
                  type="checkbox"
                  checked={teste}
                  onChange={(e) => setTeste(e.target.checked)}
                  className="accent-[#C8941A]"
                />
                Teste (homologação)
              </label>

              <div>
                <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">
                  Descrição do serviço *
                </label>
                <textarea
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  rows={2}
                  placeholder="Ex: Manutenção corretiva de veículo - troca de pastilhas"
                  className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40 text-[#3D2314] placeholder:text-[#3D2314]/35"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">Valor (R$) *</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                    placeholder="0,00"
                    className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40 text-[#3D2314] placeholder:text-[#3D2314]/35"
                  />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">Alíquota ISS (%)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={aliquotaIss}
                    onChange={(e) => setAliquotaIss(e.target.value)}
                    placeholder="5"
                    className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40 text-[#3D2314] placeholder:text-[#3D2314]/35"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">
                    Cód. tributação ISS *
                  </label>
                  <input
                    type="text"
                    value={codigoTribIss}
                    onChange={(e) => setCodigoTribIss(e.target.value)}
                    placeholder="LC 116/2003"
                    className="w-full px-3 py-2 text-[13px] font-mono border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40 text-[#3D2314] placeholder:text-[#3D2314]/35"
                  />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">Cód. NBS (opc.)</label>
                  <input
                    type="text"
                    value={codigoNbs}
                    onChange={(e) => setCodigoNbs(e.target.value)}
                    placeholder=""
                    className="w-full px-3 py-2 text-[13px] font-mono border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40 text-[#3D2314] placeholder:text-[#3D2314]/35"
                  />
                </div>
              </div>

              <div className="border-t border-[#3D2314]/10 pt-4">
                <div className="text-[11px] text-[#3D2314]/55 uppercase tracking-[0.5px] font-medium mb-2">
                  Tomador (opcional)
                </div>

                <div className="flex gap-2 mb-2">
                  {(['CPF', 'CNPJ'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTomTipo(t)}
                      className={`px-3 py-1.5 text-[12px] font-medium rounded-lg border transition-colors ${
                        tomTipo === t
                          ? 'border-[#C8941A]/45 bg-[#C8941A]/10 text-[#633806]'
                          : 'border-[#3D2314]/15 text-[#3D2314]/70 hover:bg-[#3D2314]/5'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                <input
                  type="text"
                  inputMode="numeric"
                  value={tomDoc}
                  onChange={(e) => setTomDoc(e.target.value)}
                  placeholder={tomTipo === 'CPF' ? '000.000.000-00' : '00.000.000/0000-00'}
                  maxLength={18}
                  className="w-full mb-2 px-3 py-2 text-[13px] font-mono border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40 text-[#3D2314] placeholder:text-[#3D2314]/35"
                />

                <input
                  type="text"
                  value={tomNome}
                  onChange={(e) => setTomNome(e.target.value)}
                  placeholder={tomTipo === 'CPF' ? 'Nome completo' : 'Razão social'}
                  className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40 text-[#3D2314] placeholder:text-[#3D2314]/35"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={fechar}
                  disabled={estado.fase === 'enviando'}
                  className="flex-1 px-4 py-2.5 text-[13px] font-medium rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-40"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={emitir}
                  disabled={!podeEmitir}
                  data-testid="nfse-emitir-gov"
                  className="flex-1 px-4 py-2.5 text-[13px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {estado.fase === 'enviando' ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Send size={14} />
                  )}
                  Emitir NFS-e
                </button>
              </div>
            </>
          )}

          {/* RESULTADO */}
          {estado.fase === 'concluido' && (
            <>
              <div
                className={`rounded-lg p-4 flex items-start gap-3 ${
                  estado.status_local === 'autorizada'
                    ? 'bg-[#E8F4DC] border border-[#C0DD97]'
                    : estado.status_local === 'processando'
                      ? 'bg-[#FAEEDA] border border-[#E8C387]'
                      : 'bg-[#FCEBEB] border border-[#E8A6A5]'
                }`}
              >
                <span className={`w-3 h-3 rounded-full mt-1 flex-shrink-0 ${semaforoColor}`} />
                <div className="flex-1 min-w-0">
                  {estado.status_local === 'autorizada' ? (
                    <div className="flex items-center gap-1.5 text-[14px] font-medium text-[#1B3608] mb-1">
                      <FileCheck size={15} /> NFS-e criada
                    </div>
                  ) : estado.status_local === 'processando' ? (
                    <div className="flex items-center gap-1.5 text-[14px] font-medium text-[#633806] mb-1">
                      <Loader2 size={15} className="animate-spin" /> Processando na prefeitura
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-[14px] font-medium text-[#791F1F] mb-1">
                      <AlertTriangle size={15} /> Falha ao emitir
                    </div>
                  )}

                  {estado.numero && (
                    <div className="text-[12.5px] text-[#3D2314]">
                      Nº <strong>{estado.numero}</strong>
                    </div>
                  )}
                  {estado.chave_acesso && (
                    <div className="text-[11px] text-[#3D2314]/75 font-mono break-all mt-0.5">
                      Chave: {estado.chave_acesso}
                    </div>
                  )}
                  {estado.mensagem && (
                    <div className="text-[12px] text-[#3D2314]/85 mt-1">{estado.mensagem}</div>
                  )}
                  {estado.erro && (
                    <div className="text-[12px] text-[#791F1F] mt-1">{estado.erro}</div>
                  )}
                  {estado.ref && (
                    <div className="text-[10.5px] text-[#3D2314]/55 mt-1 font-mono">ref: {estado.ref}</div>
                  )}
                </div>
              </div>

              {(links.url || links.caminho_xml || links.caminho_danfse) && (
                <div className="flex flex-col sm:flex-row gap-2">
                  {links.url && (
                    <a
                      href={links.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 px-3 py-2 text-[12px] font-medium text-center rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5 flex items-center justify-center gap-1.5"
                    >
                      <ExternalLink size={12} /> Visualizar
                    </a>
                  )}
                  {links.caminho_xml && (
                    <a
                      href={links.caminho_xml}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 px-3 py-2 text-[12px] font-medium text-center rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5 flex items-center justify-center gap-1.5"
                    >
                      <ExternalLink size={12} /> XML
                    </a>
                  )}
                  {links.caminho_danfse && (
                    <a
                      href={links.caminho_danfse}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 px-3 py-2 text-[12px] font-medium text-center rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5 flex items-center justify-center gap-1.5"
                    >
                      <ExternalLink size={12} /> DANFSe
                    </a>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEstado({ fase: 'idle' })}
                  className="flex-1 px-4 py-2.5 text-[13px] font-medium rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5"
                >
                  Emitir outra
                </button>
                <button
                  type="button"
                  onClick={fechar}
                  className="flex-1 px-4 py-2.5 text-[13px] font-medium rounded-lg bg-[#3D2314] text-[#FAF7F2]"
                >
                  Fechar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
