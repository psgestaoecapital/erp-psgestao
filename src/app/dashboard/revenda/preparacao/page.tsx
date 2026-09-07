'use client'

// Revenda de Veículos · Onda 9 — Kanban de preparação (§4.3). Reusa erp_os (veic_veiculo_id IS NOT NULL)
// via fn_veic_preparacao_listar. Colunas A Fazer / Fazendo / Finalizado pelo status real da OS.
// Read-only: concluir/abrir OS é na ficha do veículo (mover card mudaria o fluxo da Oficina — fora do escopo).

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC', blue: '#2F5AA8',
}
const brl = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const brDate = (d: string | null) => d ? String(d).slice(0, 10).split('-').reverse().join('/') : ''

type PrepOS = { os_id: string; numero: string; status: string; prioridade: string; veiculo_id: string; placa: string | null; marca: string | null; modelo: string | null; descricao_servico: string | null; tecnico_nome: string | null; data_abertura: string | null; data_prevista: string | null; data_conclusao: string | null; dias_corridos: number | null; total: number; coluna: string; concluida: boolean; custo_id: string | null }

const COLUNAS: { key: string; titulo: string; cor: string; bg: string }[] = [
  { key: 'a_fazer', titulo: 'A Fazer', cor: C.espM, bg: C.cream },
  { key: 'fazendo', titulo: 'Fazendo', cor: C.blue, bg: '#EEF3FB' },
  { key: 'finalizado', titulo: 'Finalizado', cor: C.green, bg: C.greenBg },
]

export default function PreparacaoKanbanPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const router = useRouter()
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [oss, setOss] = useState<PrepOS[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) { setOss([]); setLoading(false); return }
    const { data, error } = await supabase.rpc('fn_veic_preparacao_listar', { p_company_id: companyId, p_veiculo_id: null })
    if (error) { setErro(error.message); setLoading(false); return }
    const r = data as { ok?: boolean; os?: PrepOS[] } | null
    setOss(r?.ok ? (r.os ?? []) : [])
    setLoading(false)
  }, [companyId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const porColuna = useMemo(() => {
    const m: Record<string, PrepOS[]> = { a_fazer: [], fazendo: [], finalizado: [] }
    oss.forEach((o) => { (m[o.coluna] ?? m.a_fazer).push(o) })
    return m
  }, [oss])

  if (!companyId) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Selecione uma empresa específica no topo.</div>

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 1180, margin: '0 auto', color: C.esp }}>
      <a href="/dashboard/revenda/patio" style={{ fontSize: 12, color: C.blue, textDecoration: 'none' }}>← voltar ao pátio</a>
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>🔧 Comércio · Revenda</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Preparação · Kanban</h1>
        <p style={{ color: C.espM, fontSize: 13, margin: '6px 0 14px' }}>Ordens de serviço de preparação (reusa a OS da Oficina). Concluir uma OS é na ficha do veículo — vira custo no chassi.</p>
      </div>

      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }} onClick={() => setErro(null)}>{erro}</div>}

      {loading ? (
        <div style={{ color: C.espM, fontSize: 13 }}>Carregando…</div>
      ) : oss.length === 0 ? (
        <div style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '30px 16px', textAlign: 'center', color: C.espM }}>
          Nenhuma OS de preparação. Abra a primeira pela ficha de um veículo.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
          {COLUNAS.map((col) => {
            const lista = porColuna[col.key] ?? []
            return (
              <div key={col.key} style={{ flex: '1 0 300px', minWidth: 300, background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '10px 12px', background: col.bg, color: col.cor, fontWeight: 700, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{col.titulo}</span><span>{lista.length}</span>
                </div>
                <div style={{ padding: 10, display: 'grid', gap: 10 }}>
                  {lista.length === 0 && <div style={{ fontSize: 12, color: C.espL, fontStyle: 'italic', padding: '8px 2px' }}>vazio</div>}
                  {lista.map((o) => (
                    <div key={o.os_id} onClick={() => router.push(`/dashboard/revenda/veiculo/${o.veiculo_id}`)}
                      style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, cursor: 'pointer', background: C.white }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        <b style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{o.numero}</b>
                        <span style={{ fontWeight: 700, fontSize: 13, color: C.esp }}>{brl(o.total)}</span>
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 4 }}>{o.marca || ''} {o.modelo || 'Veículo'}</div>
                      <div style={{ fontSize: 11.5, color: C.espM, fontFamily: 'monospace' }}>{o.placa || 'sem placa'}</div>
                      {o.descricao_servico && <div style={{ fontSize: 11, color: C.espM, marginTop: 4, lineHeight: 1.35, maxHeight: 46, overflow: 'hidden' }}>{o.descricao_servico}</div>}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, background: col.bg, color: col.cor, fontWeight: 700 }}>{o.status.replace('_', ' ')}</span>
                        {o.dias_corridos != null && <span style={{ fontSize: 10.5, color: C.espL }}>{o.dias_corridos} dia(s)</span>}
                        {o.tecnico_nome && <span style={{ fontSize: 10.5, color: C.espL }}>· {o.tecnico_nome}</span>}
                        {o.data_prevista && <span style={{ fontSize: 10.5, color: C.espL }}>· prazo {brDate(o.data_prevista)}</span>}
                        {o.custo_id && <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, background: '#E8EEF9', color: C.blue, fontWeight: 700 }}>custo lançado</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
