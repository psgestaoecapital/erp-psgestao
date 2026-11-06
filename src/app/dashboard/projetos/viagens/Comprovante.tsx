'use client'

// Foto do comprovante (auditor 24/10): o cupom vai para o bucket privado 'viagens-comprovantes' em
// <empresa>/<viagem>/<arquivo> e o caminho segue no anexo_path do lançamento (fn_viagem_lancamento_salvar). Quem é da
// empresa abre por link assinado de 5 min; o perfil de consulta não envia (policy do bucket).
import { useState } from 'react'
import { Camera, FileText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

export const BUCKET_COMPROVANTE = 'viagens-comprovantes'
const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']

export function CampoComprovante({ empresa, viagemId, valor, onChange }: { empresa: string; viagemId: string; valor: string; onChange: (path: string) => void }) {
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  async function enviar(f: File | undefined) {
    if (!f) return
    setErro('')
    if (!TIPOS.includes(f.type)) { setErro('Envie foto (JPG, PNG, WEBP, HEIC) ou PDF'); return }
    if (f.size > 10 * 1024 * 1024) { setErro('Arquivo acima de 10 MB'); return }
    setEnviando(true)
    const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `${empresa}/${viagemId}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from(BUCKET_COMPROVANTE).upload(path, f, { contentType: f.type, upsert: false })
    setEnviando(false)
    if (error) { setErro(error.message); return }
    onChange(path)
  }
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span>Foto do comprovante<AjudaCampo chave="projetos.viagem.lanc_comprovante" /></span>
      <span className="flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm">
        <Camera size={16} aria-hidden />
        <input type="file" accept="image/*,application/pdf" className="w-full text-xs" disabled={enviando} onChange={(e) => enviar(e.target.files?.[0])} />
      </span>
      {enviando && <span className="opacity-60">Enviando…</span>}
      {!enviando && valor && <span className="text-green-800">Comprovante anexado</span>}
      {erro && <span role="alert" className="text-red-700">{erro}</span>}
    </label>
  )
}

export function VerComprovante({ path }: { path: string }) {
  const [erro, setErro] = useState(false)
  async function abrir() {
    const { data, error } = await supabase.storage.from(BUCKET_COMPROVANTE).createSignedUrl(path, 300)
    if (error || !data?.signedUrl) { setErro(true); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }
  return (
    <span className="ml-2 inline-flex items-center text-xs">
      <button type="button" aria-label="Ver comprovante" className="inline-flex items-center gap-0.5 underline" onClick={abrir}><FileText size={14} aria-hidden />comprovante</button>
      <AjudaCampo chave="projetos.viagem.ver_comprovante" />
      {erro && <span role="alert" className="ml-1 text-red-700">não abriu</span>}
    </span>
  )
}
