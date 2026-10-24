'use client'

// HB0 item 6 · Ordens de serviço de OBRA (Hub). A OS do Hub é por obra, etapa, serviço e equipe — não leva placa,
// veículo nem mecânico (essa é a OS da oficina, /dashboard/os, que não muda). Grava só pelas funções com guarda de
// empresa (fn_obra_os_salvar / _status / _excluir); lista por fn_obra_os_listar. Celular primeiro: a lista é de cartões.
// HBF-0.5: horas da equipe apontadas na própria OS (fn_obra_os_apontar_horas) — viram custo de mão de obra da obra.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERM = '#B91C1C', VERDE = '#15803D'

type Obra = { id: string; numero: string | null; nome: string }
type Etapa = { id: string; nome: string }
type Servico = { id: string; descricao: string | null }
type Funcao = { id: string; nome: string; custo_hora_manual: number | null }
type Horas = { horas: number; valor: number }
type OS = {
  id: string; numero: string; obra_id: string; obra_numero: string | null; obra_nome: string
  tarefa_id: string | null; etapa: string | null; obra_item_id: string | null; servico: string | null
  descricao: string; equipe: string | null; responsavel: string | null; data_prevista: string | null
  prioridade: 'baixa' | 'normal' | 'alta' | 'urgente'; status: 'aberta' | 'em_execucao' | 'concluida' | 'cancelada'
}

const STATUS: Record<OS['status'], { rotulo: string; cor: string; fundo: string }> = {
  aberta: { rotulo: 'Aberta', cor: ESP, fundo: 'rgba(61,35,20,0.08)' },
  em_execucao: { rotulo: 'Em execução', cor: '#92400E', fundo: 'rgba(200,148,26,0.18)' },
  concluida: { rotulo: 'Concluída', cor: VERDE, fundo: 'rgba(21,128,61,0.12)' },
  cancelada: { rotulo: 'Cancelada', cor: MUT, fundo: 'rgba(61,35,20,0.05)' },
}
const PRIORIDADES = [['baixa', 'Baixa'], ['normal', 'Normal'], ['alta', 'Alta'], ['urgente', 'Urgente']] as const
const VAZIO = { obra_id: '', tarefa_id: '', obra_item_id: '', descricao: '', equipe: '', responsavel: '', data_prevista: '', prioridade: 'normal' }
const hoje = () => new Date().toISOString().slice(0, 10)
const dataBR = (d: string | null) => (d ? d.split('-').reverse().join('/') : '')
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const num = (v: string) => Number(v.replace(',', '.'))
const VAZIO_H = { data: '', funcao_id: '', horas: '', custo_hora: '' }
const nomeObra = (o: { obra_numero?: string | null; numero?: string | null; obra_nome?: string; nome?: string }) =>
  [o.obra_numero ?? o.numero, o.obra_nome ?? o.nome].filter(Boolean).join(' · ')

