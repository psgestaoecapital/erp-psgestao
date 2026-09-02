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
type Reserva = { id: string; cliente_nome: string | null; valor_sinal: number | null; reservado_ate: string | null; situacao: string; receber_id: string | null }
type Venda = { id: string; cliente_nome: string | null; valor_venda: number | null; desconto_embutido_troca: number | null; valor_entrada: number | null; valor_financiado: number | null; banco_nome: string | null; retorno_banco: number | null; situacao: string }

export default function FichaPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const params = useParams()
  const id = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params!.id[0] : ''
  const [v, setV] = useState<Veic | null>(null)
  const [custos, setCustos] = useState<Custo[]>([])
  const [eventos, setEventos] = useState<Evento[]>([])
  const [reserva, setReserva] = useState<Reserva | null>(null)
  const [venda, setVenda] = useState<Venda | null>(null)
  const [margem, setMargem] = useState(20)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [modal, setModal] = useState<'reserva' | 'venda' | null>(null)

  const carregar = useCallback(async () => {
    if (!id) return
    const { data: vd, error: ve } = await supabase.from('veic_veiculo').select('*').eq('id', id).is('deleted_at', null).maybeSingle()
    if (ve) { setErro(ve.message); return }
    setV(vd as Veic | null)
    const comp = (vd as Veic | null)?.company_id
    const [cs, es, cfg, rs, vs] = await Promise.all([
      supabase.from('veic_custo').select('*').eq('veiculo_id', id).is('deleted_at', null).order('data_custo'),
      supabase.from('veic_veiculo_evento').select('*').eq('veiculo_id', id).order('data_evento', { ascending: false }),
      comp ? supabase.from('veic_config').select('margem_alvo_pct').eq('company_id', comp).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from('veic_reserva').select('id,cliente_nome,valor_sinal,reservado_ate,situacao,receber_id').eq('veiculo_id', id).eq('situacao', 'ativa').is('deleted_at', null).order('created_at', { ascending: false }).limit(1),
      supabase.from('veic_venda').select('id,cliente_nome,valor_venda,desconto_embutido_troca,valor_entrada,valor_financiado,banco_nome,retorno_banco,situacao').eq('veiculo_id', id).is('deleted_at', null).neq('situacao', 'cancelada').order('created_at', { ascending: false }).limit(1),
    ])
    setCustos((cs.data as Custo[]) ?? [])
    setEventos((es.data as Evento[]) ?? [])
    setReserva(((rs.data as Reserva[]) ?? [])[0] ?? null)
    setVenda(((vs.data as Venda[]) ?? [])[0] ?? null)
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
  async function cancelarReserva() {
    if (!reserva) return
    const { data, error } = await supabase.rpc('fn_veic_reserva_cancelar', { p_reserva_id: reserva.id, p_user: await userId() })
    const r = data as { ok?: boolean; erro?: string; tinha_sinal?: boolean } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha'); return }
    setMsg(r.tinha_sinal ? '⚠️ Reserva cancelada. O título do sinal NÃO foi excluído — trate-o no financeiro.' : 'Reserva cancelada.')
    void carregar()
  }
  async function entregarVenda() {
    if (!venda) return
    const { data, error } = await supabase.rpc('fn_veic_venda_entregar', { p_venda_id: venda.id, p_user: await userId(), p_obs: null })
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha'); return }
    setMsg('Veículo entregue.'); void carregar()
  }
  async function cancelarVenda() {
    if (!venda) return
    const { data, error } = await supabase.rpc('fn_veic_venda_cancelar', { p_venda_id: venda.id, p_user: await userId(), p_motivo: null })
    const r = data as { ok?: boolean; erro?: string; titulos_nao_excluidos?: number } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha'); return }
    setMsg(r.titulos_nao_excluidos ? `⚠️ Venda cancelada. ${r.titulos_nao_excluidos} título(s) em Contas a Receber NÃO foram excluídos — trate-os no financeiro.` : 'Venda cancelada.')
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

      <Bloco titulo="Negociação">
        {!venda && !reserva && !['vendido', 'entregue'].includes(v.situacao) && (
          <div style={{ fontSize: 12, color: C.espL, fontStyle: 'italic', marginBottom: 8 }}>Sem reserva ou venda. Reserve o veículo ou registre a venda.</div>
        )}
        {reserva && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, padding: '8px 0' }}>
            <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.amberBg, color: C.amber, fontWeight: 700 }}>RESERVADO</span>
            <b>{reserva.cliente_nome || '—'}</b>
            {reserva.valor_sinal ? <span>sinal {brl(reserva.valor_sinal)}{reserva.receber_id ? ' · em contas a receber' : ''}</span> : null}
            {reserva.reservado_ate && <span style={{ color: C.espM }}>até {brDate(reserva.reservado_ate)}</span>}
            <button onClick={() => void cancelarReserva()} style={{ marginLeft: 'auto', border: 'none', background: 'none', color: C.red, cursor: 'pointer', fontSize: 12 }}>cancelar reserva</button>
          </div>
        )}
        {venda && (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, marginTop: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: venda.situacao === 'entregue' ? C.greenBg : '#E8EEF9', color: venda.situacao === 'entregue' ? C.green : C.blue, fontWeight: 700 }}>{venda.situacao.toUpperCase()}</span>
              <b>{venda.cliente_nome || '—'}</b>
              <span style={{ fontWeight: 700 }}>{brl(venda.valor_venda ?? 0)}</span>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: C.espM, marginTop: 6 }}>
              {venda.valor_entrada ? <span>entrada {brl(venda.valor_entrada)}</span> : null}
              {venda.valor_financiado ? <span>financiado {brl(venda.valor_financiado)} · {venda.banco_nome || 'banco'}</span> : null}
              {venda.retorno_banco ? <span>retorno banco {brl(venda.retorno_banco)}</span> : null}
              {venda.desconto_embutido_troca ? <span style={{ color: C.amber }} title="valor de troca − valor de avaliação">desconto embutido na troca {brl(venda.desconto_embutido_troca)}</span> : null}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {venda.situacao !== 'entregue' && <button onClick={() => void entregarVenda()} style={{ padding: '6px 12px', border: 'none', borderRadius: 8, background: C.green, color: C.white, fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>marcar entregue</button>}
              <button onClick={() => void cancelarVenda()} style={{ padding: '6px 12px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.red, cursor: 'pointer', fontSize: 12 }}>cancelar venda</button>
            </div>
          </div>
        )}
        {!venda && !['vendido', 'entregue'].includes(v.situacao) && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {!reserva && <button onClick={() => setModal('reserva')} style={{ padding: '8px 14px', border: `1px solid ${C.gold}`, borderRadius: 8, background: C.white, color: C.gold, fontWeight: 700, cursor: 'pointer' }}>Reservar</button>}
            <button onClick={() => setModal('venda')} style={{ padding: '8px 14px', border: 'none', borderRadius: 8, background: C.gold, color: C.white, fontWeight: 700, cursor: 'pointer' }}>Registrar venda</button>
          </div>
        )}
      </Bloco>

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

      {modal === 'reserva' && v && <ReservaModal companyId={v.company_id} veiculoId={id} onClose={() => setModal(null)} onSaved={() => { setModal(null); setMsg('Veículo reservado.'); void carregar() }} onErro={setErro} />}
      {modal === 'venda' && v && <VendaModal companyId={v.company_id} veiculoId={id} onClose={() => setModal(null)} onSaved={() => { setModal(null); setMsg('Venda registrada.'); void carregar() }} onErro={setErro} />}
    </div>
  )
}

