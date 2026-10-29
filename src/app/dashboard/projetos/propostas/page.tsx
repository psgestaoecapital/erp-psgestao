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
// HB0 (auditor F15 · proposta → obra): coluna "Obra" com número, nome e situação da obra que nasceu da proposta
// (obra_id ou projetos_obras.orcamento_id, regra única em obraPorProposta); ganha sem obra fica em destaque; indicador
// "Ganhas com obra".
// HB0 (auditor F15 · BDI visível): coluna "BDI" com o BDI aplicado (médio ponderado pelo custo dos itens) contra o BDI
// padrão da empresa (projetos_modulo_config); abaixo do padrão em vermelho; indicador "BDI no padrão". Regra em situacaoBdi.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { fmtR } from '@/lib/psgc-tokens'
import { supabase } from '@/lib/supabase'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { composicaoPorProposta, diasParaVencer, ganhasComObra, situacaoBdi, obraPorProposta, origemPorProposta, resumoFunil, temOrigem, ABERTAS, type Composicao, type ObraVinculo, type SituacaoObra, type ItemProposta, type OportunidadeVinculo, type Origem, type PlantaVinculo, type VisitaVinculo } from '@/lib/hub/propostas'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'

const STATUS: Record<string, { cor: string; label: string }> = {
  rascunho: { cor: '#9C8E80', label: 'Rascunho' }, enviado: { cor: '#3B82F6', label: 'Enviado' },
  visualizado: { cor: '#8B5CF6', label: 'Visualizado' }, aprovado: { cor: '#16A34A', label: 'Aprovado' },
  recusado: { cor: '#B91C1C', label: 'Recusado' }, expirado: { cor: '#F59E0B', label: 'Expirado' },
  convertido: { cor: GOLD, label: 'Virou pedido' },
}

type Proposta = { id: string; company_id: string; numero: string | null; cliente_nome: string | null; status: string; total: number | null; data_emissao: string | null; data_validade: string | null; obra_id: string | null; eh_obra: boolean | null; versao: number | null; orcamento_origem_id: string | null; pdf_anexo_path: string | null }

const POR_PAGINA = 25, LIMITE = 100