export default function OSObraPage() {
  const { companyIds } = useCompanyIds()
  const [obras, setObras] = useState<Obra[]>([])
  const [lista, setLista] = useState<OS[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [fObra, setFObra] = useState('')
  const [fStatus, setFStatus] = useState<'andamento' | 'concluida' | 'cancelada' | 'todas'>('andamento')
  const [aberto, setAberto] = useState(false)
  const [f, setF] = useState({ ...VAZIO })
  const [etapas, setEtapas] = useState<Etapa[]>([])
  const [servicos, setServicos] = useState<Servico[]>([])
  const [salvando, setSalvando] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [editando, setEditando] = useState<string | null>(null)
  const [funcoes, setFuncoes] = useState<Funcao[]>([])
  const [horasOS, setHorasOS] = useState<Record<string, Horas>>({})
  const [apontando, setApontando] = useState<string | null>(null)
  const [fh, setFh] = useState({ ...VAZIO_H })

  const carregar = useCallback(async () => {
    if (!companyIds?.length) { setLoading(false); return }
    setLoading(true); setErro('')
    try {
      const [a, b, h, fn] = await Promise.all([
        comPrazo(async () => await supabase.rpc('fn_obra_os_listar', { p_company_ids: companyIds, p_obra_id: null }),
          { ms: 8000, tentativas: 1, label: 'os_obra' }),
        comPrazo(async () => await supabase.from('projetos_obras').select('id,numero,nome').in('company_id', companyIds)
          .not('status', 'in', '("concluida","cancelada")').order('created_at', { ascending: false }).limit(300),
          { ms: 8000, tentativas: 1, label: 'obras' }),
        comPrazo(async () => await supabase.from('projetos_obra_mao_obra_apontamento').select('os_id,horas,valor')
          .in('company_id', companyIds).not('os_id', 'is', null).is('excluido_em', null),
          { ms: 8000, tentativas: 1, label: 'horas_os' }),
        comPrazo(async () => await supabase.from('erp_funcao_mao_obra').select('id,nome,custo_hora_manual').in('company_id', companyIds).eq('ativo', true).order('nome'),
          { ms: 8000, tentativas: 1, label: 'funcoes' }),
      ])
      if (a.error) { setErro(a.error.message); return }
      setLista((a.data ?? []) as OS[]); setObras((b.data ?? []) as Obra[]); setFuncoes((fn.data ?? []) as Funcao[])
      const soma: Record<string, Horas> = {}
      for (const r of (h.data ?? []) as { os_id: string; horas: number; valor: number }[]) {
        const t = soma[r.os_id] ?? { horas: 0, valor: 0 }
        soma[r.os_id] = { horas: t.horas + Number(r.horas), valor: t.valor + Number(r.valor) }
      }
      setHorasOS(soma)
    } catch { setErro(MSG_CARREGAMENTO_FALHOU) } finally { setLoading(false) }
  }, [companyIds])
  useEffect(() => { carregar() }, [carregar])

  // etapas (cronograma) e serviços (itens contratados) da obra escolhida no formulário
  useEffect(() => {
    if (!f.obra_id) { setEtapas([]); setServicos([]); return }
    let vivo = true
    void Promise.all([
      supabase.from('projetos_obra_tarefa').select('id,nome').eq('obra_id', f.obra_id).is('excluido_em', null).order('ordem'),
      supabase.from('projetos_obra_item').select('id,descricao').eq('obra_id', f.obra_id).is('excluido_em', null).order('ordem'),
    ]).then(([t, i]) => { if (vivo) { setEtapas((t.data ?? []) as Etapa[]); setServicos((i.data ?? []) as Servico[]) } })
    return () => { vivo = false }
  }, [f.obra_id])

  const visiveis = useMemo(() => lista.filter(o => (!fObra || o.obra_id === fObra) && (
    fStatus === 'todas' || (fStatus === 'andamento' ? (o.status === 'aberta' || o.status === 'em_execucao') : o.status === fStatus))), [lista, fObra, fStatus])

  // obra de OS em edição pode já ter saído da lista (concluída): entra só no formulário
  const obrasForm = useMemo(() => {
    const atual = lista.find(o => o.id === editando)
    return !atual || obras.some(o => o.id === atual.obra_id) ? obras : [...obras, { id: atual.obra_id, numero: atual.obra_numero, nome: atual.obra_nome }]
  }, [obras, lista, editando])

  const novo = () => { setF({ ...VAZIO, obra_id: fObra }); setErro(''); setAberto(true) }
  const editar = (o: OS) => {
    setF({ obra_id: o.obra_id, tarefa_id: o.tarefa_id ?? '', obra_item_id: o.obra_item_id ?? '', descricao: o.descricao, equipe: o.equipe ?? '',
      responsavel: o.responsavel ?? '', data_prevista: o.data_prevista ?? '', prioridade: o.prioridade })
    setEditando(o.id); setErro(''); setAberto(true)
  }
  const fechar = () => { setAberto(false); setEditando(null); setF({ ...VAZIO }) }

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setErro('')
    if (!f.obra_id) { setErro('Escolha a obra.'); return }
    if (!f.descricao.trim()) { setErro('Descreva o que a equipe vai fazer.'); return }
    setSalvando(true)
    const { error } = await supabase.rpc('fn_obra_os_salvar', { p_obra_id: f.obra_id, p_dados: { ...f, id: editando } })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    fechar(); carregar()
  }

  const mudar = async (o: OS, status: OS['status']) => {
    if (status === 'cancelada' && !window.confirm(`Cancelar a ${o.numero}? Dá para reabrir depois.`)) return
    setOcupado(o.id); setErro('')
    const { error } = await supabase.rpc('fn_obra_os_status', { p_id: o.id, p_status: status })
    setOcupado(null)
    if (error) { setErro(error.message); return }
    carregar()
  }
  const excluir = async (o: OS) => {
    if (!window.confirm(`Excluir a ${o.numero}? Ela sai da lista (fica no histórico).`)) return
    setOcupado(o.id); setErro('')
    const { error } = await supabase.rpc('fn_obra_os_excluir', { p_id: o.id })
    setOcupado(null)
    if (error) { setErro(error.message); return }
    carregar()
  }

  const abrirHoras = (o: OS) => { setFh({ ...VAZIO_H, data: hoje() }); setErro(''); setApontando(apontando === o.id ? null : o.id) }
  const escolherFuncao = (fid: string) => {
    const x = funcoes.find(q => q.id === fid)
    setFh(p => ({ ...p, funcao_id: fid, custo_hora: x?.custo_hora_manual != null && !p.custo_hora ? String(x.custo_hora_manual).replace('.', ',') : p.custo_hora }))
  }
  const lancarHoras = async (e: React.FormEvent, o: OS) => {
    e.preventDefault(); setErro('')
    const horas = num(fh.horas), custo = num(fh.custo_hora)
    if (!(horas > 0)) { setErro('Informe as horas trabalhadas (maior que zero).'); return }
    if (fh.custo_hora === '' || !(custo >= 0)) { setErro('Informe o custo da hora.'); return }
    setOcupado(o.id)
    const { error } = await supabase.rpc('fn_obra_os_apontar_horas', { p_os_id: o.id, p_dados: { data: fh.data, funcao_id: fh.funcao_id, horas, custo_hora: custo } })
    setOcupado(null)
    if (error) { setErro(error.message); return }
    setApontando(null); setFh({ ...VAZIO_H }); carregar()
  }

  const inp: React.CSSProperties = { padding: '10px 12px', border: `1px solid ${LINE}`, borderRadius: 10, background: '#fff', fontSize: 15, width: '100%', boxSizing: 'border-box', color: ESP }
  const lab: React.CSSProperties = { display: 'grid', gap: 6, fontSize: 13, color: MUT, fontWeight: 600 }
  const rot: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4 }
  const btn = (fundo: string, cor: string): React.CSSProperties => ({ padding: '9px 14px', minHeight: 40, background: fundo, color: cor, border: fundo === '#fff' ? `1px solid ${LINE}` : 0, borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: 'pointer' })

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: 16, color: ESP }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <Link href="/dashboard/projetos/obras?area=hub" style={{ color: GOLD, fontSize: 13 }}>← Obras</Link>
        <h1 style={{ fontSize: 24, margin: '8px 0 4px', fontWeight: 700 }}>Ordens de serviço de obra</h1>
        <p style={{ fontSize: 14, color: MUT, margin: '0 0 16px', lineHeight: 1.5 }}>
          O que cada equipe vai executar, em que obra e etapa. Abra, inicie e conclua daqui — no escritório ou no canteiro.
        </p>

        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', alignItems: 'end', marginBottom: 14 }}>
          <label style={lab}>
            <span style={rot}>Obra <AjudaCampo chave="projetos.os_obra.filtro_obra" /></span>
            <select value={fObra} onChange={e => setFObra(e.target.value)} style={inp} data-testid="os-obra-filtro-obra">
              <option value="">Todas as obras</option>
              {obras.map(o => <option key={o.id} value={o.id}>{nomeObra(o)}</option>)}
            </select>
          </label>
          <label style={lab}>
            <span style={rot}>Situação <AjudaCampo chave="projetos.os_obra.filtro_status" /></span>
            <select value={fStatus} onChange={e => setFStatus(e.target.value as typeof fStatus)} style={inp} data-testid="os-obra-filtro-status">
              <option value="andamento">Em andamento</option>
              <option value="concluida">Concluídas</option>
              <option value="cancelada">Canceladas</option>
              <option value="todas">Todas</option>
            </select>
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button type="button" onClick={novo} style={{ ...btn(ESP, '#fff'), flex: 1 }} data-testid="os-obra-nova">+ Nova OS</button>
            <AjudaCampo chave="projetos.os_obra.nova" />
          </div>
        </div>

        {erro && <p role="alert" style={{ color: VERM, margin: '0 0 12px' }}>{erro}</p>}

        {aberto && (
          <form onSubmit={salvar} data-testid="os-obra-form" style={{ background: '#fff', border: `1px solid ${GOLD}55`, borderRadius: 14, padding: 16, marginBottom: 16, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
            <h2 style={{ gridColumn: '1 / -1', margin: 0, fontSize: 17 }}>{editando ? 'Editar OS' : 'Nova OS de obra'}</h2>
            <label style={lab}>
              <span style={rot}>Obra * <AjudaCampo chave="projetos.os_obra.obra" /></span>
              <select value={f.obra_id} disabled={!!editando} onChange={e => setF({ ...f, obra_id: e.target.value, tarefa_id: '', obra_item_id: '' })} style={inp} data-testid="os-obra-obra">
                <option value="">Escolha a obra…</option>
                {obrasForm.map(o => <option key={o.id} value={o.id}>{nomeObra(o)}</option>)}
              </select>
            </label>
            <label style={lab}>
              <span style={rot}>Etapa <AjudaCampo chave="projetos.os_obra.etapa" /></span>
              <select value={f.tarefa_id} onChange={e => setF({ ...f, tarefa_id: e.target.value })} disabled={!f.obra_id} style={inp} data-testid="os-obra-etapa">
                <option value="">{f.obra_id && etapas.length === 0 ? 'Obra sem cronograma' : 'Sem etapa'}</option>
                {etapas.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
            </label>
            <label style={lab}>
              <span style={rot}>Serviço <AjudaCampo chave="projetos.os_obra.servico" /></span>
              <select value={f.obra_item_id} onChange={e => setF({ ...f, obra_item_id: e.target.value })} disabled={!f.obra_id} style={inp} data-testid="os-obra-servico">
                <option value="">{f.obra_id && servicos.length === 0 ? 'Obra sem serviços contratados' : 'Sem serviço'}</option>
                {servicos.map(s => <option key={s.id} value={s.id}>{s.descricao ?? 'Serviço'}</option>)}
              </select>
            </label>
            <label style={{ ...lab, gridColumn: '1 / -1' }}>
              <span style={rot}>O que fazer * <AjudaCampo chave="projetos.os_obra.descricao" /></span>
              <textarea value={f.descricao} onChange={e => setF({ ...f, descricao: e.target.value })} rows={3} placeholder="Ex.: fechar o forro das salas 201 a 205 (85 m²)" style={{ ...inp, resize: 'vertical' }} data-testid="os-obra-descricao" />
            </label>
            <label style={lab}>
              <span style={rot}>Equipe <AjudaCampo chave="projetos.os_obra.equipe" /></span>
              <input value={f.equipe} onChange={e => setF({ ...f, equipe: e.target.value })} placeholder="Ex.: equipe do João — 2 gesseiros" style={inp} data-testid="os-obra-equipe" />
            </label>
            <label style={lab}>
              <span style={rot}>Responsável <AjudaCampo chave="projetos.os_obra.responsavel" /></span>
              <input value={f.responsavel} onChange={e => setF({ ...f, responsavel: e.target.value })} placeholder="Ex.: Eng. Carla" style={inp} data-testid="os-obra-responsavel" />
            </label>
            <label style={lab}>
              <span style={rot}>Para quando <AjudaCampo chave="projetos.os_obra.data_prevista" /></span>
              <input type="date" value={f.data_prevista} onChange={e => setF({ ...f, data_prevista: e.target.value })} style={inp} data-testid="os-obra-data" />
            </label>
            <label style={lab}>
              <span style={rot}>Prioridade <AjudaCampo chave="projetos.os_obra.prioridade" /></span>
              <select value={f.prioridade} onChange={e => setF({ ...f, prioridade: e.target.value })} style={inp} data-testid="os-obra-prioridade">
                {PRIORIDADES.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
              </select>
            </label>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="submit" disabled={salvando} style={btn(ESP, '#fff')} data-testid="os-obra-salvar">{salvando ? 'Salvando…' : 'Salvar OS'}</button>
              <AjudaCampo chave="projetos.os_obra.salvar" />
              <button type="button" onClick={fechar} style={btn('#fff', ESP)}>Cancelar</button>
            </div>
          </form>
        )}

        {loading && <p data-testid="os-obra-carregando">Carregando…</p>}
        {!loading && visiveis.length === 0 && (
          <div data-testid="os-obra-vazio" style={{ background: '#fff', border: `1px dashed ${LINE}`, borderRadius: 14, padding: 24, textAlign: 'center', color: MUT, fontSize: 14, lineHeight: 1.6 }}>
            {lista.length === 0 ? 'Nenhuma OS de obra ainda. Clique em "Nova OS" para mandar a primeira equipe a campo.' : 'Nenhuma OS com esses filtros.'}
          </div>
        )}
        {!loading && visiveis.length > 0 && (
          <>
            <div style={{ ...rot, fontSize: 13, color: MUT, margin: '0 0 8px' }}>
              {visiveis.length} OS · Avançar a OS <AjudaCampo chave="projetos.os_obra.acoes" />
            </div>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))' }} data-testid="os-obra-lista">
              {visiveis.map(o => {
                const st = STATUS[o.status]
                const atrasada = o.data_prevista && o.data_prevista < hoje() && (o.status === 'aberta' || o.status === 'em_execucao')
                return (
                  <article key={o.id} data-testid="os-obra-cartao" style={{ background: '#fff', border: `1px solid ${o.prioridade === 'urgente' ? VERM : LINE}`, borderRadius: 14, padding: 14, display: 'grid', gap: 8, opacity: ocupado === o.id ? 0.5 : 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                      <span style={{ fontFamily: 'ui-monospace,monospace', fontWeight: 700, fontSize: 15 }}>{o.numero}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: st.cor, background: st.fundo, borderRadius: 999, padding: '3px 10px' }}>{st.rotulo}</span>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.4 }}>{o.descricao}</div>
                    <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px', fontSize: 13 }}>
                      <dt style={{ color: MUT }}>Obra</dt><dd style={{ margin: 0 }}>{nomeObra(o)}</dd>
                      {o.etapa && <><dt style={{ color: MUT }}>Etapa</dt><dd style={{ margin: 0 }}>{o.etapa}</dd></>}
                      {o.servico && <><dt style={{ color: MUT }}>Serviço</dt><dd style={{ margin: 0 }}>{o.servico}</dd></>}
                      {o.equipe && <><dt style={{ color: MUT }}>Equipe</dt><dd style={{ margin: 0 }}>{o.equipe}</dd></>}
                      {o.responsavel && <><dt style={{ color: MUT }}>Responsável</dt><dd style={{ margin: 0 }}>{o.responsavel}</dd></>}
                      {o.data_prevista && <><dt style={{ color: MUT }}>Para</dt><dd style={{ margin: 0, color: atrasada ? VERM : ESP, fontWeight: atrasada ? 700 : 400 }}>{dataBR(o.data_prevista)}{atrasada ? ' · atrasada' : ''}</dd></>}
                      {o.prioridade !== 'normal' && <><dt style={{ color: MUT }}>Prioridade</dt><dd style={{ margin: 0, color: o.prioridade === 'urgente' ? VERM : ESP }}>{PRIORIDADES.find(p => p[0] === o.prioridade)?.[1]}</dd></>}
                      {horasOS[o.id] && <><dt style={{ ...rot, color: MUT }}>Horas <AjudaCampo chave="projetos.os_obra.horas_apontadas" /></dt>
                        <dd style={{ margin: 0, fontWeight: 600 }} data-testid="os-obra-horas-total">{horasOS[o.id].horas.toLocaleString('pt-BR')} h · {brl(horasOS[o.id].valor)}</dd></>}
                    </dl>
                    {apontando === o.id && (
                      <form onSubmit={e => lancarHoras(e, o)} data-testid="os-obra-horas-form" style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr', background: BG, borderRadius: 10, padding: 10 }}>
                        <label style={lab}><span style={rot}>Dia <AjudaCampo chave="projetos.os_obra.apontar_data" /></span>
                          <input type="date" value={fh.data} onChange={e => setFh({ ...fh, data: e.target.value })} style={inp} data-testid="os-obra-horas-data" /></label>
                        <label style={lab}><span style={rot}>Função <AjudaCampo chave="projetos.os_obra.apontar_funcao" /></span>
                          <select value={fh.funcao_id} onChange={e => escolherFuncao(e.target.value)} style={inp} data-testid="os-obra-horas-funcao">
                            <option value="">Sem função</option>{funcoes.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
                        <label style={lab}><span style={rot}>Horas <AjudaCampo chave="projetos.os_obra.apontar_horas" /></span>
                          <input inputMode="decimal" value={fh.horas} onChange={e => setFh({ ...fh, horas: e.target.value })} placeholder="Ex.: 16" style={inp} data-testid="os-obra-horas-horas" /></label>
                        <label style={lab}><span style={rot}>R$/hora <AjudaCampo chave="projetos.os_obra.apontar_custo_hora" /></span>
                          <input inputMode="decimal" value={fh.custo_hora} onChange={e => setFh({ ...fh, custo_hora: e.target.value })} placeholder="Ex.: 45,00" style={inp} data-testid="os-obra-horas-custo" /></label>
                        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <button type="submit" disabled={!!ocupado} style={btn(ESP, '#fff')} data-testid="os-obra-horas-lancar">
                            Lançar{num(fh.horas) > 0 && num(fh.custo_hora) >= 0 && fh.custo_hora !== '' ? ` ${brl(Math.round(num(fh.horas) * num(fh.custo_hora) * 100) / 100)}` : ''}</button>
                          <AjudaCampo chave="projetos.os_obra.apontar_lancar" />
                          <button type="button" onClick={() => setApontando(null)} style={btn('#fff', ESP)}>Fechar</button>
                        </div>
                      </form>
                    )}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                      {o.status === 'aberta' && <button type="button" disabled={!!ocupado} onClick={() => mudar(o, 'em_execucao')} style={btn(GOLD, ESP)} data-testid="os-obra-iniciar">Iniciar</button>}
                      {o.status === 'em_execucao' && <button type="button" disabled={!!ocupado} onClick={() => mudar(o, 'concluida')} style={btn(VERDE, '#fff')} data-testid="os-obra-concluir">Concluir</button>}
                      {(o.status === 'aberta' || o.status === 'em_execucao') && <span style={rot}><button type="button" disabled={!!ocupado} onClick={() => abrirHoras(o)} style={btn('#fff', ESP)} data-testid="os-obra-apontar">Apontar horas</button><AjudaCampo chave="projetos.os_obra.apontar" /></span>}
                      {(o.status === 'aberta' || o.status === 'em_execucao') && <button type="button" disabled={!!ocupado} onClick={() => editar(o)} style={btn('#fff', ESP)}>Editar</button>}
                      {(o.status === 'aberta' || o.status === 'em_execucao') && <button type="button" disabled={!!ocupado} onClick={() => mudar(o, 'cancelada')} style={btn('#fff', VERM)}>Cancelar</button>}
                      {o.status === 'cancelada' && <button type="button" disabled={!!ocupado} onClick={() => mudar(o, 'aberta')} style={btn('#fff', ESP)}>Reabrir</button>}
                      {o.status === 'cancelada' && <button type="button" disabled={!!ocupado} onClick={() => excluir(o)} style={btn('#fff', VERM)}>Excluir</button>}
                    </div>
                  </article>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
