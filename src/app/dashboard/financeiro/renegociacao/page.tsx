'use client'

// Lote C · Renegociação / Acerto — criar acerto (cliente→títulos→parcelas→confirmar) + consultar (drill-down
// origens↔gerados). Backend: fn_renegociacao_* (PR #805; guarda de datas #105 PR1; forma por parcela #105 PR2).
// #105 PR2: todas as formas de pagamento (não só boleto) · painel lateral de resumo (estilo inclusão de receita) ·
// cálculo automático do valor da parcela pela quantidade (última absorve o resíduo) · exibe os avisos do backend.
// Só forma='boleto' entra na emissão/remessa CNAB; as demais gravam o título e ficam fora.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { FORMAS_PAGAMENTO } from '@/lib/financeiro/formasPagamento'
import Modal from '@/components/ui/Modal'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERDE = '#2E8B57', VERM = '#A32D2D', AMBAR = '#C88A1A'
const brl = (n: number) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dbr = (s: string | null) => s ? s.slice(0, 10).split('-').reverse().join('/') : '—'
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const iso = (d: Date) => d.toISOString().slice(0, 10)
// Vencimento por MÊS-CALENDÁRIO a partir de hoje (dia preservado, com clamp p/ fim de mês). Sempre
// não-decrescente → passa na guarda de ordem do backend (#105 PR1). m=1 → mês que vem, etc.
const maisMeses = (m: number): string => {
  const h = new Date(); const dia = h.getDate()
  const d = new Date(h.getFullYear(), h.getMonth() + m, 1)
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(dia, ultimo))
  return iso(d)
}
// Distribui o total em N parcelas iguais (round2); a ÚLTIMA absorve o resíduo de centavos.
const distribuir = (total: number, n: number): number[] => {
  if (n <= 0) return []
  const base = round2(total / n)
  const arr = Array.from({ length: n }, () => base)
  arr[n - 1] = round2(total - base * (n - 1))
  return arr
}
const formaLabel = (v: string) => FORMAS_PAGAMENTO.find((f) => f.v === v)?.l ?? v

type Cliente = { id: string; nome: string }
type Conta = { id: string; nome: string }
type Titulo = { id: string; descricao: string; valor: number; data_vencimento: string; status: string; numero_documento: string | null }
type Boleto = { valor: string; data_vencimento: string; forma_pagamento: string }
type Aviso = { parcela: number; data_vencimento: string; aviso: string }
type Acerto = { id: string; data_acerto: string; cliente_nome: string; valor_origem: number; valor_gerado: number; ajuste: number; status: string; qtd_origens: number; qtd_gerados: number }

const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: `0.5px solid ${LINE}`, borderRadius: 6, fontSize: 13, background: '#fff', color: ESP, fontFamily: 'inherit', boxSizing: 'border-box' }
const lbl: React.CSSProperties = { fontSize: 11, color: MUT, display: 'block', marginBottom: 4 }
const btnG: React.CSSProperties = { background: GOLD, color: '#3D2314', border: 'none', padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const btnO: React.CSSProperties = { background: 'transparent', color: ESP, border: `0.5px solid ${LINE}`, padding: '8px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer' }

export default function RenegociacaoPage() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [aba, setAba] = useState<'criar' | 'consultar'>('criar')

  if (!companyId) return <div style={{ background: BG, minHeight: '100vh', padding: 32, color: MUT, fontSize: 14 }}>Selecione uma empresa específica no topo.</div>

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '28px 20px' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>Financeiro · Contas a Receber</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, color: ESP, margin: '2px 0 14px' }}>Renegociação / Acerto</h1>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button onClick={() => setAba('criar')} style={aba === 'criar' ? { ...btnG } : btnO}>Criar acerto</button>
          <button onClick={() => setAba('consultar')} style={aba === 'consultar' ? { ...btnG } : btnO}>Consultar</button>
        </div>
        {aba === 'criar' ? <Criar companyId={companyId} /> : <Consultar companyId={companyId} />}
      </div>
    </div>
  )
}

