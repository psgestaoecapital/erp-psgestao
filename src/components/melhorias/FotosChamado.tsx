'use client'

// FotosChamado — LISTA de imagens de um chamado (abertura E conversa). Colar (Ctrl+V), arrastar ou
// escolher ACRESCENTA à lista, nunca substitui (era o bug: o front guardava 1 imagem só). Até 10 por
// chamado, na ORDEM de inserção — a ordem importa (print 1 = começo, 3 = erro) e é preservada em
// sugestao_anexo.ordem pelo servidor (fn_sugestao_criar / _mensagem_enviar iteram o array em ordem).
//
// Reusa o FotoMarcador (RD-52: não forka) como editor da imagem ATIVA — a marcação (onde está o
// problema) continua viva, por imagem. A aquisição (colar/arrastar/escolher) é desta lista.
// Comprime no cliente antes de subir (10 prints de tela cheia estouram o payload) e AVISA se um
// arquivo for grande demais — nunca falha em silêncio.

import { useCallback, useEffect, useState } from 'react'
import FotoMarcador, { type FotoSel, type Marca } from './FotoMarcador'

export type FotoItem = { file: File; marcas: Marca[] }

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318',
}
const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none' }

const MAX_PADRAO = 10
// teto de arquivo APÓS compressão: acima disso, avisa e não anexa (em vez de estourar o upload calado)
const MAX_BYTES_HARD = 8 * 1024 * 1024
const COMPRIMIR_ACIMA = 500 * 1024
const MAX_DIM = 1600

// compressão client-side: redimensiona pro maior lado <= MAX_DIM e reencoda JPEG q0.82. Só troca se
// ficar menor. Print é screenshot — não precisa de transparência; JPEG derruba MB de tela cheia.
async function comprimir(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size <= COMPRIMIR_ACIMA) return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale)
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d'); if (!ctx) return file
    ctx.drawImage(bmp, 0, 0, w, h); bmp.close?.()
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.82))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch { return file }
}

const fmtMB = (b: number) => (b / (1024 * 1024)).toFixed(1) + ' MB'

