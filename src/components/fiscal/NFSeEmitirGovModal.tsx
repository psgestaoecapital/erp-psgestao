'use client'

// FEAT-NFSE-TELA-v1 · Modal de emissao NFS-e
// Chama edge function gov-nfse-emitir (Focus NFe gateway).
// Mobile-first · form curto · erros em linguagem humana.
// Defaults KGF: codigo tributacao 140101 · aliquota 0 (Simples Nacional).

import { useState } from 'react'
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
  onEmitida: () => void
  producaoDisponivel?: boolean
}

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

export default function NFSeEmitirGovModal({ companyId, aberto, onFechar, onEmitida, producaoDisponivel = false }: Props) {
  // FIX-NFSE-MODAL-PRODUCAO-v1 · quando producao esta liberada, default = producao
  const [ambiente, setAmbiente] = useState<'homologacao' | 'producao'>(producaoDisponivel ? 'producao' : 'homologacao')
  const [tomTipo, setTomTipo] = useState<TomadorTipo>('CNPJ')
  const [tomDoc, setTomDoc] = useState('')
  const [tomNome, setTomNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [codigoTrib, setCodigoTrib] = useState('140101')
  const [aliquota, setAliquota] = useState('0')
  const [fase, setFase] = useState<Fase>('form')
  const [resultado, setResultado] = useState<EmitirResp | null>(null)
  const [erroLocal, setErroLocal] = useState<string | null>(null)

  if (!aberto) return null

  function resetForm() {
    setTomDoc(''); setTomNome(''); setDescricao(''); setValor('')
    setCodigoTrib('140101'); setAliquota('0')
    setResultado(null); setErroLocal(null); setFase('form')
  }

  function fechar() {
    if (fase === 'enviando') return
    resetForm()
    onFechar()
  }

  async function emitir() {
    setErroLocal(null)

    const valorNum = Number(valor.replace(/\./g, '').replace(',', '.'))
    if (!descricao.trim()) { setErroLocal('Informe a descrição do serviço.'); return }
    if (!isFinite(valorNum) || valorNum <= 0) { setErroLocal('Valor deve ser maior que zero.'); return }
    if (!codigoTrib.trim()) { setErroLocal('Informe o código de tributação ISS.'); return }

    const aliquotaNum = Number(aliquota.replace(',', '.')) || 0

    const body: Record<string, unknown> = {
      company_id: companyId,
      teste_homologacao: ambiente === 'homologacao',
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
      onClick={(e) => { if (e.target === e.currentTarget) fechar() }}
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
              <div>
                <label className="block text-[11px] font-medium text-[#3D2314]/70 uppercase tracking-wide mb-2">
                  Ambiente
                </label>
                <div className="inline-flex rounded-lg border border-[#3D2314]/15 bg-white p-0.5 w-full">
                  <button
                    type="button"
                    onClick={() => setAmbiente('homologacao')}
                    className={`flex-1 px-3 py-2 rounded-md text-[13px] font-medium transition ${
                      ambiente === 'homologacao' ? 'bg-[#3D2314] text-[#FAF7F2]' : 'text-[#3D2314]/70'
                    }`}
                  >
                    Homologação
                  </button>
                  <button
                    type="button"
                    onClick={() => producaoDisponivel && setAmbiente('producao')}
                    disabled={!producaoDisponivel}
                    title={producaoDisponivel ? 'Emite na Focus produção (real, fiscal)' : 'Aguardando liberação Focus para CNPJ KGF'}
                    className={`flex-1 px-3 py-2 rounded-md text-[13px] font-medium transition ${
                      ambiente === 'producao' ? 'bg-[#3D2314] text-[#FAF7F2]' :
                      producaoDisponivel ? 'text-[#3D2314]/70' :
                      'text-[#3D2314]/30 cursor-not-allowed'
                    }`}
                  >
                    Produção
                  </button>
                </div>
              </div>

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
                  disabled={fase === 'enviando'}
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
                  onClick={() => { onEmitida(); fechar() }}
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
