'use client'
// Importar a tabela do cliente por arquivo (Excel, PDF ou foto) com IA. Só preenche a caixa de linhas:
// quem grava é a revisão lado a lado da tela, depois que a pessoa confere.
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const paraBase64 = (buf: ArrayBuffer) => {
  const b = new Uint8Array(buf); let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}

export function ImportarArquivoIA({ onTexto, estilo }: { onTexto: (t: string) => void; estilo: React.CSSProperties }) {
  const [busy, setBusy] = useState(false)
  const [aviso, setAviso] = useState('')

  const ler = async (f: File) => {
    setBusy(true); setAviso('Lendo o arquivo com IA…')
    try {
      const nome = f.name.toLowerCase()
      let corpo: Record<string, string>
      if (/\.(xlsx|xls|csv)$/.test(nome)) {
        const XLSX = await import('xlsx')
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' })
        corpo = { texto: XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { FS: ';' }) }
      } else if (/\.(pdf|png|jpe?g|webp)$/.test(nome)) {
        const mt = nome.endsWith('.pdf') ? 'application/pdf' : nome.endsWith('.png') ? 'image/png' : nome.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
        corpo = { arquivo_base64: paraBase64(await f.arrayBuffer()), media_type: mt }
      } else { setAviso('Use Excel (.xlsx), PDF ou foto (.png/.jpg).'); return }
      const { data, error } = await supabase.functions.invoke('tabela-preco-ia', { body: corpo })
      const r = data as { ok?: boolean; texto?: string; erro?: string } | null
      if (error || !r?.ok) { setAviso(r?.erro || 'Não consegui ler o arquivo. Cole as linhas na caixa.'); return }
      onTexto(r.texto ?? ''); setAviso('Linhas lidas. Confira a revisão lado a lado antes de importar.')
    } catch { setAviso('Não consegui ler o arquivo. Cole as linhas na caixa.') } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        <input data-testid="tp-imp-arquivo" type="file" accept=".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp" disabled={busy} aria-label="Arquivo da tabela do cliente" style={{ ...estilo, width: 'auto' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) void ler(f); e.target.value = '' }} />
        <AjudaCampo chave="hub.tabela_preco.importar_arquivo" />
      </label>
      {aviso && <div data-testid="tp-imp-arquivo-aviso" role="status" style={{ fontSize: 13 }}>{aviso}</div>}
    </div>
  )
}
