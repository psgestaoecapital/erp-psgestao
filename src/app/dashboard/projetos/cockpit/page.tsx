'use client'

// HB0 · Cockpit — porta de entrada do menu: escolhe a obra e abre /obras/[id]/cockpit (1 obra = abre direto).
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'

const ROTA = '/dashboard/projetos/cockpit'
// Cada situação tem cor e fundo próprios (pílula) — leitura imediata, sem tudo em dourado. Mesmo padrão da OS de obra.
const STATUS: Record<string, { rotulo: string; cor: string; fundo: string }> = {
  em_andamento: { rotulo: 'Em andamento', cor: '#92400E', fundo: 'rgba(200,148,26,0.18)' },
  concluida: { rotulo: 'Concluída', cor: '#15803D', fundo: 'rgba(21,128,61,0.12)' },
  pausada: { rotulo: 'Pausada', cor: '#6B5B4D', fundo: 'rgba(61,35,20,0.07)' },
  cancelada: { rotulo: 'Cancelada', cor: '#B91C1C', fundo: 'rgba(185,28,28,0.08)' },
}
const ATALHOS = [{ rota: 'cronograma', rotulo: 'Cronograma' }, { rota: 'horas', rotulo: 'Horas' }, { rota: 'linha-do-tempo', rotulo: 'Linha do tempo' }]
// Ordem dos grupos na lista: o que exige atenção primeiro.
const ORDEM_SITUACAO = ['em_andamento', 'pausada', 'concluida', 'cancelada']
// Código padrão visual único: tira o prefixo de empresa DEMO e padroniza (DEMO-OB-004 / DEMO-FC-001 → OB-004 / FC-001).
const codigoPadrao = (n: string) => (n ?? '').trim().toUpperCase().replace(/^DEMO-/, '')
const situacao = (s: string) => STATUS[s] ?? { rotulo: s, cor: GOLD, fundo: 'rgba(200,148,26,0.12)' }

type ObraLinha = {
  obra_id: string; numero: string; nome: string | null; status: string
  receita_prevista: number; receita_servico: number; receita_material: number
  custo_previsto: number; custo_material: number; custo_viagens: number; margem_realizada: number
  custo_mao_obra: number | null; custo_rateio: number | null; margem_alocada: number | null
}
type ObraInfo = { id: string; cliente_nome: string | null; cidade: string | null; pct_conclusao: number | null; data_prevista_fim: string | null }

const brl = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const num = (v: unknown) => Number(v) || 0

