'use client'
// PS CRM · Leads: quem procurou a empresa e ainda não virou negócio. Entra pelo cadastro rápido (nome + telefone),
// alguém pega (ou o gerente distribui), conversa pelo WhatsApp e, quando faz sentido, QUALIFICA: vira empresa + negócio
// no funil num toque (fn_crm_lead_qualificar). Descartar pede o motivo. Leitura direta (RLS + carteira), escrita só por RPC.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { erroAmigavel } from '@/lib/erroAmigavel'
import Modal from '@/components/ui/Modal'
import { C, Campo, Titulo, Cabecalho, Pagina, Aviso, Vazio, SemEmpresa, inp, btnPri, btnSec, chip, cartao, dataBR, waHref, rpcCrm, useCrm } from '@/components/crm/crmUi'

type Lead = {
  id: string; nome: string; empresa: string | null; telefone: string | null; email: string | null; origem: string | null; origem_id: string | null
  interesse: string | null; cidade: string | null; status: string; motivo_descarte: string | null; responsavel_id: string | null
  oportunidade_id: string | null; observacoes: string | null; created_at: string
}
const SITUACOES: { v: string; l: string }[] = [
  { v: 'abertos', l: 'Em aberto' }, { v: 'novo', l: 'Novos' }, { v: 'em_contato', l: 'Em contato' },
  { v: 'convertido', l: 'Viraram negócio' }, { v: 'descartado', l: 'Descartados' }, { v: 'todos', l: 'Todos' },
]
const ROTULO_STATUS: Record<string, string> = { novo: 'Novo', em_contato: 'Em contato', convertido: 'Virou negócio', descartado: 'Descartado' }
const VAZIO = { id: '', nome: '', empresa: '', telefone: '', email: '', origem_id: '', interesse: '', cidade: '', observacoes: '', responsavel_id: '' }

