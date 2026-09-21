'use client'

// Revenda · R6b — LISTA de precificação. Cada carro do pátio: preço mínimo × anunciado × lucro projetado
// (da fonte única fn_veic_conta_do_carro, RD-65). Clicar abre a precificação do veículo (a mesma tela que
// a ficha abre): /dashboard/revenda/veiculo/[id]/precificacao — onde ficam cenários, giro e recusa de item.
// Sem cálculo na tela; "não configurado" quando falta (RD-51); paleta PS.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', red: '#B42318',
}
const brl = (v: number | null | undefined) => v == null ? 'não configurado' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Row = { id: string; marca: string | null; modelo: string | null; placa: string | null; anunciado: number | null; minimo: number | null; lucro: number | null; dias: number | null }

export default function PrecificacaoListaPage() {
  const router = useRouter()
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!companyId) { setRows([]); setLoading(false); return }
    setLoading(true)
    const { data: veics } = await supabase.from('veic_veiculo')
      .select('id, marca, modelo, placa').eq('company_id', companyId).eq('ativo', true)
      .in('situacao', ['disponivel', 'reservado', 'em_preparacao']).order('modelo')
    const base = (veics ?? []) as { id: string; marca: string | null; modelo: string | null; placa: string | null }[]
    // preço mínimo × anunciado × lucro projetado da fonte única (uma chamada por carro).
    const out = await Promise.all(base.map(async v => {
      const { data } = await supabase.rpc('fn_veic_conta_do_carro', { p_veiculo_id: v.id })
      const c = data as { ok?: boolean; anunciado?: number | null; preco_minimo?: number | null; lucro_real_projetado?: number | null; dias_parado?: number | null } | null
      return { id: v.id, marca: v.marca, modelo: v.modelo, placa: v.placa,
        anunciado: c?.anunciado ?? null, minimo: c?.preco_minimo ?? null, lucro: c?.lucro_real_projetado ?? null, dias: c?.dias_parado ?? null } as Row
    }))
    setRows(out); setLoading(false)
  }, [companyId])
  useEffect(() => { void load() }, [load])

  if (!companyId) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Selecione uma empresa específica no topo.</div>

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '20px 16px 60px' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <a href="/dashboard/revenda" style={{ color: C.gold, fontSize: 12, textDecoration: 'none', fontWeight: 600 }}>← voltar ao painel</a>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: C.esp, margin: '6px 0 2px' }}>Precificação do pátio</h1>
        <p style={{ color: C.espM, fontSize: 13, margin: '0 0 16px' }}>Preço mínimo × anunciado × lucro projetado de cada carro. Toque para abrir a precificação (cenários, giro e recusa de item).</p>

        {loading ? <div style={{ color: C.espM }}>Carregando…</div> :
         rows.length === 0 ? <div style={{ color: C.espL, fontSize: 13 }}>Nenhum carro no pátio.</div> :
         <div style={{ display: 'grid', gap: 8 }}>
           {rows.map(r => (
             <button key={r.id} onClick={() => router.push(`/dashboard/revenda/veiculo/${r.id}/precificacao`)}
               style={{ textAlign: 'left', background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
               <div style={{ minWidth: 0 }}>
                 <div style={{ fontWeight: 700, color: C.esp, fontSize: 14 }}>{[r.marca, r.modelo].filter(Boolean).join(' ') || 'Veículo'}{r.placa ? <span style={{ color: C.espL, fontWeight: 400 }}> · {r.placa}</span> : ''}</div>
                 <div style={{ fontSize: 12, color: C.espM, marginTop: 2 }}>mínimo <b style={{ color: C.esp }}>{brl(r.minimo)}</b> · anunciado <b style={{ color: C.esp }}>{r.anunciado == null ? 'sem preço' : brl(r.anunciado)}</b>{r.dias != null ? ` · ${r.dias} dias` : ''}</div>
               </div>
               <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                 <div style={{ fontSize: 10.5, color: C.espM }}>lucro projetado</div>
                 <div style={{ fontSize: 15, fontWeight: 800, color: r.lucro == null ? C.espL : (r.lucro < 0 ? C.red : C.green) }}>{brl(r.lucro)}</div>
               </div>
             </button>
           ))}
         </div>}
      </div>
    </div>
  )
}
