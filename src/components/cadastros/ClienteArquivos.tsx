'use client'

// PM-QW #16 · Anexar contrato/arquivo no CLIENTE. Espelha components/ge/ContratoArquivos (RD-26/RD-52):
// .from()+storage direto com RLS. Diferença: exclusão é SOFT (deleted_at) — RD-30, nada some de vez.
// Reusa o bucket 'contratos-assinados' (policy libera por 1º folder = company_id).

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface ArquivoRow {
  id: string
  cliente_id: string
  company_id: string
  tipo: string
  nome_arquivo: string
  storage_path: string
  tamanho_bytes: number | null
  mime_type: string | null
  enviado_em: string
}

interface Props {
  companyId: string
  clienteId: string
}

const BUCKET = 'contratos-assinados'
const MIME_OK = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 10 * 1024 * 1024

function fmtTamanho(b: number | null): string {
  if (!b) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

function fmtData(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function sanitizar(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

export default function ClienteArquivos({ companyId, clienteId }: Props) {
  const [lista, setLista] = useState<ArquivoRow[]>([])
  const [carregando, setCarregando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [progresso, setProgresso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [arrastando, setArrastando] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const { data, error } = await supabase
      .from('erp_cliente_arquivos')
      .select('id, cliente_id, company_id, tipo, nome_arquivo, storage_path, tamanho_bytes, mime_type, enviado_em')
      .eq('cliente_id', clienteId)
      .is('deleted_at', null)
      .order('enviado_em', { ascending: false })
    setCarregando(false)
    if (error) { setErro(error.message); return }
    setLista((data as ArquivoRow[]) ?? [])
  }, [clienteId])

  useEffect(() => { void carregar() }, [carregar])

  async function anexar(file: File) {
    setErro(null)
    if (!MIME_OK.includes(file.type)) { setErro('Aceita só PDF, JPG, PNG ou WebP.'); return }
    if (file.size > MAX_BYTES) { setErro(`Arquivo grande demais (${fmtTamanho(file.size)}) — máximo 10 MB.`); return }
    setEnviando(true)
    setProgresso(`Anexando ${file.name}…`)
    const path = `${companyId}/cliente/${clienteId}/${Date.now()}_${sanitizar(file.name)}`
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
    if (up.error) { setEnviando(false); setProgresso(null); setErro('Não consegui anexar: ' + up.error.message); return }
    const ins = await supabase.from('erp_cliente_arquivos').insert({
      cliente_id: clienteId, company_id: companyId, tipo: 'contrato',
      nome_arquivo: file.name, storage_path: path, tamanho_bytes: file.size, mime_type: file.type,
    })
    setEnviando(false); setProgresso(null)
    if (ins.error) {
      await supabase.storage.from(BUCKET).remove([path])   // rollback do blob órfão
      setErro('Não consegui registrar o anexo: ' + ins.error.message)
      return
    }
    await carregar()
  }

  async function baixar(row: ArquivoRow) {
    setErro(null)
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(row.storage_path, 60)
    if (error || !data?.signedUrl) { setErro('Não consegui gerar o link de download: ' + (error?.message ?? 'sem URL')); return }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function remover(row: ArquivoRow) {
    if (!confirm(`Excluir "${row.nome_arquivo}"? Sai da lista (exclusão reversível — o arquivo não é apagado de vez).`)) return
    setErro(null)
    // SOFT (RD-30): marca deleted_at; o blob fica no storage (reversível).
    const { error } = await supabase.from('erp_cliente_arquivos').update({ deleted_at: new Date().toISOString() }).eq('id', row.id)
    if (error) { setErro('Não consegui excluir: ' + error.message); return }
    await carregar()
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault(); setArrastando(false)
    const f = e.dataTransfer.files?.[0]
    if (f) void anexar(f)
  }

  return (
    <div style={{ marginTop: 4 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>
        Contratos & anexos
      </label>

      <div
        onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
        onDragLeave={() => setArrastando(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
        style={{
          border: `1.5px dashed ${arrastando ? '#C8941A' : 'rgba(61,35,20,0.3)'}`, borderRadius: 8,
          padding: '16px', textAlign: 'center', background: arrastando ? 'rgba(200,148,26,0.08)' : 'rgba(61,35,20,0.02)',
          cursor: enviando ? 'wait' : 'pointer', opacity: enviando ? 0.6 : 1, transition: 'all 0.15s',
        }}
      >
        <div style={{ fontSize: 13, color: '#3D2314', fontWeight: 500 }}>
          {enviando ? (progresso ?? 'Anexando…') : '📎 Anexar contrato — arraste ou clique'}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 4 }}>PDF, JPG, PNG ou WebP — até 10 MB</div>
        <input
          ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void anexar(f); e.target.value = '' }}
        />
      </div>

      {erro && <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '8px 12px', borderRadius: 6, marginTop: 10, fontSize: 12 }}>{erro}</div>}

      <div style={{ marginTop: 12 }}>
        {carregando ? (
          <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)', padding: '8px 0' }}>Carregando anexos…</div>
        ) : lista.length === 0 ? (
          <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)', padding: '10px 0', fontStyle: 'italic' }}>Nenhum anexo ainda.</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {lista.map((row) => (
              <li key={row.id} style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.18)', borderRadius: 6, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 13, color: '#3D2314', fontWeight: 500, wordBreak: 'break-word' }}>{row.nome_arquivo}</div>
                  <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 2 }}>{fmtTamanho(row.tamanho_bytes)} · ANEXOU em {fmtData(row.enviado_em)}</div>
                </div>
                <button type="button" onClick={() => void baixar(row)} style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '6px 14px', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Baixar</button>
                <button type="button" onClick={() => void remover(row)} style={{ background: 'transparent', color: '#A32D2D', border: '0.5px solid rgba(163,45,45,0.4)', padding: '6px 12px', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}>Excluir</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