export default function CrmLeadsPage() {
  const router = useRouter()
  const { empresa, cfg, erro: erroCfg, carregando, gestor, soLeitura } = useCrm()
  const [leads, setLeads] = useState<Lead[]>([])
  const [busca, setBusca] = useState('')
  const [situacao, setSituacao] = useState('abertos')
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [form, setForm] = useState<typeof VAZIO | null>(null)
  const [descartar, setDescartar] = useState<Lead | null>(null)
  const [motivo, setMotivo] = useState('')

  const carregar = useCallback(async () => {
    if (!empresa) return
    const { data, error } = await supabase.from('erp_crm_lead')
      .select('id, nome, empresa, telefone, email, origem, origem_id, interesse, cidade, status, motivo_descarte, responsavel_id, oportunidade_id, observacoes, created_at')
      .eq('company_id', empresa).is('deleted_at', null).order('created_at', { ascending: false }).limit(500)
    if (error) { setErro(erroAmigavel(error)); return }
    setLeads((data ?? []) as Lead[])
  }, [empresa])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga/sincronia ao trocar empresa, funil ou filtro
  useEffect(() => { void carregar() }, [carregar])

  const nomeDe = useMemo(() => new Map((cfg?.equipe ?? []).map((u) => [u.id, u.nome])), [cfg])
  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return leads.filter((l) => (situacao === 'todos' || (situacao === 'abertos' ? ['novo', 'em_contato'].includes(l.status) : l.status === situacao))
      && (!t || [l.nome, l.empresa, l.telefone, l.email, l.interesse].some((x) => (x ?? '').toLowerCase().includes(t))))
  }, [leads, busca, situacao])

  async function acao(l: Lead, a: string, valor?: string) {
    try { await rpcCrm('fn_crm_lead_acao', { p_lead_id: l.id, p_acao: a, p_valor: valor ?? null }); void carregar(); return true }
    catch (e) { setErro((e as Error).message); return false }
  }
  async function qualificar(l: Lead) {
    try {
      const r = await rpcCrm<{ id: string }>('fn_crm_lead_qualificar', { p_lead_id: l.id, p_funil_id: null, p_cliente_id: null })
      router.push(`/dashboard/crm/oportunidade/${r.id}`)
    } catch (e) { setErro((e as Error).message) }
  }
  async function salvar() {
    if (!form || !empresa) return
    try {
      await rpcCrm('fn_crm_lead_salvar', { p_company_id: empresa, p_dados: { ...form, id: form.id || null } })
      setOk(form.id ? 'Lead atualizado.' : 'Lead cadastrado.'); setForm(null); void carregar()
    } catch (e) { setErro((e as Error).message) }
  }

  if (carregando) return <Pagina><div style={{ color: C.TEXTM }}>Carregando…</div></Pagina>
  if (!empresa) return <Pagina><Cabecalho titulo="Leads" /><SemEmpresa /></Pagina>
  if (!cfg) return <Pagina><Cabecalho titulo="Leads" /><Aviso texto={erroCfg ?? 'Não foi possível abrir o CRM.'} /></Pagina>
  const set = (k: keyof typeof VAZIO) => (e: { target: { value: string } }) => setForm((f) => f && { ...f, [k]: e.target.value })

  return (
    <Pagina>
      <Cabecalho titulo="Leads" subtitulo="Quem procurou a empresa. Pegue, converse e qualifique para virar negócio."
        acoes={!soLeitura && <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          <button onClick={() => setForm({ ...VAZIO })} style={btnPri} data-testid="crm-lead-novo">+ Novo lead</button>
        </span>} />
      <Aviso texto={erro} onFechar={() => setErro(null)} />
      <Aviso texto={ok} tipo="ok" onFechar={() => setOk(null)} />

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <Campo rotulo="Buscar" ajuda="crm.leads.busca" largura={240}>
          <input style={inp} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, empresa, telefone…" />
        </Campo>
        <Campo rotulo="Situação" ajuda="crm.leads.situacao" largura={180}>
          <select style={inp} value={situacao} onChange={(e) => setSituacao(e.target.value)}>
            {SITUACOES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
          </select>
        </Campo>
      </div>

      <section style={cartao}>
        <Titulo texto={`${filtrados.length} lead(s)`} ajuda="crm.leads.acoes" />
        {filtrados.length === 0 && <Vazio texto={leads.length === 0 ? 'Nenhum lead ainda. Cadastre quem pediu orçamento, ligou ou mandou mensagem.' : 'Nenhum lead com esse filtro.'}
          acao={!soLeitura && leads.length === 0 ? <button onClick={() => setForm({ ...VAZIO })} style={btnPri}>+ Novo lead</button> : undefined} />}
        {filtrados.map((l) => {
          const wa = waHref(l.telefone, `Olá ${l.nome.split(' ')[0]}, tudo bem?`)
          const aberto = ['novo', 'em_contato'].includes(l.status)
          return (
            <div key={l.id} data-testid="crm-lead-linha" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', borderTop: `1px solid ${C.BORDA}`, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{l.nome}{l.empresa ? <span style={{ fontWeight: 400, color: C.TEXTM }}> · {l.empresa}</span> : null}</div>
                <div style={{ fontSize: 12, color: C.TEXTM }}>
                  {ROTULO_STATUS[l.status] ?? l.status} · {l.origem ?? 'origem não informada'} · {dataBR(l.created_at)}
                  {' · '}{l.responsavel_id ? (nomeDe.get(l.responsavel_id) ?? 'com dono') : <strong style={{ color: C.DOURADO }}>sem dono</strong>}
                  {l.interesse ? ` · ${l.interesse}` : ''}{l.motivo_descarte ? ` · motivo: ${l.motivo_descarte}` : ''}
                </div>
              </div>
              {wa && <a href={wa} target="_blank" rel="noreferrer" style={chip(C.WA)}>WhatsApp</a>}
              {!soLeitura && aberto && !l.responsavel_id && <button onClick={() => void acao(l, 'pegar').then((x) => x && setOk(`O lead ${l.nome} agora é seu.`))} style={chip(C.DOURADO)}>Pegar</button>}
              {!soLeitura && gestor && aberto && (
                <span data-ajuda="crm.leads.responsavel">
                  <select aria-label="Distribuir para" style={{ ...inp, minHeight: 32, padding: '4px 8px', fontSize: 12, width: 'auto' }} value={l.responsavel_id ?? ''}
                    onChange={(e) => void acao(l, 'atribuir', e.target.value)}>
                    <option value="">Sem dono</option>
                    {cfg.equipe.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                  </select>
                </span>
              )}
              {!soLeitura && aberto && <button onClick={() => void qualificar(l)} style={chip(C.GREEN, C.GREEN_BG)} data-testid="crm-lead-qualificar">→ Virar negócio</button>}
              {l.oportunidade_id && <button onClick={() => router.push(`/dashboard/crm/oportunidade/${l.oportunidade_id}`)} style={chip(C.ESPRESSO)}>Abrir negócio</button>}
              {!soLeitura && aberto && <button onClick={() => setForm({ ...VAZIO, ...Object.fromEntries(Object.entries(l).map(([k, v]) => [k, v ?? ''])) as typeof VAZIO })} style={chip(C.ESPRESSO)}>Editar</button>}
              {!soLeitura && aberto && <button onClick={() => { setDescartar(l); setMotivo('') }} style={chip(C.RED)}>Descartar</button>}
              {!soLeitura && l.status === 'descartado' && <button onClick={() => void acao(l, 'reabrir')} style={chip(C.ESPRESSO)}>Reabrir</button>}
              {!soLeitura && gestor && l.status !== 'convertido' && <button onClick={() => void acao(l, 'excluir').then((x) => x && setOk('Lead excluído.'))} style={chip(C.TEXTM)} aria-label={`Excluir ${l.nome}`}>Excluir</button>}
            </div>
          )
        })}
      </section>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Editar lead' : 'Novo lead'} subtitle="Nome e telefone já bastam." maxWidth={520}
        footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={() => setForm(null)} style={btnSec}>Cancelar</button>
          <button onClick={() => void salvar()} disabled={!form?.nome.trim()} style={{ ...btnPri, opacity: form?.nome.trim() ? 1 : 0.5 }} data-testid="crm-lead-salvar">Salvar</button>
        </div>}>
        {form && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Campo rotulo="Nome" ajuda="crm.leads.nome"><input style={inp} value={form.nome} onChange={set('nome')} data-testid="crm-lead-nome" /></Campo>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Campo rotulo="Telefone / WhatsApp" ajuda="crm.leads.telefone" largura={160}><input style={inp} inputMode="tel" value={form.telefone} onChange={set('telefone')} /></Campo>
              <Campo rotulo="E-mail" ajuda="crm.leads.email" largura={160}><input style={inp} type="email" value={form.email} onChange={set('email')} /></Campo>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Campo rotulo="Empresa" ajuda="crm.leads.empresa" largura={160}><input style={inp} value={form.empresa} onChange={set('empresa')} /></Campo>
              <Campo rotulo="Origem" ajuda="crm.leads.origem" largura={160}>
                <select style={inp} value={form.origem_id} onChange={set('origem_id')}>
                  <option value="">—</option>
                  {cfg.origens.filter((o) => o.ativo || o.id === form.origem_id).map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
                </select>
              </Campo>
            </div>
            <Campo rotulo="Interesse" ajuda="crm.leads.interesse"><input style={inp} value={form.interesse} onChange={set('interesse')} placeholder="Ex.: Orçamento de 3 unidades" /></Campo>
            {gestor && (
              <Campo rotulo="Responsável" ajuda="crm.leads.responsavel">
                <select style={inp} value={form.responsavel_id} onChange={set('responsavel_id')}>
                  <option value="">Sem dono</option>
                  {cfg.equipe.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                </select>
              </Campo>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!descartar} onClose={() => setDescartar(null)} title="Descartar lead" maxWidth={440}
        footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={() => setDescartar(null)} style={btnSec}>Cancelar</button>
          <button onClick={() => descartar && void acao(descartar, 'descartar', motivo).then((x) => x && setDescartar(null))} disabled={!motivo.trim()} style={{ ...btnPri, opacity: motivo.trim() ? 1 : 0.5 }}>Descartar</button>
        </div>}>
        <Campo rotulo="Por que descartar?" ajuda="crm.leads.acoes">
          <input style={inp} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: Só queria saber preço; fora da região" />
        </Campo>
      </Modal>
    </Pagina>
  )
}
