'use client'

import { useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { C, fmtBRL, fmtPct } from './index'

type Linha = {
  ln_id: string
  ln_nome: string
  rob: number
  cmv: number
  desp_variavel: number
  desp_fixa: number
  margem_bruta: number
  margem_contribuicao: number
  ebitda_pre_rateio: number
  rateio_sede_recebido: number
  ebitda_pos_rateio: number
  ebitda_pct_pos_rateio: number
  qtd_lancamentos: number
}

type Totais = {
  receita_total: number
  ebitda_pre_total: number
  rateio_total: number
  ebitda_real_total: number
  qtd_lancamentos_total: number
}

interface Props {
  linhas: Linha[]
  totais: Totais
  onReorder?: (novaOrdem: Linha[]) => void
  onReset?: () => void
  isCustomOrder?: boolean
}

export function TabelaDetalhada({ linhas, totais, onReorder, onReset, isCustomOrder }: Props) {
  const [expanded, setExpanded] = useState(true)
  const draggable = !!onReorder

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = linhas.findIndex((l) => l.ln_id === active.id)
    const newIndex = linhas.findIndex((l) => l.ln_id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    onReorder?.(arrayMove(linhas, oldIndex, newIndex))
  }

  const cmvTotal = linhas.reduce((s, l) => s + l.cmv, 0)
  const dvTotal = linhas.reduce((s, l) => s + l.desp_variavel, 0)
  const dfTotal = linhas.reduce((s, l) => s + l.desp_fixa, 0)
  const mbTotal = linhas.reduce((s, l) => s + l.margem_bruta, 0)
  const pctRealTotal = totais.receita_total > 0
    ? (totais.ebitda_real_total / totais.receita_total) * 100
    : 0

  const tabela = (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ background: C.offwhite }}>
          {draggable && <Th style={{ width: 28 }} />}
          <Th>Linha de Negócio</Th>
          <ThNum>Receita</ThNum>
          <ThNum>CMV</ThNum>
          <ThNum>Margem Bruta</ThNum>
          <ThNum>Desp. Variável</ThNum>
          <ThNum>Desp. Fixa</ThNum>
          <ThNum>EBITDA Pré</ThNum>
          <ThNum>Rateio SEDE</ThNum>
          <ThNum>EBITDA Real</ThNum>
          <ThNum>%</ThNum>
          <ThNum>Lcto.</ThNum>
        </tr>
      </thead>
      <tbody>
        {linhas.map((l, i) => (
          <SortableRow
            key={l.ln_id}
            linha={l}
            primeiraLinha={i === 0}
            draggable={draggable}
          />
        ))}
      </tbody>
      <tfoot>
        <tr style={{ borderTop: `2px solid ${C.borderLt}`, background: C.beigeLt }}>
          {draggable && <Td />}
          <Td><strong style={{ color: C.espresso }}>TOTAL</strong></Td>
          <TdNum strong>{fmtBRL(totais.receita_total)}</TdNum>
          <TdNum strong>{fmtBRL(cmvTotal)}</TdNum>
          <TdNum strong>{fmtBRL(mbTotal)}</TdNum>
          <TdNum strong>{fmtBRL(dvTotal)}</TdNum>
          <TdNum strong>{fmtBRL(dfTotal)}</TdNum>
          <TdNum strong>{fmtBRL(totais.ebitda_pre_total)}</TdNum>
          <TdNum strong>{totais.rateio_total > 0 ? `-${fmtBRL(totais.rateio_total)}` : fmtBRL(0)}</TdNum>
          <TdNum strong style={{ color: totais.ebitda_real_total >= 0 ? C.green : C.red }}>
            {fmtBRL(totais.ebitda_real_total)}
          </TdNum>
          <TdNum strong style={{ color: totais.ebitda_real_total >= 0 ? C.green : C.red }}>
            {fmtPct(pctRealTotal)}
          </TdNum>
          <TdNum strong>{totais.qtd_lancamentos_total}</TdNum>
        </tr>
      </tfoot>
    </table>
  )

  return (
    <section style={{ background: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 20 }}>
      <div style={{
        width: '100%', padding: '14px 20px',
        background: C.beigeLt, display: 'flex',
        alignItems: 'center', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap',
        borderBottom: expanded ? `1px solid ${C.borderLt}` : 'none',
      }}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 8, color: C.espresso }}
        >
          <span style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 500 }}>
            Detalhamento por linha
          </span>
          <span style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>
            {expanded ? '▾' : '▸'}
          </span>
        </button>

        {draggable && expanded && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {isCustomOrder && (
              <span style={{ fontSize: 11, color: C.muted, fontStyle: 'italic' }}>
                Ordem personalizada
              </span>
            )}
            {onReset && (
              <button
                type="button"
                onClick={onReset}
                title="Voltar à ordem padrão (por receita decrescente)"
                style={{
                  background: 'transparent', color: C.espresso,
                  border: `1px solid ${C.borderLt}`,
                  padding: '6px 12px', borderRadius: 6,
                  fontSize: 11, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Resetar ordem
              </button>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div style={{ overflowX: 'auto' }}>
          {draggable ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={linhas.map((l) => l.ln_id)} strategy={verticalListSortingStrategy}>
                {tabela}
              </SortableContext>
            </DndContext>
          ) : (
            tabela
          )}
        </div>
      )}

      {draggable && expanded && (
        <div style={{ padding: '8px 20px', fontSize: 11, color: C.muted, background: C.offwhite, borderTop: `1px solid ${C.borderLt}` }}>
          Arraste o ícone ⠿ para reordenar linhas. Ordem é salva por empresa.
        </div>
      )}
    </section>
  )
}

