'use client'

// Revenda · R5b — Negociação (Tela 9), composição de UM negócio.
// O dono compõe (preço, desconto, entrada, financiamento, troca, espécie) e vê AO VIVO, em linguagem de
// dono: o cliente paga X, você recebe do cliente Y e do banco Z, a troca embutiu W de desconto — mais o
// lucro real, a margem × mínima, a alçada e o COAF. Nada é calculado na tela: tudo vem de
// fn_veic_negociacao_simular (RD-65). Alçada acima do limite pede aprovação registrada. Fechar gera a
// venda + os títulos pelo caminho oficial (financeiro é da GE). Paleta PS; RD-51 (sem valor = não configurado).

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { CampoMoeda } from '@/components/comum/CampoMoeda'
import { moedaParaNumero, numeroParaMoeda } from '@/lib/moeda-mascara'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC',
}
const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none', width: '100%' }
const brl = (v: number | null | undefined) => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (v: number | null | undefined) => v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
async function userId() { const { data: { session } } = await supabase.auth.getSession(); return session?.user?.id ?? null }

type Neg = {
  id: string; company_id: string; veiculo_id: string; estado: string
  cliente_nome: string | null; cliente_doc: string | null; vendedor_nome: string | null; validade: string | null; motivo_perda: string | null
  preco_pedido: number | null; desconto: number | null
  troca_avaliacao: number | null; troca_valor_dado: number | null; troca_chassi: string | null; troca_marca: string | null; troca_modelo: string | null; troca_ano: number | null; troca_km: number | null
  entrada: number | null; financiado: number | null; banco_nome: string | null; parcelas: number | null; retorno_banco: number | null
  outros_debitos: number | null; outros_debitos_desc: string | null; especie_valor: number | null
  aprovado_em: string | null; aprovacao_motivo: string | null; venda_id: string | null; observacao: string | null
  marca?: string | null; modelo?: string | null; chassi?: string | null
}
type Sim = {
  ok: boolean; preco_pedido: number | null; desconto: number | null; preco_final: number; desconto_pct: number
  sobrepreco_troca: number; custo_real: number | null; encargos_pct: number | null; lucro_real: number | null; margem_pct: number | null
  margem_minima_pct: number | null; desconto_max_pct: number | null; alcada: string
  coaf: { status: string; especie: number | null; limite: number | null }
  em_linguagem_de_dono: { o_cliente_paga: number; voce_recebe_do_cliente: number; voce_recebe_do_banco: number; a_troca_embutiu_desconto: number }
}

const numOrNull = (s: string) => { const n = Number(String(s).replace(/\./g, '').replace(',', '.')); return s.trim() === '' || Number.isNaN(n) ? null : n }

