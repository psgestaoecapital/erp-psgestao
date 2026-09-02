'use client'

// Revenda de Veículos · Ondas 1-2 — ficha do veículo. Dados, custos (com os 3 estados fiscais),
// custo acumulado + preço mínimo (rotulado "antes de impostos" §3.5), linha do tempo, situação por RPC.

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC', blue: '#2F5AA8',
}
const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none' }
const brl = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const brDate = (d: string) => d ? String(d).slice(0, 10).split('-').reverse().join('/') : ''
const SIT = ['em_preparacao', 'disponivel', 'reservado', 'vendido', 'entregue', 'devolvido']
const CATS = ['aquisicao', 'documentacao', 'despachante', 'preparacao', 'peca', 'mao_de_obra', 'debito_assumido', 'frete', 'comissao', 'outro']

type Veic = { id: string; company_id: string; chassi: string; placa: string | null; marca: string | null; modelo: string | null; ano_modelo: number | null; cor: string | null; situacao: string; origem: string | null; data_entrada: string; valor_aquisicao: number | null }
type Custo = { id: string; categoria: string; descricao: string | null; valor: number; fornecedor_nome: string | null; data_custo: string; entra_base_fiscal: boolean | null; pagar_id: string | null }
type Evento = { id: string; tipo: string; descricao: string | null; data_evento: string }

export default function FichaPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const params = useParams()
  const id = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params!.id[0] : ''
  const [v, setV] = useState<Veic | null>(null)
  const [custos, setCustos] = useState<Custo[]>([])
  const [eventos, setEventos] = useState<Evento[]>([])
  const [margem, setMargem] = useState(20)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!id) return
    const { data: vd, error: ve } = await supabase.from('veic_veiculo').select('*').eq('id', id).is('deleted_at', null).maybeSingle()
    if (ve) { setErro(ve.message); return }
    setV(vd as Veic | null)
    const comp = (vd as Veic | null)?.company_id
    const [cs, es, cfg] = await Promise.all([
      supabase.from('veic_custo').select('*').eq('veiculo_id', id).is('deleted_at', null).order('data_custo'),
      supabase.from('veic_veiculo_evento').select('*').eq('veiculo_id', id).order('data_evento', { ascending: false }),
      comp ? supabase.from('veic_config').select('margem_alvo_pct').eq('company_id', comp).maybeSingle() : Promise.resolve({ data: null }),
    ])
    setCustos((cs.data as Custo[]) ?? [])
    setEventos((es.data as Evento[]) ?? [])
    const m = (cfg.data as { margem_alvo_pct?: number } | null)?.margem_alvo_pct
    if (m != null) setMargem(Number(m))
  }, [id])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const custoAcumulado = useMemo(() => (v?.valor_aquisicao ?? 0) + custos.reduce((s, c) => s + (Number(c.valor) || 0), 0), [v, custos])
  const precoMinimo = useMemo(() => custoAcumulado * (1 + margem / 100), [custoAcumulado, margem])

  async function userId() { const { data: { user } } = await supabase.auth.getUser(); return user?.id ?? null }

  async function mudarSituacao(nova: string) {
    const { data, error } = await supabase.rpc('fn_veic_mudar_situacao', { p_veiculo_id: id, p_nova: nova, p_user: await userId(), p_obs: null })
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha'); return }
    setMsg('Situação atualizada.'); void carregar()
  }
  async function excluirCusto(custoId: string) {
    const { data, error } = await supabase.rpc('fn_veic_custo_excluir', { p_custo_id: custoId, p_user: await userId() })
    const r = data as { ok?: boolean; erro?: string; tinha_titulo?: boolean } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha'); return }
    setMsg(r.tinha_titulo ? '⚠️ Custo excluído. O título em Contas a Pagar NÃO foi excluído — trate-o no financeiro.' : 'Custo excluído.')
    void carregar()
  }

  if (!v) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>{erro ?? 'Carregando veículo…'}</div>

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 980, margin: '0 auto', color: C.esp }}>
      <a href="/dashboard/revenda/patio" style={{ fontSize: 12, color: C.blue, textDecoration: 'none' }}>← voltar ao pátio</a>
      {msg && <div style={{ background: C.amberBg, color: C.amber, padding: '9px 13px', borderRadius: 8, fontSize: 13, margin: '10px 0' }} onClick={() => setMsg(null)}>{msg}</div>}
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, margin: '10px 0' }} onClick={() => setErro(null)}>{erro}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{v.marca || ''} {v.modelo || 'Veículo'} {v.ano_modelo ? `· ${v.ano_modelo}` : ''}</h1>
          <div style={{ fontSize: 13, color: C.espM, fontFamily: 'monospace' }}>{v.placa || 'sem placa'} · chassi {v.chassi}</div>
        </div>
        <label style={{ fontSize: 12, color: C.espM }}>Situação&nbsp;
          <select value={v.situacao} onChange={(e) => void mudarSituacao(e.target.value)} style={inp}>{SIT.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, margin: '14px 0' }}>
        <Card l="Entrada" v={brDate(v.data_entrada)} />
        <Card l="Aquisição" v={brl(v.valor_aquisicao ?? 0)} />
        <Card l="Custo acumulado" v={brl(custoAcumulado)} destaque />
        <Card l={`Preço mínimo (margem ${margem}%)`} v={brl(precoMinimo)} sub="antes de impostos — cálculo fiscal é a Onda 4" />
      </div>

      <Bloco titulo="Custos no chassi">
        <NovoCusto veiculoId={id} onSaved={() => { setMsg('Custo lançado.'); void carregar() }} onErro={setErro} />
        {custos.length === 0 ? <div style={{ fontSize: 12, color: C.espL, fontStyle: 'italic', marginTop: 8 }}>Nenhum custo ainda.</div> : (
          <div style={{ marginTop: 10 }}>
            {custos.map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, borderTop: `1px solid ${C.cream}`, padding: '7px 0', flexWrap: 'wrap' }}>
                <b style={{ minWidth: 110 }}>{c.categoria.replace('_', ' ')}</b>
                <span>{brl(c.valor)}</span>
                {c.fornecedor_nome && <span style={{ color: C.espM }}>· {c.fornecedor_nome}</span>}
                <span style={{ color: C.espL, fontSize: 11 }}>{brDate(c.data_custo)}</span>
                {/* 3 estados fiscais — NULL nunca vira "fora da base" (§3.2/§4.1) */}
                {c.entra_base_fiscal === null
                  ? <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.amberBg, color: C.amber }} title="Item 2.5 do questionário do contador">aguarda contador</span>
                  : c.entra_base_fiscal
                    ? <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.greenBg, color: C.green }}>entra na base fiscal</span>
                    : <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.cream, color: C.espM }}>fora da base</span>}
                {c.pagar_id && <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: '#E8EEF9', color: C.blue }}>tem título</span>}
                <button onClick={() => void excluirCusto(c.id)} style={{ marginLeft: 'auto', border: 'none', background: 'none', color: C.red, cursor: 'pointer', fontSize: 12 }}>excluir</button>
              </div>
            ))}
          </div>
        )}
      </Bloco>

      <Bloco titulo="Linha do tempo">
        {eventos.length === 0 ? <div style={{ fontSize: 12, color: C.espL }}>Sem eventos.</div> : eventos.map((e) => (
          <div key={e.id} style={{ fontSize: 12.5, borderLeft: `2px solid ${C.gold}`, paddingLeft: 10, margin: '6px 0' }}>
            <b>{e.tipo}</b> · {e.descricao} <span style={{ color: C.espL }}>· {brDate(e.data_evento)} {String(e.data_evento).slice(11, 16)}</span>
          </div>
        ))}
      </Bloco>
    </div>
  )
}

