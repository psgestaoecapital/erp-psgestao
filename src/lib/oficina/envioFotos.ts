// #135 (ajuste 21/10, item 6) · fotos da oficina em LOTE: escolher várias de uma vez (galeria/arquivos) e subir em
// paralelo, com progresso por foto, compressão antes de subir e sem perder as outras quando uma falha.
// Vale para recepção/checklist, diagnóstico, execução (pátio) e a ficha da OS. A lógica do lote é pura (testada no
// gate scripts/gates/check-oficina-fotos-multiplas.ts); a compressão usa o canvas do navegador.

export type FaseFoto = 'fila' | 'comprimindo' | 'enviando' | 'salvando' | 'ok' | 'erro'
export type EstadoFoto = { chave: string; nome: string; fase: FaseFoto; pct: number; erro?: string }
export type FalhaFoto = { nome: string; erro: string }
export type ResultadoLote<T> = { ok: T[]; falhas: FalhaFoto[] }

// progresso por etapa (o upload do storage não expõe bytes enviados; a barra anda por etapa concluída)
export const PCT_FASE: Record<FaseFoto, number> = { fila: 0, comprimindo: 15, enviando: 45, salvando: 85, ok: 100, erro: 100 }

// quantas fotos sobem ao mesmo tempo (4G ruim da oficina: 3 em paralelo sem estrangular a rede)
export const CONCORRENCIA_FOTOS = 3

export function soImagens<F extends { type: string }>(arquivos: F[]): F[] {
  return arquivos.filter((f) => (f.type ?? '').startsWith('image/'))
}

// Envia cada arquivo com `enviarUm` (que avisa a fase por `fase(...)`), no máximo `concorrencia` por vez.
// Uma falha não interrompe as outras: ela entra em `falhas` com o nome do arquivo. A ordem de `ok` segue a escolha.
export async function enviarFotosEmLote<F extends { name: string }, T>(
  arquivos: F[],
  enviarUm: (arquivo: F, fase: (f: Exclude<FaseFoto, 'ok' | 'erro' | 'fila'>) => void) => Promise<T>,
  opcoes: { concorrencia?: number; onEstado?: (estados: EstadoFoto[]) => void } = {},
): Promise<ResultadoLote<T>> {
  const concorrencia = Math.max(1, opcoes.concorrencia ?? CONCORRENCIA_FOTOS)
  const estados: EstadoFoto[] = arquivos.map((a, i) => ({ chave: `${i}-${a.name}`, nome: a.name || `foto ${i + 1}`, fase: 'fila', pct: 0 }))
  const avisar = () => opcoes.onEstado?.(estados.map((e) => ({ ...e })))
  const marcar = (i: number, fase: FaseFoto, erro?: string) => { estados[i] = { ...estados[i], fase, pct: PCT_FASE[fase], erro }; avisar() }
  const resultados: ({ ok: true; v: T } | { ok: false; erro: string } | undefined)[] = new Array(arquivos.length)
  avisar()
  let proximo = 0
  const trabalhador = async () => {
    while (proximo < arquivos.length) {
      const i = proximo++
      try {
        const v = await enviarUm(arquivos[i], (f) => marcar(i, f))
        resultados[i] = { ok: true, v }
        marcar(i, 'ok')
      } catch (e) {
        const erro = e instanceof Error ? e.message : String(e ?? 'falha')
        resultados[i] = { ok: false, erro }
        marcar(i, 'erro', erro)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concorrencia, arquivos.length) }, trabalhador))
  const ok: T[] = []
  const falhas: FalhaFoto[] = []
  resultados.forEach((r, i) => { if (r?.ok) ok.push(r.v); else falhas.push({ nome: estados[i].nome, erro: r?.erro ?? 'falha' }) })
  return { ok, falhas }
}

// aviso ao usuário depois do lote: quantas subiram e QUAIS não subiram (pelo nome do arquivo)
export function mensagemLote(totalEscolhidas: number, falhas: FalhaFoto[]): string {
  const subiram = totalEscolhidas - falhas.length
  if (!falhas.length) return subiram === 1 ? '1 foto salva.' : `${subiram} fotos salvas.`
  const nomes = falhas.map((f) => f.nome).join(', ')
  return `${subiram} de ${totalEscolhidas} foto(s) salvas. Não subiu: ${nomes}. Tente enviar essa(s) de novo.`
}

// Comprime no navegador antes de subir: lado maior até 1600 px, JPEG 0,7 (mesmo padrão da recepção, legível na
// impressão da OS). Se o navegador não conseguir ler a imagem, sobe o arquivo original.
export async function comprimirImagem(file: File, max = 1600): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file)
    let { width, height } = bitmap
    if (width > max || height > max) { const r = Math.min(max / width, max / height); width = Math.round(width * r); height = Math.round(height * r) }
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d'); if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.7))
    return blob.size < file.size ? blob : file
  } catch { return file }
}
