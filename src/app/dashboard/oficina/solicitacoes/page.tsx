'use client'

// R5+R6 · Tela do DONO/admin: solicitações de peça do mecânico. Aqui SIM aparece PREÇO (lado admin/financeiro).
// Mostra foto + peça + qtd + observação + preço → Aprovar / Comprar / Recusar (fn_oficina_peca_decidir).
// O alerta pró-ativo (erp_alerta_proativo) leva o dono até aqui.
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Package, Check, ShoppingCart, X, RefreshCw } from 'lucide-react'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.55)'
const OK = '#166534', RED = '#A32D2D', BLUE = '#1D4ED8'
const BUCKET = 'oficina-recepcao'
const brl = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)

type Solic = {
  id: string; os_id: string; os_numero: string | null; produto_id: string | null; descricao: string
  quantidade: number; foto_path: string | null; observacao: string | null; status: string
  solicitado_por_nome: string | null; solicitado_em: string; preco_venda: number | null
}
const STATUS_COR: Record<string, string> = { solicitado: GOLD, aprovado: BLUE, comprado: OK, recusado: RED }
const STATUS_LBL: Record<string, string> = { solicitado: 'Pendente', aprovado: 'Aprovado', comprado: 'Comprado', recusado: 'Recusado' }

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
  const [lista, setLista] = useState<Solic[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [salvandoId, setSalvandoId] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.rpc('fn_oficina_peca_solicitacoes_listar', { p_company_id: companyId, p_os_id: null })
    const rows = (Array.isArray(data) ? data : []) as Solic[]
    setLista(rows)
    // signed URLs das fotos (bucket privado)
    const map: Record<string, string> = {}
    await Promise.all(rows.filter((r) => r.foto_path).map(async (r) => {
      const { data: s } = await supabase.storage.from(BUCKET).createSignedUrl(r.foto_path!, 3600)
      if (s?.signedUrl) map[r.id] = s.signedUrl
    }))
    setUrls(map); setLoading(false)
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

  if (!companyId) return <div style={{ padding: 24, color: ESP60, background: BG, minHeight: '100vh' }}>Selecione uma empresa para ver as solicitações.</div>

  const pendentes = lista.filter((s) => s.status === 'solicitado')
  const decididas = lista.filter((s) => s.status !== 'solicitado')

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '16px 12px 40px', maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: ESP, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Package size={22} color={GOLD} /> Solicitações de peça
        </h1>
        <button onClick={() => void carregar()} style={{ background: 'none', border: `1px solid ${LINE}`, borderRadius: 8, padding: 8, cursor: 'pointer', color: ESP60 }}><RefreshCw size={16} /></button>
      </div>

      {loading ? <div style={{ color: ESP60 }}>Carregando…</div> : (
        <>
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: ESP60, fontWeight: 700, margin: '4px 0 8px' }}>Pendentes ({pendentes.length})</div>
          {pendentes.length === 0 && <div style={{ color: ESP60, fontSize: 13, marginBottom: 16 }}>Nenhuma solicitação pendente.</div>}
          {pendentes.map((s) => <Card key={s.id} s={s} url={urls[s.id]} salvando={salvandoId === s.id} onDecidir={decidir} />)}

          {decididas.length > 0 && (
            <>
              <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: ESP60, fontWeight: 700, margin: '18px 0 8px' }}>Histórico</div>
              {decididas.map((s) => <Card key={s.id} s={s} url={urls[s.id]} salvando={false} onDecidir={decidir} />)}
            </>
          )}
        </>
      )}
    </div>
  )
}

function Card({ s, url, salvando, onDecidir }: { s: Solic; url?: string; salvando: boolean; onDecidir: (id: string, st: 'aprovado' | 'comprado' | 'recusado') => void }) {
  const pend = s.status === 'solicitado'
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, marginBottom: 10, display: 'flex', gap: 12 }}>
      {url ? <img src={url} alt="peça" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: `1px solid ${LINE}`, flexShrink: 0 }} />
           : <div style={{ width: 72, height: 72, borderRadius: 8, background: BG, border: `1px solid ${LINE}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ESP60 }}><Package size={22} /></div>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: ESP }}>{s.quantidade}× {s.descricao}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COR[s.status] ?? ESP60, flexShrink: 0 }}>{STATUS_LBL[s.status] ?? s.status}</span>
        </div>
        <div style={{ fontSize: 12, color: ESP60, marginTop: 2 }}>
          OS {s.os_numero ?? '—'}{s.solicitado_por_nome ? ` · ${s.solicitado_por_nome}` : ''}
          {s.preco_venda != null ? ` · ${brl(s.preco_venda)} un.` : ''}
        </div>
        {s.observacao && <div style={{ fontSize: 12, color: ESP, marginTop: 4, fontStyle: 'italic' }}>“{s.observacao}”</div>}
        {pend && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <button disabled={salvando} onClick={() => onDecidir(s.id, 'aprovado')} style={btn(BLUE)}><Check size={14} /> Aprovar</button>
            <button disabled={salvando} onClick={() => onDecidir(s.id, 'comprado')} style={btn(OK)}><ShoppingCart size={14} /> Comprar</button>
            <button disabled={salvando} onClick={() => onDecidir(s.id, 'recusado')} style={btn(RED, true)}><X size={14} /> Recusar</button>
          </div>
        )}
      </div>
    </div>
  )
}
function btn(cor: string, outline = false): React.CSSProperties {
  return { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, padding: '7px 12px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${cor}`, background: outline ? '#fff' : cor, color: outline ? cor : '#fff' }
}
