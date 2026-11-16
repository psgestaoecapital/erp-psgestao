'use client'
// PS CRM · "O que fazer hoje" — a tela de entrada do vendedor (RD-99: abre e já sabe o que fazer). Quatro listas curtas
// vindas de fn_crm_hoje, já filtradas pela carteira: tarefas vencendo/atrasadas, negócios parados, propostas sem
// retorno e leads sem dono. Cada linha tem a ação de 1 toque (concluir, WhatsApp, abrir, pegar o lead).
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { erroAmigavel } from '@/lib/erroAmigavel'
import NovoNegocioModal from '@/components/crm/NovoNegocioModal'
import { useRouter } from 'next/navigation'
import { C, Titulo, Cabecalho, Pagina, Aviso, Vazio, SemEmpresa, btnPri, chip, cartao, brl, dataBR, horaBR, waHref, rpcCrm, useCrm, IconeTipo } from '@/components/crm/crmUi'

type Tarefa = { id: string; tipo: string; titulo: string; vence_em: string; atrasada: boolean; oportunidade_id: string | null; lead_id: string | null; oportunidade: string | null; telefone: string | null }
type Parada = { id: string; titulo: string; etapa: string; responsavel_nome: string | null; valor: number | null; dias: number }
type Proposta = { id: string; titulo: string; etapa: string; valor: number | null; responsavel_nome: string | null }
type LeadSemDono = { id: string; nome: string; empresa: string | null; telefone: string | null; origem: string | null; criado_em: string }
type Hoje = { tarefas: Tarefa[]; paradas: Parada[]; propostas: Proposta[]; leads_sem_dono: LeadSemDono[] }

