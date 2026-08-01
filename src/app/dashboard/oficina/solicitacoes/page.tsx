'use client'

// RD-41 · Tela do ADM/gerente: solicitações de peça do mecânico (fecha o loop do #831).
// Lista (fn_oficina_peca_solicitacoes_listar) + decidir (aprovar/comprar/recusar) +
// marcar trocada. Filtros por OS e status. Custo aparece SÓ p/ gerente (o guard do
// #831 zera preco_venda p/ OPERATOR no backend — Pilar 2). FRONTEIRA GE: custo/compra
// são de GE (Estoque/Compras); aqui só exibe/dispara, não recria.
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Package, Check, ShoppingCart, X, RefreshCw, Wrench } from 'lucide-react'
import { useAcesso } from '@/hooks/useAcesso'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.55)'
const OK = '#166534', RED = '#A32D2D', BLUE = '#1D4ED8', TEAL = '#0F766E'
const BUCKET = 'oficina-recepcao'
const brl = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)

type Solic = {
  id: string; os_id: string; os_numero: string | null; produto_id: string | null; descricao: string
  quantidade: number; foto_path: string | null; observacao: string | null; status: string
  solicitado_por_nome: string | null; solicitado_em: string; preco_venda: number | null
}
const STATUS_COR: Record<string, string> = { solicitado: GOLD, aprovado: BLUE, comprado: OK, recusado: RED, trocada: TEAL }
const STATUS_LBL: Record<string, string> = { solicitado: 'Pendente', aprovado: 'Aprovado', comprado: 'Comprado', recusado: 'Recusado', trocada: 'Trocada ✓' }
const FILTRO_STATUS: { v: string; l: string }[] = [
  { v: 'todos', l: 'Todos' }, { v: 'solicitado', l: 'Pendentes' }, { v: 'aprovado', l: 'Aprovados' },
  { v: 'comprado', l: 'Comprados' }, { v: 'trocada', l: 'Trocados' }, { v: 'recusado', l: 'Recusados' },
]

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

export default function SolicitacoesPecaPage() {
  const companyId = useCompanyId()
  const { isGerencial, isOperator } = useAcesso(companyId)
  const [lista, setLista] = useState<Solic[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [placas, setPlacas] = useState<Record<string, string>>({})   // os_id → placa
  const [loading, setLoading] = useState(true)
  const [salvandoId, setSalvandoId] = useState<string | null>(null)
  const [fStatus, setFStatus] = useState('todos')
  const [fOs, setFOs] = useState('todos')
  // ADM/gerente decide; papéis não-gerenciais veem a lista em leitura (e sem R$, pelo backend).
  const podeDecidir = isGerencial

  const carregar = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.rpc('fn_oficina_peca_solicitacoes_listar', { p_company_id: companyId, p_os_id: null })
    const rows = (Array.isArray(data) ? data : []) as Solic[]
    setLista(rows)
    // signed URLs das fotos (bucket privado) + placa da OS
    const map: Record<string, string> = {}
    await Promise.all(rows.filter((r) => r.foto_path).map(async (r) => {
      const { data: s } = await supabase.storage.from(BUCKET).createSignedUrl(r.foto_path!, 3600)
      if (s?.signedUrl) map[r.id] = s.signedUrl
    }))
    setUrls(map)
    const osIds = Array.from(new Set(rows.map((r) => r.os_id)))
    if (osIds.length) {
      const { data: oss } = await supabase.from('erp_os').select('id, placa').in('id', osIds)
      const pm: Record<string, string> = {}
      ;(oss ?? []).forEach((o: { id: string; placa: string | null }) => { if (o.placa) pm[o.id] = o.placa })
      setPlacas(pm)
    }
    setLoading(false)
  }, [companyId])
  useEffect(() => { void carregar() }, [carregar])

  async function decidir(id: string, status: 'aprovado' | 'comprado' | 'recusado') {
    if (!companyId) return
    setSalvandoId(id)
    const { data, error } = await supabase.rpc('fn_oficina_peca_decidir', { p_company_id: companyId, p_solicitacao_id: id, p_status: status, p_decidido_por: null })
    setSalvandoId(null)
    const res = data as { ok?: boolean; erro?: string } | null
    if (error || !res?.ok) { alert(error?.message || res?.erro || 'Falha'); return }
    setLista((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)))
  }
  async function marcarTrocada(id: string) {
    if (!companyId) return
    setSalvandoId(id)
    const { data, error } = await supabase.rpc('fn_oficina_peca_marcar_trocada', { p_company_id: companyId, p_solicitacao_id: id })
    setSalvandoId(null)
    const res = data as { ok?: boolean; erro?: string } | null
    if (error || !res?.ok) { alert(error?.message || res?.erro || 'Falha'); return }
    setLista((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'trocada' } : s)))
  }

  if (!companyId) return <div style={{ padding: 24, color: ESP60, background: BG, minHeight: '100vh' }}>Selecione uma empresa específica no topo para ver as solicitações.</div>

  const osOpcoes = Array.from(new Map(lista.map((s) => [s.os_id, `OS ${s.os_numero ?? '—'}${placas[s.os_id] ? ` · ${placas[s.os_id]}` : ''}`])).entries())
  const filtrada = lista.filter((s) => (fStatus === 'todos' || s.status === fStatus) && (fOs === 'todos' || s.os_id === fOs))
  const pendentes = filtrada.filter((s) => s.status === 'solicitado')
  const outras = filtrada.filter((s) => s.status !== 'solicitado')

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '16px 12px 40px', maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>🔧 Oficina</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: ESP, display: 'inline-flex', alignItems: 'center', gap: 8, margin: '2px 0 0' }}>
            <Package size={22} color={GOLD} /> Solicitações de peça
          </h1>
        </div>
        <button onClick={() => void carregar()} title="Atualizar" style={{ background: 'none', border: `1px solid ${LINE}`, borderRadius: 8, padding: 8, cursor: 'pointer', color: ESP60 }}><RefreshCw size={16} /></button>
      </div>

      {/* Filtros: OS + status */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <select value={fOs} onChange={(e) => setFOs(e.target.value)} style={sel}>
          <option value="todos">🚗 Todas as OS</option>
          {osOpcoes.map(([id, lbl]) => <option key={id} value={id}>{lbl}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={sel}>
          {FILTRO_STATUS.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
        </select>
      </div>

      {loading ? <div style={{ color: ESP60 }}>Carregando…</div> : filtrada.length === 0 ? (
        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '32px 16px', textAlign: 'center' }}>
          <Package size={30} color={ESP60} style={{ opacity: 0.6 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: ESP, marginTop: 8 }}>Nenhuma solicitação por aqui</div>
          <div style={{ fontSize: 13, color: ESP60, marginTop: 4 }}>As peças que os mecânicos pedirem aparecem aqui pra você aprovar.</div>
        </div>
      ) : (
        <>
          {pendentes.length > 0 && (
            <>
              <div style={secTit}>Pendentes ({pendentes.length})</div>
              {pendentes.map((s) => <Card key={s.id} s={s} url={urls[s.id]} placa={placas[s.os_id]} salvando={salvandoId === s.id} podeDecidir={podeDecidir} onDecidir={decidir} onTrocada={marcarTrocada} />)}
            </>
          )}
          {outras.length > 0 && (
            <>
              <div style={{ ...secTit, marginTop: 18 }}>Histórico ({outras.length})</div>
              {outras.map((s) => <Card key={s.id} s={s} url={urls[s.id]} placa={placas[s.os_id]} salvando={salvandoId === s.id} podeDecidir={podeDecidir} onDecidir={decidir} onTrocada={marcarTrocada} />)}
            </>
          )}
          {isOperator && <div style={{ fontSize: 11, color: ESP60, textAlign: 'center', marginTop: 14 }}>Decisão e valores são do gerente.</div>}
        </>
      )}
    </div>
  )
}

