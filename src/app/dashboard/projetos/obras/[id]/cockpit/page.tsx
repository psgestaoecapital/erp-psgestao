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
// Contexto da obra (avanço físico, prazo, cliente) — vem de projetos_obras, não da view de resultado financeiro.
type ObraInfo = { pct_conclusao: number | null; data_inicio: string | null; data_prevista_fim: string | null; cliente_nome: string | null; cidade: string | null }
type Linha = { k: string; ajuda: string; l: string; v: number }
type Card = { k: string; ajuda: string; l: string; v: string; sub: string; cor?: string; bar?: number | null; linhas?: Linha[] }

export default function CockpitObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [r, setR] = useState<Resultado | null>(null)
  const [info, setInfo] = useState<ObraInfo | null>(null)
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
    // Contexto da obra (avanço físico, prazo, cliente) — leitura separada de projetos_obras; se falhar, os cards
    // financeiros seguem aparecendo (não trava a tela).
    const { data: oi } = await supabase.from('projetos_obras').select('pct_conclusao,data_inicio,data_prevista_fim,cliente_nome,cidade').eq('id', id).maybeSingle()
    if (oi) setInfo(oi as ObraInfo)
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
  // Avanço físico = execução em campo (pct_conclusao do cronograma/medição). Distinto do avanço financeiro (receita realizada).
  const fisicoPct = info && info.pct_conclusao != null ? Math.max(0, Math.min(100, Number(info.pct_conclusao))) : null
  // Prazo: dias até a data prevista de término; vencido só vale enquanto a obra não foi concluída.
  const hoje = new Date().toISOString().slice(0, 10)
  const prazo = info?.data_prevista_fim ?? null
  const prazoVencido = !!prazo && prazo < hoje && r?.status === 'em_andamento'
  const prazoBR = prazo ? new Date(prazo + 'T12:00:00').toLocaleDateString('pt-BR') : null
  const diasRestantes = prazo ? Math.round((new Date(prazo + 'T12:00:00').getTime() - new Date(hoje + 'T12:00:00').getTime()) / 86400000) : null
  const prazoSub = prazo == null ? 'Sem data prevista'
    : prazoVencido ? 'Vencido' : diasRestantes === 0 ? 'Entrega hoje' : (diasRestantes ?? 0) > 0 ? `Faltam ${diasRestantes} dia(s)` : `${Math.abs(diasRestantes ?? 0)} dia(s) atrás`

  // Indicadores de valor agregado (só com os dois lados do dado): valor ganho = avanço físico × custo previsto.
  // IDC = valor ganho ÷ custo realizado (>1 gastando menos que o executado); IDP = avanço físico ÷ tempo decorrido (cronograma linear).
  const inicio = info?.data_inicio ?? null
  const idc = fisicoPct != null && custoPrevisto > 0 && custo > 0 ? (fisicoPct / 100 * custoPrevisto) / custo : null
  const prazoTotal = inicio && prazo ? Math.round((new Date(prazo + 'T12:00:00').getTime() - new Date(inicio + 'T12:00:00').getTime()) / 86400000) : 0
  const decorridos = inicio ? Math.round((new Date(hoje + 'T12:00:00').getTime() - new Date(inicio + 'T12:00:00').getTime()) / 86400000) : 0
  const tempoPct = prazoTotal > 0 && decorridos > 0 ? Math.min(100, decorridos / prazoTotal * 100) : null
  const idp = fisicoPct != null && tempoPct != null ? fisicoPct / tempoPct : null
  const burn = decorridos > 0 && custo > 0 ? custo / decorridos : null
  const indicadores = [
    { k: 'idc', ajuda: 'projetos.cockpit.idc', l: 'IDC · custo', v: idc == null ? '—' : idc.toFixed(2), sub: idc == null ? 'Precisa de avanço físico, custo previsto e custo lançado' : idc >= 1 ? 'Executando dentro do custo' : 'Custo acima do executado', cor: idc == null ? undefined : idc >= 1 ? VERDE : VERM },
    { k: 'idp', ajuda: 'projetos.cockpit.idp', l: 'IDP · prazo', v: idp == null ? '—' : idp.toFixed(2), sub: idp == null ? 'Precisa de data de início, data prevista e avanço físico' : idp >= 1 ? 'No ritmo ou adiantada' : 'Ritmo abaixo do planejado', cor: idp == null ? undefined : idp >= 1 ? VERDE : VERM },
    { k: 'burn', ajuda: 'projetos.cockpit.burn_rate', l: 'Gasto por dia', v: burn == null ? '—' : brl(burn), sub: burn == null ? 'Precisa de data de início e custo lançado' : `${decorridos} dia(s) desde o início` },
  ]

  const cards: Card[] = r ? [
    { k: 'receita', ajuda: 'projetos.cockpit.receita', l: 'Receita realizada', v: brl(receita), sub: receita > 0 ? 'Medido e vendido na obra' : 'Nenhuma medição lançada ainda', linhas: [
      { k: 'serv', ajuda: 'projetos.cockpit.receita_servico', l: 'Serviço medido', v: Number(r.receita_servico) },
      { k: 'mat', ajuda: 'projetos.cockpit.receita_material', l: 'Material vendido', v: Number(r.receita_material) }] },
    { k: 'custo', ajuda: 'projetos.cockpit.custo', l: 'Custo realizado', v: brl(custo), sub: custoPrevisto > 0 ? `Previsto ${brl(custoPrevisto)}` : 'Sem custo previsto', cor: estouro ? VERM : undefined, linhas: [
      { k: 'mat', ajuda: 'projetos.cockpit.custo_material', l: 'Material', v: Number(r.custo_material) },
      { k: 'via', ajuda: 'projetos.cockpit.custo_viagens', l: 'Viagens', v: Number(r.custo_viagens) },
      { k: 'mo', ajuda: 'projetos.cockpit.custo_mao_obra', l: 'Mão de obra', v: Number(r.custo_mao_obra ?? 0) },
      { k: 'rat', ajuda: 'projetos.cockpit.custo_rateio', l: 'Rateio', v: Number(r.custo_rateio ?? 0) }] },
    { k: 'margem', ajuda: 'projetos.cockpit.margem', l: 'Margem', v: brl(margem), sub: margemPct == null ? (custo > 0 ? 'Custo lançado, mas sem medição: a margem fica negativa até medir' : 'Sem receita ainda') : `${margemPct.toFixed(1)}% da receita`, cor: margem < 0 ? VERM : VERDE },
    { k: 'avanco_fisico', ajuda: 'projetos.cockpit.avanco_fisico', l: 'Avanço físico', v: fisicoPct == null ? '—' : `${fisicoPct.toFixed(0)}%`, sub: fisicoPct == null ? 'Lance o % no cronograma' : 'Execução em campo', bar: fisicoPct },
    { k: 'avanco', ajuda: 'projetos.cockpit.avanco', l: 'Avanço financeiro', v: avancoPct == null ? '—' : `${avancoPct.toFixed(0)}%`, sub: `Realizado ${brl(receita)} de ${brl(r.receita_prevista)}`, bar: avancoPct },
    { k: 'prazo', ajuda: 'projetos.cockpit.prazo', l: 'Prazo', v: prazoBR ?? '—', sub: prazoSub, cor: prazoVencido ? VERM : undefined, bar: tempoPct },
  ] : []

  const pendencias: string[] = []
  if (r) {
    if (Number(r.receita_prevista) === 0) pendencias.push('Obra sem itens contratados — cadastre o orçamento para medir o avanço.')
    if (estouro) pendencias.push(`Custo realizado acima do previsto (${brl(custo)} de ${brl(custoPrevisto)}).`)
    if (margem < 0) pendencias.push(receita === 0
      ? 'Margem negativa porque há custo lançado e nenhuma medição — lance a medição da obra.'
      : 'Margem negativa — o custo lançado superou a receita medida; revise custos.')
    if (prazoVencido) pendencias.push(`Prazo vencido em ${prazoBR} — replaneje a entrega ou ajuste a data.`)
    // Desvio físico × financeiro: alerta só quando a diferença é relevante (≥ 15 pontos) e há os dois números.
    if (fisicoPct != null && avancoPct != null && Math.abs(fisicoPct - avancoPct) >= 15) {
      pendencias.push(fisicoPct > avancoPct
        ? `Execução à frente do faturamento (físico ${fisicoPct.toFixed(0)}% × financeiro ${avancoPct.toFixed(0)}%) — há medição a lançar.`
        : `Faturamento à frente da execução (financeiro ${avancoPct.toFixed(0)}% × físico ${fisicoPct.toFixed(0)}%) — confira o avanço em campo.`)
    }
  }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }} data-testid="hub-cockpit-obra">
        <Link href="/dashboard/projetos/obras?area=hub" style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Obras</Link>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 8 }}>Hub · Obra</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, color: ESP, margin: '2px 0 2px' }}>
          Cockpit {r ? `· ${r.numero}${r.nome ? ` — ${r.nome}` : ''}` : ''}
        </h1>
        {r && (info?.cliente_nome || info?.cidade) && (
          <div style={{ fontSize: 13, color: MUT, margin: '0 0 12px' }}>{[info?.cliente_nome, info?.cidade].filter(Boolean).join(' · ')}</div>
        )}
        {r && !(info?.cliente_nome || info?.cidade) && <div style={{ margin: '0 0 12px' }} />}
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
                    {c.bar != null && (
                      <div style={{ height: 6, background: LINE, borderRadius: 999, margin: '2px 0 6px' }}>
                        <div style={{ width: `${Math.max(0, Math.min(100, c.bar))}%`, height: '100%', background: GOLD, borderRadius: 999 }} />
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: MUT }}>{c.sub}</div>
                    {c.linhas && (
                      <div style={{ marginTop: 8, borderTop: `0.5px solid ${LINE}`, paddingTop: 6 }}>
                        {c.linhas.map((l) => (
                          <div key={l.k} data-testid={`cockpit-${c.k}-${l.k}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: MUT, padding: '2px 0' }}>
                            <span>{l.l} <AjudaCampo chave={l.ajuda} rota={ROTA} /></span><span>{brl(l.v)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 14 }}>
                {indicadores.map((c) => (
                  <div key={c.k} data-testid={`cockpit-${c.k}`} style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
                    <div style={{ fontSize: 11, color: MUT, textTransform: 'uppercase', letterSpacing: 0.5 }}>{c.l} <AjudaCampo chave={c.ajuda} rota={ROTA} /></div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: c.cor ?? ESP, margin: '4px 0' }}>{c.v}</div>
                    <div style={{ fontSize: 11, color: MUT }}>{c.sub}</div>
                  </div>
                ))}
                <div data-testid="cockpit-curva-s" style={{ background: '#fff', border: `0.5px dashed ${LINE}`, borderRadius: 12, padding: 14 }}>
                  <div style={{ fontSize: 11, color: MUT, textTransform: 'uppercase', letterSpacing: 0.5 }}>Curva S <AjudaCampo chave="projetos.cockpit.curva_s" rota={ROTA} /></div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: ESP, margin: '6px 0' }}>Em construção</div>
                  <div style={{ fontSize: 11, color: MUT }}>Previsto × realizado acumulado entra quando o cronograma tiver medições mensais.</div>
                </div>
              </div>
              <div data-testid="cockpit-pendencias" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: ESP, marginBottom: 6 }}>Pendências do dia <AjudaCampo chave="projetos.cockpit.pendencias" rota={ROTA} /></div>
                {pendencias.length === 0
                  ? <div style={{ fontSize: 12, color: VERDE }}>Nenhuma pendência. Obra em ordem.</div>
                  : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: ESP }}>{pendencias.map((p) => <li key={p}>{p}</li>)}</ul>}
              </div>
              <Link href={`/dashboard/projetos/obras/${id}/horas?area=hub`} data-testid="link-lancar-horas" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none', marginRight: 12 }}>Lançar horas →</Link><AjudaCampo chave="projetos.cockpit.lancar_horas" rota={ROTA} />
              <Link href={`/dashboard/projetos/obras/os?obra=${id}&area=hub`} data-testid="link-os-obra" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none', marginRight: 12 }}>Ordens de serviço →</Link><AjudaCampo chave="projetos.cockpit.os" rota={ROTA} />
              <Link href={`/dashboard/projetos/obras/${id}/linha-do-tempo?area=hub`} style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Ver linha do tempo →</Link><AjudaCampo chave="projetos.cockpit.linha_tempo" rota={ROTA} />
              <Link href={`/dashboard/projetos/obras/${id}/cronograma?area=hub`} style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none', marginLeft: 14 }}>Ver cronograma →</Link><AjudaCampo chave="projetos.cockpit.cronograma" rota={ROTA} />
              <Link href={`/dashboard/projetos/viagens?obra=${id}&area=hub`} data-testid="link-nova-viagem" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none', marginLeft: 14 }}>Nova viagem desta obra →</Link><AjudaCampo chave="projetos.cockpit.nova_viagem" rota={ROTA} />
              <Link href={`/dashboard/projetos/obras/${id}/encerramento?area=hub`} data-testid="link-encerramento-obra" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none', marginLeft: 14 }}>Encerramento da obra →</Link><AjudaCampo chave="projetos.cockpit.encerramento" rota={ROTA} />
              <Link href={`/dashboard/projetos/obras/${id}/relatorio?area=hub`} data-testid="link-relatorio-cliente" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none', marginLeft: 14 }}>Relatório ao cliente →</Link><AjudaCampo chave="projetos.cockpit.relatorio" rota={ROTA} />
            </>
          )}
      </div>
    </div>
  )
}
