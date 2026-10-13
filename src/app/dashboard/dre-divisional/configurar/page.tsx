'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { authFetch } from '@/lib/authFetch'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { supabase } from '@/lib/supabase'
import { C, fmtBRL } from '../_components'

type Linha = {
  ln_id: string
  ln_nome: string
  rob: number
  ebitda_pos_rateio: number
}

type ConfigItem = {
  linha_id: string
  ordem: number
  visivel: boolean
  ln_nome: string
  rob: number
  ebitda_pos_rateio: number
}

const HOJE = new Date()
const ANO_HOJE = HOJE.getFullYear()
const MES_HOJE = HOJE.getMonth() + 1

export default function ConfigurarDREPage() {
  const router = useRouter()
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [items, setItems] = useState<ConfigItem[]>([])
  const [salvando, setSalvando] = useState(false)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [mensagem, setMensagem] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const carregar = useCallback(async () => {
    if (!empresaUnica) { setItems([]); setLoading(false); return }
    setLoading(true)
    setErro(null)
    try {
      const params = new URLSearchParams({
        company_id: empresaUnica,
        ano: String(ANO_HOJE),
        mes: String(MES_HOJE),
        view_mode: 'mes',
      })
      const res = await authFetch(`/api/dre-divisional?${params.toString()}`)
      const j = await res.json()
      if (!j.ok) throw new Error(j.mensagem_humana || j.error || 'falha ao carregar DRE')
      const linhas = (j.linhas ?? []) as Linha[]

      const { data: ordem } = await supabase.rpc('fn_dre_ordem_personalizada_get', { p_company_id: empresaUnica })
      const cfgRaw = (ordem ?? []) as Array<{ linha_id: string; ordem: number; visivel?: boolean }>
      const cfgMap = new Map(cfgRaw.map((c) => [c.linha_id, c]))

      const merged: ConfigItem[] = linhas.map((l, idx) => ({
        linha_id: l.ln_id,
        ordem: cfgMap.get(l.ln_id)?.ordem ?? idx,
        visivel: cfgMap.get(l.ln_id)?.visivel !== false,
        ln_nome: l.ln_nome,
        rob: l.rob,
        ebitda_pos_rateio: l.ebitda_pos_rateio,
      }))
      merged.sort((a, b) => a.ordem - b.ordem)
      setItems(merged)
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setLoading(false)
    }
  }, [empresaUnica])

  useEffect(() => { carregar() }, [carregar])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex((l) => l.linha_id === active.id)
    const newIndex = items.findIndex((l) => l.linha_id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    setItems(arrayMove(items, oldIndex, newIndex))
  }

  function toggleVisivel(linha_id: string) {
    setItems((prev) => prev.map((i) => i.linha_id === linha_id ? { ...i, visivel: !i.visivel } : i))
  }

  async function salvar() {
    if (!empresaUnica) return
    setSalvando(true)
    setMensagem(null)
    const payload = items.map((i, idx) => ({ linha_id: i.linha_id, ordem: idx, visivel: i.visivel }))
    const { error } = await supabase.rpc('fn_dre_ordem_personalizada_set', {
      p_company_id: empresaUnica,
      p_ordens: payload,
    })
    setSalvando(false)
    if (error) {
      setMensagem('Não foi possível salvar agora.')
    } else {
      setMensagem('Configuração salva.')
      setTimeout(() => router.push('/dashboard/dre-divisional'), 700)
    }
  }

  async function restaurarPadrao() {
    if (!empresaUnica) return
    if (!confirm('Restaurar a ordem e visibilidade padrão da DRE?')) return
    setSalvando(true)
    await supabase.rpc('fn_dre_ordem_personalizada_reset', { p_company_id: empresaUnica })
    setSalvando(false)
    setMensagem('Padrão restaurado.')
    carregar()
  }

  const visiveis = useMemo(() => items.filter((i) => i.visivel), [items])
  const totalRob = visiveis.reduce((s, l) => s + l.rob, 0)
  const totalEbitda = visiveis.reduce((s, l) => s + l.ebitda_pos_rateio, 0)

  if (!empresaUnica) {
    return (
      <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', padding: '32px 24px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', color: C.muted }}>
          Selecione uma empresa específica para configurar a DRE.
        </div>
      </div>
    )
  }

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        <Link href="/dashboard/dre-divisional" style={{ fontSize: 13, color: C.espresso, textDecoration: 'none' }}>← Voltar à DRE</Link>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, margin: '6px 0 4px' }}>
          Configurar DRE
        </h1>
        <p style={{ margin: '0 0 24px', fontSize: 13, color: C.muted }}>
          Reordene as linhas arrastando e desmarque para ocultar. Salve quando terminar.
        </p>

        {erro && (
          <div style={{ background: C.redBg, color: C.red, padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{erro}</div>
        )}
        {mensagem && (
          <div style={{ background: '#E8F5DD', color: '#3B6D11', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{mensagem}</div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 24, alignItems: 'flex-start' }} className="config-grid">
          <section style={{ background: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61,35,20,0.06)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: C.muted, marginBottom: 12 }}>
              Linhas da DRE
            </div>
            {loading ? (
              <div style={{ color: C.muted, fontSize: 13, padding: 20 }}>Carregando…</div>
            ) : items.length === 0 ? (
              <div style={{ color: C.muted, fontSize: 13, padding: 20 }}>Nenhuma linha de negócio cadastrada.</div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={items.map((i) => i.linha_id)} strategy={verticalListSortingStrategy}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {items.map((it) => (
                      <ItemArrastavel key={it.linha_id} item={it} onToggleVisivel={() => toggleVisivel(it.linha_id)} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
              <button onClick={salvar} disabled={salvando || loading} style={btnPrimario(salvando || loading)}>
                {salvando ? 'Salvando…' : 'Salvar configuração'}
              </button>
              <button onClick={() => router.push('/dashboard/dre-divisional')} disabled={salvando} style={btnSecundario}>
                Cancelar
              </button>
              <span style={{ flex: 1 }} />
              <button onClick={restaurarPadrao} disabled={salvando || loading} style={btnSecundario}>
                Restaurar padrão
              </button>
            </div>
          </section>

          <section style={{ background: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61,35,20,0.06)', position: 'sticky', top: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: C.muted, marginBottom: 12 }}>
              Pré-visualização
            </div>
            {visiveis.length === 0 ? (
              <div style={{ color: C.muted, fontSize: 13, padding: 20, textAlign: 'center' }}>
                Nenhuma linha visível. Marque pelo menos uma para ver o preview.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: C.offwhite }}>
                    <th style={previewTh}>Linha</th>
                    <th style={{ ...previewTh, textAlign: 'right' }}>Receita</th>
                    <th style={{ ...previewTh, textAlign: 'right' }}>EBITDA</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((l) => (
                    <tr key={l.linha_id} style={{ borderTop: `1px solid ${C.borderLt}` }}>
                      <td style={previewTd}>{l.ln_nome}</td>
                      <td style={{ ...previewTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(l.rob)}</td>
                      <td style={{ ...previewTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtBRL(l.ebitda_pos_rateio)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: `2px solid ${C.espresso}`, background: C.offwhite }}>
                    <td style={{ ...previewTd, fontWeight: 700 }}>Total</td>
                    <td style={{ ...previewTd, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(totalRob)}</td>
                    <td style={{ ...previewTd, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(totalEbitda)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .config-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  )
}

function ItemArrastavel({ item, onToggleVisivel }: { item: ConfigItem; onToggleVisivel: () => void }) {
  const sortable = useSortable({ id: item.linha_id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.6 : 1,
    background: item.visivel ? 'white' : '#F5F2EB',
    border: `1px solid ${C.borderLt}`,
    borderLeft: `3px solid ${item.visivel ? C.gold : C.borderLt}`,
    borderRadius: 8,
    padding: '10px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  }
  return (
    <div ref={sortable.setNodeRef} style={style}>
      <span
        {...sortable.attributes}
        {...sortable.listeners}
        aria-label="Arrastar"
        style={{ cursor: 'grab', color: C.gold, fontSize: 18, fontWeight: 700, padding: '0 4px', userSelect: 'none' }}
      >
        ⋮⋮
      </span>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flexShrink: 0 }}>
        <input type="checkbox" checked={item.visivel} onChange={onToggleVisivel} aria-label={`Visível: ${item.ln_nome}`} />
        <span style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
          {item.visivel ? 'Visível' : 'Oculta'}
        </span>
      </label>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: item.visivel ? C.ink : C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.ln_nome}
      </span>
    </div>
  )
}

const previewTh: React.CSSProperties = { padding: '8px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: C.muted, textAlign: 'left' }
const previewTd: React.CSSProperties = { padding: '8px 10px', fontSize: 12, color: C.ink }

function btnPrimario(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? 'rgba(200,148,26,0.5)' : C.gold,
    color: C.espresso,
    border: 'none',
    padding: '10px 18px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

const btnSecundario: React.CSSProperties = {
  background: 'transparent',
  color: C.espresso,
  border: `1px solid ${C.borderLt}`,
  padding: '10px 18px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}
