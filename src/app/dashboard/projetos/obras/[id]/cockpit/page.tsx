'use client'
// HB0 · Cockpit da obra — avanço, custo, margem e pendências numa tela só (Hub, blueprint V18 Parte M).
// Só leitura de v_obra_resultado (HB1, security_invoker: respeita a RLS das tabelas de origem).
import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', VERM = '#B91C1C'
const brl = (n: number | null | undefined) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Resultado = {
  obra_id: string; numero: string; nome: string | null; status: string
  custo_previsto: number; receita_prevista: number; receita_servico: number; receita_material: number
  custo_material: number; custo_viagens: number; margem_realizada: number
}

export default function CockpitObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [r, setR] = useState<Resultado | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    const { data, error } = await supabase.from('v_obra_resultado').select('*').eq('obra_id', id).maybeSingle()
    setLoading(false)
    if (error) { setErro(error.message); return }
    if (!data) { setErro('Obra não encontrada ou sem acesso.'); return }
    setR(data as Resultado)
  }, [id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  const receita = r ? Number(r.receita_servico) + Number(r.receita_material) : 0
  const custo = r ? Number(r.custo_material) + Number(r.custo_viagens) : 0
  const margem = r ? Number(r.margem_realizada) : 0
  const margemPct = receita > 0 ? (margem / receita) * 100 : null
  const avancoPct = r && Number(r.receita_prevista) > 0 ? Math.min(100, (Number(r.receita_servico) / Number(r.receita_prevista)) * 100) : null
  const custoPrevisto = r ? Number(r.custo_previsto) : 0
  const estouro = custoPrevisto > 0 && custo > custoPrevisto

  const cards = r ? [
    { k: 'receita', l: 'Receita realizada', v: brl(receita), sub: `Serviço ${brl(r.receita_servico)} · Material ${brl(r.receita_material)}` },
    { k: 'custo', l: 'Custo realizado', v: brl(custo), sub: `Material ${brl(r.custo_material)} · Viagens ${brl(r.custo_viagens)}`, cor: estouro ? VERM : undefined },
    { k: 'margem', l: 'Margem', v: brl(margem), sub: margemPct == null ? 'Sem receita ainda' : `${margemPct.toFixed(1)}% da receita`, cor: margem < 0 ? VERM : VERDE },
    { k: 'avanco', l: 'Avanço financeiro', v: avancoPct == null ? '—' : `${avancoPct.toFixed(0)}%`, sub: `Medido ${brl(r.receita_servico)} de ${brl(r.receita_prevista)}` },
  ] : []

  const pendencias: string[] = []
  if (r) {
    if (Number(r.receita_prevista) === 0) pendencias.push('Obra sem itens contratados — cadastre o orçamento para medir o avanço.')
    if (estouro) pendencias.push(`Custo realizado acima do previsto (${brl(custo)} de ${brl(custoPrevisto)}).`)
    if (margem < 0) pendencias.push('Margem negativa — revise custos lançados.')
  }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }} data-testid="hub-cockpit-obra">
        <Link href="/dashboard/projetos/obras?area=hub" style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Obras</Link>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 8 }}>Hub · Obra</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, color: ESP, margin: '2px 0 12px' }}>
          Cockpit {r ? `· ${r.numero}${r.nome ? ` — ${r.nome}` : ''}` : ''}
        </h1>
        {loading ? <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div>
          : erro ? <div style={{ background: '#FBEAEA', color: VERM, borderRadius: 10, padding: 14, fontSize: 13 }}>{erro}</div>
          : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 14 }}>
                {cards.map((c) => (
                  <div key={c.k} data-testid={`cockpit-${c.k}`} style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
                    <div style={{ fontSize: 11, color: MUT, textTransform: 'uppercase', letterSpacing: 0.5 }}>{c.l}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: c.cor ?? ESP, margin: '4px 0' }}>{c.v}</div>
                    <div style={{ fontSize: 11, color: MUT }}>{c.sub}</div>
                  </div>
                ))}
              </div>
              <div data-testid="cockpit-pendencias" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: ESP, marginBottom: 6 }}>Pendências do dia</div>
                {pendencias.length === 0
                  ? <div style={{ fontSize: 12, color: VERDE }}>Nenhuma pendência. Obra em ordem.</div>
                  : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: ESP }}>{pendencias.map((p) => <li key={p}>{p}</li>)}</ul>}
              </div>
              <Link href={`/dashboard/projetos/obras/${id}/linha-do-tempo?area=hub`} style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Ver linha do tempo →</Link>
            </>
          )}
      </div>
    </div>
  )
}
