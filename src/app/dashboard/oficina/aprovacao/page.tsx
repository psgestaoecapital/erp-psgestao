'use client'
// OFICINA · APROVAÇÃO / ORÇAMENTO (operacional COM valor). Mobile-first.
// O tempário precifica dentro da Oficina: mostra valor sugerido por item (editável) + total,
// aprova item a item, registra a trilha (quem/quando/valor) e compartilha no WhatsApp.
// 🚫 SEM gerar título, SEM baixa de estoque, SEM tela financeira — faturamento é da GE (#696 pausado).
import React, { useEffect, useState, useCallback, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardCheck, ChevronLeft, Check, X, Share2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314'; const BG = '#FAF7F2'; const GOLD = '#C8941A'; const LINE = '#E7DECF'; const ESP60 = 'rgba(61,35,20,0.55)'
const OK = '#166534'; const RED = '#A32D2D'; const AMBER = '#B45309'
const SEV_COR: Record<string, string> = { critico: RED, recomendado: AMBER, futuro: ESP60 }
const CANAIS = [{ v: 'presencial', l: 'Presencial' }, { v: 'whatsapp', l: 'WhatsApp' }, { v: 'telefone', l: 'Telefone' }, { v: 'email', l: 'E-mail' }]
const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(isFinite(n) ? n : 0)

type ItemOrc = { item_id: string; tipo: string; descricao: string; servico_id: string | null; produto_id: string | null; quantidade: number | null; tempo_estimado_h: number | null; severidade: string; aprovado: boolean | null; preco: number | null; preco_sugerido: number | null }
type OSInfo = { id: string; numero: string; cliente_nome: string | null; placa: string | null; marca: string | null; modelo: string | null }
type OSLinha = OSInfo

function useCompanyId(): string | null {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => {
      if (typeof window === 'undefined') return null
      const v = localStorage.getItem('ps_empresa_sel')
      if (!v || v === 'consolidado' || v.startsWith('group_')) return null
      return v
    }
    setId(read())
    const t = setInterval(() => { const v = read(); setId((p) => (p === v ? p : v)) }, 800)
    return () => clearInterval(t)
  }, [])
  return id
}

// estado editável por item: decisão + preço (string p/ o input)
type Linha = ItemOrc & { _preco: string }