function NovoCusto({ veiculoId, onSaved, onErro }: { veiculoId: string; onSaved: () => void; onErro: (m: string) => void }) {
  const [f, setF] = useState({ categoria: 'despachante', valor: '', fornecedor_nome: '', data_custo: '', gerar: false, vencimento: '' })
  const [busy, setBusy] = useState(false)
  async function salvar() {
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.rpc('fn_veic_custo_salvar', {
      p_veiculo_id: veiculoId,
      p_custo: { categoria: f.categoria, valor: Number(f.valor), fornecedor_nome: f.fornecedor_nome.trim() || null, data_custo: f.data_custo || null },
      p_gerar_pagar: f.gerar, p_vencimento: f.gerar ? (f.vencimento || null) : null, p_user: user?.id ?? null,
    })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { onErro(r?.erro === 'vencimento_obrigatorio_para_titulo' ? 'Para gerar título, informe o vencimento.' : (error?.message || 'Falha')); return }
    setF({ categoria: 'despachante', valor: '', fornecedor_nome: '', data_custo: '', gerar: false, vencimento: '' }); onSaved()
  }
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} style={inp}>{CATS.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}</select>
      <input value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} placeholder="valor" style={{ ...inp, width: 100 }} />
      <input value={f.fornecedor_nome} onChange={(e) => setF({ ...f, fornecedor_nome: e.target.value })} placeholder="fornecedor" style={{ ...inp, width: 140 }} />
      <input type="date" value={f.data_custo} onChange={(e) => setF({ ...f, data_custo: e.target.value })} style={inp} />
      <label style={{ fontSize: 12, color: C.espM, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <input type="checkbox" checked={f.gerar} onChange={(e) => setF({ ...f, gerar: e.target.checked })} /> gerar título em contas a pagar
      </label>
      {f.gerar && <label style={{ fontSize: 11, color: C.espM }}>venc.<input type="date" value={f.vencimento} onChange={(e) => setF({ ...f, vencimento: e.target.value })} style={{ ...inp, marginLeft: 4 }} /></label>}
      <button disabled={!f.valor || busy} onClick={() => void salvar()} style={{ padding: '8px 14px', border: 'none', borderRadius: 8, background: f.valor && !busy ? C.gold : C.espL, color: C.white, fontWeight: 700, cursor: f.valor && !busy ? 'pointer' : 'not-allowed' }}>+ Custo</button>
    </div>
  )
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 14 }}><div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{titulo}</div>{children}</div>
}
function Card({ l, v, sub, destaque }: { l: string; v: string; sub?: string; destaque?: boolean }) {
  return (
    <div style={{ background: destaque ? '#FDF7E8' : C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, color: C.espM }}>{l}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: destaque ? C.gold : C.esp, marginTop: 2 }}>{v}</div>
      {sub && <div style={{ fontSize: 10.5, color: C.amber, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