export default function CockpitEscolherObraPage() {
  const router = useRouter()
  const { companyIds } = useCompanyIds()
  const [obras, setObras] = useState<ObraLinha[]>([])
  const [info, setInfo] = useState<Record<string, ObraInfo>>({})
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [filtroCliente, setFiltroCliente] = useState('')

  useEffect(() => {
    if (!companyIds?.length) { setLoading(false); return }
    let vivo = true
    ;(async () => {
      try {
        const { data, error } = await comPrazo(
          async () => await supabase.from('v_obra_resultado_alocado')
            .select('obra_id,numero,nome,status,receita_prevista,receita_servico,receita_material,custo_previsto,custo_material,custo_viagens,margem_realizada,custo_mao_obra,custo_rateio,margem_alocada')
            .in('company_id', companyIds).order('numero', { ascending: false }),
          { ms: 8000, tentativas: 1, label: 'cockpit-obras' },
        )
        if (!vivo) return
        if (error) { setErro(error.message); return }
        let lista = (data ?? []) as ObraLinha[]
        // obra excluída (soft-delete, deleted_at) não aparece; se a consulta de apoio falhar, mantém a lista como veio
        const ids = lista.map(o => o.obra_id)
        if (ids.length) {
          const r = await supabase.from('projetos_obras').select('id,cliente_nome,cidade,pct_conclusao,data_prevista_fim').in('id', ids).is('deleted_at', null)
          if (!vivo) return
          if (!r.error) {
            const vivas = Object.fromEntries(((r.data ?? []) as ObraInfo[]).map(x => [x.id, x]))
            lista = lista.filter(o => vivas[o.obra_id])
            setInfo(vivas)
          }
        }
        if (lista.length === 1) { router.replace(`/dashboard/projetos/obras/${lista[0].obra_id}/cockpit?area=hub`); return }
        setObras(lista)
      } catch { if (vivo) setErro(MSG_CARREGAMENTO_FALHOU) } finally { if (vivo) setLoading(false) }
    })()
    return () => { vivo = false }
  }, [companyIds, router])

  const hoje = new Date().toISOString().slice(0, 10)
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return obras.filter(o => {
      if (filtroStatus && o.status !== filtroStatus) return false
      const i = info[o.obra_id]
      if (filtroCliente && (i?.cliente_nome ?? '') !== filtroCliente) return false
      if (!q) return true
      return [o.numero, o.nome, i?.cliente_nome, i?.cidade].some(t => (t ?? '').toLowerCase().includes(q))
    })
  }, [obras, info, busca, filtroStatus, filtroCliente])
  const clientes = useMemo(() => Array.from(new Set(Object.values(info).map(i => i.cliente_nome).filter((c): c is string => !!c))).sort(), [info])
  // Receita realizada = medição/venda lançada. Sem ela a margem não existe (não é prejuízo): "Sem medição".
  const receitaDe = (o: ObraLinha) => num(o.receita_servico) + num(o.receita_material)
  const semMedicao = filtradas.filter(o => receitaDe(o) <= 0)
  const grupos = useMemo(() => {
    const por: Record<string, ObraLinha[]> = {}
    for (const o of filtradas) (por[o.status] ??= []).push(o)
    const chaves = Object.keys(por).sort((a, b) => (ORDEM_SITUACAO.indexOf(a) + 1 || 99) - (ORDEM_SITUACAO.indexOf(b) + 1 || 99))
    return chaves.map(k => ({ status: k, obras: por[k] }))
  }, [filtradas])

  const atrasadas = filtradas.filter(o => o.status === 'em_andamento' && info[o.obra_id]?.data_prevista_fim && (info[o.obra_id]!.data_prevista_fim as string) < hoje).length
  const resumo = [
    { k: 'Obras', v: filtradas.length === obras.length ? String(obras.length) : `${filtradas.length} de ${obras.length}`, chave: 'projetos.cockpit.kpi_obras' },
    { k: 'Em andamento', v: String(filtradas.filter(o => o.status === 'em_andamento').length), chave: 'projetos.cockpit.kpi_andamento' },
    { k: 'Margem realizada', v: brl(filtradas.filter(o => receitaDe(o) > 0).reduce((t, o) => t + num(o.margem_alocada ?? o.margem_realizada), 0)), chave: 'projetos.cockpit.kpi_margem' },
    { k: 'Com prazo vencido', v: String(atrasadas), chave: 'projetos.cockpit.kpi_atrasadas' },
    { k: 'Sem medição', v: String(semMedicao.length), chave: 'projetos.cockpit.kpi_sem_medicao' },
  ]

  return (
    <div style={{ background: BG, padding: '20px 24px', color: ESP }} data-testid="cockpit-escolher">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Cockpit da obra <AjudaCampo chave="projetos.cockpit.escolher_obra" rota={ROTA} /></h1>
          <p style={{ color: MUT, fontSize: 13, margin: '4px 0 16px' }}>Veja avanço, custo, margem e prazo de todas as obras e abra o cockpit completo de uma delas.</p>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Link href="/dashboard/projetos/obras/nova?area=hub" data-testid="cockpit-nova-obra"
            style={{ background: ESP, color: BG, borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>+ Nova obra</Link>
          <AjudaCampo chave="projetos.cockpit.nova_obra" rota={ROTA} />
        </span>
      </div>
      {loading && <div style={{ color: MUT }}>Carregando…</div>}
      {erro && <div style={{ background: '#FBEAEA', color: '#B91C1C', borderRadius: 8, padding: '8px 10px', fontSize: 13 }}>{erro}</div>}
      {!loading && !erro && obras.length === 0 && (
        <div style={{ color: MUT, fontSize: 14 }}>Nenhuma obra ainda. Crie uma agora em <Link href="/dashboard/projetos/obras/nova?area=hub" style={{ color: ESP, textDecoration: 'underline' }}>Nova obra</Link> ou aprove um orçamento em <Link href="/dashboard/projetos/obras?area=hub" style={{ color: ESP, textDecoration: 'underline' }}>Obras</Link>.</div>
      )}
      {obras.length > 0 && (
        <>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', marginBottom: 14 }}>
            {resumo.map(r => (
              <div key={r.k} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: MUT, textTransform: 'uppercase', letterSpacing: 0.3 }}>{r.k} <AjudaCampo chave={r.chave} rota={ROTA} /></div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{r.v}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por número, nome, cliente ou cidade" aria-label="Buscar obra" data-testid="cockpit-busca"
              style={{ flex: '1 1 240px', border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 14, background: '#fff', color: ESP }} />
            <AjudaCampo chave="projetos.cockpit.busca" rota={ROTA} />
            <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)} aria-label="Filtrar por situação" data-testid="cockpit-filtro-status"
              style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 14, background: '#fff', color: ESP }}>
              <option value="">Todas as situações</option>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}
            </select>
            <AjudaCampo chave="projetos.cockpit.filtro_situacao" rota={ROTA} />
            <select value={filtroCliente} onChange={e => setFiltroCliente(e.target.value)} aria-label="Filtrar por cliente" data-testid="cockpit-filtro-cliente"
              style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 14, background: '#fff', color: ESP }}>
              <option value="">Todos os clientes</option>
              {clientes.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <AjudaCampo chave="projetos.cockpit.filtro_cliente" rota={ROTA} />
          </div>
          <div style={{ color: MUT, fontSize: 12, marginBottom: 10 }} data-testid="cockpit-contagem">Mostrando {filtradas.length} de {obras.length} obras — os indicadores acima somam exatamente as obras listadas abaixo (a margem soma só as obras com medição).</div>
          {filtradas.length === 0 && <div style={{ color: MUT, fontSize: 14 }}>Nenhuma obra encontrada com esse filtro.</div>}
        </>
      )}
      {grupos.map(g => {
        const gs = situacao(g.status)
        return (
      <section key={g.status} data-testid={`cockpit-grupo-${g.status}`} style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: gs.cor, margin: '0 0 8px' }}>{gs.rotulo} · {g.obras.length} <AjudaCampo chave="projetos.cockpit.grupo_situacao" rota={ROTA} /></h2>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))' }}>
        {g.obras.map(o => {
          const i = info[o.obra_id]
          const pct = Math.max(0, Math.min(100, num(i?.pct_conclusao)))
          const receita = num(o.receita_servico) + num(o.receita_material)
          const custo = num(o.custo_material) + num(o.custo_viagens) + num(o.custo_mao_obra) + num(o.custo_rateio)
          const margem = num(o.margem_alocada ?? o.margem_realizada)
          const temMedicao = receita > 0
          const vencida = o.status === 'em_andamento' && !!i?.data_prevista_fim && i.data_prevista_fim < hoje
          const st = situacao(o.status)
          return (
            <div key={o.obra_id} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '12px 14px' }}>
            <Link href={`/dashboard/projetos/obras/${o.obra_id}/cockpit?area=hub`} data-testid="cockpit-obra-link"
              style={{ textDecoration: 'none', color: ESP, display: 'block' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 14, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: 0.3 }} title={o.numero}>{codigoPadrao(o.numero)}</div>
                <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.3, color: st.cor, background: st.fundo, border: `1.5px solid ${st.cor}`, borderRadius: 999, padding: '2px 9px' }}>{st.rotulo}</span>
              </div>
              <div style={{ fontSize: 13, color: MUT, marginTop: 2 }}>{o.nome || 'Sem nome'}{i?.cliente_nome ? ` · ${i.cliente_nome}` : ''}</div>
            </Link>
              {/* Os campos com "?" (RD-95) ficam FORA do <Link>: o AjudaCampo faz preventDefault/stopPropagation; no card estreito do celular o toque no centro do link caía no "?" do Custo e abria a ajuda em vez de navegar (@pos vermelho pós #3396). O link cobre o cabeçalho (código + nome), que não tem "?", então o toque sempre abre o cockpit. */}
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: MUT }}><span>Avanço <AjudaCampo chave="projetos.cockpit.avanco" rota={ROTA} /></span><span>{pct.toFixed(0)}%</span></div>
                <div style={{ height: 6, background: LINE, borderRadius: 999, marginTop: 3 }}><div style={{ width: `${pct}%`, height: '100%', background: GOLD, borderRadius: 999 }} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 10, fontSize: 12 }}>
                <div><div style={{ color: MUT, fontSize: 11 }}>Receita <AjudaCampo chave="projetos.cockpit.card_receita" rota={ROTA} /></div><b>{brl(receita)}</b></div>
                <div><div style={{ color: MUT, fontSize: 11 }}>Custo <AjudaCampo chave="projetos.cockpit.card_custo" rota={ROTA} /></div>{custo > 0 ? <b>{brl(custo)}</b> : <b style={{ color: MUT }} title="Nenhum custo de material, viagem, mão de obra ou rateio foi lançado nesta obra ainda — não é custo zero." data-testid="cockpit-sem-custo">Sem custo lançado</b>}</div>
                <div><div style={{ color: MUT, fontSize: 11 }}>Margem <AjudaCampo chave="projetos.cockpit.card_margem" rota={ROTA} /></div>{temMedicao
                  ? <b style={{ color: margem < 0 ? '#B91C1C' : '#15803D' }}>{brl(margem)}</b>
                  : <b style={{ color: MUT }} title="Sem medição lançada a margem ainda não existe — não é prejuízo." data-testid="cockpit-sem-medicao">Sem medição</b>}</div>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: vencida ? '#B91C1C' : MUT }}>
                Prazo: {i?.data_prevista_fim ? new Date(i.data_prevista_fim + 'T12:00:00').toLocaleDateString('pt-BR') : 'não definido'}{vencida ? ' · vencido' : ''} <AjudaCampo chave="projetos.cockpit.card_prazo" rota={ROTA} />
              </div>
              {pendencias(o, vencida, temMedicao, custo).length > 0 && (
                <div data-testid="cockpit-pendencias" style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {pendencias(o, vencida, temMedicao, custo).map(t => <span key={t} style={{ fontSize: 11, fontWeight: 600, color: '#92400E', background: 'rgba(200,148,26,0.14)', borderRadius: 999, padding: '2px 8px' }}>{t}</span>)}
                  <AjudaCampo chave="projetos.cockpit.card_pendencias" rota={ROTA} />
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTop: `1px solid ${LINE}` }} data-testid="cockpit-atalhos">
                {ATALHOS.map(a => (
                  <Link key={a.rota} href={`/dashboard/projetos/obras/${o.obra_id}/${a.rota}?area=hub`}
                    style={{ fontSize: 12, fontWeight: 600, color: ESP, border: `1px solid ${LINE}`, borderRadius: 999, padding: '3px 10px', textDecoration: 'none' }}>{a.rotulo}</Link>
                ))}
                <AjudaCampo chave="projetos.cockpit.card_atalhos" rota={ROTA} />
              </div>
            </div>
          )
        })}
      </div>
      </section>
        )
      })}
    </div>
  )
}

// "O que fazer hoje" por obra: só em obra em andamento; sem medição não vira alarme de margem.
function pendencias(o: ObraLinha, vencida: boolean, temMedicao: boolean, custo: number): string[] {
  if (o.status !== 'em_andamento') return []
  const p: string[] = []
  if (vencida) p.push('Prazo vencido — replanejar')
  if (!temMedicao) p.push(custo > 0 ? 'Lançar a medição' : 'Sem custo nem medição ainda')
  else if (num(o.margem_alocada ?? o.margem_realizada) < 0) p.push('Margem negativa — revise custos')
  return p
}