export default function AprovacaoPage() {
  const companyId = useCompanyId()
  const router = useRouter()
  const [lista, setLista] = useState<OSLinha[]>([])
  const [osSel, setOsSel] = useState<OSInfo | null>(null)
  const [itens, setItens] = useState<Linha[]>([])
  const [aprovadorNome, setAprovadorNome] = useState('')
  const [canal, setCanal] = useState('presencial')
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const carregarLista = useCallback(async () => {
    if (!companyId) return
    const { data } = await supabase.from('erp_os')
      .select('id, numero, cliente_nome, placa, marca, modelo')
      .eq('company_id', companyId).eq('excluida', false)
      .not('status', 'in', '("entregue","cancelada")')
      .order('created_at', { ascending: false }).limit(50)
    setLista((data as OSLinha[]) ?? [])
  }, [companyId])

  useEffect(() => { void carregarLista() }, [carregarLista])

  const abrirOS = async (os: OSLinha) => {
    if (!companyId) return
    const { data } = await supabase.rpc('fn_oficina_orcamento_precificar', { p_company_id: companyId, p_os_id: os.id })
    const d = data as { ok?: boolean; os?: OSInfo; itens?: ItemOrc[] } | null
    const its = (d?.itens ?? [])
    if (its.length === 0) { setMsg('Essa OS ainda não tem laudo. Faça o diagnóstico primeiro.'); return }
    setOsSel(d?.os ?? os)
    setItens(its.map((i) => ({
      ...i,
      aprovado: i.aprovado === null ? true : i.aprovado,               // default: aprovado
      _preco: String(i.preco ?? i.preco_sugerido ?? ''),               // preço editável: acordado > sugerido
    })))
    setAprovadorNome(os.cliente_nome ?? '')
  }

  const toggle = (id: string) => setItens((p) => p.map((i) => (i.item_id === id ? { ...i, aprovado: !i.aprovado } : i)))
  const setPreco = (id: string, v: string) => setItens((p) => p.map((i) => (i.item_id === id ? { ...i, _preco: v.replace(/[^\d.,]/g, '') } : i)))
  const precoNum = (l: Linha) => Number((l._preco || '0').replace(',', '.')) || 0
  const totalAprov = itens.filter((i) => i.aprovado).reduce((s, i) => s + precoNum(i), 0)

  const salvar = async () => {
    if (!companyId || !osSel) return
    setSalvando(true)
    const { data, error } = await supabase.rpc('fn_oficina_orcamento_registrar', {
      p_company_id: companyId, p_os_id: osSel.id,
      p_dados: { aprovador_nome: aprovadorNome, canal, observacao, itens: itens.map((i) => ({ item_id: i.item_id, aprovado: !!i.aprovado, preco: precoNum(i) || null })) },
    })
    setSalvando(false)
    const j = data as { ok?: boolean; erro?: string; decisao?: string; itens_aprovados?: number; itens_total?: number; valor_total?: number } | null
    if (error || j?.ok === false) { setMsg('❌ ' + (error?.message || j?.erro)); return }
    setMsg(`✅ Orçamento registrado (${j?.decisao}) — ${j?.itens_aprovados}/${j?.itens_total} itens · ${brl(Number(j?.valor_total) || 0)}.`)
    setTimeout(() => setOsSel(null), 1800)
  }

  const compartilharWhatsApp = () => {
    if (!osSel) return
    const linhas = itens.filter((i) => i.aprovado).map((i) => `✅ ${i.descricao} — ${brl(precoNum(i))}`)
    const texto = [
      `*Orçamento ${osSel.numero}* — ${osSel.placa ?? ''} ${osSel.marca ?? ''} ${osSel.modelo ?? ''}`.trim(),
      '', ...linhas, '',
      `*Total: ${brl(totalAprov)}*`, '',
      'Responda *APROVO* para autorizarmos o serviço.',
    ].join('\n')
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener')
  }

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4500); return () => clearTimeout(t) }, [msg])

  if (!companyId) return <div style={{ padding: 24, color: ESP60, background: BG, minHeight: '100vh' }}>Selecione uma empresa específica no topo para abrir a Aprovação.</div>

  if (!osSel) return (
    <div style={{ background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 14px 40px' }}>
        <button onClick={() => router.push('/dashboard/oficina/patio')} style={linkBtn}><ChevronLeft size={16} /> Pátio</button>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 6 }}>🔧 Oficina · Orçamento & Aprovação</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}><ClipboardCheck size={22} /> Qual laudo orçar?</h1>
        {lista.length === 0 && <div style={{ color: ESP60, fontSize: 14, padding: '20px 0' }}>Nenhum veículo ativo no pátio.</div>}
        {lista.map((os) => (
          <button key={os.id} onClick={() => void abrirOS(os)} style={{ width: '100%', textAlign: 'left', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 10, cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{os.placa || '—'} · {os.marca} {os.modelo}</span>
              <span style={{ fontSize: 11, color: ESP60 }}>{os.numero}</span>
            </div>
            <div style={{ fontSize: 13, color: ESP60, marginTop: 3 }}>{os.cliente_nome || 'Cliente não informado'}</div>
          </button>
        ))}
      </div>
      {msg && <Toast>{msg}</Toast>}
    </div>
  )

  const nAprov = itens.filter((i) => i.aprovado).length

  return (
    <div style={{ background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 14px 120px' }}>
        <button onClick={() => setOsSel(null)} style={linkBtn}><ChevronLeft size={16} /> Trocar veículo</button>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 6 }}>🔧 Oficina · Orçamento · {osSel.numero}</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '2px 0 10px' }}>{osSel.placa} · {osSel.marca} {osSel.modelo}</h1>

        <Sec titulo={`Itens do orçamento (${nAprov}/${itens.length})`}>
          {itens.map((i) => (
            <div key={i.item_id} style={{ border: `1px solid ${i.aprovado ? OK : LINE}`, borderRadius: 12, padding: 12, marginBottom: 8, background: i.aprovado ? 'rgba(22,101,52,0.04)' : '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: SEV_COR[i.severidade] ?? ESP60, flexShrink: 0 }} />
                    {i.descricao}
                  </div>
                  <div style={{ fontSize: 11, color: ESP60, marginTop: 2 }}>
                    {i.tipo === 'peca' ? 'Peça' : 'Serviço'}{i.tempo_estimado_h ? ` · ${i.tempo_estimado_h}h` : ''}{i.quantidade && i.quantidade !== 1 ? ` · qtd ${i.quantidade}` : ''}
                    {i.preco_sugerido != null && <> · sugerido {brl(Number(i.preco_sugerido))}</>}
                  </div>
                </div>
                <button onClick={() => toggle(i.item_id)} style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, color: i.aprovado ? OK : RED, background: 'none', border: 'none', cursor: 'pointer' }}>
                  {i.aprovado ? <><Check size={16} /> Fazer</> : <><X size={16} /> Não</>}
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <span style={{ fontSize: 12, color: ESP60 }}>R$</span>
                <input value={i._preco} onChange={(e) => setPreco(i.item_id, e.target.value)} inputMode="decimal" placeholder="0,00"
                  style={{ ...inp, maxWidth: 140, padding: '8px 10px', opacity: i.aprovado ? 1 : 0.5 }} />
                {i.preco_sugerido != null && i._preco !== String(i.preco_sugerido) && (
                  <button onClick={() => setPreco(i.item_id, String(i.preco_sugerido))} style={{ ...chipMini }}>usar sugerido</button>
                )}
              </div>
            </div>
          ))}
        </Sec>

        <Sec titulo="Quem autorizou">
          <Campo l="Nome de quem autorizou"><input value={aprovadorNome} onChange={(e) => setAprovadorNome(e.target.value)} placeholder="Nome do cliente" style={inp} /></Campo>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {CANAIS.map((c) => (
              <button key={c.v} onClick={() => setCanal(c.v)} style={{ ...chip, background: canal === c.v ? ESP : '#fff', color: canal === c.v ? '#fff' : ESP, borderColor: canal === c.v ? ESP : LINE }}>{c.l}</button>
            ))}
          </div>
          <Campo l="Observação (opcional)"><textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} placeholder="Ex.: cliente pediu para adiar a retífica." style={{ ...inp, resize: 'vertical' }} /></Campo>
          <button onClick={compartilharWhatsApp} style={{ ...btnLine, width: '100%', gap: 6, marginTop: 4 }}><Share2 size={15} /> Compartilhar orçamento no WhatsApp</button>
        </Sec>
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: `1px solid ${LINE}`, padding: '10px 14px' }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: ESP60 }}>Total aprovado</span>
            <span style={{ fontSize: 20, fontWeight: 800, color: ESP }}>{brl(totalAprov)}</span>
          </div>
          <button onClick={salvar} disabled={salvando} style={{ ...btnGold, width: '100%', fontSize: 15, minHeight: 48 }}>
            {salvando ? 'Registrando…' : `Registrar aprovação (${nAprov}/${itens.length})`}
          </button>
        </div>
      </div>
      {msg && <Toast>{msg}</Toast>}
    </div>
  )
}

