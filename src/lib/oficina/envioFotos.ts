'use client'

// #135 item 6 (Triches, 21/10) · várias fotos de uma vez em todas as telas de foto da oficina (recepção, diagnóstico e OS).
// Cada foto: comprime (máx 1600px, JPEG 0.7) → sobe ao bucket → (opcional) grava o registro na OS. Até 3 em paralelo;
// a falha de uma não para as outras e o resultado diz qual não subiu. O progresso é por etapa (o upload do Storage
// não informa bytes): 10% na fila · 35% comprimindo · 70% enviando · 100% salva.
import { supabase } from '@/lib/supabase'
import { PCT_ESTADO, PARALELO_FOTOS, emParalelo, type EstadoFoto, type FotoEnviada, type ProgressoFoto, type ResultadoEnvio } from './envioFotosRegras'

export * from './envioFotosRegras'

export const BUCKET_OFICINA = 'oficina-recepcao'

// Redimensiona p/ máx 1600px e JPEG 0.7 (box com 4G ruim). Se o navegador não consegue ler a imagem, sobe o original.
export async function comprimirImagem(file: File | Blob): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file)
    const MAX = 1600
    let { width, height } = bitmap
    if (width > MAX || height > MAX) {
      const r = Math.min(MAX / width, MAX / height)
      width = Math.round(width * r); height = Math.round(height * r)
    }
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.7))
  } catch { return file }
}

type Opcoes = {
  pasta: string                                    // ex.: `${companyId}/os/${osId}` (o 1º nível é a empresa — RLS do bucket)
  onProgresso?: (p: ProgressoFoto) => void
  // grava o registro da foto depois do upload (OS/diagnóstico); devolve o id ou lança erro com a mensagem
  registrar?: (path: string, idx: number) => Promise<string | null>
}

export async function enviarFotos(files: File[], op: Opcoes): Promise<ResultadoEnvio> {
  const enviadas: FotoEnviada[] = []
  const falhas: ResultadoEnvio['falhas'] = []
  const av = (idx: number, estado: EstadoFoto, erro?: string) =>
    op.onProgresso?.({ idx, nome: files[idx]?.name ?? '', estado, pct: PCT_ESTADO[estado], erro })
  files.forEach((_, i) => av(i, 'fila'))
  await emParalelo(files, PARALELO_FOTOS, async (file, idx) => {
    try {
      av(idx, 'comprimindo')
      const blob = await comprimirImagem(file)
      av(idx, 'enviando')
      const path = `${op.pasta}/${crypto.randomUUID()}.jpg`
      const { error } = await supabase.storage.from(BUCKET_OFICINA).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
      if (error) throw new Error(error.message || 'falha no envio')
      let registroId: string | null = null
      if (op.registrar) {
        try { registroId = await op.registrar(path, idx) }
        catch (e) { await supabase.storage.from(BUCKET_OFICINA).remove([path]); throw e }   // não deixa arquivo órfão
      }
      const { data: s } = await supabase.storage.from(BUCKET_OFICINA).createSignedUrl(path, 3600)
      enviadas.push({ idx, nome: file.name, path, url: s?.signedUrl ?? null, registroId })
      av(idx, 'salva')
    } catch (e) {
      const erro = e instanceof Error ? e.message : 'falha no envio'
      falhas.push({ idx, nome: file.name, erro })
      av(idx, 'falhou', erro)
    }
  })
  enviadas.sort((a, b) => a.idx - b.idx)
  falhas.sort((a, b) => a.idx - b.idx)
  return { enviadas, falhas }
}
