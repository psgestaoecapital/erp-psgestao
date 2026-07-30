'use client'

// Lote C · Renegociação / Acerto — criar acerto (cliente→títulos→boletos→confirmar) + consultar (drill-down
// origens↔gerados). Backend: fn_renegociacao_* (PR #805). Boleto gerado = erp_receber normal → remessa CNAB.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import Modal from '@/components/ui/Modal'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERDE = '#2E8B57', VERM = '#A32D2D'
const brl = (n: number) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dbr = (s: string | null) => s ? s.slice(0, 10).split('-').reverse().join('/') : '—'
const maisDias = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10)

type Cliente = { id: string; nome: string }
type Conta = { id: string; nome: string }
type Titulo = { id: string; descricao: string; valor: number; data_vencimento: string; status: string; numero_documento: string | null }
type Boleto = { valor: string; data_vencimento: string }
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
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
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
  const [boletos, setBoletos] = useState<Boleto[]>([{ valor: '', data_vencimento: maisDias(30) }])
  const [motivo, setMotivo] = useState('')
  const [buscou, setBuscou] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<{ renegociacao_id: string; gerados: string[] } | null>(null)

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
  const ajuste = Math.round((totalGerado - totalOrigem) * 100) / 100

  async function confirmar() {
    setSalvando(true); setErro(null)
    try {
      const { data, error } = await supabase.rpc('fn_renegociacao_criar', {
        p_company: companyId, p_cliente: clienteId || null, p_conta: contaId || null,
        p_origem_ids: [...sel],
        p_boletos: boletos.map((b) => ({ valor: parseFloat((b.valor || '0').replace(',', '.')) || 0, data_vencimento: b.data_vencimento })),
        p_observacao: motivo.trim() || null,
      })
      if (error) throw error
      const j = data as { sucesso?: boolean; erro?: string; renegociacao_id?: string; gerados?: string[] } | null
      if (!j?.sucesso) throw new Error(j?.erro ?? 'falha ao criar')
      setResultado({ renegociacao_id: j.renegociacao_id!, gerados: j.gerados ?? [] })
      setConfirmOpen(false)
    } catch (e) { setErro((e as Error).message) } finally { setSalvando(false) }
  }

  if (resultado) {
    return (
      <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: VERDE }}>✅ Acerto CRIOU</div>
        <p style={{ fontSize: 13, color: ESP, marginTop: 8 }}>{sel.size} título(s) consolidados em <b>{resultado.gerados.length} boleto(s)</b>. As origens ficaram como <b>renegociado</b>; os boletos gerados estão <b>abertos</b> e entram na remessa CNAB.</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <button onClick={() => router.push('/dashboard/financeiro/remessa-pagamento')} style={btnG}>Ir para remessa (emitir boletos)</button>
          <button onClick={() => { setResultado(null); setSel(new Set()); setBoletos([{ valor: '', data_vencimento: maisDias(30) }]); setMotivo(''); setBuscou(false) }} style={btnO}>Novo acerto</button>
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
        <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: ESP, marginBottom: 8 }}>Boletos do acerto</div>
          {boletos.map((b, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 8, alignItems: 'end' }}>
              <div><label style={lbl}>Valor (R$)</label><input value={b.valor} onChange={(e) => setBoletos((bs) => bs.map((x, j) => j === i ? { ...x, valor: e.target.value } : x))} inputMode="decimal" style={inp} /></div>
              <div><label style={lbl}>Vencimento</label><input type="date" value={b.data_vencimento} onChange={(e) => setBoletos((bs) => bs.map((x, j) => j === i ? { ...x, data_vencimento: e.target.value } : x))} style={inp} /></div>
              <button onClick={() => setBoletos((bs) => bs.length > 1 ? bs.filter((_, j) => j !== i) : bs)} style={{ ...btnO, color: VERM }}>✕</button>
            </div>
          ))}
          <button onClick={() => setBoletos((bs) => [...bs, { valor: '', data_vencimento: maisDias(30 * (bs.length + 1)) }])} style={btnO}>+ boleto</button>

          <div style={{ marginTop: 14, padding: 12, background: BG, borderRadius: 8, fontSize: 13, color: ESP }}>
            Origem <b>{brl(totalOrigem)}</b> · Gerado <b>{brl(totalGerado)}</b> · Ajuste <b style={{ color: ajuste === 0 ? MUT : ajuste > 0 ? VERM : VERDE }}>{ajuste > 0 ? '+' : ''}{brl(ajuste)}</b>
            {ajuste !== 0 && (
              <div style={{ marginTop: 8 }}>
                <label style={lbl}>Motivo do ajuste (obrigatório quando ≠ 0)</label>
                <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ex: juros de atraso / desconto p/ quitação" style={inp} />
              </div>
            )}
          </div>
          {erro && <div style={{ marginTop: 10, background: '#FCEBEB', color: VERM, padding: 10, borderRadius: 6, fontSize: 12 }}>{erro}</div>}
          <div style={{ marginTop: 12, textAlign: 'right' }}>
            <button onClick={() => setConfirmOpen(true)} disabled={totalGerado <= 0 || (ajuste !== 0 && !motivo.trim())} style={{ ...btnG, opacity: (totalGerado <= 0 || (ajuste !== 0 && !motivo.trim())) ? 0.5 : 1 }}>Revisar e confirmar</button>
          </div>
        </div>
      )}

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirmar acerto"
        footer={<>
          <button onClick={() => setConfirmOpen(false)} disabled={salvando} style={btnO}>Cancelar</button>
          <button onClick={confirmar} disabled={salvando} style={btnG}>{salvando ? 'Criando…' : 'CRIAR acerto'}</button>
        </>}>
        <div style={{ fontSize: 13, color: ESP, lineHeight: 1.6 }}>
          Consolidar <b>{sel.size} título(s)</b> ({brl(totalOrigem)}) em <b>{boletos.length} boleto(s)</b> ({brl(totalGerado)}).
          {ajuste !== 0 && <> Ajuste <b>{ajuste > 0 ? '+' : ''}{brl(ajuste)}</b> — motivo: <i>{motivo}</i>.</>}
          <br /><br />As origens viram <b>renegociado</b>; os boletos gerados nascem <b>abertos</b>. Confirmar?
        </div>
        {erro && <div style={{ marginTop: 10, background: '#FCEBEB', color: VERM, padding: 10, borderRadius: 6, fontSize: 12 }}>{erro}</div>}
      </Modal>
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
              <div style={{ fontSize: 11, color: MUT }}>{a.qtd_origens} origem(ns) → {a.qtd_gerados} boleto(s) · origem {brl(a.valor_origem)} · gerado {brl(a.valor_gerado)}{Number(a.ajuste) !== 0 ? ` · ajuste ${Number(a.ajuste) > 0 ? '+' : ''}${brl(a.ajuste)}` : ''}</div>
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
              <div><div style={{ fontSize: 11, textTransform: 'uppercase', color: MUT, fontWeight: 700, marginBottom: 6 }}>Boletos gerados</div>
                {detalhe[a.id].gerados.map((g) => <div key={g.id} style={{ fontSize: 12, color: ESP, padding: '4px 0', borderTop: `0.5px solid ${BG}` }}>{g.descricao} · {brl(g.valor)} · venc {dbr(g.data_vencimento)} · <span style={{ color: MUT }}>{g.status}</span></div>)}</div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