function SortableRow({ linha, primeiraLinha, draggable }: { linha: Linha; primeiraLinha: boolean; draggable: boolean }) {
  const sortable = useSortable({ id: linha.ln_id, disabled: !draggable })
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    background: isDragging ? '#FFF8E7' : 'transparent',
    opacity: isDragging ? 0.7 : 1,
    borderTop: primeiraLinha ? 'none' : `1px solid ${C.borderLt}`,
  }

  const corReal = linha.ebitda_pos_rateio >= 0 ? C.green : C.red

  return (
    <tr ref={setNodeRef} style={style}>
      {draggable && (
        <Td style={{ padding: '0 4px', cursor: 'grab', touchAction: 'none', width: 28 }}>
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Mover ${linha.ln_nome}`}
            style={{
              background: 'transparent', border: 'none', cursor: isDragging ? 'grabbing' : 'grab',
              padding: 4, color: 'rgba(61,35,20,0.4)', fontSize: 14, lineHeight: 1,
            }}
          >
            ⠿
          </button>
        </Td>
      )}
      <Td>
        <span style={{ fontWeight: 600, color: C.espresso }}>{linha.ln_nome}</span>
      </Td>
      <TdNum>{fmtBRL(linha.rob)}</TdNum>
      <TdNum>{fmtBRL(linha.cmv)}</TdNum>
      <TdNum>{fmtBRL(linha.margem_bruta)}</TdNum>
      <TdNum>{fmtBRL(linha.desp_variavel)}</TdNum>
      <TdNum>{fmtBRL(linha.desp_fixa)}</TdNum>
      <TdNum>{fmtBRL(linha.ebitda_pre_rateio)}</TdNum>
      <TdNum>{linha.rateio_sede_recebido > 0 ? `-${fmtBRL(linha.rateio_sede_recebido)}` : fmtBRL(0)}</TdNum>
      <TdNum style={{ color: corReal, fontWeight: 700 }}>{fmtBRL(linha.ebitda_pos_rateio)}</TdNum>
      <TdNum style={{ color: corReal }}>{fmtPct(linha.ebitda_pct_pos_rateio)}</TdNum>
      <TdNum>{linha.qtd_lancamentos}</TdNum>
    </tr>
  )
}

function Th({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(61, 35, 20, 0.65)', whiteSpace: 'nowrap', ...style }}>{children}</th>
}
function ThNum({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(61, 35, 20, 0.65)', whiteSpace: 'nowrap' }}>{children}</th>
}
function Td({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: '10px 12px', verticalAlign: 'top', ...style }}>{children}</td>
}
function TdNum({ children, strong, style }: { children: React.ReactNode; strong?: boolean; style?: React.CSSProperties }) {
  return (
    <td
      style={{
        padding: '10px 12px',
        textAlign: 'right',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        whiteSpace: 'nowrap',
        fontWeight: strong ? 700 : 500,
        ...(style || {}),
      }}
    >
      {children}
    </td>
  )
}
