'use client'
// Render-only: desenha os traços por cima da imagem. viewBox 0..1 + preserveAspectRatio="none"
// mapeia os pontos normalizados exatamente na caixa da imagem; vector-effect mantém a espessura
// constante em qualquer tamanho. Deve ficar dentro de um wrapper position:relative que envolva
// a imagem no MESMO aspecto em que foi anotada (contain / shrink-wrap), não em cover recortado.
import { parseTracos } from './anotacao'

export default function AnotacaoOverlay({ anotacao, strokeWidth = 2.5 }: { anotacao: unknown; strokeWidth?: number }) {
  const tracos = parseTracos(anotacao)
  if (tracos.length === 0) return null
  return (
    <svg viewBox="0 0 1 1" preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      {tracos.map((t, i) => (
        <polyline key={i} points={t.pontos.map((p) => `${p[0]},${p[1]}`).join(' ')}
          fill="none" stroke={t.cor || '#E23B3B'} strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  )
}
