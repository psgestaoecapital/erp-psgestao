'use client'

import { useState } from 'react'
import { authFetch } from '@/lib/authFetch'

const C = {
  espresso: '#3D2314',
  offwhite: '#FAF7F2',
  borderLt: '#ece3d2',
  muted: 'rgba(61, 35, 20, 0.55)',
  ink: '#1a1a1a',
  red: '#a02020',
  redBg: '#fce8e8',
}

const MAX_MB = 10
const MIME_ACEITOS = 'application/pdf,image/jpeg,image/png'

export type UploadContext = {
  companyId: string
  tipoDocumentoId: string
  tipoNome: string
  funcionarioId?: string | null
  empresaAlvoId?: string | null
  prestadorId?: string | null
  modo: 'upload' | 'substituir'
}

export function UploadDocumentoModal({
  ctx,
  onClose,
  onUploaded,
}: {
  ctx: UploadContext
  onClose: () => void
  onUploaded: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [dataEmissao, setDataEmissao] = useState('')
  const [dataValidade, setDataValidade] = useState('')
  const [semValidade, setSemValidade] = useState(false)
  const [numero, setNumero] = useState('')
  const [emissor, setEmissor] = useState('')
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function enviar() {
    if (!file) {
      setErro('Selecione um arquivo')
      return
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setErro(`Arquivo excede ${MAX_MB} MB`)
      return
    }
    setEnviando(true)
    setErro(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('company_id', ctx.companyId)
      fd.append('tipo_documento_id', ctx.tipoDocumentoId)
      if (ctx.funcionarioId) fd.append('funcionario_id', ctx.funcionarioId)
      if (ctx.empresaAlvoId) fd.append('empresa_alvo_id', ctx.empresaAlvoId)
      if (ctx.prestadorId) fd.append('prestador_id', ctx.prestadorId)
      if (dataEmissao) fd.append('data_emissao', dataEmissao)
      if (dataValidade && !semValidade) fd.append('data_validade', dataValidade)
      fd.append('sem_validade', String(semValidade))
      if (numero) fd.append('numero_documento', numero)
      if (emissor) fd.append('emissor', emissor)
      if (obs) fd.append('observacoes', obs)

      const res = await authFetch('/api/compliance/documentos', {
        method: 'POST',
        body: fd,
      })
      const j = await res.json()
      if (!j.ok) throw new Error(j.error || 'falha')
      onUploaded()
    } catch (e: any) {
      setErro(e.message)
      setEnviando(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
    >
      <div
        onClick={(e: any) => e.stopPropagation()}
        style={{ background: 'white', borderRadius: 12, padding: 24, width: 'min(560px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>
          {ctx.modo === 'substituir' ? 'Substituir documento' : 'Upload de documento'}
        </p>
        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, margin: '4px 0 16px' }}>
          {ctx.tipoNome}
        </h2>
        {erro && (
          <div style={{ backgroundColor: C.redBg, color: C.red, padding: '10px 12px', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
            {erro}
          </div>
        )}

        <Field label="Arquivo (PDF/JPG/PNG, máx 10 MB) *">
          <input
            type="file"
            accept={MIME_ACEITOS}
            onChange={(e: any) => setFile(e.target.files?.[0] ?? null)}
            style={{ width: '100%', padding: 8, fontSize: 13 }}
          />
          {file && (
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
              {file.name} · {(file.size / 1024).toFixed(0)} KB
            </div>
          )}
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Data emissão">
            <input type="date" value={dataEmissao} onChange={(e: any) => setDataEmissao(e.target.value)} style={inputStyle()} />
          </Field>
          <Field label="Data validade">
            <input
              type="date"
              value={dataValidade}
              onChange={(e: any) => setDataValidade(e.target.value)}
              disabled={semValidade}
              style={{ ...inputStyle(), opacity: semValidade ? 0.5 : 1 }}
            />
          </Field>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 12px', fontSize: 13, color: C.ink, cursor: 'pointer' }}>
          <input type="checkbox" checked={semValidade} onChange={(e: any) => setSemValidade(e.target.checked)} />
          Sem validade (CPF, RG, certificado sem expiração, etc.)
        </label>

        <Field label="Número do documento">
          <input value={numero} onChange={(e: any) => setNumero(e.target.value)} style={inputStyle()} />
        </Field>
        <Field label="Emissor / Órgão">
          <input value={emissor} onChange={(e: any) => setEmissor(e.target.value)} style={inputStyle()} />
        </Field>
        <Field label="Observações">
          <textarea value={obs} onChange={(e: any) => setObs(e.target.value)} style={{ ...inputStyle(), minHeight: 60 }} />
        </Field>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} disabled={enviando} style={btnSecStyle()}>Cancelar</button>
          <button onClick={enviar} disabled={enviando || !file} style={btnPrimStyle(!enviando && !!file)}>
            {enviando ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}
function inputStyle() {
  return { width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 14, background: C.offwhite, color: C.ink, boxSizing: 'border-box', fontFamily: 'inherit' } as any
}
function btnSecStyle() {
  return { padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, cursor: 'pointer' } as any
}
function btnPrimStyle(enabled: boolean) {
  return { padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.6 } as any
}