function Card({ s, url, placa, salvando, podeDecidir, onDecidir, onTrocada }: {
  s: Solic; url?: string; placa?: string; salvando: boolean; podeDecidir: boolean
  onDecidir: (id: string, st: 'aprovado' | 'comprado' | 'recusado') => void
  onTrocada: (id: string) => void
}) {
  const pend = s.status === 'solicitado'
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, marginBottom: 10, display: 'flex', gap: 12 }}>
      {url ? <img src={url} alt="peça" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: `1px solid ${LINE}`, flexShrink: 0 }} />
           : <div style={{ width: 72, height: 72, borderRadius: 8, background: BG, border: `1px solid ${LINE}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ESP60 }}><Package size={22} /></div>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: ESP }}>{Number(s.quantidade)}× {s.descricao}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COR[s.status] ?? ESP60, flexShrink: 0 }}>{STATUS_LBL[s.status] ?? s.status}</span>
        </div>
        <div style={{ fontSize: 12, color: ESP60, marginTop: 2 }}>
          OS {s.os_numero ?? '—'}{placa ? ` · ${placa}` : ''}{s.solicitado_por_nome ? ` · ${s.solicitado_por_nome}` : ''}
          {/* custo só aparece quando a RPC devolve (gerente); p/ OPERATOR vem NULL (guard #831) */}
          {s.preco_venda != null ? ` · ${brl(s.preco_venda)} un.` : ''}
        </div>
        {s.observacao && <div style={{ fontSize: 12, color: ESP, marginTop: 4, fontStyle: 'italic' }}>“{s.observacao}”</div>}
        {podeDecidir && s.status !== 'trocada' && s.status !== 'recusado' && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {pend && <button disabled={salvando} onClick={() => onDecidir(s.id, 'aprovado')} style={btn(BLUE)}><Check size={14} /> Aprovar</button>}
            {(pend || s.status === 'aprovado') && <button disabled={salvando} onClick={() => onDecidir(s.id, 'comprado')} style={btn(OK)}><ShoppingCart size={14} /> Comprada</button>}
            {(s.status === 'aprovado' || s.status === 'comprado') && <button disabled={salvando} onClick={() => onTrocada(s.id)} style={btn(TEAL)}><Wrench size={14} /> Trocada</button>}
            {pend && <button disabled={salvando} onClick={() => onDecidir(s.id, 'recusado')} style={btn(RED, true)}><X size={14} /> Recusar</button>}
          </div>
        )}
      </div>
    </div>
  )
}

const sel: React.CSSProperties = { padding: '9px 12px', fontSize: 13, borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: ESP, fontWeight: 600, flex: '1 1 160px' }
const secTit: React.CSSProperties = { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: ESP60, fontWeight: 700, margin: '4px 0 8px' }
function btn(cor: string, outline = false): React.CSSProperties {
  return { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, padding: '7px 12px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${cor}`, background: outline ? '#fff' : cor, color: outline ? cor : '#fff' }
}