function Miniatura({ item, n, ativo, onSelecionar, onRemover }: {
  item: FotoItem; n: number; ativo: boolean; onSelecionar: () => void; onRemover: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  // object URL segue o arquivo — criar/revogar é sincronizar com uma API do browser (mesmo padrão do
  // FotoMarcador), daí o disable.
  useEffect(() => {
    const u = URL.createObjectURL(item.file)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [item.file])
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button type="button" onClick={onSelecionar} title={`Imagem ${n}`}
        style={{ padding: 0, border: `2px solid ${ativo ? C.gold : C.border}`, borderRadius: 8, cursor: 'pointer', background: C.white, width: 64, height: 64, overflow: 'hidden', display: 'block' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url && <img src={url} alt={`anexo ${n}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
      </button>
      <span style={{ position: 'absolute', top: -6, left: -6, width: 18, height: 18, borderRadius: 999, background: ativo ? C.amber : C.espM, color: '#fff', fontSize: 10.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff' }}>{n}</span>
      <button type="button" onClick={onRemover} title="remover imagem"
        style={{ position: 'absolute', top: -8, right: -8, width: 18, height: 18, borderRadius: 999, background: C.red, color: '#fff', border: '2px solid #fff', cursor: 'pointer', fontSize: 11, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>✕</button>
      {item.marcas.length > 0 && (
        <span style={{ position: 'absolute', bottom: -6, right: -6, background: C.esp, color: '#fff', fontSize: 9.5, fontWeight: 700, borderRadius: 6, padding: '1px 4px', border: '1.5px solid #fff' }} title={`${item.marcas.length} marcação(ões)`}>✎{item.marcas.length}</span>
      )}
    </div>
  )
}

export default function FotosChamado({ value, onChange, max = MAX_PADRAO, compact = false }: {
  value: FotoItem[]
  onChange: (v: FotoItem[]) => void
  max?: number
  compact?: boolean
}) {
  const [ativo, setAtivo] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
  const [processando, setProcessando] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const addFiles = useCallback(async (arquivos: File[]) => {
    const imgs = arquivos.filter((f) => f.type.startsWith('image/'))
    if (!imgs.length) return
    const espaco = max - value.length
    if (espaco <= 0) { setAviso(`Limite de ${max} imagens por chamado.`); return }
    const aProcessar = imgs.slice(0, espaco)
    const avisos: string[] = []
    if (imgs.length > espaco) avisos.push(`Só cabiam mais ${espaco} (limite ${max}); o restante foi ignorado.`)

    setProcessando(true)
    const novos: FotoItem[] = []
    const grandes: string[] = []
    for (const f of aProcessar) {
      const out = await comprimir(f)
      if (out.size > MAX_BYTES_HARD) { grandes.push(`${f.name} (${fmtMB(out.size)})`); continue }
      novos.push({ file: out, marcas: [] })
    }
    setProcessando(false)
    if (grandes.length) avisos.push(`Imagem grande demais, não anexada: ${grandes.join(', ')}. Reduza e tente de novo.`)
    setAviso(avisos.length ? avisos.join(' ') : null)
    if (novos.length) {
      onChange([...value, ...novos])
      setAtivo(value.length) // foca a primeira recém-adicionada
    }
  }, [value, max, onChange])

  const onPaste = useCallback((e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.items || [])
      .filter((it) => it.type.startsWith('image/')).map((it) => it.getAsFile()).filter((f): f is File => !!f)
    if (!files.length) return
    e.preventDefault()
    void addFiles(files)
  }, [addFiles])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    void addFiles(Array.from(e.dataTransfer?.files || []))
  }, [addFiles])

  const remover = useCallback((i: number) => {
    const nova = value.filter((_, j) => j !== i)
    onChange(nova)
    setAtivo((a) => (i < a ? a - 1 : Math.min(a, Math.max(0, nova.length - 1))))
  }, [value, onChange])

  // editor da imagem ATIVA (marcação). onChange do FotoMarcador só altera marcas/arquivo da ativa.
  const onEditarAtivo = useCallback((fs: FotoSel) => {
    if (!fs) { remover(ativo); return }
    onChange(value.map((it, i) => (i === ativo ? { file: fs.file, marcas: fs.marcas } : it)))
  }, [ativo, value, onChange, remover])

  const cheio = value.length >= max
  const idxAtivo = Math.min(ativo, Math.max(0, value.length - 1))

  return (
    <div onPaste={onPaste}>
      {/* Área de adicionar — sempre visível até o limite. Colar/arrastar/escolher ACRESCENTA. */}
      {!cheio && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          style={{ border: `1.5px dashed ${dragOver ? C.gold : C.border}`, background: dragOver ? C.amberBg : C.cream, borderRadius: 10, padding: compact ? '10px 12px' : '14px', textAlign: 'center', transition: 'all .12s' }}
        >
          <div style={{ fontSize: compact ? 12 : 13, color: C.espM, fontWeight: 600 }}>
            Cole com <b style={{ color: C.esp }}>Ctrl+V</b>, arraste imagens aqui {value.length > 0 ? '(acrescenta à lista)' : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            <label style={{ ...inp, cursor: 'pointer', fontWeight: 600, color: C.esp }}>
              🖼️ Escolher arquivo(s)
              <input type="file" accept="image/*" multiple onChange={(e) => { void addFiles(Array.from(e.target.files || [])); e.currentTarget.value = '' }} style={{ display: 'none' }} />
            </label>
            <label style={{ ...inp, cursor: 'pointer', fontWeight: 600, color: C.esp }}>
              📷 Tirar foto
              <input type="file" accept="image/*" capture="environment" onChange={(e) => { void addFiles(Array.from(e.target.files || [])); e.currentTarget.value = '' }} style={{ display: 'none' }} />
            </label>
          </div>
        </div>
      )}

      {/* Contador + fila de miniaturas na ordem de inserção */}
      {value.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: cheio ? C.amber : C.espM }}>{value.length} de {max}</span>
            {processando && <span style={{ fontSize: 11.5, color: C.espL }}>processando imagem…</span>}
            {cheio && <span style={{ fontSize: 11, color: C.amber }}>limite atingido</span>}
          </div>
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4, paddingTop: 2 }}>
            {value.map((it, i) => (
              <Miniatura key={i} item={it} n={i + 1} ativo={i === idxAtivo}
                onSelecionar={() => setAtivo(i)} onRemover={() => remover(i)} />
            ))}
          </div>
        </div>
      )}

      {aviso && (
        <div style={{ marginTop: 8, background: C.amberBg, border: `1px solid ${C.gold}`, borderRadius: 8, padding: '7px 10px', fontSize: 12, color: C.amber }}>
          {aviso}
        </div>
      )}

      {/* Editor da imagem ativa (marcação preservada, por imagem) */}
      {value[idxAtivo] && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, color: C.espM, fontWeight: 600, marginBottom: 6 }}>
            Marcando a imagem <b style={{ color: C.esp }}>{idxAtivo + 1}</b> de {value.length} — aponte onde está o problema.
          </div>
          <FotoMarcador value={value[idxAtivo]} onChange={onEditarAtivo} hideAcquire compact={compact} />
        </div>
      )}
    </div>
  )
}
