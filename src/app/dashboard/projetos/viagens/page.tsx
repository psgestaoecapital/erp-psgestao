'use client'

// Viagem · fechamento administrativo (CEO 30/09 e 01/10): só viagens NOVAS. O administrativo abre a viagem, lança os
// cupons (despesa ou abastecimento, cada um com a SUA obra — rateio), confere o adiantamento (5.01) × gastos × saldo
// (5.02) e fecha. Gravação só pelas funções do banco (fn_viagem_*); o fechamento emite o evento 'viagem_fechada' e o
// título nasce no GE — esta tela nunca lança financeiro.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { FORMAS_PAGAMENTO_VIAGEM } from '@/lib/viagem/modeloPlanilha'
import { resumoTexto, validarLancamento, type LancamentoForm } from '@/lib/viagem/tela'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF'
type Viagem = { id: string; numero: number; colaborador_nome: string; obra_id: string; periodo_inicio: string; periodo_fim: string; adiantamento: number; status: string; km_inicial: number | null; km_final: number | null; placa: string | null; origem: string | null; destino: string | null }
type Lanc = { id: string; tipo: string; data: string; fornecedor_nome: string; categoria: string; forma_pagamento: string; valor: number; obra_id: string; pago_colaborador: boolean; litros: number | null; hodometro: number | null }
type Resumo = { total: number; adiantamento: number; pago_colaborador: number; saldo: number; km_rodado: number | null; custo_km: number | null }
type Obra = { id: string; numero: string; nome: string }
type Cat = { codigo: string; descricao: string }
const brl = (n: number | null | undefined) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dt = (s: string) => s.split('-').reverse().join('/')
const campo = 'w-full rounded-lg border px-2 py-1.5 text-sm'
const vazio = (obra: string, ini: string): LancamentoForm => ({ tipo: 'despesa', data: ini, fornecedor_nome: '', categoria: '', forma_pagamento: 'dinheiro', valor: '', obra_id: obra, pago_colaborador: true, litros: '', hodometro: '' })