function Criar({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [contas, setContas] = useState<Conta[]>([])
  const [clienteId, setClienteId] = useState('')
  const [contaId, setContaId] = useState('')
  const [titulos, setTitulos] = useState<Titulo[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [boletos, setBoletos] = useState<Boleto[]>([{ valor: '', data_vencimento: maisMeses(1), forma_pagamento: 'boleto' }])
  // Geração automática: quantidade de parcelas + forma padrão aplicada a todas.
  const [qtd, setQtd] = useState('1')
  const [formaPadrao, setFormaPadrao] = useState('boleto')
  const [motivo, setMotivo] = useState('')
  const [buscou, setBuscou] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<{ renegociacao_id: string; gerados: string[]; avisos: Aviso[]; qtdBoleto: number } | null>(null)

  useEffect(() => {
    ;(async () => {
      const [cli, ct] = await Promise.all([
        supabase.from('erp_clientes').select('id, nome_fantasia, razao_social').eq('company_id', companyId).eq('ativo', true).order('nome_fantasia'),
        supabase.from('erp_banco_contas').select('id, nome').eq('company_id', companyId).eq('ativo', true).order('nome'),
      ])
      setClientes(((cli.data as { id: string; nome_fantasia: string | null; razao_social: string | null }[] | null) ?? []).map((c) => ({ id: c.id, nome: c.nome_fantasia || c.razao_social || 'sem nome' })))
      setContas(((ct.data as { id: string; nome: string }[] | null) ?? []))
    })()
  }, [companyId])

  async function buscar() {
    setErro(null); setBuscou(false); setSel(new Set())
    const { data, error } = await supabase.rpc('fn_renegociacao_titulos_abertos', { p_company: companyId, p_cliente: clienteId || null, p_conta: contaId || null })
    if (error) { setErro(error.message); return }
    setTitulos((data ?? []) as Titulo[]); setBuscou(true)
  }

  const totalOrigem = useMemo(() => titulos.filter((t) => sel.has(t.id)).reduce((s, t) => s + Number(t.valor), 0), [titulos, sel])
  const totalGerado = useMemo(() => boletos.reduce((s, b) => s + (parseFloat((b.valor || '0').replace(',', '.')) || 0), 0), [boletos])
  const ajuste = round2(totalGerado - totalOrigem)
  const qtdBoleto = useMemo(() => boletos.filter((b) => b.forma_pagamento === 'boleto').length, [boletos])
  // Datas fora de ordem (espelha a guarda do backend #105 PR1 — feedback local, sem esperar o erro).
  const datasForaOrdem = useMemo(() => {
    for (let i = 1; i < boletos.length; i++) {
      if (boletos[i].data_vencimento && boletos[i - 1].data_vencimento && boletos[i].data_vencimento < boletos[i - 1].data_vencimento) return true
    }
    return false
  }, [boletos])

  // #105 PR2 · calcula o valor da parcela a partir da QUANTIDADE: total das origens ÷ N (última absorve o
  // resíduo de centavos), vencimentos mensais crescentes (guarda-safe), forma = a forma padrão escolhida.
  function gerarParcelas() {
    const n = Math.max(1, Math.min(60, parseInt(qtd) || 1))
    const vals = distribuir(round2(totalOrigem), n)
    setBoletos(vals.map((v, i) => ({ valor: v.toFixed(2).replace('.', ','), data_vencimento: maisMeses(i + 1), forma_pagamento: formaPadrao })))
  }
  function setBoleto(i: number, patch: Partial<Boleto>) {
    setBoletos((bs) => bs.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  }

  async function confirmar() {
    setSalvando(true); setErro(null)
    try {
      const { data, error } = await supabase.rpc('fn_renegociacao_criar', {
        p_company: companyId, p_cliente: clienteId || null, p_conta: contaId || null,
        p_origem_ids: [...sel],
        p_boletos: boletos.map((b) => ({ valor: parseFloat((b.valor || '0').replace(',', '.')) || 0, data_vencimento: b.data_vencimento, forma_pagamento: b.forma_pagamento })),
        p_observacao: motivo.trim() || null,
      })
      if (error) throw error
      const j = data as { sucesso?: boolean; erro?: string; renegociacao_id?: string; gerados?: string[]; avisos?: Aviso[] } | null
      if (!j?.sucesso) throw new Error(j?.erro ?? 'falha ao criar')
      setResultado({ renegociacao_id: j.renegociacao_id!, gerados: j.gerados ?? [], avisos: j.avisos ?? [], qtdBoleto })
      setConfirmOpen(false)
    } catch (e) { setErro((e as Error).message) } finally { setSalvando(false) }
  }

  if (resultado) {
    const outras = resultado.gerados.length - resultado.qtdBoleto
    return (
      <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: VERDE }}>✅ Acerto CRIOU</div>
        <p style={{ fontSize: 13, color: ESP, marginTop: 8 }}>{sel.size} título(s) consolidados em <b>{resultado.gerados.length} parcela(s)</b>. As origens ficaram como <b>renegociado</b>; as parcelas nascem <b>abertas</b>. <b>{resultado.qtdBoleto}</b> por boleto (entram na remessa CNAB){outras > 0 ? <> · <b>{outras}</b> em outras formas (registradas, fora da remessa)</> : null}.</p>
        {resultado.avisos.length > 0 && (
          <div style={{ marginTop: 12, background: '#FFF8E1', border: `0.5px solid ${AMBAR}`, borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: AMBAR, marginBottom: 4 }}>Avisos</div>
            {resultado.avisos.map((a, i) => <div key={i} style={{ fontSize: 12, color: ESP }}>Parcela {a.parcela} ({dbr(a.data_vencimento)}): {a.aviso}</div>)}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          {resultado.qtdBoleto > 0 && <button onClick={() => router.push('/dashboard/financeiro/remessa-pagamento')} style={btnG}>Ir para remessa (emitir boletos)</button>}
          <button onClick={() => { setResultado(null); setSel(new Set()); setBoletos([{ valor: '', data_vencimento: maisMeses(1), forma_pagamento: 'boleto' }]); setQtd('1'); setMotivo(''); setBuscou(false) }} style={btnO}>Novo acerto</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, alignItems: 'end' }}>
        <div><label style={lbl}>Cliente</label>
          <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} style={inp}>
            <option value="">— todos —</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select></div>
        <div><label style={lbl}>Conta</label>
          <select value={contaId} onChange={(e) => setContaId(e.target.value)} style={inp}>
            <option value="">— todas —</option>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select></div>
        <button onClick={buscar} style={btnG}>Buscar títulos abertos</button>
      </div>

      {buscou && (
        <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: ESP, marginBottom: 8 }}>Títulos elegíveis (aberto/vencido, sem acerto) — {titulos.length}</div>
          {titulos.length === 0 ? <div style={{ fontSize: 12, color: MUT }}>Nenhum título elegível para o filtro.</div> : titulos.map((t) => (
            <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: `0.5px solid ${BG}`, cursor: 'pointer' }}>
              <input type="checkbox" checked={sel.has(t.id)} onChange={() => { const n = new Set(sel); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); setSel(n) }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: ESP, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.descricao}</div>
                <div style={{ fontSize: 11, color: MUT }}>{t.status} · venc {dbr(t.data_vencimento)}{t.numero_documento ? ` · doc ${t.numero_documento}` : ''}</div>
              </div>
              <div style={{ fontSize: 13, color: ESP, fontWeight: 600 }}>{brl(t.valor)}</div>
            </label>
          ))}
          <div style={{ marginTop: 10, fontSize: 13, color: ESP, fontWeight: 700 }}>Selecionado: {brl(totalOrigem)} · {sel.size} título(s)</div>
        </div>
      )}

      {sel.size > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 16, alignItems: 'start' }}>
          {/* Coluna principal: gerar parcelas + editar cada uma */}
          <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: ESP, marginBottom: 10 }}>Parcelas do acerto</div>
            {/* Gerador automático: quantidade + forma padrão */}
            <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr auto', gap: 8, alignItems: 'end', padding: 10, background: BG, borderRadius: 8, marginBottom: 12 }}>
              <div><label style={lbl}>Qtd. parcelas</label><input type="number" min={1} max={60} value={qtd} onChange={(e) => setQtd(e.target.value)} style={inp} /></div>
              <div><label style={lbl}>Forma padrão</label>
                <select value={formaPadrao} onChange={(e) => setFormaPadrao(e.target.value)} style={inp}>
                  {FORMAS_PAGAMENTO.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
                </select></div>
              <button type="button" onClick={gerarParcelas} disabled={totalOrigem <= 0} style={{ ...btnO, opacity: totalOrigem <= 0 ? 0.5 : 1 }} title="Divide o total selecionado pela quantidade (última parcela absorve o resíduo)">Gerar</button>
            </div>

            {boletos.map((b, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, marginBottom: 8, alignItems: 'end' }}>
                <div><label style={lbl}>Valor (R$)</label><input value={b.valor} onChange={(e) => setBoleto(i, { valor: e.target.value })} inputMode="decimal" style={inp} /></div>
                <div><label style={lbl}>Vencimento</label><input type="date" value={b.data_vencimento} onChange={(e) => setBoleto(i, { data_vencimento: e.target.value })} style={inp} /></div>
                <div><label style={lbl}>Forma</label>
                  <select value={b.forma_pagamento} onChange={(e) => setBoleto(i, { forma_pagamento: e.target.value })} style={inp}>
                    {FORMAS_PAGAMENTO.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
                  </select></div>
                <button onClick={() => setBoletos((bs) => bs.length > 1 ? bs.filter((_, j) => j !== i) : bs)} style={{ ...btnO, color: VERM }}>✕</button>
              </div>
            ))}
            <button onClick={() => setBoletos((bs) => [...bs, { valor: '', data_vencimento: maisMeses(bs.length + 1), forma_pagamento: formaPadrao }])} style={btnO}>+ parcela</button>
          </div>

          {/* Painel lateral: resumo do acerto (estilo inclusão de receita) */}
          <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, position: 'sticky', top: 16 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: MUT, fontWeight: 700, marginBottom: 10 }}>Resumo</div>
            <Linha k="Origem" v={brl(totalOrigem)} />
            <Linha k="Gerado" v={brl(totalGerado)} />
            <Linha k="Ajuste" v={`${ajuste > 0 ? '+' : ''}${brl(ajuste)}`} cor={ajuste === 0 ? MUT : ajuste > 0 ? VERM : VERDE} />
            <div style={{ borderTop: `0.5px solid ${LINE}`, margin: '8px 0' }} />
            <Linha k="Parcelas" v={String(boletos.length)} />
            <Linha k="Por boleto (CNAB)" v={String(qtdBoleto)} />
            {boletos.length - qtdBoleto > 0 && <Linha k="Outras formas" v={String(boletos.length - qtdBoleto)} />}
            {datasForaOrdem && <div style={{ marginTop: 10, background: '#FCEBEB', color: VERM, padding: 8, borderRadius: 6, fontSize: 11 }}>Há vencimento fora de ordem (uma parcela vence antes da anterior). Corrija — o sistema recusa.</div>}
            {ajuste !== 0 && (
              <div style={{ marginTop: 10 }}>
                <label style={lbl}>Motivo do ajuste (obrigatório)</label>
                <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ex: juros / desconto p/ quitação" style={inp} />
              </div>
            )}
            {erro && <div style={{ marginTop: 10, background: '#FCEBEB', color: VERM, padding: 10, borderRadius: 6, fontSize: 12 }}>{erro}</div>}
            <button onClick={() => setConfirmOpen(true)} disabled={totalGerado <= 0 || datasForaOrdem || (ajuste !== 0 && !motivo.trim())} style={{ ...btnG, width: '100%', marginTop: 12, opacity: (totalGerado <= 0 || datasForaOrdem || (ajuste !== 0 && !motivo.trim())) ? 0.5 : 1 }}>Revisar e confirmar</button>
          </div>
        </div>
      )}

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirmar acerto"
        footer={<>
          <button onClick={() => setConfirmOpen(false)} disabled={salvando} style={btnO}>Cancelar</button>
          <button onClick={confirmar} disabled={salvando} style={btnG}>{salvando ? 'Criando…' : 'CRIAR acerto'}</button>
        </>}>
        <div style={{ fontSize: 13, color: ESP, lineHeight: 1.6 }}>
          Consolidar <b>{sel.size} título(s)</b> ({brl(totalOrigem)}) em <b>{boletos.length} parcela(s)</b> ({brl(totalGerado)}) — {qtdBoleto} por boleto{boletos.length - qtdBoleto > 0 ? `, ${boletos.length - qtdBoleto} em outras formas` : ''}.
          {ajuste !== 0 && <> Ajuste <b>{ajuste > 0 ? '+' : ''}{brl(ajuste)}</b> — motivo: <i>{motivo}</i>.</>}
          <br /><br />As origens viram <b>renegociado</b>; as parcelas nascem <b>abertas</b>. Confirmar?
        </div>
        {erro && <div style={{ marginTop: 10, background: '#FCEBEB', color: VERM, padding: 10, borderRadius: 6, fontSize: 12 }}>{erro}</div>}
      </Modal>
    </div>
  )
}

