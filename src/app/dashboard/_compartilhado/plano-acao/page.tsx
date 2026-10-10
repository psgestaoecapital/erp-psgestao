'use client'

// Plano de Ação 5W2H — tela COMPARTILHADA (Indústria primeiro). Ações nascem nas reuniões/rotinas da empresa.
// Visões: por reunião (pauta da próxima = pendências abertas), minhas ações, atrasadas, Kanban. Ata em PDF (imprimir).
// Quem não é dono da ação só comenta (RLS). "Atrasada" é calculada, não gravada.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { STATUS, DIAS, atrasada, pendente, vencendo, dataBR, reais, hojeISO, type StatusAcao } from '@/lib/planoAcao/regras'

type Rotina = { id: string; nome: string; dia_semana: number | null; horario: string | null; ativa: boolean }
type Acao = {
  id: string; rotina_id: string | null; o_que: string; por_que: string | null; onde: string | null; quando: string | null
  quem_id: string | null; como: string | null; quanto: number | null; status: StatusAcao; prioridade: 'baixa' | 'media' | 'alta'
  evidencia_url: string | null; criado_por: string | null
}
type Pessoa = { id: string; nome: string }
type Hist = { id: string; tipo: string; texto: string | null; autor_id: string | null; criado_em: string }
type Visao = 'reuniao' | 'minhas' | 'atrasadas' | 'kanban'
const VAZIA = { o_que: '', por_que: '', onde: '', quando: '', quem_id: '', como: '', quanto: '', prioridade: 'media', evidencia_url: '' }
const inp = 'w-full rounded-lg border border-[#3D2314]/20 bg-white px-3 py-2 text-[14px]'
const cartao = 'rounded-2xl border border-[#3D2314]/10 bg-white p-4'