function Modal({ titulo, children, onClose }: { titulo: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.white, borderRadius: 12, padding: 18, width: 'min(560px,100%)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{titulo}</div>
        {children}
      </div>
    </div>
  )
}

function ReservaModal({ companyId, veiculoId, onClose, onSaved, onErro }: { companyId: string; veiculoId: string; onClose: () => void; onSaved: () => void; onErro: (m: string) => void }) {
  const [f, setF] = useState({ cliente_nome: '', valor_sinal: '', forma_sinal: 'pix', reservado_ate: '', gerar: true })
  const [busy, setBusy] = useState(false)
  async function salvar() {
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.rpc('fn_veic_reserva_criar', {
      p_company_id: companyId, p_veiculo_id: veiculoId,
      p_reserva: { cliente_nome: f.cliente_nome.trim() || null, valor_sinal: f.valor_sinal ? Number(f.valor_sinal) : null, forma_sinal: f.forma_sinal, reservado_ate: f.reservado_ate || null },
      p_gerar_receber: f.gerar, p_user: user?.id ?? null,
    })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { onErro(r?.erro === 'ja_reservado' ? 'Este veículo já tem uma reserva ativa.' : (error?.message || r?.erro || 'Falha')); return }
    onSaved()
  }
  return (
    <Modal titulo="Reservar veículo" onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input value={f.cliente_nome} onChange={(e) => setF({ ...f, cliente_nome: e.target.value })} placeholder="cliente" style={{ ...inp, gridColumn: '1 / -1' }} />
        <input value={f.valor_sinal} onChange={(e) => setF({ ...f, valor_sinal: e.target.value })} placeholder="valor do sinal" style={inp} />
        <select value={f.forma_sinal} onChange={(e) => setF({ ...f, forma_sinal: e.target.value })} style={inp}>
          <option value="pix">pix</option><option value="dinheiro">dinheiro</option><option value="cartao">cartão</option><option value="transferencia">transferência</option>
        </select>
        <label style={{ fontSize: 12, color: C.espM }}>reservado até<input type="date" value={f.reservado_ate} onChange={(e) => setF({ ...f, reservado_ate: e.target.value })} style={{ ...inp, marginLeft: 4 }} /></label>
        <label style={{ fontSize: 12, color: C.espM, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={f.gerar} onChange={(e) => setF({ ...f, gerar: e.target.checked })} /> lançar sinal em contas a receber
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={{ padding: '8px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.espM, cursor: 'pointer' }}>Cancelar</button>
        <button disabled={busy} onClick={() => void salvar()} style={{ padding: '8px 16px', border: 'none', borderRadius: 8, background: busy ? C.espL : C.gold, color: C.white, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}>{busy ? 'Salvando…' : 'Reservar'}</button>
      </div>
    </Modal>
  )
}

function VendaModal({ companyId, veiculoId, onClose, onSaved, onErro }: { companyId: string; veiculoId: string; onClose: () => void; onSaved: () => void; onErro: (m: string) => void }) {
  const [f, setF] = useState({ cliente_nome: '', vendedor_nome: '', valor_venda: '', valor_entrada: '', valor_financiado: '', banco_nome: '', retorno_banco: '' })
  const [troca, setTroca] = useState({ on: false, chassi: '', modelo: '', valor_troca: '', valor_avaliacao: '' })
  const [busy, setBusy] = useState(false)
  const descontoEmbutido = (Number(troca.valor_troca) || 0) - (Number(troca.valor_avaliacao) || 0)
  async function salvar() {
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const recebimentos: { tipo: string; devedor: string; valor: number }[] = []
    if (Number(f.valor_entrada) > 0) recebimentos.push({ tipo: 'entrada', devedor: 'cliente', valor: Number(f.valor_entrada) })
    if (Number(f.valor_financiado) > 0) recebimentos.push({ tipo: 'financiamento', devedor: 'banco', valor: Number(f.valor_financiado) })
    if (Number(f.retorno_banco) > 0) recebimentos.push({ tipo: 'retorno_banco', devedor: 'banco', valor: Number(f.retorno_banco) })
    // sem entrada/financiamento explícitos: à vista, o cliente deve o valor da venda
    if (recebimentos.length === 0 && Number(f.valor_venda) > 0) recebimentos.push({ tipo: 'parcela', devedor: 'cliente', valor: Number(f.valor_venda) })
    const { data, error } = await supabase.rpc('fn_veic_venda_registrar', {
      p_company_id: companyId, p_veiculo_id: veiculoId,
      p_venda: { cliente_nome: f.cliente_nome.trim() || null, vendedor_nome: f.vendedor_nome.trim() || null, valor_venda: f.valor_venda ? Number(f.valor_venda) : null, valor_entrada: f.valor_entrada ? Number(f.valor_entrada) : null, valor_financiado: f.valor_financiado ? Number(f.valor_financiado) : null, banco_nome: f.banco_nome.trim() || null, retorno_banco: f.retorno_banco ? Number(f.retorno_banco) : null },
      p_recebimentos: recebimentos,
      p_troca: troca.on ? { chassi: troca.chassi.trim() || null, modelo: troca.modelo.trim() || null, valor_troca: troca.valor_troca ? Number(troca.valor_troca) : null, valor_avaliacao: troca.valor_avaliacao ? Number(troca.valor_avaliacao) : null } : null,
      p_user: user?.id ?? null,
    })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string; situacao?: string } | null
    if (error || !r?.ok) { onErro(r?.erro === 'veiculo_indisponivel' ? `Veículo indisponível (${r?.situacao}).` : (error?.message || r?.erro || 'Falha')); return }
    onSaved()
  }
  return (
    <Modal titulo="Registrar venda" onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input value={f.cliente_nome} onChange={(e) => setF({ ...f, cliente_nome: e.target.value })} placeholder="cliente" style={inp} />
        <input value={f.vendedor_nome} onChange={(e) => setF({ ...f, vendedor_nome: e.target.value })} placeholder="vendedor" style={inp} />
        <input value={f.valor_venda} onChange={(e) => setF({ ...f, valor_venda: e.target.value })} placeholder="valor da venda" style={{ ...inp, gridColumn: '1 / -1' }} />
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: C.espM, margin: '12px 0 4px' }}>Pagamento</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input value={f.valor_entrada} onChange={(e) => setF({ ...f, valor_entrada: e.target.value })} placeholder="entrada (cliente)" style={inp} />
        <input value={f.valor_financiado} onChange={(e) => setF({ ...f, valor_financiado: e.target.value })} placeholder="financiado (banco)" style={inp} />
        <input value={f.banco_nome} onChange={(e) => setF({ ...f, banco_nome: e.target.value })} placeholder="banco" style={inp} />
        <input value={f.retorno_banco} onChange={(e) => setF({ ...f, retorno_banco: e.target.value })} placeholder="retorno do banco (receita)" style={inp} />
      </div>
      <div style={{ fontSize: 11, color: C.espL, marginTop: 4 }}>O financiado é cobrado do banco; a entrada, do cliente. Cada um vira um título em contas a receber com o devedor certo.</div>

      <label style={{ fontSize: 13, color: C.esp, display: 'inline-flex', alignItems: 'center', gap: 6, margin: '12px 0 4px', fontWeight: 700 }}>
        <input type="checkbox" checked={troca.on} onChange={(e) => setTroca({ ...troca, on: e.target.checked })} /> Tem veículo na troca
      </label>
      {troca.on && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input value={troca.chassi} onChange={(e) => setTroca({ ...troca, chassi: e.target.value })} placeholder="chassi do usado (p/ entrar no estoque)" style={{ ...inp, gridColumn: '1 / -1' }} />
            <input value={troca.modelo} onChange={(e) => setTroca({ ...troca, modelo: e.target.value })} placeholder="modelo" style={{ ...inp, gridColumn: '1 / -1' }} />
            <input value={troca.valor_troca} onChange={(e) => setTroca({ ...troca, valor_troca: e.target.value })} placeholder="valor dado na troca" style={inp} />
            <input value={troca.valor_avaliacao} onChange={(e) => setTroca({ ...troca, valor_avaliacao: e.target.value })} placeholder="valor de avaliação (quanto vale)" style={inp} />
          </div>
          <div style={{ fontSize: 11.5, color: descontoEmbutido > 0 ? C.amber : C.espL, marginTop: 6 }}>
            {descontoEmbutido > 0
              ? `Desconto embutido na venda: ${brl(descontoEmbutido)}. O usado entra no estoque pelo valor de avaliação (${brl(Number(troca.valor_avaliacao) || 0)}), não pelo valor dado — assim as duas margens ficam certas.`
              : 'O usado entra no estoque pelo valor de avaliação. Se o valor dado for maior, a diferença vira desconto embutido na venda.'}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={{ padding: '8px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.espM, cursor: 'pointer' }}>Cancelar</button>
        <button disabled={busy || !f.valor_venda} onClick={() => void salvar()} style={{ padding: '8px 16px', border: 'none', borderRadius: 8, background: busy || !f.valor_venda ? C.espL : C.gold, color: C.white, fontWeight: 700, cursor: busy || !f.valor_venda ? 'not-allowed' : 'pointer' }}>{busy ? 'Salvando…' : 'Registrar venda'}</button>
      </div>
    </Modal>
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