function Linha({ k, v, cor }: { k: string; v: string; cor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0', fontSize: 13 }}>
      <span style={{ color: MUT }}>{k}</span>
      <b style={{ color: cor ?? ESP }}>{v}</b>
    </div>
  )
}

function Consultar({ companyId }: { companyId: string }) {
  const [lista, setLista] = useState<Acerto[]>([])
  const [loading, setLoading] = useState(true)
  const [aberto, setAberto] = useState<string | null>(null)
  const [detalhe, setDetalhe] = useState<Record<string, { origens: Titulo[]; gerados: Titulo[] }>>({})

  const carregar = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.rpc('fn_renegociacao_consultar', { p_company: companyId, p_filtros: {} })
    setLista((data ?? []) as Acerto[]); setLoading(false)
  }, [companyId])
  /* eslint-disable-next-line react-hooks/set-state-in-effect */
  useEffect(() => { void carregar() }, [carregar])

  async function expandir(id: string) {
    if (aberto === id) { setAberto(null); return }
    setAberto(id)
    if (!detalhe[id]) {
      const { data: orRows } = await supabase.from('erp_renegociacao_origem').select('receber_origem_id').eq('renegociacao_id', id)
      const origemIds = (orRows ?? []).map((r) => (r as { receber_origem_id: string }).receber_origem_id)
      const [orig, ger] = await Promise.all([
        origemIds.length ? supabase.from('erp_receber').select('id, descricao, valor, data_vencimento, status, numero_documento').in('id', origemIds) : Promise.resolve({ data: [] }),
        supabase.from('erp_receber').select('id, descricao, valor, data_vencimento, status, numero_documento').eq('renegociacao_id', id),
      ])
      const gerados = ((ger.data as Titulo[] | null) ?? []).filter((g) => !origemIds.includes(g.id))
      setDetalhe((d) => ({ ...d, [id]: { origens: (orig.data as Titulo[] | null) ?? [], gerados } }))
    }
  }

  async function cancelar(id: string) {
    if (!confirm('Cancelar este acerto? As origens voltam a aberto/vencido e os boletos gerados (não pagos) são cancelados.')) return
    const { data, error } = await supabase.rpc('fn_renegociacao_cancelar', { p_reneg_id: id })
    const j = data as { sucesso?: boolean; erro?: string; orientacao?: string } | null
    if (error || !j?.sucesso) { alert('Não cancelou: ' + (j?.orientacao ?? j?.erro ?? error?.message)); return }
    setDetalhe((d) => { const n = { ...d }; delete n[id]; return n }); void carregar()
  }

  if (loading) return <div style={{ padding: 30, textAlign: 'center', color: MUT, fontSize: 13 }}>Carregando…</div>
  if (lista.length === 0) return <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 24, color: MUT, fontSize: 13 }}>Nenhum acerto ainda.</div>

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {lista.map((a) => (
        <div key={a.id} style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: ESP }}>{a.cliente_nome} · {dbr(a.data_acerto)}</div>
              <div style={{ fontSize: 11, color: MUT }}>{a.qtd_origens} origem(ns) → {a.qtd_gerados} parcela(s) · origem {brl(a.valor_origem)} · gerado {brl(a.valor_gerado)}{Number(a.ajuste) !== 0 ? ` · ajuste ${Number(a.ajuste) > 0 ? '+' : ''}${brl(a.ajuste)}` : ''}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12, color: a.status === 'cancelada' ? VERM : VERDE, background: a.status === 'cancelada' ? '#FCEBEB' : 'rgba(46,139,87,0.1)' }}>{a.status}</span>
              <button onClick={() => expandir(a.id)} style={btnO}>{aberto === a.id ? '▲' : '▼'} detalhe</button>
              {a.status !== 'cancelada' && <button onClick={() => cancelar(a.id)} style={{ ...btnO, color: VERM }}>Cancelar</button>}
            </div>
          </div>
          {aberto === a.id && detalhe[a.id] && (
            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
              <div><div style={{ fontSize: 11, textTransform: 'uppercase', color: MUT, fontWeight: 700, marginBottom: 6 }}>Origens</div>
                {detalhe[a.id].origens.map((o) => <div key={o.id} style={{ fontSize: 12, color: ESP, padding: '4px 0', borderTop: `0.5px solid ${BG}` }}>{o.descricao} · {brl(o.valor)} · <span style={{ color: MUT }}>{o.status}</span></div>)}</div>
              <div><div style={{ fontSize: 11, textTransform: 'uppercase', color: MUT, fontWeight: 700, marginBottom: 6 }}>Parcelas geradas</div>
                {detalhe[a.id].gerados.map((g) => <div key={g.id} style={{ fontSize: 12, color: ESP, padding: '4px 0', borderTop: `0.5px solid ${BG}` }}>{g.descricao} · {brl(g.valor)} · venc {dbr(g.data_vencimento)} · <span style={{ color: MUT }}>{g.status}</span></div>)}</div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
