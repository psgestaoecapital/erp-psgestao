'use client'

// HB2 · Propostas dentro do Hub (RD-52: mesma fonte erp_orcamentos, sem 2ª lista). Antes redirecionava para
// /dashboard/orcamentos e o usuário "saía" do Hub. Agora a lista, o funil e a busca vivem aqui; criar/editar
// continua no editor completo (1 toque; "Abrir" leva o ?id= e o editor abre a proposta escolhida). Só leitura. 3 estados: erro / vazio (ensina) / dados.
// HB0 (auditor F15): funil honesto por situação (toque filtra), taxa de aprovação, propostas que vencem em 7 dias,
// emissão/validade/obra na lista; no celular a lista rola dentro do cartão; erro do banco nunca vai cru (erroAmigavel).
// HB0 (auditor F15 · itens reais): cada proposta mostra a composição — itens, quantos do catálogo, custo e margem dos
// itens (sem custo informado = "sem custo", nunca 100%). Regra única em composicaoProposta.
// HB0 (auditor F15 · origem): coluna "Origem" — oportunidade, visitas e plantas do take-off que levaram à proposta, pelos
// vínculos que já existem no banco (regra única em origemPorProposta); indicador "Origem rastreada". Sem vínculo = "avulsa".
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { fmtR } from '@/lib/psgc-tokens'
import { supabase } from '@/lib/supabase'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { composicaoPorProposta, diasParaVencer, origemPorProposta, resumoFunil, temOrigem, ABERTAS, type Composicao, type ItemProposta, type OportunidadeVinculo, type Origem, type PlantaVinculo, type VisitaVinculo } from '@/lib/hub/propostas'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'

const STATUS: Record<string, { cor: string; label: string }> = {
  rascunho: { cor: '#9C8E80', label: 'Rascunho' }, enviado: { cor: '#3B82F6', label: 'Enviado' },
  visualizado: { cor: '#8B5CF6', label: 'Visualizado' }, aprovado: { cor: '#16A34A', label: 'Aprovado' },
  recusado: { cor: '#B91C1C', label: 'Recusado' }, expirado: { cor: '#F59E0B', label: 'Expirado' },
  convertido: { cor: GOLD, label: 'Virou pedido' },
}

type Proposta = { id: string; numero: string | null; cliente_nome: string | null; status: string; total: number | null; data_emissao: string | null; data_validade: string | null; obra_id: string | null }