export default function NegociacaoPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params?.id
  const [neg, setNeg] = useState<Neg | null>(null)
  const [sim, setSim] = useState<Sim | null>(null)
  const [f, setF] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null)
  const [aprMotivo, setAprMotivo] = useState('')
  const [perdaMotivo, setPerdaMotivo] = useState('')
  const [perdaOpen, setPerdaOpen] = useState(false)
  // #8162 etapa 2b: bancos parceiros cadastrados (etapa 1) para seleção na negociação
  const [parceiros, setParceiros] = useState<{ id: string; nome: string; retorno_pct: number | null }[]>([])

  // carrega os bancos parceiros ATIVOS da empresa da negociação (RLS por company_id)
  useEffect(() => {
    const cid = neg?.company_id
    if (!cid) { setParceiros([]); return }
    let vivo = true
    void supabase.from('veic_banco_parceiro').select('id, nome, retorno_pct').eq('company_id', cid).eq('ativo', true).order('nome')
      .then(({ data }) => { if (vivo) setParceiros((data ?? []) as { id: string; nome: string; retorno_pct: number | null }[]) })
    return () => { vivo = false }
  }, [neg?.company_id])

  const carregar = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const { data } = await supabase.from('veic_negociacao')
      .select('*, veic_veiculo(marca, modelo, chassi)').eq('id', id).single()
    if (data) {
      const v = (data.veic_veiculo ?? {}) as { marca?: string; modelo?: string; chassi?: string }
      const n: Neg = { ...(data as unknown as Neg), marca: v.marca ?? null, modelo: v.modelo ?? null, chassi: v.chassi ?? null }
      setNeg(n)
      setF({
        cliente_nome: n.cliente_nome ?? '', cliente_doc: n.cliente_doc ?? '', vendedor_nome: n.vendedor_nome ?? '', validade: n.validade ?? '', origem_lead: (n as { origem_lead?: string | null }).origem_lead ?? '',
        preco_pedido: numeroParaMoeda(n.preco_pedido), desconto: numeroParaMoeda(n.desconto),
        entrada: numeroParaMoeda(n.entrada), financiado: numeroParaMoeda(n.financiado), banco_nome: n.banco_nome ?? '', parcelas: n.parcelas?.toString() ?? '', retorno_banco: numeroParaMoeda(n.retorno_banco),
        troca_avaliacao: numeroParaMoeda(n.troca_avaliacao), troca_valor_dado: numeroParaMoeda(n.troca_valor_dado), troca_marca: n.troca_marca ?? '', troca_modelo: n.troca_modelo ?? '', troca_ano: n.troca_ano?.toString() ?? '', troca_km: n.troca_km?.toString() ?? '', troca_chassi: n.troca_chassi ?? '',
        outros_debitos: numeroParaMoeda(n.outros_debitos), outros_debitos_desc: n.outros_debitos_desc ?? '', especie_valor: numeroParaMoeda(n.especie_valor), observacao: n.observacao ?? '',
      })
      const { data: s } = await supabase.rpc('fn_veic_negociacao_simular', { p_neg_id: id })
      setSim(s as Sim)
    }
    setLoading(false)
  }, [id])
  useEffect(() => { void carregar() }, [carregar])

  async function salvar() {
    if (!id || salvando) return
    setSalvando(true); setMsg(null)
    const patch = {
      cliente_nome: f.cliente_nome || null, cliente_doc: f.cliente_doc || null, vendedor_nome: f.vendedor_nome || null, validade: f.validade || null,
      origem_lead: f.origem_lead?.trim() || null,
      preco_pedido: moedaParaNumero(f.preco_pedido), desconto: moedaParaNumero(f.desconto) ?? 0,
      entrada: moedaParaNumero(f.entrada) ?? 0, financiado: moedaParaNumero(f.financiado) ?? 0, banco_nome: f.banco_nome || null, parcelas: numOrNull(f.parcelas), retorno_banco: moedaParaNumero(f.retorno_banco) ?? 0,
      troca_avaliacao: moedaParaNumero(f.troca_avaliacao), troca_valor_dado: moedaParaNumero(f.troca_valor_dado), troca_marca: f.troca_marca || null, troca_modelo: f.troca_modelo || null, troca_ano: numOrNull(f.troca_ano), troca_km: numOrNull(f.troca_km), troca_chassi: f.troca_chassi || null,
      outros_debitos: moedaParaNumero(f.outros_debitos) ?? 0, outros_debitos_desc: f.outros_debitos_desc || null, especie_valor: moedaParaNumero(f.especie_valor) ?? 0, observacao: f.observacao || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('veic_negociacao').update(patch).eq('id', id)
    if (error) { setSalvando(false); setMsg({ t: 'err', m: 'Não foi possível salvar.' }); return }
    const { data: s } = await supabase.rpc('fn_veic_negociacao_simular', { p_neg_id: id })
    setSim(s as Sim); setSalvando(false); setMsg({ t: 'ok', m: 'Composição atualizada.' })
    void carregar()
  }

  async function aprovar() {
    if (!id) return
    const { data, error } = await supabase.rpc('fn_veic_negociacao_aprovar', { p_neg_id: id, p_motivo: aprMotivo.trim() || 'Aprovado pelo gerente', p_user: await userId() })
    if (error || (data as { ok?: boolean })?.ok === false) { setMsg({ t: 'err', m: 'Falha ao registrar a aprovação.' }); return }
    setAprMotivo(''); setMsg({ t: 'ok', m: 'Aprovação registrada.' }); void carregar()
  }

  async function fechar() {
    if (!id) return
    setMsg(null)
    const { data, error } = await supabase.rpc('fn_veic_negociacao_fechar', { p_neg_id: id, p_user: await userId() })
    const r = data as { ok?: boolean; erro?: string; mensagem?: string; venda_id?: string } | null
    if (error || !r?.ok) { setMsg({ t: 'err', m: r?.mensagem || r?.erro || 'Não foi possível fechar.' }); void carregar(); return }
    router.push('/dashboard/revenda/vendas')
  }

  async function perder() {
    if (!id) return
    if (!perdaMotivo.trim()) { setMsg({ t: 'err', m: 'Informe o motivo da perda.' }); return }
    const { data, error } = await supabase.rpc('fn_veic_negociacao_perder', { p_neg_id: id, p_motivo: perdaMotivo.trim(), p_user: await userId() })
    if (error || (data as { ok?: boolean })?.ok === false) { setMsg({ t: 'err', m: 'Não foi possível marcar como perdida.' }); return }
    setPerdaOpen(false); void carregar()
  }

  if (loading) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>
  if (!neg) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Negociação não encontrada. <a href="/dashboard/revenda/negociacao" style={{ color: C.gold }}>Voltar</a></div>

  const aberta = neg.estado === 'aberta'
  const precisaAprovar = sim?.alcada === 'exige_aprovacao'
  const aprovado = !!neg.aprovado_em
  const dono = sim?.em_linguagem_de_dono

  const Campo = (label: string, key: string, ph = '', tipo: 'text' | 'date' = 'text') => (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 11, color: C.espM, marginBottom: 3, fontWeight: 600 }}>{label}</span>
      <input type={tipo} value={f[key] ?? ''} placeholder={ph} disabled={!aberta}
        onChange={e => setF(s => ({ ...s, [key]: e.target.value }))} style={{ ...inp, background: aberta ? C.white : C.cream }} />
    </label>
  )

  // #8162 etapa 2b: retorno previsto do banco parceiro = % do banco × valor financiado (editável)
  const parceiroSel = parceiros.find(p => p.nome === (f.banco_nome ?? ''))
  const financiadoNum = numOrNull(f.financiado ?? '')
  const retornoPrevisto = parceiroSel && parceiroSel.retorno_pct != null && financiadoNum != null
    ? Math.round(financiadoNum * parceiroSel.retorno_pct) / 100
    : null
  const escolherBanco = (nome: string) => {
    const p = parceiros.find(x => x.nome === nome)
    const fin = numOrNull(f.financiado ?? '')
    setF(s => {
      const prox: Record<string, string> = { ...s, banco_nome: nome }
      // retorno_banco é campo mascarado (R$) — grava texto mascarado, não número cru
      if (p && p.retorno_pct != null && fin != null) prox.retorno_banco = numeroParaMoeda(Math.round(fin * p.retorno_pct) / 100)
      return prox
    })
  }
  // Seleção do banco parceiro; se a empresa ainda não cadastrou nenhum, mantém o campo de texto livre (compatibilidade).
  const bancoCampo = () => {
    if (parceiros.length === 0) return Campo('Banco', 'banco_nome')
    const atual = f.banco_nome ?? ''
    const legado = atual && !parceiros.some(p => p.nome === atual)
    return (
      <label style={{ display: 'block' }}>
        <span style={{ fontSize: 11, color: C.espM, marginBottom: 3, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          Banco (financiamento)<AjudaCampo chave="revenda.negociacao.banco_parceiro" rota="/dashboard/revenda/negociacao" />
        </span>
        <select value={atual} disabled={!aberta} onChange={e => escolherBanco(e.target.value)} style={{ ...inp, background: aberta ? C.white : C.cream }}>
          <option value="">— selecione —</option>
          {parceiros.map(p => <option key={p.id} value={p.nome}>{p.nome}{p.retorno_pct != null ? ` (${p.retorno_pct}%)` : ''}</option>)}
          {legado && <option value={atual}>{atual} (cadastro antigo)</option>}
        </select>
      </label>
    )
  }
  // #6874 — campos de dinheiro com máscara R$ (formata enquanto digita)
  const CampoM = (label: string, key: string) => (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 11, color: C.espM, marginBottom: 3, fontWeight: 600 }}>{label}</span>
      <CampoMoeda value={f[key] ?? ''} placeholder="R$" disabled={!aberta}
        onChange={(v) => setF(s => ({ ...s, [key]: v }))} style={{ ...inp, background: aberta ? C.white : C.cream }} />
    </label>
  )

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '18px 16px 70px' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <a href="/dashboard/revenda/negociacao" style={{ color: C.gold, fontSize: 13, textDecoration: 'none', fontWeight: 600 }}>← Negociações</a>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
          <h1 style={{ fontSize: 21, fontWeight: 800, color: C.esp, margin: 0 }}>{[neg.marca, neg.modelo].filter(Boolean).join(' ') || 'Negociação'}</h1>
          <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
            color: aberta ? C.amber : neg.estado === 'fechada' ? C.green : C.red,
            background: aberta ? C.amberBg : neg.estado === 'fechada' ? C.greenBg : C.redBg }}>{neg.estado}</span>
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 4, fontSize: 12 }}>
          <a href={`/dashboard/revenda/patio?veiculo=${neg.veiculo_id}`} style={{ color: C.gold, textDecoration: 'none', fontWeight: 600 }}>Ficha do carro</a>
          <a href="/dashboard/revenda/patio" style={{ color: C.gold, textDecoration: 'none', fontWeight: 600 }}>Ver no pátio</a>
        </div>

        {msg && <div style={{ marginTop: 12, background: msg.t === 'ok' ? C.greenBg : C.redBg, color: msg.t === 'ok' ? C.green : C.red, padding: '8px 12px', borderRadius: 8, fontSize: 13 }}>{msg.m}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 16, marginTop: 16 }}>
          {/* Composição (entrada de dados) */}
          <section style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, color: C.esp, margin: '0 0 12px' }}>Composição do negócio</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              {Campo('Cliente', 'cliente_nome')}
              {Campo('CPF/CNPJ', 'cliente_doc')}
              {Campo('Vendedor', 'vendedor_nome')}
              {Campo('Vale até', 'validade', '', 'date')}
              {Campo('Origem do lead', 'origem_lead', 'ex.: OLX, WhatsApp, indicação')}
              {CampoM('Preço pedido', 'preco_pedido')}
              {CampoM('Desconto', 'desconto')}
              {CampoM('Entrada', 'entrada')}
              {CampoM('Financiado (banco)', 'financiado')}
              {bancoCampo()}
              {Campo('Parcelas', 'parcelas')}
              {CampoM('Retorno do banco', 'retorno_banco')}
              {CampoM('Espécie (dinheiro)', 'especie_valor')}
            </div>
            {parceiroSel && parceiroSel.retorno_pct != null && (
              <div style={{ marginTop: 8, fontSize: 12, color: C.espM, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>Retorno previsto ({parceiroSel.retorno_pct}% × financiado): <b style={{ color: C.esp }}>{retornoPrevisto == null ? 'informe o financiado' : brl(retornoPrevisto)}</b>. Valor editável acima.</span>
                {aberta && retornoPrevisto != null && (numOrNull(f.retorno_banco ?? '') ?? 0) !== retornoPrevisto && (
                  <button type="button" onClick={() => setF(s => ({ ...s, retorno_banco: numeroParaMoeda(retornoPrevisto) }))}
                    style={{ border: `1px solid ${C.gold}`, background: C.white, color: C.gold, borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 11.5, fontWeight: 700 }}>
                    aplicar retorno previsto
                  </button>
                )}
              </div>
            )}
            <h3 style={{ fontSize: 12, fontWeight: 800, color: C.espM, margin: '16px 0 8px', textTransform: 'uppercase', letterSpacing: 0.4 }}>Troca na entrada</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              {Campo('Marca', 'troca_marca')}
              {Campo('Modelo', 'troca_modelo')}
              {Campo('Ano', 'troca_ano')}
              {Campo('KM', 'troca_km')}
              {Campo('Chassi', 'troca_chassi')}
              {CampoM('Avaliação (real)', 'troca_avaliacao')}
              {CampoM('Valor dado ao cliente', 'troca_valor_dado')}
            </div>
            <label style={{ display: 'block', marginTop: 12 }}>
              <span style={{ display: 'block', fontSize: 11, color: C.espM, marginBottom: 3, fontWeight: 600 }}>Observação</span>
              <textarea value={f.observacao ?? ''} disabled={!aberta} onChange={e => setF(s => ({ ...s, observacao: e.target.value }))}
                rows={2} style={{ ...inp, resize: 'vertical', background: aberta ? C.white : C.cream }} />
            </label>
            {aberta && (
              <button onClick={salvar} disabled={salvando} style={{ marginTop: 14, padding: '10px 18px', background: C.esp, color: C.white, border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                {salvando ? 'Calculando…' : 'Salvar e recalcular'}
              </button>
            )}
          </section>

          {/* Simulação (leitura, fonte única) */}
          <section style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, color: C.esp, margin: '0 0 12px' }}>Em linguagem de dono</h2>
            {!sim?.ok ? <div style={{ color: C.espL, fontSize: 13 }}>Salve para ver a composição.</div> : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: 10 }}>
                  <Tile k="O cliente paga" v={brl(dono?.o_cliente_paga)} />
                  <Tile k="Você recebe do cliente" v={brl(dono?.voce_recebe_do_cliente)} />
                  <Tile k="Você recebe do banco" v={brl(dono?.voce_recebe_do_banco)} />
                  <Tile k="A troca embutiu de desconto" v={brl(dono?.a_troca_embutiu_desconto)} destaque={Number(dono?.a_troca_embutiu_desconto) > 0} />
                </div>
                <div style={{ height: 1, background: C.border, margin: '14px 0' }} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: 10 }}>
                  <Tile k="Preço final" v={brl(sim.preco_final)} />
                  <Tile k="Desconto" v={`${brl(sim.desconto)} · ${pct(sim.desconto_pct)}`} />
                  <Tile k="Custo real do carro" v={sim.custo_real == null ? 'não configurado' : brl(sim.custo_real)} />
                  <Tile k="Lucro real"
                    v={sim.lucro_real == null ? 'não configurado' : brl(sim.lucro_real)}
                    cor={sim.lucro_real == null ? undefined : Number(sim.lucro_real) < 0 ? C.red : C.green} />
                  <Tile k="Margem"
                    v={sim.margem_pct == null ? 'não configurado' : pct(sim.margem_pct)}
                    sub={sim.margem_minima_pct == null ? 'mínima: não configurada' : `mínima ${pct(sim.margem_minima_pct)}`}
                    cor={sim.margem_pct != null && sim.margem_minima_pct != null && sim.margem_pct < sim.margem_minima_pct ? C.red : undefined} />
                </div>

                {/* Alçada + COAF */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 20,
                    color: sim.alcada === 'ok' ? C.green : C.amber, background: sim.alcada === 'ok' ? C.greenBg : C.amberBg }}>
                    Alçada: {sim.alcada === 'ok' ? 'dentro do permitido' : 'exige aprovação'}
                    {sim.desconto_max_pct != null ? ` (máx. ${pct(sim.desconto_max_pct)})` : ' (máx. não configurado)'}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 20,
                    color: sim.coaf.status === 'alerta' ? C.red : sim.coaf.status === 'ok' ? C.green : C.espM,
                    background: sim.coaf.status === 'alerta' ? C.redBg : sim.coaf.status === 'ok' ? C.greenBg : C.cream }}>
                    COAF: {sim.coaf.status === 'nao_configurado' ? 'não configurado' : sim.coaf.status === 'alerta' ? `espécie ${brl(sim.coaf.especie)} acima do limite ${brl(sim.coaf.limite)}` : 'dentro do limite'}
                  </span>
                </div>

                {/* Aprovação quando a alçada exige */}
                {aberta && precisaAprovar && !aprovado && (
                  <div style={{ marginTop: 14, background: C.amberBg, border: `1px solid ${C.amber}`, borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.amber, marginBottom: 6 }}>Desconto/margem acima da alçada — precisa da aprovação do gerente.</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <input value={aprMotivo} onChange={e => setAprMotivo(e.target.value)} placeholder="Motivo da aprovação" style={{ ...inp, flex: 1, minWidth: 180 }} />
                      <button onClick={aprovar} style={{ padding: '8px 16px', background: C.amber, color: C.white, border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>Aprovar</button>
                    </div>
                  </div>
                )}
                {aprovado && <div style={{ marginTop: 12, fontSize: 12, color: C.green }}>✓ Aprovação registrada{neg.aprovacao_motivo ? ` — ${neg.aprovacao_motivo}` : ''}.</div>}

                {/* Ações */}
                {aberta && (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
                    <button onClick={fechar} disabled={precisaAprovar && !aprovado}
                      style={{ padding: '11px 20px', background: (precisaAprovar && !aprovado) ? C.espL : C.green, color: C.white, border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: (precisaAprovar && !aprovado) ? 'not-allowed' : 'pointer' }}>
                      Fechar negócio (gera a venda)
                    </button>
                    <button onClick={() => setPerdaOpen(true)} style={{ padding: '11px 18px', background: C.white, color: C.red, border: `1px solid ${C.red}`, borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Marcar perdida</button>
                  </div>
                )}
                {neg.estado === 'fechada' && neg.venda_id && (
                  <a href="/dashboard/revenda/vendas" style={{ display: 'inline-block', marginTop: 14, color: C.gold, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>Ver a venda na tela de Vendas →</a>
                )}
                {neg.estado === 'perdida' && <div style={{ marginTop: 14, fontSize: 13, color: C.red }}>Perdida — {neg.motivo_perda}</div>}
              </>
            )}
          </section>
        </div>
      </div>

      {perdaOpen && (
        <div onClick={() => setPerdaOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.white, borderRadius: 14, width: '100%', maxWidth: 440, padding: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: C.esp, margin: '0 0 10px' }}>Marcar como perdida</h2>
            <input value={perdaMotivo} onChange={e => setPerdaMotivo(e.target.value)} placeholder="Motivo da perda (obrigatório)" style={{ ...inp }} autoFocus />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button onClick={() => setPerdaOpen(false)} style={{ padding: '9px 16px', background: C.cream, color: C.esp, border: `1px solid ${C.border}`, borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={perder} style={{ padding: '9px 16px', background: C.red, color: C.white, border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>Confirmar perda</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Tile({ k, v, sub, cor, destaque }: { k: string; v: string; sub?: string; cor?: string; destaque?: boolean }) {
  return (
    <div style={{ background: destaque ? '#FFF6E5' : '#FAF7F2', border: '1px solid #E0D8CC', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: '#6B5D4F', fontWeight: 600 }}>{k}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: cor ?? '#3D2314', marginTop: 2 }}>{v}</div>
      {sub && <div style={{ fontSize: 11, color: '#9C8E80', marginTop: 1 }}>{sub}</div>}
    </div>
  )
}