function Sec({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: ESP60, fontWeight: 700, marginBottom: 10 }}>{titulo}</div>
      {children}
    </div>
  )
}
function Campo({ l, children }: { l: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 10 }}><div style={{ fontSize: 11, color: ESP60, marginBottom: 4 }}>{l}</div>{children}</div>
}
function Toast({ children }: { children: React.ReactNode }) {
  return <div style={{ position: 'fixed', bottom: 96, left: '50%', transform: 'translateX(-50%)', background: ESP, color: '#fff', padding: '10px 16px', borderRadius: 999, fontSize: 13, zIndex: 70, maxWidth: '92%', textAlign: 'center' }}>{children}</div>
}
const inp: CSSProperties = { width: '100%', padding: '11px 12px', border: `1px solid ${LINE}`, borderRadius: 10, fontSize: 15, background: '#fff', color: ESP, outline: 'none', fontFamily: 'inherit' }
const btnGold: CSSProperties = { background: GOLD, color: '#3D2314', border: 'none', borderRadius: 10, padding: '11px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }
const btnLine: CSSProperties = { background: '#fff', color: ESP, border: `1px solid ${LINE}`, borderRadius: 10, padding: '11px 12px', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }
const chip: CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }
const chipMini: CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 999, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', background: '#fff', color: ESP60 }
const linkBtn: CSSProperties = { background: 'none', border: 'none', color: ESP60, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: 0 }
