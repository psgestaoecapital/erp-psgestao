'use client'
// #135 (ajuste 21/10, item 6) · botão de fotos da oficina em LOTE. "Câmera" tira uma foto; "Galeria / arquivos" escolhe
// várias de uma vez (computador e celular). Cada foto é comprimida, sobe em paralelo (3 por vez) com a sua barra de
// progresso e, se uma falhar, as outras continuam e o aviso diz qual não subiu. O que fazer com cada foto salva no
// bucket (ligar à OS, guardar na recepção) fica com a tela, em `aoSubir`.
import { useState } from 'react'
import { Camera, Images, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import AjudaCampo from '@/components/ajuda/AjudaCampo'
import { comprimirImagem, enviarFotosEmLote, mensagemLote, soImagens, type EstadoFoto, type FalhaFoto } from '@/lib/oficina/envioFotos'

const ESP = '#3D2314', GOLD = '#C8941A', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.55)', OK = '#166534', RED = '#A32D2D'
const BUCKET = 'oficina-recepcao'

export type FotoSubida = { path: string; url: string | null }

export default function FotosMultiplas<T = FotoSubida>({ companyId, pasta, aoSubir, aoTerminar, rotulo = 'Fotos', chaveAjuda, rotaAjuda, compacto = false, desabilitado = false, testId }: {
  companyId: string | null
  pasta: string                                   // subpasta no bucket, depois da empresa (ex.: `servico/<osId>`)
  aoSubir?: (foto: FotoSubida) => Promise<T>      // grava a foto (ex.: liga à OS); erro = foto entra nas falhas
  aoTerminar?: (ok: T[], falhas: FalhaFoto[], msg: string) => void
  rotulo?: string
  chaveAjuda: string
  rotaAjuda?: string
  compacto?: boolean
  desabilitado?: boolean
  testId?: string
}) {
  const [estados, setEstados] = useState<EstadoFoto[]>([])
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState<{ texto: string; erro: boolean } | null>(null)

  const escolher = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const arquivos = soImagens(Array.from(e.target.files ?? []))
    e.target.value = ''   // permite escolher de novo a mesma foto / tirar outra
    if (!arquivos.length || !companyId || enviando) return
    setEnviando(true); setAviso(null)
    const { ok, falhas } = await enviarFotosEmLote(arquivos, async (arq, fase) => {
      fase('comprimindo')
      const blob = await comprimirImagem(arq)
      const tipo = blob.type || 'image/jpeg'
      const ext = tipo === 'image/png' ? 'png' : tipo === 'image/webp' ? 'webp' : 'jpg'
      const path = `${companyId}/${pasta}/${crypto.randomUUID()}.${ext}`
      fase('enviando')
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: tipo, upsert: false })
      if (error) throw new Error(error.message)
      fase('salvando')
      // URL assinada aqui: se a miniatura aparece, a leitura do bucket privado está OK
      const { data: s } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
      const foto: FotoSubida = { path, url: s?.signedUrl ?? null }
      if (!aoSubir) return foto as unknown as T
      try { return await aoSubir(foto) } catch (err) {
        await supabase.storage.from(BUCKET).remove([path])   // não deixa arquivo solto sem registro
        throw err
      }
    }, { onEstado: setEstados })
    const msg = mensagemLote(arquivos.length, falhas)
    setEnviando(false); setAviso({ texto: msg, erro: falhas.length > 0 })
    if (!falhas.length) setEstados([])
    aoTerminar?.(ok, falhas, msg)
  }

  const btn: React.CSSProperties = compacto
    ? { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: ESP, fontSize: 12, fontWeight: 700, cursor: 'pointer' }
    : { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 14px', minHeight: 44, borderRadius: 10, border: `1px solid ${GOLD}`, background: GOLD, color: '#1A1410', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
  const btn2: React.CSSProperties = compacto ? btn : { ...btn, background: '#fff', color: ESP, border: `1px solid ${LINE}` }
  const bloqueado = desabilitado || enviando || !companyId

  return (
    <div data-testid={testId}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label data-ajuda={chaveAjuda} style={{ ...btn, opacity: bloqueado ? 0.6 : 1, cursor: bloqueado ? 'not-allowed' : 'pointer' }}>
          {enviando ? <Loader2 size={compacto ? 13 : 16} className="animate-spin" /> : <Camera size={compacto ? 13 : 16} />}
          {enviando ? 'Enviando…' : compacto ? 'Câmera' : `${rotulo}: câmera`}
          <input type="file" accept="image/*" capture="environment" onChange={escolher} disabled={bloqueado} style={{ display: 'none' }} />
        </label>
        <label data-ajuda={chaveAjuda} style={{ ...btn2, opacity: bloqueado ? 0.6 : 1, cursor: bloqueado ? 'not-allowed' : 'pointer' }}>
          <Images size={compacto ? 13 : 16} /> {compacto ? 'Galeria' : 'Galeria / arquivos (várias)'}
          <input type="file" accept="image/*" multiple onChange={escolher} disabled={bloqueado} data-testid={testId ? `${testId}-galeria` : undefined} style={{ display: 'none' }} />
        </label>
        <AjudaCampo chave={chaveAjuda} rota={rotaAjuda} />
      </div>

      {estados.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }} aria-live="polite">
          {estados.map((e) => (
            <div key={e.chave} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: e.fase === 'erro' ? RED : ESP }}>
              <span style={{ flex: '0 0 40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.nome}>{e.nome}</span>
              <span style={{ flex: 1, height: 6, borderRadius: 999, background: '#F0EADE', overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${e.pct}%`, background: e.fase === 'erro' ? RED : e.fase === 'ok' ? OK : GOLD, transition: 'width .25s' }} />
              </span>
              <span style={{ flex: '0 0 auto', color: e.fase === 'erro' ? RED : ESP60 }}>
                {e.fase === 'ok' ? 'ok' : e.fase === 'erro' ? 'não subiu' : e.fase === 'fila' ? 'na fila' : `${e.pct}%`}
              </span>
            </div>
          ))}
        </div>
      )}
      {aviso && (
        <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: aviso.erro ? RED : OK }}>{aviso.texto}</div>
      )}
    </div>
  )
}
