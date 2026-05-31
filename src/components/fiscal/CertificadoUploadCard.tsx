'use client'

import { useRef, useState } from 'react'
import { authFetch } from '@/lib/authFetch'
import { parsePfxFile, type PfxParsedInfo } from '@/lib/fiscal/pfx-parser'
import { Upload, FileCheck, AlertTriangle, Trash2, Loader2 } from 'lucide-react'

interface Props {
  companyId: string
  certificadoAtual: Record<string, unknown> | null
  onAtualizado: () => void
}

export default function CertificadoUploadCard({ companyId, certificadoAtual, onAtualizado }: Props) {
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [senha, setSenha] = useState('')
  const [parsing, setParsing] = useState(false)
  const [previa, setPrevia] = useState<PfxParsedInfo | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function analisarArquivo() {
    if (!arquivo || !senha) return
    setParsing(true)
    setErro(null)
    setPrevia(null)
    try {
      const info = await parsePfxFile(arquivo, senha)
      setPrevia(info)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao analisar certificado')
    } finally {
      setParsing(false)
    }
  }

  async function enviar() {
    if (!arquivo || !senha || !previa) return
    setEnviando(true)
    setErro(null)
    try {
      const formData = new FormData()
      formData.append('arquivo', arquivo)
      formData.append('senha', senha)
      formData.append('companyId', companyId)
      formData.append('cnpj', previa.cnpj)
      formData.append('razaoSocial', previa.razaoSocial)
      formData.append('validadeInicio', previa.validadeInicio.toISOString())
      formData.append('validadeFim', previa.validadeFim.toISOString())
      formData.append('thumbprint', previa.thumbprint)

      const resp = await authFetch('/api/fiscal/certificado/upload', { method: 'POST', body: formData })
      const json = await resp.json()
      if (!resp.ok || !json.ok) throw new Error(json.erro ?? 'Erro ao enviar certificado')

      setArquivo(null)
      setSenha('')
      setPrevia(null)
      if (inputRef.current) inputRef.current.value = ''
      onAtualizado()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao enviar certificado')
    } finally {
      setEnviando(false)
    }
  }

  async function remover() {
    const id = certificadoAtual?.id
    if (typeof id !== 'string') return
    if (!confirm('Tem certeza? O certificado atual será marcado como removido.')) return
    try {
      const resp = await authFetch(`/api/fiscal/certificado/${id}/remover`, { method: 'DELETE' })
      const json = await resp.json()
      if (!resp.ok || !json.ok) throw new Error(json.erro ?? 'Erro ao remover')
      onAtualizado()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao remover')
    }
  }

  const razaoSocial = certificadoAtual?.razao_social_certificado as string | undefined
  const cnpjAtual = certificadoAtual?.cnpj_certificado as string | undefined
  const validadeFim = certificadoAtual?.validade_fim as string | undefined

  return (
    <div className="bg-white border border-[#3D2314]/10 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-[#3D2314]/10 flex items-center justify-between">
        <div>
          <div className="text-[11px] text-[#3D2314]/55 tracking-[0.8px] uppercase font-medium">Passo 1</div>
          <h2 className="text-[15px] font-medium text-[#3D2314]">Certificado Digital A1</h2>
        </div>
        {certificadoAtual && (
          <span className="text-[10px] bg-[#C0DD97] text-[#173404] px-2.5 py-1 rounded-full font-medium tracking-[0.3px]">
            ATIVO
          </span>
        )}
      </div>

      <div className="p-5">
        {certificadoAtual ? (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <FileCheck className="text-[#3F7012] flex-shrink-0 mt-0.5" size={18} />
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-medium text-[#3D2314]">
                  {razaoSocial || 'Certificado A1'}
                </div>
                <div className="text-[12px] text-[#3D2314]/70 mt-0.5">
                  CNPJ: {cnpjAtual ?? '—'} · Válido até:{' '}
                  {validadeFim ? new Date(validadeFim).toLocaleDateString('pt-BR') : '—'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={remover}
              data-testid="cert-remover"
              className="text-[12px] text-[#C94544] hover:text-[#791F1F] flex items-center gap-1.5 font-medium transition-colors"
            >
              <Trash2 size={13} /> Remover certificado
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-[12.5px] text-[#3D2314]/70 leading-relaxed">
              Envie o certificado A1 (.pfx ou .p12) e a senha. O arquivo fica armazenado em
              bucket privado da empresa — apenas usuários autorizados acessam.
            </p>

            <div>
              <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">Arquivo do certificado</label>
              <input
                ref={inputRef}
                type="file"
                accept=".pfx,.p12"
                onChange={(e) => { setArquivo(e.target.files?.[0] ?? null); setPrevia(null); setErro(null) }}
                className="block w-full text-[12.5px] text-[#3D2314] file:mr-3 file:py-2 file:px-3.5 file:rounded-lg file:border-0 file:text-[12px] file:font-medium file:bg-[#C8941A]/10 file:text-[#633806] hover:file:bg-[#C8941A]/20 file:cursor-pointer cursor-pointer"
              />
            </div>

            <div>
              <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">Senha do certificado</label>
              <input
                type="password"
                value={senha}
                onChange={(e) => { setSenha(e.target.value); setPrevia(null); setErro(null) }}
                className="block w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40 focus:border-[#C8941A]/40"
                placeholder="••••••••"
              />
            </div>

            {erro && (
              <div className="flex items-start gap-2 text-[12px] text-[#791F1F] bg-[#FCEBEB] p-3 rounded-lg">
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{erro}</span>
              </div>
            )}

            {previa && (
              <div className="bg-[#E8F4DC] border border-[#C0DD97] rounded-lg p-3.5 text-[12.5px]">
                <div className="font-medium text-[#1B3608] mb-1.5">Certificado válido</div>
                <div className="text-[#1B3608]/85 space-y-0.5">
                  <div><strong>CNPJ:</strong> {previa.cnpj}</div>
                  <div><strong>Razão Social:</strong> {previa.razaoSocial}</div>
                  <div>
                    <strong>Validade:</strong>{' '}
                    {previa.validadeInicio.toLocaleDateString('pt-BR')} até{' '}
                    {previa.validadeFim.toLocaleDateString('pt-BR')}
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                type="button"
                disabled={!arquivo || !senha || parsing}
                onClick={analisarArquivo}
                data-testid="cert-upload-analisar"
                className="px-4 py-2.5 text-[13px] font-medium rounded-lg bg-[#3D2314] text-[#FAF7F2] hover:bg-[#5A3522] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {parsing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                Analisar arquivo
              </button>
              {previa && (
                <button
                  type="button"
                  disabled={enviando}
                  onClick={enviar}
                  data-testid="cert-upload-confirmar"
                  className="px-4 py-2.5 text-[13px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {enviando ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                  Confirmar e enviar
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