const OBRA_STATUS: Record<string, string> = { em_andamento: 'em andamento', pausada: 'pausada', concluida: 'concluída', cancelada: 'cancelada' }

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
  const [obras, setObras] = useState<Record<string, SituacaoObra>>({})
  const [obraErro, setObraErro] = useState(false)
  const [bdiPadrao, setBdiPadrao] = useState<Record<string, number | null>>({})
  const [excluir, setExcluir] = useState<Proposta | null>(null)
  const [motivo, setMotivo] = useState('')
  const [excluindo, setExcluindo] = useState(false)
  const [totalBanco, setTotalBanco] = useState(0)
  const [mostrar, setMostrar] = useState(POR_PAGINA)
  const [msg, setMsg] = useState('')
  const [msgErro, setMsgErro] = useState('')

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
      const { data, error, count } = await comPrazo(
        async () => await supabase.from('erp_orcamentos').select('id,company_id,numero,cliente_nome,status,total,data_emissao,data_validade,obra_id,eh_obra,versao,orcamento_origem_id,pdf_anexo_path', { count: 'exact' })
          .in('company_id', companyIds).is('deleted_at', null).order('data_emissao', { ascending: false }).limit(LIMITE),
        { ms: 8000, tentativas: 1, label: 'propostas_hub' },
      )
      if (error) { setErro(erroAmigavel(error, 'Não foi possível carregar as propostas.')); return }
      const ls = (data ?? []) as Proposta[]
      setLinhas(ls); setTotalBanco(typeof count === 'number' ? count : ls.length); setMostrar(POR_PAGINA)
      // Composição: uma consulta só para os itens da lista. Se falhar, a lista segue e a coluna avisa (sem inventar número).
      setCompErro(false); setComp({})
      if (ls.length) {
        const it = await comPrazo(
          async () => await supabase.from('erp_orcamentos_itens').select('orcamento_id,quantidade,preco_custo,subtotal,servico_id,produto_id,bdi_percentual')
            .in('orcamento_id', ls.map(l => l.id)),
          { ms: 8000, tentativas: 1, label: 'propostas_hub_itens' },
        ).catch(() => ({ data: null, error: true }))
        if (it.error) setCompErro(true)
        else setComp(composicaoPorProposta((it.data ?? []) as ItemProposta[]))
        // BDI padrão da empresa (o mesmo que o editor aplica ao incluir item). Falha → só não compara (sem acusar).
        const cfg = await comPrazo(
          async () => await supabase.from('projetos_modulo_config').select('company_id,bdi_total_pct').in('company_id', companyIds),
          { ms: 8000, tentativas: 1, label: 'propostas_hub_bdi' },
        ).catch(() => ({ data: null, error: true }))
        const mapa: Record<string, number | null> = {}
        if (!cfg.error) for (const c of (cfg.data ?? []) as { company_id: string; bdi_total_pct: number | null }[]) mapa[c.company_id] = c.bdi_total_pct == null ? null : Number(c.bdi_total_pct)
        setBdiPadrao(mapa)
      }
      // Obra: pelos dois lados do vínculo (obra_id da proposta ou orcamento_id da obra). Falha → coluna avisa.
      setObraErro(false); setObras({})
      if (ls.length) {
        const ids = ls.map(l => l.id), obraIds = ls.map(l => l.obra_id).filter((x): x is string => !!x)
        const filtroObra = [`orcamento_id.in.(${ids.join(',')})`, ...(obraIds.length ? [`id.in.(${obraIds.join(',')})`] : [])].join(',')
        const ob = await comPrazo(
          async () => await supabase.from('projetos_obras').select('id,numero,nome,status,orcamento_id').in('company_id', companyIds).or(filtroObra),
          { ms: 8000, tentativas: 1, label: 'propostas_hub_obras' },
        ).catch(() => ({ data: null, error: true }))
        if (ob.error) setObraErro(true)
        else setObras(obraPorProposta(ls, (ob.data ?? []) as ObraVinculo[]))
      }
      setOrigErro(false); setOrig({})
      if (ls.length) await carregarOrigem(ls.map(l => l.id))
    } catch { setErro(MSG_CARREGAMENTO_FALHOU) } finally { setLoading(false) }
  }, [companyIds, carregarOrigem])
  useEffect(() => { carregar() }, [carregar])

  // Só proposta que não virou negócio pode sair (o banco confere de novo)
  const podeExcluir = (l: Proposta) => ['rascunho', 'enviado', 'visualizado', 'recusado', 'expirado'].includes(l.status) && !l.obra_id
  async function confirmarExclusao() {
    if (!excluir) return
    if (motivo.trim().length < 3) { setMsgErro('Informe o motivo da exclusão.'); return }
    setExcluindo(true); setMsgErro('')
    const { error } = await supabase.rpc('fn_proposta_excluir', { p_orcamento_id: excluir.id, p_motivo: motivo })
    setExcluindo(false)
    if (error) { setMsgErro(erroAmigavel(error, 'Não foi possível excluir a proposta.')); return }
    setMsg(`Proposta ${excluir.numero ?? ''} excluída (fica guardada na auditoria).`)
    setExcluir(null); setMotivo(''); void carregar()
  }

  const vis = useMemo(() => {
    const b = busca.trim().toLowerCase()
    return linhas.filter(l => (filtro === 'todos' || l.status === filtro)
      && (!b || (l.numero ?? '').toLowerCase().includes(b) || (l.cliente_nome ?? '').toLowerCase().includes(b)))
  }, [linhas, busca, filtro])
  const r = useMemo(() => resumoFunil(linhas), [linhas])
  const numeroPorId = useMemo(() => Object.fromEntries(linhas.map(l => [l.id, l.numero])) as Record<string, string | null>, [linhas])
  const comPdf = useMemo(() => linhas.filter(l => !!l.pdf_anexo_path).length, [linhas])
  const revisoes = useMemo(() => linhas.filter(l => (l.versao ?? 1) > 1 || !!l.orcamento_origem_id).length, [linhas])
  const comOrigem = useMemo(() => linhas.filter(l => temOrigem(orig[l.id])).length, [linhas, orig])
  const gObra = useMemo(() => ganhasComObra(obras, linhas), [obras, linhas])
  const bdiConta = useMemo(() => {
    let comparaveis = 0, noPadrao = 0
    for (const l of linhas) {
      const sit = situacaoBdi(comp[l.id]?.bdiPct ?? null, bdiPadrao[l.company_id])
      if (sit) { comparaveis++; if (sit !== 'abaixo') noPadrao++ }
    }
    return { comparaveis, noPadrao }
  }, [linhas, comp, bdiPadrao])
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

      {msg && <div role="status" style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, fontSize: 12.5, background: '#EAF5EE', color: '#16A34A', border: `0.5px solid ${LINE}` }}>{msg}</div>}
      {excluir && (
        <div onClick={() => setExcluir(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8vh 12px' }}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Excluir proposta" style={{ background: BG, borderRadius: 14, width: '100%', maxWidth: 460, padding: 18 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Excluir proposta {excluir.numero}</div>
            <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>Sai da lista, mas não é apagada: ficam registrados quem excluiu, quando e o motivo.</div>
            <label style={{ display: 'block', marginTop: 10 }}>
              <span style={{ fontSize: 11, color: MUT, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 2, marginBottom: 3 }}>Motivo da exclusão<AjudaCampo chave="projetos.propostas.motivo_exclusao" /></span>
              <input data-testid="hub-proposta-excluir-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: proposta em duplicidade" style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13, border: `1px solid ${LINE}`, borderRadius: 8 }} />
            </label>
            {msgErro && <div role="alert" style={{ color: '#B91C1C', fontSize: 12.5, marginTop: 8 }}>{msgErro}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button onClick={() => setExcluir(null)} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>Cancelar</button>
              <button data-testid="hub-proposta-excluir-confirmar" onClick={() => void confirmarExclusao()} disabled={excluindo} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#B91C1C', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', opacity: excluindo ? 0.6 : 1 }}>{excluindo ? 'Excluindo…' : 'Excluir proposta'}</button>
            </div>
          </div>
        </div>
      )}
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
            <div style={{ ...card, borderColor: !obraErro && gObra.comObra < gObra.ganhas ? '#F59E0B' : LINE }}>
              <div style={{ fontSize: 11, color: MUT, display: 'flex', alignItems: 'center', gap: 4 }}>Ganhas com obra <AjudaCampo chave="projetos.propostas.ganhas_com_obra" /></div>
              <div data-testid="hub-propostas-ganhas-com-obra" style={{ fontSize: 18, fontWeight: 700 }}>{obraErro ? '—' : `${gObra.comObra} de ${gObra.ganhas}`}</div>
              <div style={{ fontSize: 12, color: MUT }}>{obraErro ? 'obras indisponíveis agora' : gObra.comObra < gObra.ganhas ? `${gObra.ganhas - gObra.comObra} aprovada(s) ainda sem obra` : 'toda proposta ganha já é obra'}</div>
            </div>
            <div style={{ ...card, borderColor: !compErro && bdiConta.noPadrao < bdiConta.comparaveis ? '#F59E0B' : LINE }}>
              <div style={{ fontSize: 11, color: MUT, display: 'flex', alignItems: 'center', gap: 4 }}>BDI no padrão <AjudaCampo chave="projetos.propostas.bdi_no_padrao" /></div>
              <div data-testid="hub-propostas-bdi-no-padrao" style={{ fontSize: 18, fontWeight: 700 }}>{compErro || !bdiConta.comparaveis ? '—' : `${bdiConta.noPadrao} de ${bdiConta.comparaveis}`}</div>
              <div style={{ fontSize: 12, color: MUT }}>{compErro ? 'itens indisponíveis agora' : !bdiConta.comparaveis ? 'configure o BDI padrão em Configurações' : bdiConta.noPadrao < bdiConta.comparaveis ? `${bdiConta.comparaveis - bdiConta.noPadrao} abaixo do BDI padrão` : 'nenhuma abaixo do BDI padrão'}</div>
            </div>
            <div style={card}>
              <div style={{ fontSize: 11, color: MUT, display: 'flex', alignItems: 'center', gap: 4 }}>Com PDF anexo <AjudaCampo chave="projetos.propostas.com_pdf" /></div>
              <div data-testid="hub-propostas-com-pdf" style={{ fontSize: 18, fontWeight: 700 }}>{comPdf} de {r.total}</div>
              <div style={{ fontSize: 12, color: MUT }}>propostas com o PDF guardado</div>
            </div>
            <div style={card}>
              <div style={{ fontSize: 11, color: MUT, display: 'flex', alignItems: 'center', gap: 4 }}>Revisões <AjudaCampo chave="projetos.propostas.revisoes" /></div>
              <div data-testid="hub-propostas-revisoes" style={{ fontSize: 18, fontWeight: 700 }}>{revisoes}</div>
              <div style={{ fontSize: 12, color: MUT }}>propostas que são nova versão de outra</div>
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
                  <button key={k} type="button" data-testid="hub-propostas-funil-etapa" aria-pressed={ativo} onClick={() => { setFiltro(ativo ? 'todos' : k); setMostrar(POR_PAGINA) }}
                    style={{ border: `1px solid ${ativo ? v.cor : LINE}`, background: ativo ? `${v.cor}14` : '#fff', borderRadius: 999, padding: '6px 12px', fontSize: 12, color: ESP, cursor: 'pointer', minHeight: 36 }}>
                    <span style={{ color: v.cor, fontWeight: 700 }}>{v.label}</span> · {r.porStatus[k].n} · {fmtR(r.porStatus[k].valor)}
                  </button>
                )
              })}
            </div>
          </div>
          {totalBanco > linhas.length && <div role="status" data-testid="hub-propostas-truncado" style={{ marginTop: 12, fontSize: 12, color: '#B45309' }}>Mostrando as {linhas.length} mais recentes de {totalBanco} propostas — os indicadores valem para estas.</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
            <div style={{ flex: '1 1 220px', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input value={busca} onChange={e => { setBusca(e.target.value); setMostrar(POR_PAGINA) }} placeholder="Buscar por número ou cliente"
                style={{ flex: 1, padding: '8px 12px', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 13 }} />
              <AjudaCampo chave="projetos.propostas.busca" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <select value={filtro} onChange={e => { setFiltro(e.target.value); setMostrar(POR_PAGINA) }} style={{ padding: '8px 12px', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 13 }}>
                <option value="todos">Todos os status</option>
                {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <AjudaCampo chave="projetos.propostas.status" />
            </div>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 12, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12 }}>
            <table style={{ width: '100%', minWidth: 1220, borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left', fontSize: 12, color: MUT }}>
                <th style={{ padding: '8px 12px' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Número <AjudaCampo chave="projetos.propostas.col_numero" /></span></th><th style={{ padding: '8px 12px' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Versão <AjudaCampo chave="projetos.propostas.versao" /></span></th><th style={{ padding: '8px 12px' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Cliente <AjudaCampo chave="projetos.propostas.col_cliente" /></span></th>
                <th style={{ padding: '8px 12px' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Origem <AjudaCampo chave="projetos.propostas.origem" /></span></th>
                <th style={{ padding: '8px 12px' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Status <AjudaCampo chave="projetos.propostas.col_status" /></span></th><th style={{ padding: '8px 12px' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Emissão <AjudaCampo chave="projetos.propostas.col_emissao" /></span></th>
                <th style={{ padding: '8px 12px' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Validade <AjudaCampo chave="projetos.propostas.validade" /></span></th>
                <th style={{ padding: '8px 12px' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Itens <AjudaCampo chave="projetos.propostas.composicao" /></span></th>
                <th style={{ padding: '8px 12px', textAlign: 'right' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Margem <AjudaCampo chave="projetos.propostas.margem" /></span></th>
                <th style={{ padding: '8px 12px', textAlign: 'right' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>BDI <AjudaCampo chave="projetos.propostas.bdi" /></span></th>
                <th style={{ padding: '8px 12px', textAlign: 'right' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Total <AjudaCampo chave="projetos.propostas.col_total" /></span></th>
                <th style={{ padding: '8px 12px' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Obra <AjudaCampo chave="projetos.propostas.obra" /></span></th>
                <th style={{ padding: '8px 12px', position: 'sticky', right: 0, background: '#fff', boxShadow: `-1px 0 0 ${LINE}` }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Ações <AjudaCampo chave="projetos.propostas.acoes" /></span></th>
              </tr></thead>
              <tbody>
                {vis.slice(0, mostrar).map(l => {
                  const st = STATUS[l.status] ?? { cor: MUT, label: l.status }
                  const dias = ABERTAS.includes(l.status as typeof ABERTAS[number]) ? diasParaVencer(l.data_validade) : null
                  const corVal = dias === null ? ESP : dias < 0 ? '#B91C1C' : dias <= 7 ? '#B45309' : ESP
                  const c = comp[l.id]
                  const o = orig[l.id]
                  const so = obras[l.id]
                  return (
                    <tr key={l.id} style={{ borderTop: `1px solid ${LINE}`, fontSize: 13 }}>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: GOLD, fontWeight: 600 }}>{l.numero ?? '—'}</td>
                      <td style={{ padding: '8px 12px', fontSize: 12 }} data-testid="hub-proposta-versao">
                        <span style={{ fontWeight: 600 }}>v{l.versao ?? 1}</span>
                        {l.orcamento_origem_id && <span style={{ display: 'block', color: MUT }}>revisão de {numeroPorId[l.orcamento_origem_id] ?? 'proposta anterior'}</span>}
                        {l.pdf_anexo_path && <span data-testid="hub-proposta-pdf" style={{ display: 'block', color: '#16A34A' }}>PDF anexo</span>}
                      </td>
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
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, whiteSpace: 'nowrap' }} data-testid="hub-proposta-bdi">
                        {compErro || !c ? '—' : c.bdiPct === null ? <span style={{ color: '#B45309' }}>sem BDI</span> : (() => {
                          const padrao = bdiPadrao[l.company_id], sit = situacaoBdi(c.bdiPct, padrao)
                          return (
                            <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                              <span style={{ fontWeight: 600, color: sit === 'abaixo' ? '#B91C1C' : ESP }}>{pct(c.bdiPct)}</span>
                              {sit === 'abaixo' && <span data-testid="hub-proposta-bdi-abaixo" style={{ color: '#B91C1C', fontSize: 11 }}>abaixo do padrão {pct(Number(padrao))}</span>}
                              {sit === 'acima' && <span style={{ color: MUT, fontSize: 11 }}>padrão {pct(Number(padrao))}</span>}
                              {c.semBdi > 0 && <span style={{ color: '#B45309', fontSize: 11 }}>{c.semBdi} item(ns) sem BDI</span>}
                            </span>
                          )
                        })()}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmtR(Number(l.total ?? 0))}</td>
                      <td style={{ padding: '8px 12px', fontSize: 12, maxWidth: 200 }} data-testid="hub-proposta-obra-situacao">
                        {obraErro || !so ? '—' : so.tipo === 'obra' ? (
                          <Link href={`/dashboard/projetos/obras/${so.obra.id}`} data-testid="hub-proposta-obra" style={{ color: ESP, display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 600 }}>{so.obra.numero}{so.obra.nome ? ` · ${so.obra.nome}` : ''}</span>
                            {so.obra.status && <span style={{ color: MUT }}>{OBRA_STATUS[so.obra.status] ?? so.obra.status}</span>}
                          </Link>
                        ) : so.tipo === 'sem_obra' ? <span data-testid="hub-proposta-sem-obra" style={{ color: '#B45309', fontWeight: 600 }}>aprovada sem obra</span>
                          : so.tipo === 'nao_e_obra' ? <span style={{ color: MUT }}>não é obra</span>
                          : <span style={{ color: MUT }}>vira obra ao aprovar</span>}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap', position: 'sticky', right: 0, background: '#fff', boxShadow: `-1px 0 0 ${LINE}` }}>
                        <Link href={`/dashboard/orcamentos?id=${l.id}`} data-testid="hub-proposta-abrir" style={{ color: GOLD, fontWeight: 600, fontSize: 12 }}>Abrir</Link>
                        <AjudaCampo chave="projetos.propostas.editar" />
                        <Link href="/dashboard/projetos/calculadora" data-testid="hub-proposta-calculadora" style={{ marginLeft: 10, color: ESP, fontWeight: 600, fontSize: 12 }}>Calculadora</Link>
                        <AjudaCampo chave="projetos.propostas.calculadora" />
                        {podeExcluir(l) && (
                          <>
                            <button data-testid="hub-proposta-excluir" onClick={() => { setExcluir(l); setMotivo(''); setMsgErro('') }} style={{ marginLeft: 10, color: '#B91C1C', fontWeight: 600, fontSize: 12, background: 'none', border: 0, cursor: 'pointer', padding: 0 }}>Excluir</button>
                            <AjudaCampo chave="projetos.propostas.excluir" />
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {vis.length === 0 && <tr><td colSpan={13} style={{ padding: 16, color: MUT, fontSize: 13 }}>Nenhuma proposta com esse filtro.</td></tr>}
              </tbody>
            </table>
          </div>
          {vis.length > mostrar && (
            <div style={{ marginTop: 12, textAlign: 'center' }}>
              <button type="button" data-testid="hub-propostas-mostrar-mais" onClick={() => setMostrar(m => m + POR_PAGINA)} style={{ padding: '8px 18px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', color: ESP }}>
                Mostrar mais ({vis.length - mostrar} restantes)
              </button>
              <AjudaCampo chave="projetos.propostas.mostrar_mais" />
            </div>
          )}
        </>
      )}
    </div>
  )
}
