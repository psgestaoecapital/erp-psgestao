'use client'

// #135 item 6 · seletor de VÁRIAS fotos de uma vez (galeria/arquivos ou câmera) + barra de progresso de cada foto.
// Usado na Recepção, no Diagnóstico e na Ordem de Serviço. O envio em si fica em src/lib/oficina/envioFotos.ts.
import { Camera, Images } from 'lucide-react'
import AjudaCampo from '@/components/ajuda/AjudaCampo'
import { soImagens, type ProgressoFoto } from '@/lib/oficina/envioFotos'

const ESP = '#3D2314', ESP60 = '#6B5D4F', LINE = '#E0D8CC', GOLD = '#C8941A', GREEN = '#2E7D32', RED = '#B23A3A'

const ROTULO: Record<ProgressoFoto['estado'], string> = {
  fila: 'na fila', comprimindo: 'reduzindo', enviando: 'enviando', salva: 'salva', falhou: 'não subiu',
}

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '10px 14px', borderRadius: 10,
  border: `1px solid ${LINE}`, background: '#fff', color: ESP, fontSize: 13, fontWeight: 700, cursor: 'pointer',
}

export default function FotosMultiplas({ onArquivos, progresso, enviando, chaveAjuda = 'oficina.fotos.enviar_varias', rotaAjuda, testid = 'fotos-multiplas' }: {
  onArquivos: (files: File[]) => void
  progresso: ProgressoFoto[]
  enviando: boolean
  chaveAjuda?: string
  rotaAjuda?: string
  testid?: string
}) {
  const escolher = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = soImagens(e.target.files)
    e.target.value = ''   // permite escolher de novo a mesma foto
    if (files.length) onArquivos(files)
  }
  const salvas = progresso.filter((p) => p.estado === 'salva').length
  return (
    <div data-testid={testid}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label data-ajuda={chaveAjuda} style={{ ...btn, opacity: enviando ? 0.6 : 1 }}>
          <Images size={18} /> {enviando ? 'Enviando…' : 'Escolher fotos'}
          <input data-testid={`${testid}-galeria`} type="file" accept="image/*" multiple disabled={enviando} onChange={escolher} style={{ display: 'none' }} />
        </label>
        <label data-ajuda={chaveAjuda} style={{ ...btn, opacity: enviando ? 0.6 : 1 }}>
          <Camera size={18} /> Câmera
          <input data-testid={`${testid}-camera`} type="file" accept="image/*" capture="environment" multiple disabled={enviando} onChange={escolher} style={{ display: 'none' }} />
        </label>
        <AjudaCampo chave={chaveAjuda} rota={rotaAjuda} />
      </div>
      {progresso.length > 0 && (
        <div style={{ marginTop: 10, display: 'grid', gap: 6 }} data-testid={`${testid}-progresso`}>
          <div style={{ fontSize: 12, color: ESP60 }}>{salvas} de {progresso.length} foto(s) salvas</div>
          {progresso.map((p) => (
            <div key={p.idx} data-estado={p.estado} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 84px', gap: 8, alignItems: 'center', fontSize: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: ESP }}>{p.nome || `foto ${p.idx + 1}`}</div>
                <div style={{ height: 6, borderRadius: 3, background: '#EDE7DA', overflow: 'hidden', marginTop: 3 }}>
                  <div style={{ width: `${p.pct}%`, height: '100%', background: p.estado === 'falhou' ? RED : p.estado === 'salva' ? GREEN : GOLD, transition: 'width .2s' }} />
                </div>
              </div>
              <span style={{ fontWeight: 700, color: p.estado === 'falhou' ? RED : p.estado === 'salva' ? GREEN : ESP60 }} title={p.erro}>{ROTULO[p.estado]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