export default function ViagensPage() {
  const { companyIds } = useCompanyIds()
  const empresa = companyIds?.[0] ?? null
  const [viagens, setViagens] = useState<Viagem[]>([])
  const [obras, setObras] = useState<Obra[]>([])
  const [cats, setCats] = useState<Cat[]>([])
  const [aberta, setAberta] = useState<Viagem | null>(null)
  const [lancs, setLancs] = useState<Lanc[]>([])
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [nova, setNova] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [lf, setLf] = useState<LancamentoForm | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const carregar = useCallback(async () => {
    if (!empresa) return
    const [v, o, c] = await Promise.all([
      supabase.from('erp_viagem').select('id,numero,colaborador_nome,obra_id,periodo_inicio,periodo_fim,adiantamento,status,km_inicial,km_final,placa,origem,destino').eq('company_id', empresa).is('excluido_em', null).order('periodo_inicio', { ascending: false }).limit(100),
      supabase.from('projetos_obras').select('id,numero,nome').eq('company_id', empresa).order('numero'),
      supabase.from('erp_plano_contas').select('codigo,descricao').eq('company_id', empresa).eq('ativo', true).order('codigo'),
    ])
    if (v.error) setMsg(v.error.message)
    setViagens((v.data ?? []) as Viagem[]); setObras((o.data ?? []) as Obra[]); setCats((c.data ?? []) as Cat[])
  }, [empresa])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial dos dados da empresa
  useEffect(() => { carregar() }, [carregar])

  const abrir = useCallback(async (v: Viagem) => {
    setAberta(v); setLf(null)
    const [l, r] = await Promise.all([
      supabase.from('erp_viagem_lancamento').select('id,tipo,data,fornecedor_nome,categoria,forma_pagamento,valor,obra_id,pago_colaborador,litros,hodometro').eq('viagem_id', v.id).is('excluido_em', null).order('data'),
      supabase.rpc('fn_viagem_resumo', { p_viagem_id: v.id }),
    ])
    setLancs((l.data ?? []) as Lanc[]); setResumo((r.data as Resumo) ?? null)
  }, [])

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    setBusy(true); setMsg('')
    const { data, error } = await supabase.rpc(fn, args)
    setBusy(false)
    const d = data as { ok?: boolean; erro?: string; erros?: string[] } | null
    if (error || !d?.ok) { setMsg(error?.message ?? d?.erro ?? (d?.erros ?? []).join(' · ') ?? 'Não foi possível salvar'); return null }
    return d
  }
  const obraNome = (id: string) => { const o = obras.find((x) => x.id === id); return o ? `${o.numero} · ${o.nome}` : '—' }
  const totalViagens = useMemo(() => viagens.filter((v) => v.status === 'aberta').length, [viagens])

  async function criar() {
    if (!empresa) return
    const d = await rpc('fn_viagem_salvar', { p_company_id: empresa, p_id: null, p_dados: { ...form, adiantamento: form.adiantamento || '0', origem_registro: 'administrativo' } })
    if (d) { setNova(false); setForm({}); await carregar() }
  }
  async function lancar() {
    if (!aberta || !lf) return
    const erros = validarLancamento(lf, aberta.periodo_inicio, aberta.periodo_fim)
    if (erros.length) { setMsg(erros.join(' · ')); return }
    const d = await rpc('fn_viagem_lancamento_salvar', { p_viagem_id: aberta.id, p_id: null, p_dados: lf })
    if (d) { setLf(vazio(aberta.obra_id, lf.data)); await abrir(aberta) }
  }
  async function excluir(id: string) {
    if (!aberta || !confirm('Excluir este lançamento?')) return
    if (await rpc('fn_viagem_lancamento_excluir', { p_id: id })) await abrir(aberta)
  }
  async function fechar() {
    if (!aberta || !confirm('Fechar a viagem? Depois de fechada ela não se altera e o GE recebe o acerto.')) return
    if (await rpc('fn_viagem_fechar', { p_viagem_id: aberta.id })) { await carregar(); setAberta(null) }
  }

  if (!empresa) return <div className="p-6 text-sm" style={{ color: ESP }}>Escolha uma empresa.</div>
  return (
    <div className="mx-auto max-w-5xl p-4" style={{ background: BG, color: ESP }}>
      <div className="mb-3 flex items-center justify-between">
        <div><h1 className="text-xl font-semibold">Viagens</h1><p className="text-xs opacity-60">Fechamento administrativo · {totalViagens} aberta(s) · só viagens novas</p></div>
        {!aberta && <button className="rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: GOLD }} onClick={() => { setNova(true); setMsg('') }}>Nova viagem</button>}
        {aberta && <button className="text-sm underline" onClick={() => { setAberta(null); setMsg('') }}>← Voltar à lista</button>}
      </div>
      {msg && <div role="alert" className="mb-3 rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-800">{msg}</div>}

      {nova && !aberta && (
        <div className="mb-4 grid gap-2 rounded-xl border bg-white p-3 sm:grid-cols-3" style={{ borderColor: LINE }}>
          <input className={campo} placeholder="Colaborador" onChange={(e) => setForm({ ...form, colaborador_nome: e.target.value })} />
          <input className={campo} placeholder="Placa" onChange={(e) => setForm({ ...form, placa: e.target.value })} />
          <select className={campo} onChange={(e) => setForm({ ...form, obra_id: e.target.value })} defaultValue=""><option value="">Obra principal…</option>{obras.map((o) => <option key={o.id} value={o.id}>{o.numero} · {o.nome}</option>)}</select>
          <label className="text-xs">Saída<input type="date" className={campo} onChange={(e) => setForm({ ...form, periodo_inicio: e.target.value })} /></label>
          <label className="text-xs">Volta<input type="date" className={campo} onChange={(e) => setForm({ ...form, periodo_fim: e.target.value })} /></label>
          <label className="text-xs">Adiantamento (5.01)<input inputMode="decimal" className={campo} onChange={(e) => setForm({ ...form, adiantamento: e.target.value.replace(',', '.') })} /></label>
          <input className={campo} placeholder="Origem" onChange={(e) => setForm({ ...form, origem: e.target.value })} />
          <input className={campo} placeholder="Destino" onChange={(e) => setForm({ ...form, destino: e.target.value })} />
          <div className="flex gap-2"><button disabled={busy} className="rounded-lg px-3 py-1.5 text-sm text-white" style={{ background: ESP }} onClick={criar}>Abrir viagem</button><button className="text-sm underline" onClick={() => setNova(false)}>Cancelar</button></div>
        </div>
      )}

      {!aberta && (viagens.length === 0
        ? <p className="rounded-xl border bg-white p-6 text-center text-sm" style={{ borderColor: LINE }}>Nenhuma viagem ainda. Clique em “Nova viagem” para abrir a primeira — o acerto é lançado aqui, cupom por cupom.</p>
        : <ul className="space-y-2">{viagens.map((v) => (
            <li key={v.id}><button onClick={() => abrir(v)} className="flex w-full items-center justify-between rounded-xl border bg-white p-3 text-left" style={{ borderColor: LINE }}>
              <span><b>Viagem {v.numero}</b> · {v.colaborador_nome}<br /><span className="text-xs opacity-60">{dt(v.periodo_inicio)} a {dt(v.periodo_fim)} · {obraNome(v.obra_id)}</span></span>
              <span className="text-xs font-medium" style={{ color: v.status === 'aberta' ? GOLD : ESP }}>{v.status}</span></button></li>))}</ul>)}

      {aberta && (
        <div className="space-y-3">
          <div className="rounded-xl border bg-white p-3" style={{ borderColor: LINE }}>
            <b>Viagem {aberta.numero} · {aberta.colaborador_nome}</b> <span className="text-xs opacity-60">({aberta.status})</span>
            <div className="text-xs opacity-70">{dt(aberta.periodo_inicio)} a {dt(aberta.periodo_fim)} · {aberta.placa ?? 'sem placa'} · {aberta.origem ?? '—'} → {aberta.destino ?? '—'}</div>
            {resumo && <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div>Total<br /><b>{brl(resumo.total)}</b></div><div>Adiantamento<br /><b>{brl(resumo.adiantamento)}</b></div>
              <div>Pago pelo colaborador<br /><b>{brl(resumo.pago_colaborador)}</b></div><div>Saldo<br /><b>{brl(Math.abs(resumo.saldo))}</b></div>
              <div className="col-span-2 sm:col-span-4 text-xs opacity-80">{resumoTexto(resumo.saldo)}{resumo.km_rodado != null ? ` · ${resumo.km_rodado} km` : ''}{resumo.custo_km != null ? ` · ${brl(resumo.custo_km)}/km` : ''}</div></div>}
          </div>
          <ul className="space-y-1">{lancs.map((l) => (
            <li key={l.id} className="flex items-center justify-between rounded-lg border bg-white px-3 py-2 text-sm" style={{ borderColor: LINE }}>
              <span>{dt(l.data)} · {l.fornecedor_nome} <span className="text-xs opacity-60">· {l.categoria} · {obraNome(l.obra_id)}{l.tipo === 'abastecimento' ? ` · ${l.litros} L` : ''}</span></span>
              <span>{brl(l.valor)} {aberta.status === 'aberta' && <button aria-label="Excluir lançamento" className="ml-2 text-xs underline" onClick={() => excluir(l.id)}>excluir</button>}</span></li>))}
            {lancs.length === 0 && <li className="text-sm opacity-60">Sem lançamentos.</li>}</ul>
          {aberta.status === 'aberta' && (lf ? (
            <div className="grid gap-2 rounded-xl border bg-white p-3 sm:grid-cols-4" style={{ borderColor: LINE }}>
              <select className={campo} value={lf.tipo} onChange={(e) => setLf({ ...lf, tipo: e.target.value as LancamentoForm['tipo'] })}><option value="despesa">Despesa</option><option value="abastecimento">Abastecimento</option></select>
              <input type="date" className={campo} value={lf.data} onChange={(e) => setLf({ ...lf, data: e.target.value })} />
              <input className={campo} placeholder="Fornecedor" value={lf.fornecedor_nome} onChange={(e) => setLf({ ...lf, fornecedor_nome: e.target.value })} />
              <input inputMode="decimal" className={campo} placeholder="Valor" value={lf.valor} onChange={(e) => setLf({ ...lf, valor: e.target.value.replace(',', '.') })} />
              <select className={campo} value={lf.categoria} onChange={(e) => setLf({ ...lf, categoria: e.target.value })}><option value="">Categoria…</option>{cats.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.descricao}</option>)}</select>
              <select className={campo} value={lf.forma_pagamento} onChange={(e) => setLf({ ...lf, forma_pagamento: e.target.value })}>{FORMAS_PAGAMENTO_VIAGEM.map((f) => <option key={f.codigo} value={f.codigo}>{f.rotulo}</option>)}</select>
              <select className={campo} value={lf.obra_id} onChange={(e) => setLf({ ...lf, obra_id: e.target.value })}>{obras.map((o) => <option key={o.id} value={o.id}>{o.numero} · {o.nome}</option>)}</select>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={lf.pago_colaborador} onChange={(e) => setLf({ ...lf, pago_colaborador: e.target.checked })} />Pago pelo colaborador</label>
              {lf.tipo === 'abastecimento' && <><input inputMode="decimal" className={campo} placeholder="Litros" value={lf.litros} onChange={(e) => setLf({ ...lf, litros: e.target.value.replace(',', '.') })} /><input inputMode="decimal" className={campo} placeholder="Hodômetro" value={lf.hodometro} onChange={(e) => setLf({ ...lf, hodometro: e.target.value.replace(',', '.') })} /></>}
              <div className="flex gap-2 sm:col-span-4"><button disabled={busy} className="rounded-lg px-3 py-1.5 text-sm text-white" style={{ background: ESP }} onClick={lancar}>Lançar e novo</button><button className="text-sm underline" onClick={() => setLf(null)}>Fechar formulário</button></div>
            </div>
          ) : (
            <div className="flex gap-2"><button className="rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: GOLD }} onClick={() => setLf(vazio(aberta.obra_id, aberta.periodo_inicio))}>Novo lançamento</button>
              <button disabled={busy || lancs.length === 0} className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-40" style={{ borderColor: ESP }} onClick={fechar}>Fechar viagem</button></div>
          ))}
        </div>
      )}
    </div>
  )
}
