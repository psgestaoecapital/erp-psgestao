'use client'
// HB0 · Cockpit da obra — avanço, custo, margem e pendências numa tela só (Hub, blueprint V18 Parte M).
// Só leitura de v_obra_resultado_alocado (HB1, security_invoker: respeita a RLS das tabelas de origem): inclui mão de obra e rateio.
import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ehUuid, erroAmigavel } from '@/lib/erroAmigavel'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/projetos/obras/[id]/cockpit'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', VERM = '#B91C1C'
const brl = (n: number | null | undefined) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Resultado = {
  obra_id: string; numero: string; nome: string | null; status: string
  custo_previsto: number; receita_prevista: number; receita_servico: number; receita_material: number
  custo_material: number; custo_viagens: number; margem_realizada: number
  custo_mao_obra: number; custo_rateio: number; margem_alocada: number
}

export default function CockpitObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [r, setR] = useState<Resultado | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const consulta = useCallback(async () => await supabase.from('v_obra_resultado_alocado').select('*').eq('obra_id', id).maybeSingle(), [id])
  const carregar = useCallback(async () => {
    if (!ehUuid(id)) { setLoading(false); setErro('Obra não encontrada. Abra pela lista de obras.'); return }
    setLoading(true); setErro(null)
    let res: Awaited<ReturnType<typeof consulta>>
    try { res = await comPrazo(consulta, { ms: 8000, tentativas: 1, label: 'cockpit-obra' }) } catch { setLoading(false); setErro(MSG_CARREGAMENTO_FALHOU); return }
    const { data, error } = res
    setLoading(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível carregar a obra. Tente de novo.')); return }
    if (!data) {
      // Diferencia obra inexistente × sem acesso nesta empresa (fn_obra_existe só diz existe/tem_acesso).
      const { data: ex } = await supabase.rpc('fn_obra_existe', { p_obra_id: id })
      const j = ex as { existe?: boolean; tem_acesso?: boolean } | null
      setErro(j?.existe === false ? 'Esta obra não existe. O link pode estar desatualizado.'
        : j?.existe && !j.tem_acesso ? 'Você não tem acesso a esta obra na empresa ativa. Troque de empresa ou peça acesso.'
        : 'Não foi possível confirmar esta obra. Abra pela lista de obras.')
      return
    }
    setR(data as Resultado)
  }, [consulta, id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  const receita = r ? Number(r.receita_servico) + Number(r.receita_material) : 0
  const custo = r ? Number(r.custo_material) + Number(r.custo_viagens) + Number(r.custo_mao_obra ?? 0) + Number(r.custo_rateio ?? 0) : 0
  const margem = r ? Number(r.margem_alocada ?? r.margem_realizada) : 0
  const margemPct = receita > 0 ? (margem / receita) * 100 : null
  // Avanço financeiro = receita já realizada (serviço medido + material vendido à obra) sobre a receita prevista.
  // Usa a receita realizada total — a mesma do card "Receita realizada" — para não contradizer a própria tela quando a
  // receita vem por venda de material (ex.: obra sem NFS-e de medição ainda lançada). Teto 100%.
  const avancoPct = r && Number(r.receita_prevista) > 0 ? Math.min(100, (receita / Number(r.receita_prevista)) * 100) : null
  const custoPrevisto = r ? Number(r.custo_previsto) : 0
  const estouro = custoPrevisto > 0 && custo > custoPrevisto

  const cards = r ? [
    { k: 'receita', ajuda: 'projetos.cockpit.receita', l: 'Receita realizada', v: brl(receita), sub: `Serviço ${brl(r.receita_servico)} · Material ${brl(r.receita_material)}` },
    { k: 'custo', ajuda: 'projetos.cockpit.custo', l: 'Custo realizado', v: brl(custo), sub: `Material ${brl(r.custo_material)} · Viagens ${brl(r.custo_viagens)} · Mão de obra ${brl(r.custo_mao_obra)} · Rateio ${brl(r.custo_rateio)}`, cor: estouro ? VERM : undefined },
    { k: 'margem', ajuda: 'projetos.cockpit.margem', l: 'Margem', v: brl(margem), sub: margemPct == null ? 'Sem receita ainda' : `${margemPct.toFixed(1)}% da receita`, cor: margem < 0 ? VERM : VERDE },
    { k: 'avanco', ajuda: 'projetos.cockpit.avanco', l: 'Avanço financeiro', v: avancoPct == null ? '—' : `${avancoPct.toFixed(0)}%`, sub: `Realizado ${brl(receita)} de ${brl(r.receita_prevista)}` },
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
          : erro ? (
            <div data-testid="cockpit-erro" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 14, padding: '32px 24px', textAlign: 'center', maxWidth: 440, margin: '20px auto 0' }}>
              <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 400, color: ESP, marginBottom: 6 }}>Não foi possível abrir este cockpit</div>
              <div style={{ fontSize: 13, color: MUT, lineHeight: 1.5, marginBottom: 18 }}>{erro}</div>
              <Link href="/dashboard/projetos/obras?area=hub" data-testid="cockpit-erro-voltar" style={{ display: 'inline-block', background: ESP, color: BG, borderRadius: 10, padding: '10px 20px', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>Voltar para Obras</Link>
            </div>
          )
          : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 14 }}>
                {cards.map((c) => (
                  <div key={c.k} data-testid={`cockpit-${c.k}`} style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
                    <div style={{ fontSize: 11, color: MUT, textTransform: 'uppercase', letterSpacing: 0.5 }}>{c.l} <AjudaCampo chave={c.ajuda} rota={ROTA} /></div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: c.cor ?? ESP, margin: '4px 0' }}>{c.v}</div>
                    <div style={{ fontSize: 11, color: MUT }}>{c.sub}</div>
                  </div>
                ))}
              </div>
              <div data-testid="cockpit-pendencias" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: ESP, marginBottom: 6 }}>Pendências do dia <AjudaCampo chave="projetos.cockpit.pendencias" rota={ROTA} /></div>
                {pendencias.length === 0
                  ? <div style={{ fontSize: 12, color: VERDE }}>Nenhuma pendência. Obra em ordem.</div>
                  : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: ESP }}>{pendencias.map((p) => <li key={p}>{p}</li>)}</ul>}
              </div>
              <Link href={`/dashboard/projetos/obras/${id}/horas?area=hub`} data-testid="link-lancar-horas" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none', marginRight: 12 }}>Lançar horas →</Link><AjudaCampo chave="projetos.cockpit.lancar_horas" rota={ROTA} />
              <Link href={`/dashboard/projetos/obras/${id}/linha-do-tempo?area=hub`} style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Ver linha do tempo →</Link><AjudaCampo chave="projetos.cockpit.linha_tempo" rota={ROTA} />
              <Link href={`/dashboard/projetos/obras/${id}/cronograma?area=hub`} style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none', marginLeft: 14 }}>Ver cronograma →</Link><AjudaCampo chave="projetos.cockpit.cronograma" rota={ROTA} />
              <Link href={`/dashboard/projetos/viagens?obra=${id}&area=hub`} data-testid="link-nova-viagem" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none', marginLeft: 14 }}>Nova viagem desta obra →</Link><AjudaCampo chave="projetos.cockpit.nova_viagem" rota={ROTA} />
            </>
          )}
      </div>
    </div>
  )
}