const pct = (v: number) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`

const dataBR = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—')

export default function PropostasHubPage() {
  const { companyIds } = useCompanyIds()
  const [linhas, setLinhas] = useState<Proposta[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [comp, setComp] = useState<Record<string, Composicao>>({})
  const [compErro, setCompErro] = useState(false)
  const [orig, setOrig] = useState<Record<string, Origem>>({})
  const [origErro, setOrigErro] = useState(false)

  // Origem: oportunidades e plantas ligadas às propostas; depois as visitas (diretas ou da oportunidade). Falha → coluna avisa.
  const carregarOrigem = useCallback(async (ids: string[]) => {
    const op = { ms: 8000, tentativas: 1 }
    try {
      const [o, p] = await Promise.all([
        comPrazo(async () => await supabase.from('erp_crm_oportunidade').select('id,titulo,orcamento_id').in('orcamento_id', ids).is('deleted_at', null), { ...op, label: 'propostas_hub_oport' }),
        comPrazo(async () => await supabase.from('erp_obra_planta').select('id,nome,orcamento_id').in('orcamento_id', ids), { ...op, label: 'propostas_hub_plantas' }),
      ])
      if (o.error || p.error) { setOrigErro(true); return }
      const ops = (o.data ?? []) as OportunidadeVinculo[]
      const filtroVis = [`gerou_orcamento_id.in.(${ids.join(',')})`, ...(ops.length ? [`oportunidade_id.in.(${ops.map(x => x.id).join(',')})`] : [])].join(',')
      const v = await comPrazo(async () => await supabase.from('erp_crm_visita').select('id,oportunidade_id,gerou_orcamento_id').or(filtroVis), { ...op, label: 'propostas_hub_visitas' })
      if (v.error) { setOrigErro(true); return }
      setOrig(origemPorProposta(ops, (v.data ?? []) as VisitaVinculo[], (p.data ?? []) as PlantaVinculo[]))
    } catch { setOrigErro(true) }
  }, [])

  const carregar = useCallback(async () => {
    if (!companyIds?.length) { setLoading(false); return }
    setLoading(true); setErro('')
    try {
      const { data, error } = await comPrazo(
        async () => await supabase.from('erp_orcamentos').select('id,numero,cliente_nome,status,total,data_emissao,data_validade,obra_id')
          .in('company_id', companyIds).order('data_emissao', { ascending: false }).limit(100),
        { ms: 8000, tentativas: 1, label: 'propostas_hub' },
      )
      if (error) { setErro(erroAmigavel(error, 'Não foi possível carregar as propostas.')); return }
      const ls = (data ?? []) as Proposta[]
      setLinhas(ls)
      // Composição: uma consulta só para os itens da lista. Se falhar, a lista segue e a coluna avisa (sem inventar número).
      setCompErro(false); setComp({})
      if (ls.length) {
        const it = await comPrazo(
          async () => await supabase.from('erp_orcamentos_itens').select('orcamento_id,quantidade,preco_custo,subtotal,servico_id,produto_id')
            .in('orcamento_id', ls.map(l => l.id)),
          { ms: 8000, tentativas: 1, label: 'propostas_hub_itens' },
        ).catch(() => ({ data: null, error: true }))
        if (it.error) setCompErro(true)
        else setComp(composicaoPorProposta((it.data ?? []) as ItemProposta[]))
      }
      setOrigErro(false); setOrig({})
      if (ls.length) await carregarOrigem(ls.map(l => l.id))
    } catch { setErro(MSG_CARREGAMENTO_FALHOU) } finally { setLoading(false) }
  }, [companyIds, carregarOrigem])
  useEffect(() => { carregar() }, [carregar])

  const vis = useMemo(() => {
    const b = busca.trim().toLowerCase()
    return linhas.filter(l => (filtro === 'todos' || l.status === filtro)
      && (!b || (l.numero ?? '').toLowerCase().includes(b) || (l.cliente_nome ?? '').toLowerCase().includes(b)))
  }, [linhas, busca, filtro])
  const r = useMemo(() => resumoFunil(linhas), [linhas])
  const comOrigem = useMemo(() => linhas.filter(l => temOrigem(orig[l.id])).length, [linhas, orig])
  const comCatalogo = useMemo(() => linhas.filter(l => { const c = comp[l.id]; return c && c.itens > 0 && c.doCatalogo === c.itens }).length, [linhas, comp])

  const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 16px', flex: '1 1 160px' }
  return (
    <div data-testid="hub-propostas" style={{ background: BG, color: ESP, padding: 20, minHeight: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Propostas</h1>
          <div style={{ fontSize: 12, color: MUT }}>Propostas (orçamentos) enviadas aos clientes — do rascunho ao pedido.</div>
        </div>
        <Link href="/dashboard/orcamentos" style={{ background: GOLD, color: '#fff', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>+ Nova proposta</Link>
      </div>

      {erro ? (
        <div role="alert" style={{ marginTop: 16, padding: 14, border: '1px solid #B91C1C', borderRadius: 10, color: '#B91C1C', fontSize: 13 }}>
          {erro} <button onClick={carregar} style={{ marginLeft: 8, textDecoration: 'underline', background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}>Tentar de novo</button>
        </div>
      ) : loading ? (
        <div style={{ marginTop: 16, color: MUT, fontSize: 13 }}>Carregando propostas…</div>
      ) : linhas.length === 0 ? (
        <div style={{ marginTop: 16, padding: 20, border: `1px dashed ${LINE}`, borderRadius: 12, fontSize: 13 }}>
          Nenhuma proposta ainda. Escolha serviços do catálogo, o preço sai do custo real e a proposta vai ao cliente por link.{' '}
          <Link href="/dashboard/orcamentos" style={{ color: GOLD, fontWeight: 600 }}>Criar a primeira proposta</Link>
        </div>
      ) : (
        <>
          <div data-testid="hub-propostas-indicadores" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
            <div style={card}>
              <div style={{ fontSize: 11, color: MUT, display: 'flex', alignItems: 'center', gap: 4 }}>Em aberto <AjudaCampo chave="projetos.propostas.em_aberto" /></div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{r.abertas}</div><div style={{ fontSize: 12, color: MUT }}>{fmtR(r.valorAberto)}</div>
            </div>
            <div style={card}>
              <div style={{ fontSize: 11, color: MUT, display: 'flex', alignItems: 'center', gap: 4 }}>Aprovadas / viraram pedido <AjudaCampo chave="projetos.propostas.aprovadas" /></div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{r.ganhas}</div><div style={{ fontSize: 12, color: MUT }}>{fmtR(r.valorGanho)}</div>
            </div>
            <div style={card}>
              <div style={{ fontSize: 11, color: MUT, display: 'flex', alignItems: 'center', gap: 4 }}>Taxa de aprovação <AjudaCampo chave="projetos.propostas.taxa_aprovacao" /></div>
              <div data-testid="hub-propostas-taxa" style={{ fontSize: 18, fontWeight: 700 }}>{r.taxaAprovacao === null ? '—' : `${r.taxaAprovacao}%`}</div>
              <div style={{ fontSize: 12, color: MUT }}>{r.taxaAprovacao === null ? 'nenhum cliente respondeu ainda' : 'das propostas já respondidas'}</div>
            </div>
            <div style={{ ...card, borderColor: r.aVencer ? '#F59E0B' : LINE }}>
              <div style={{ fontSize: 11, color: MUT, display: 'flex', alignItems: 'center', gap: 4 }}>Vencem em 7 dias <AjudaCampo chave="projetos.propostas.a_vencer" /></div>
              <div data-testid="hub-propostas-a-vencer" style={{ fontSize: 18, fontWeight: 700 }}>{r.aVencer}</div><div style={{ fontSize: 12, color: MUT }}>{fmtR(r.valorAVencer)}</div>
            </div>
            <div style={card}>
              <div style={{ fontSize: 11, color: MUT, display: 'flex', alignItems: 'center', gap: 4 }}>Itens do catálogo <AjudaCampo chave="projetos.propostas.do_catalogo" /></div>
              <div data-testid="hub-propostas-do-catalogo" style={{ fontSize: 18, fontWeight: 700 }}>{compErro ? '—' : `${comCatalogo} de ${r.total}`}</div>
              <div style={{ fontSize: 12, color: MUT }}>{compErro ? 'itens indisponíveis agora' : 'propostas com todos os itens cadastrados'}</div>
            </div>
            <div style={card}>
              <div style={{ fontSize: 11, color: MUT, display: 'flex', alignItems: 'center', gap: 4 }}>Origem rastreada <AjudaCampo chave="projetos.propostas.com_origem" /></div>
              <div data-testid="hub-propostas-com-origem" style={{ fontSize: 18, fontWeight: 700 }}>{origErro ? '—' : `${comOrigem} de ${r.total}`}</div>
              <div style={{ fontSize: 12, color: MUT }}>{origErro ? 'origem indisponível agora' : 'vieram de oportunidade, visita ou take-off'}</div>
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, color: MUT, display: 'flex', alignItems: 'center', gap: 4 }}>
              {r.total} proposta(s) · {r.abertas} em aberto — toque numa situação para filtrar <AjudaCampo chave="projetos.propostas.funil" />
            </div>
            <div data-testid="hub-propostas-funil" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {Object.entries(STATUS).filter(([k]) => r.porStatus[k]).map(([k, v]) => {
                const ativo = filtro === k
                return (
                  <button key={k} type="button" data-testid="hub-propostas-funil-etapa" aria-pressed={ativo} onClick={() => setFiltro(ativo ? 'todos' : k)}
                    style={{ border: `1px solid ${ativo ? v.cor : LINE}`, background: ativo ? `${v.cor}14` : '#fff', borderRadius: 999, padding: '6px 12px', fontSize: 12, color: ESP, cursor: 'pointer', minHeight: 36 }}>
                    <span style={{ color: v.cor, fontWeight: 700 }}>{v.label}</span> · {r.porStatus[k].n} · {fmtR(r.porStatus[k].valor)}
                  </button>
                )
              })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
            <div style={{ flex: '1 1 220px', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por número ou cliente"
                style={{ flex: 1, padding: '8px 12px', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 13 }} />
              <AjudaCampo chave="projetos.propostas.busca" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <select value={filtro} onChange={e => setFiltro(e.target.value)} style={{ padding: '8px 12px', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 13 }}>
                <option value="todos">Todos os status</option>
                {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <AjudaCampo chave="projetos.propostas.status" />
            </div>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 12, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12 }}>
            <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left', fontSize: 12, color: MUT }}>
                <th style={{ padding: '8px 12px' }}>Número</th><th style={{ padding: '8px 12px' }}>Cliente</th>
                <th style={{ padding: '8px 12px' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Origem <AjudaCampo chave="projetos.propostas.origem" /></span></th>
                <th style={{ padding: '8px 12px' }}>Status</th><th style={{ padding: '8px 12px' }}>Emissão</th>
                <th style={{ padding: '8px 12px' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Validade <AjudaCampo chave="projetos.propostas.validade" /></span></th>
                <th style={{ padding: '8px 12px' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Itens <AjudaCampo chave="projetos.propostas.composicao" /></span></th>
                <th style={{ padding: '8px 12px', textAlign: 'right' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Margem <AjudaCampo chave="projetos.propostas.margem" /></span></th>
                <th style={{ padding: '8px 12px', textAlign: 'right' }}>Total</th><th style={{ padding: '8px 12px' }} />
              </tr></thead>
              <tbody>
                {vis.map(l => {
                  const st = STATUS[l.status] ?? { cor: MUT, label: l.status }
                  const dias = ABERTAS.includes(l.status as typeof ABERTAS[number]) ? diasParaVencer(l.data_validade) : null
                  const corVal = dias === null ? ESP : dias < 0 ? '#B91C1C' : dias <= 7 ? '#B45309' : ESP
                  const c = comp[l.id]
                  const o = orig[l.id]
                  return (
                    <tr key={l.id} style={{ borderTop: `1px solid ${LINE}`, fontSize: 13 }}>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: GOLD, fontWeight: 600 }}>{l.numero ?? '—'}</td>
                      <td style={{ padding: '8px 12px' }}>{l.cliente_nome ?? '—'}</td>
                      <td style={{ padding: '8px 12px', fontSize: 12, maxWidth: 220 }} data-testid="hub-proposta-origem">
                        {origErro ? '—' : !temOrigem(o) ? <span style={{ color: MUT }}>avulsa</span> : (
                          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {o!.oportunidade && <Link href={`/dashboard/projetos/oportunidades/${o!.oportunidade.id}`} data-testid="hub-proposta-origem-oportunidade" style={{ color: ESP }}>Oportunidade: {o!.oportunidade.titulo}</Link>}
                            {o!.visitas > 0 && <Link href="/dashboard/projetos/visitas" data-testid="hub-proposta-origem-visita" style={{ color: ESP }}>{o!.visitas} visita(s) técnica(s)</Link>}
                            {o!.plantas.map(pl => <Link key={pl.id} href={`/dashboard/projetos/takeoff?planta_id=${pl.id}`} data-testid="hub-proposta-origem-planta" style={{ color: ESP }}>Take-off: {pl.nome}</Link>)}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '8px 12px' }}><span style={{ color: st.cor, fontWeight: 600 }}>{st.label}</span></td>
                      <td style={{ padding: '8px 12px' }}>{dataBR(l.data_emissao)}</td>
                      <td style={{ padding: '8px 12px', color: corVal }} data-testid="hub-proposta-validade">
                        {dataBR(l.data_validade)}{dias !== null && dias < 0 ? ' · vencida' : dias !== null && dias <= 7 ? ` · ${dias === 0 ? 'vence hoje' : `${dias} dia(s)`}` : ''}
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 12 }} data-testid="hub-proposta-itens">
                        {compErro ? '—' : !c ? <span style={{ color: '#B45309' }}>sem itens</span>
                          : <>{c.itens} item(ns){c.doCatalogo < c.itens ? <span style={{ color: '#B45309' }}> · {c.itens - c.doCatalogo} fora do catálogo</span> : ' · do catálogo'}</>}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12 }} data-testid="hub-proposta-margem">
                        {compErro || !c ? '—' : c.margemPct === null ? <span style={{ color: '#B45309' }}>sem custo</span>
                          : <span title={`Custo ${fmtR(c.custo)} de ${fmtR(c.preco)}`} style={{ color: c.margemPct < 0 ? '#B91C1C' : ESP, fontWeight: 600 }}>{pct(c.margemPct)}</span>}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmtR(Number(l.total ?? 0))}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {l.obra_id && <Link href={`/dashboard/projetos/obras/${l.obra_id}`} data-testid="hub-proposta-obra" style={{ color: ESP, fontSize: 12, marginRight: 12 }}>Obra</Link>}
                        <Link href={`/dashboard/orcamentos?id=${l.id}`} data-testid="hub-proposta-abrir" style={{ color: GOLD, fontWeight: 600, fontSize: 12 }}>Abrir</Link>
                      </td>
                    </tr>
                  )
                })}
                {vis.length === 0 && <tr><td colSpan={10} style={{ padding: 16, color: MUT, fontSize: 13 }}>Nenhuma proposta com esse filtro.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
