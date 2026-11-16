'use client'
// Quadro de funil GENÉRICO (Kanban) — generalizado do quadro de leads do P&M (/dashboard/pm/leads), que era o mais
// completo do sistema (RD-26: um componente só, nada de quadro novo do zero). Hoje o usam o P&M (leads da agência) e o
// PS CRM (/dashboard/crm/pipeline).
//
// Colunas = etapas cadastradas (funil_etapa), nunca uma lista fixa (RD-51). O componente só cuida do quadro:
// colunas, contagem e soma, arrastar-e-soltar e o destaque da coluna-alvo. O conteúdo do cartão, o semáforo e as
// ações ficam com quem usa (renderCartao/estiloCartao) — cada vertical mostra o que importa para ela.
// Celular: arrastar (HTML5) não existe no toque; quem usa põe no cartão o "Mover para" (o CRM faz isso — RD-99).
import { useState, type CSSProperties, type ReactNode } from 'react'

export const QUADRO_CORES = {
  ESPRESSO: '#3D2314', OFFWHITE: '#FAF7F2', DOURADO: '#C8941A', BORDA: '#E7DED3', TEXTM: '#6b5444', GREEN: '#1F5A1F', RED: '#7A1F1F',
} as const
const { OFFWHITE, DOURADO, BORDA, TEXTM, GREEN, RED } = QUADRO_CORES

export type ColunaQuadro = {
  chave: string
  rotulo: string
  cor?: string | null
  /** 'normal' | 'ganho' | 'perda' (fecham o negócio e ganham ✓/✕ no cabeçalho) */
  tipo?: string | null
  /** texto extra no cabeçalho (ex.: "50%") */
  detalhe?: string | null
}

type Props<T> = {
  colunas: ColunaQuadro[]
  itens: T[]
  idDe: (item: T) => string
  colunaDe: (item: T) => string
  onMover: (item: T, chaveColuna: string) => void
  renderCartao: (item: T) => ReactNode
  valorDe?: (item: T) => number
  formatarValor?: (v: number) => string
  estiloCartao?: (item: T) => CSSProperties
  testIdCartao?: string
  /** rodapé da coluna (ex.: total ponderado) */
  rodapeColuna?: (col: ColunaQuadro, itens: T[]) => ReactNode
  /** texto da coluna vazia */
  vazio?: string
  largura?: number
  podeArrastar?: boolean
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function QuadroFunil<T>({
  colunas, itens, idDe, colunaDe, onMover, renderCartao, valorDe, formatarValor = brl, estiloCartao,
  testIdCartao, rodapeColuna, vazio, largura = 250, podeArrastar = true,
}: Props<T>) {
  const [arrastando, setArrastando] = useState<string | null>(null)
  const [alvo, setAlvo] = useState<string | null>(null)

  return (
    <div data-testid="quadro-funil" style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start', WebkitOverflowScrolling: 'touch' }}>
      {colunas.map((col) => {
        const daColuna = itens.filter((i) => colunaDe(i) === col.chave)
        const soma = valorDe ? daColuna.reduce((s, i) => s + (Number(valorDe(i)) || 0), 0) : 0
        const ehAlvo = alvo === col.chave && arrastando !== null
        return (
          <div key={col.chave}
            data-testid="quadro-coluna" data-coluna={col.chave}
            onDragOver={(e) => { if (!podeArrastar) return; e.preventDefault(); if (alvo !== col.chave) setAlvo(col.chave) }}
            onDragLeave={() => setAlvo((a) => (a === col.chave ? null : a))}
            onDrop={() => {
              const item = itens.find((x) => idDe(x) === arrastando)
              if (item && colunaDe(item) !== col.chave) onMover(item, col.chave)
              setArrastando(null); setAlvo(null)
            }}
            style={{
              minWidth: largura, width: largura, flex: '0 0 auto', background: '#fff', borderRadius: 12, padding: 8,
              border: ehAlvo ? `1.5px dashed ${DOURADO}` : `1px solid ${BORDA}`, transition: 'border-color .12s',
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px 8px' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: col.cor ?? OFFWHITE, border: `1px solid ${BORDA}`, flex: '0 0 auto' }} />
              <strong style={{ fontSize: 13 }}>{col.rotulo}</strong>
              {col.tipo && col.tipo !== 'normal' && (
                <span style={{ fontSize: 9, fontWeight: 700, color: col.tipo === 'ganho' ? GREEN : RED }}>{col.tipo === 'ganho' ? '✓' : '✕'}</span>
              )}
              {col.detalhe && <span style={{ fontSize: 10.5, color: TEXTM }}>{col.detalhe}</span>}
              <span style={{ fontSize: 11, color: TEXTM, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                {daColuna.length}{soma > 0 ? ` · ${formatarValor(soma)}` : ''}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 20 }}>
              {daColuna.map((item) => {
                const id = idDe(item)
                return (
                  <div key={id} draggable={podeArrastar}
                    onDragStart={() => setArrastando(id)} onDragEnd={() => { setArrastando(null); setAlvo(null) }}
                    data-testid={testIdCartao}
                    style={{
                      background: OFFWHITE, border: `1px solid ${BORDA}`, borderRadius: 10, padding: '9px 10px',
                      cursor: podeArrastar ? 'grab' : 'default', opacity: arrastando === id ? 0.55 : 1,
                      ...(estiloCartao ? estiloCartao(item) : {}),
                    }}>
                    {renderCartao(item)}
                  </div>
                )
              })}
              {daColuna.length === 0 && vazio && (
                <div style={{ fontSize: 11, color: TEXTM, textAlign: 'center', padding: '10px 4px', border: `1px dashed ${BORDA}`, borderRadius: 8 }}>{vazio}</div>
              )}
            </div>
            {rodapeColuna && rodapeColuna(col, daColuna)}
          </div>
        )
      })}
    </div>
  )
}