export default function CrmHojePage() {
  const router = useRouter()
  const { empresa, cfg, erro: erroCfg, carregando, soLeitura } = useCrm()
  const [hoje, setHoje] = useState<Hoje | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [novo, setNovo] = useState(false)

  const carregar = useCallback(async () => {
    if (!empresa) return
    const { data, error } = await supabase.rpc('fn_crm_hoje', { p_company_id: empresa })
    if (error) { setErro(erroAmigavel(error)); return }
    setHoje(data as Hoje)
  }, [empresa])
  useEffect(() => { void carregar() }, [carregar])

  async function concluir(t: Tarefa) {
    try { await rpcCrm('fn_crm_tarefa_concluir', { p_id: t.id, p_concluida: true }); setOk(`Feito: ${t.titulo}`); void carregar() }
    catch (e) { setErro((e as Error).message) }
  }
  async function pegar(l: LeadSemDono) {
    try { await rpcCrm('fn_crm_lead_acao', { p_lead_id: l.id, p_acao: 'pegar' }); setOk(`O lead ${l.nome} agora é seu.`); void carregar() }
    catch (e) { setErro((e as Error).message) }
  }

  if (carregando) return <Pagina><div style={{ color: C.TEXTM }}>Carregando…</div></Pagina>
  if (!empresa) return <Pagina><Cabecalho titulo="O que fazer hoje" /><SemEmpresa /></Pagina>
  if (!cfg) return <Pagina><Cabecalho titulo="O que fazer hoje" /><Aviso texto={erroCfg ?? 'Não foi possível abrir o CRM.'} /></Pagina>

  const linha = { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', borderTop: `1px solid ${C.BORDA}`, flexWrap: 'wrap' as const }
  const total = hoje ? hoje.tarefas.length + hoje.paradas.length + hoje.propostas.length + hoje.leads_sem_dono.length : 0

  return (
    <Pagina>
      <Cabecalho titulo="O que fazer hoje" subtitulo={hoje && total === 0 ? 'Tudo em dia. Bom momento para prospectar.' : 'Comece pelo que está atrasado.'}
        acoes={!soLeitura && <>
          <button onClick={() => setNovo(true)} style={btnPri} data-testid="crm-hoje-novo">+ Novo negócio</button>
          <Link href="/dashboard/crm/pipeline" style={{ ...chip(C.ESPRESSO), minHeight: 44, padding: '0 14px', fontSize: 13.5 }}>Abrir funil</Link>
        </>} />
      <Aviso texto={erro} onFechar={() => setErro(null)} />
      <Aviso texto={ok} tipo="ok" onFechar={() => setOk(null)} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <section style={cartao} data-testid="crm-hoje-tarefas">
          <Titulo texto={`Tarefas de hoje${hoje ? ` (${hoje.tarefas.length})` : ''}`} ajuda="crm.hoje.tarefas" />
          {hoje && hoje.tarefas.length === 0 && <Vazio texto="Nenhuma tarefa para hoje. Agende o próximo passo dentro de cada negócio." />}
          {hoje?.tarefas.map((t) => {
            const wa = waHref(t.telefone)
            return (
              <div key={t.id} style={linha}>
                <IconeTipo tipo={t.tipo} />
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{t.titulo}</div>
                  <div style={{ fontSize: 12, color: t.atrasada ? C.RED : C.TEXTM }}>
                    {t.atrasada ? `Atrasada desde ${dataBR(t.vence_em)}` : `Hoje ${horaBR(t.vence_em)}`}
                    {t.oportunidade && <> · <Link href={`/dashboard/crm/oportunidade/${t.oportunidade_id}`} style={{ color: C.DOURADO }}>{t.oportunidade}</Link></>}
                  </div>
                </div>
                {wa && <a href={wa} target="_blank" rel="noreferrer" style={chip(C.WA)}>WhatsApp</a>}
                {!soLeitura && <button onClick={() => void concluir(t)} style={chip(C.GREEN, C.GREEN_BG)}>✓ Feito</button>}
              </div>
            )
          })}
        </section>

        <section style={cartao} data-testid="crm-hoje-paradas">
          <Titulo texto={`Negócios parados${hoje ? ` (${hoje.paradas.length})` : ''}`} ajuda="crm.hoje.paradas" />
          {hoje && hoje.paradas.length === 0 && <Vazio texto="Nenhum negócio parado. Todos andaram nos últimos dias." />}
          {hoje?.paradas.map((p) => (
            <div key={p.id} style={linha}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <Link href={`/dashboard/crm/oportunidade/${p.id}`} style={{ fontWeight: 600, fontSize: 14, color: C.ESPRESSO }}>{p.titulo}</Link>
                <div style={{ fontSize: 12, color: C.TEXTM }}>{p.etapa} · {p.responsavel_nome ?? 'sem responsável'}{p.valor ? ` · ${brl(p.valor)}` : ''}</div>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.RED }}>{p.dias} dias</span>
            </div>
          ))}
        </section>

        <section style={cartao} data-testid="crm-hoje-propostas">
          <Titulo texto={`Propostas sem retorno${hoje ? ` (${hoje.propostas.length})` : ''}`} ajuda="crm.hoje.propostas" />
          {hoje && hoje.propostas.length === 0 && <Vazio texto="Nenhuma proposta aguardando. Ao lançar o valor da proposta no negócio, ele aparece aqui até fechar." />}
          {hoje?.propostas.map((p) => (
            <div key={p.id} style={linha}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <Link href={`/dashboard/crm/oportunidade/${p.id}`} style={{ fontWeight: 600, fontSize: 14, color: C.ESPRESSO }}>{p.titulo}</Link>
                <div style={{ fontSize: 12, color: C.TEXTM }}>{p.etapa} · {p.responsavel_nome ?? 'sem responsável'}</div>
              </div>
              <strong style={{ fontSize: 13 }}>{brl(p.valor)}</strong>
            </div>
          ))}
        </section>

        <section style={cartao} data-testid="crm-hoje-leads">
          <Titulo texto={`Leads sem dono${hoje ? ` (${hoje.leads_sem_dono.length})` : ''}`} ajuda="crm.hoje.leads_sem_dono"
            extra={<Link href="/dashboard/crm/leads" style={chip(C.ESPRESSO)}>Ver todos</Link>} />
          {hoje && hoje.leads_sem_dono.length === 0 && <Vazio texto="Nenhum lead esperando. Cadastre quem procurou a empresa em Leads." />}
          {hoje?.leads_sem_dono.map((l) => {
            const wa = waHref(l.telefone)
            return (
              <div key={l.id} style={linha}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{l.nome}{l.empresa ? ` · ${l.empresa}` : ''}</div>
                  <div style={{ fontSize: 12, color: C.TEXTM }}>{l.origem ?? 'origem não informada'} · chegou {dataBR(l.criado_em)}</div>
                </div>
                {wa && <a href={wa} target="_blank" rel="noreferrer" style={chip(C.WA)}>WhatsApp</a>}
                {!soLeitura && <button onClick={() => void pegar(l)} style={chip(C.DOURADO)}>Pegar</button>}
              </div>
            )
          })}
        </section>
      </div>

      <NovoNegocioModal aberto={novo} onFechar={() => setNovo(false)} empresa={empresa} cfg={cfg}
        onCriado={(id) => { setNovo(false); router.push(`/dashboard/crm/oportunidade/${id}`) }} />
    </Pagina>
  )
}