export default function PlanoAcaoPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [uid, setUid] = useState<string | null>(null)
  const [rotinas, setRotinas] = useState<Rotina[]>([])
  const [acoes, setAcoes] = useState<Acao[]>([])
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [visao, setVisao] = useState<Visao>('reuniao')
  const [rotinaSel, setRotinaSel] = useState<string>('')
  const [form, setForm] = useState({ ...VAZIA })
  const [novaRotina, setNovaRotina] = useState({ nome: '', dia: '3', horario: '08:00' })
  const [aberta, setAberta] = useState<Acao | null>(null)
  const [hist, setHist] = useState<Hist[]>([])
  const [coment, setComent] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa) return
    const { data: { user } } = await supabase.auth.getUser()
    setUid(user?.id ?? null)
    const [r, a, u] = await Promise.all([
      supabase.from('erp_pa_rotina').select('id, nome, dia_semana, horario, ativa').eq('company_id', empresa).order('nome'),
      supabase.from('erp_pa_acao').select('id, rotina_id, o_que, por_que, onde, quando, quem_id, como, quanto, status, prioridade, evidencia_url, criado_por').eq('company_id', empresa).order('quando', { ascending: true, nullsFirst: false }).limit(1000),
      supabase.rpc('fn_usuarios_da_empresa', { p_company_id: empresa }),
    ])
    const e = r.error || a.error
    if (e) { setErro(e.message); return }
    setErro(null)
    setRotinas((r.data ?? []) as Rotina[]); setAcoes((a.data ?? []) as Acao[])
    setPessoas(((u.data ?? []) as { id: string; full_name: string | null; email: string | null; is_active: boolean }[])
      .filter((x) => x.is_active).map((x) => ({ id: x.id, nome: x.full_name || x.email || 'usuário' }))
      .sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR')))
  }, [empresa])
  useEffect(() => { void carregar() }, [carregar])

  const nomeDe = (id: string | null) => pessoas.find((p) => p.id === id)?.nome ?? '—'
  const rotinaDe = (id: string | null) => rotinas.find((r) => r.id === id)?.nome ?? 'Sem reunião'
  const hoje = hojeISO()

  const lista = useMemo(() => {
    if (visao === 'minhas') return acoes.filter((a) => a.quem_id === uid && pendente(a))
    if (visao === 'atrasadas') return acoes.filter((a) => atrasada(a, hoje))
    if (visao === 'reuniao') return acoes.filter((a) => (rotinaSel ? a.rotina_id === rotinaSel : true) && pendente(a))
    return acoes
  }, [acoes, visao, uid, rotinaSel, hoje])
  const avisos = acoes.filter((a) => a.quem_id === uid && (atrasada(a, hoje) || vencendo(a, hoje)))

  async function criarRotina() {
    if (!empresa || !novaRotina.nome.trim()) return
    const { error } = await supabase.from('erp_pa_rotina').insert({ company_id: empresa, nome: novaRotina.nome.trim(), dia_semana: Number(novaRotina.dia), horario: novaRotina.horario || null })
    if (error) { setErro(error.message); return }
    setNovaRotina({ nome: '', dia: '3', horario: '08:00' }); await carregar()
  }
  async function criarAcao(e: React.FormEvent) {
    e.preventDefault()
    if (!empresa || !form.o_que.trim()) { setErro('Diga O QUÊ precisa ser feito.'); return }
    const { error } = await supabase.from('erp_pa_acao').insert({
      company_id: empresa, rotina_id: rotinaSel || null, o_que: form.o_que.trim(), por_que: form.por_que || null, onde: form.onde || null,
      quando: form.quando || null, quem_id: form.quem_id || null, como: form.como || null,
      quanto: form.quanto ? Number(form.quanto.replace(',', '.')) : null, prioridade: form.prioridade, evidencia_url: form.evidencia_url || null,
    })
    if (error) { setErro(error.message); return }
    setForm({ ...VAZIA }); setMsg('Ação registrada.'); await carregar()
  }
  const podeEditar = (a: Acao) => a.quem_id === uid || a.criado_por === uid
  async function mudarStatus(a: Acao, status: StatusAcao) {
    const { error } = await supabase.from('erp_pa_acao').update({ status }).eq('id', a.id)
    if (error) { setErro(error.message); return }
    await carregar()
  }
  async function abrir(a: Acao) {
    setAberta(a)
    const { data } = await supabase.from('erp_pa_historico').select('id, tipo, texto, autor_id, criado_em').eq('acao_id', a.id).order('criado_em')
    setHist((data ?? []) as Hist[])
  }
  async function comentar() {
    if (!aberta || !empresa || !coment.trim()) return
    const { error } = await supabase.from('erp_pa_historico').insert({ company_id: empresa, acao_id: aberta.id, autor_id: uid, tipo: 'comentario', texto: coment.trim() })
    if (error) { setErro(error.message); return }
    setComent(''); await abrir(aberta)
  }
  function ata() {
    const r = rotinas.find((x) => x.id === rotinaSel)
    const linhas = lista.map((a) => `<tr><td>${esc(a.o_que)}</td><td>${esc(a.por_que)}</td><td>${esc(a.onde)}</td><td>${dataBR(a.quando)}</td><td>${esc(nomeDe(a.quem_id))}</td><td>${esc(a.como)}</td><td>${reais(a.quanto)}</td><td>${STATUS.find((s) => s.id === a.status)?.nome}</td></tr>`).join('')
    const w = window.open('', '_blank')
    if (!w) { setErro('Libere pop-ups para gerar a ata.'); return }
    w.document.write(`<html><head><title>Ata</title><style>body{font:13px sans-serif;padding:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px;text-align:left}</style></head><body><h2>Ata — ${esc(r?.nome ?? 'Plano de ação')}</h2><p>Emitida em ${dataBR(hoje)}</p><table><tr><th>O quê</th><th>Por quê</th><th>Onde</th><th>Quando</th><th>Quem</th><th>Como</th><th>Quanto</th><th>Status</th></tr>${linhas}</table></body></html>`)
    w.document.close(); w.print()
  }

  if (!empresa) return <div className="p-4">Selecione uma empresa.</div>
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <h1 className="text-xl font-semibold text-[#3D2314]">Plano de ação 5W2H</h1>
      {erro && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}
      {msg && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{msg}</div>}
      {avisos.length > 0 && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Você tem {avisos.filter((a) => atrasada(a, hoje)).length} ação(ões) atrasada(s) e {avisos.filter((a) => vencendo(a, hoje)).length} vencendo em até 2 dias.
        </div>
      )}

      <section className={cartao}>
        <div className="mb-2 text-xs font-semibold uppercase text-[#3D2314]/60">Reuniões e rotinas</div>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Reunião" className={inp + ' max-w-xs'} value={rotinaSel} onChange={(e) => setRotinaSel(e.target.value)}>
            <option value="">Todas / sem reunião</option>
            {rotinas.map((r) => <option key={r.id} value={r.id}>{r.nome}{r.dia_semana != null ? ` — ${DIAS[r.dia_semana]} ${r.horario?.slice(0, 5) ?? ''}` : ''}</option>)}
          </select>
          <input aria-label="Nova rotina" placeholder="Nova rotina (ex.: Produtividade – Supervisores)" className={inp + ' max-w-xs'} value={novaRotina.nome} onChange={(e) => setNovaRotina({ ...novaRotina, nome: e.target.value })} />
          <select aria-label="Dia" className={inp + ' max-w-[9rem]'} value={novaRotina.dia} onChange={(e) => setNovaRotina({ ...novaRotina, dia: e.target.value })}>{DIAS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
          <input aria-label="Horário" type="time" className={inp + ' max-w-[7rem]'} value={novaRotina.horario} onChange={(e) => setNovaRotina({ ...novaRotina, horario: e.target.value })} />
          <button type="button" onClick={criarRotina} className="rounded-lg bg-[#3D2314] px-3 py-2 text-sm text-white">Criar rotina</button>
        </div>
      </section>

      <form onSubmit={criarAcao} className={cartao + ' grid gap-2 sm:grid-cols-2'}>
        <div className="sm:col-span-2 text-xs font-semibold uppercase text-[#3D2314]/60">Nova ação (registre rápido durante a reunião)</div>
        <input aria-label="O quê" placeholder="O quê *" className={inp + ' sm:col-span-2'} value={form.o_que} onChange={(e) => setForm({ ...form, o_que: e.target.value })} />
        <input aria-label="Por quê" placeholder="Por quê" className={inp} value={form.por_que} onChange={(e) => setForm({ ...form, por_que: e.target.value })} />
        <input aria-label="Onde" placeholder="Onde (setor/planta)" className={inp} value={form.onde} onChange={(e) => setForm({ ...form, onde: e.target.value })} />
        <input aria-label="Quando" type="date" className={inp} value={form.quando} onChange={(e) => setForm({ ...form, quando: e.target.value })} />
        <select aria-label="Quem" className={inp} value={form.quem_id} onChange={(e) => setForm({ ...form, quem_id: e.target.value })}>
          <option value="">Quem (responsável)</option>{pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
        <input aria-label="Como" placeholder="Como" className={inp} value={form.como} onChange={(e) => setForm({ ...form, como: e.target.value })} />
        <input aria-label="Quanto" inputMode="decimal" placeholder="Quanto (custo estimado)" className={inp} value={form.quanto} onChange={(e) => setForm({ ...form, quanto: e.target.value })} />
        <select aria-label="Prioridade" className={inp} value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value })}><option value="baixa">Prioridade baixa</option><option value="media">Prioridade média</option><option value="alta">Prioridade alta</option></select>
        <input aria-label="Evidência (link da foto/anexo)" placeholder="Evidência (link da foto/anexo)" className={inp} value={form.evidencia_url} onChange={(e) => setForm({ ...form, evidencia_url: e.target.value })} />
        <button className="rounded-lg bg-[#C8941A] px-3 py-2 font-medium text-white sm:col-span-2">Registrar ação</button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        {([['reuniao', 'Por reunião (pauta)'], ['minhas', 'Minhas ações'], ['atrasadas', 'Atrasadas'], ['kanban', 'Kanban']] as [Visao, string][]).map(([v, n]) => (
          <button key={v} type="button" onClick={() => setVisao(v)} className={`rounded-full px-3 py-1.5 text-sm ${visao === v ? 'bg-[#3D2314] text-white' : 'bg-[#3D2314]/10'}`}>{n}</button>
        ))}
        <button type="button" onClick={ata} className="ml-auto rounded-lg border border-[#3D2314]/30 px-3 py-1.5 text-sm">Ata em PDF</button>
      </div>

      {visao === 'kanban' ? (
        <div className="grid gap-3 md:grid-cols-4">
          {STATUS.map((s) => (
            <div key={s.id} className="rounded-2xl bg-[#3D2314]/5 p-2">
              <div className="mb-2 text-sm font-semibold">{s.nome} ({acoes.filter((a) => a.status === s.id).length})</div>
              {acoes.filter((a) => a.status === s.id).map((a) => <Cartao key={a.id} a={a} />)}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {lista.length === 0 && <div className="text-sm text-[#3D2314]/60">Nenhuma ação nesta visão.</div>}
          {lista.map((a) => <Cartao key={a.id} a={a} />)}
        </div>
      )}

      {aberta && (
        <section className={cartao}>
          <div className="flex justify-between"><b>{aberta.o_que}</b><button type="button" onClick={() => setAberta(null)}>Fechar</button></div>
          <div className="text-sm text-[#3D2314]/70">Como: {aberta.como ?? '—'} · Por quê: {aberta.por_que ?? '—'} · Evidência: {aberta.evidencia_url ? <a className="underline" href={aberta.evidencia_url} target="_blank" rel="noreferrer">abrir</a> : '—'}</div>
          <ul className="my-2 space-y-1 text-sm">{hist.map((h) => <li key={h.id}><span className="text-[#3D2314]/50">{new Date(h.criado_em).toLocaleString('pt-BR')} · {nomeDe(h.autor_id)} · {h.tipo}</span> {h.texto}</li>)}</ul>
          <div className="flex gap-2"><input aria-label="Comentário" className={inp} placeholder="Comentar (qualquer pessoa da empresa)" value={coment} onChange={(e) => setComent(e.target.value)} /><button type="button" onClick={comentar} className="rounded-lg bg-[#3D2314] px-3 text-white">Enviar</button></div>
        </section>
      )}
    </div>
  )

  function Cartao({ a }: { a: Acao }) {
    const atr = atrasada(a, hoje)
    return (
      <div className={`${cartao} ${atr ? 'border-red-300' : ''}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <button type="button" onClick={() => abrir(a)} className="text-left font-medium">{a.o_que}</button>
          {atr && <span className="rounded bg-red-100 px-2 text-xs text-red-700">Atrasada</span>}
        </div>
        <div className="mt-1 text-xs text-[#3D2314]/70">{rotinaDe(a.rotina_id)} · {nomeDe(a.quem_id)} · prazo {dataBR(a.quando)} · prioridade {a.prioridade}{a.onde ? ` · ${a.onde}` : ''}</div>
        {podeEditar(a)
          ? <select aria-label="Status" className="mt-2 rounded border px-2 py-1 text-sm" value={a.status} onChange={(e) => mudarStatus(a, e.target.value as StatusAcao)}>{STATUS.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select>
          : <div className="mt-2 text-xs">Status: {STATUS.find((s) => s.id === a.status)?.nome} (só o responsável altera; você pode comentar)</div>}
      </div>
    )
  }
}

const esc = (s: string | null) => (s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
