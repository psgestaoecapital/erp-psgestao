'use client'
// GE · Faturar OS — vincular (ou criar) o cliente de uma OS antes de faturar.
// Busca em erp_clientes (fn_cliente_buscar) OU cria na hora (fn_cliente_criar_inline, que DEDUPLICA
// por documento/nome — #1439). Ao escolher, fn_os_vincular_cliente propaga o cliente_id PARA A OS.
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { X, Search, UserPlus, Check } from 'lucide-react'

const ESP = '#3D2314', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.6)', WHITE = '#FFFFFF', OK = '#166534', GOLD = '#C8941A', RED = '#A32D2D'
type Achado = { cliente_id: string; nome: string; cnpj_cpf: string | null; cidade: string | null }

export default function VincularClienteModal({ companyId, os, onFechar, onVinculado }: {
  companyId: string
  os: { os_id: string; numero: string | null; placa: string | null }
  onFechar: () => void
  onVinculado: (nome: string) => void
}) {
  const [termo, setTermo] = useState('')
  const [achados, setAchados] = useState<Achado[]>([])
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [modoCriar, setModoCriar] = useState(false)
  const [novoNome, setNovoNome] = useState('')
  const [novoDoc, setNovoDoc] = useState('')
  const deb = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (deb.current) clearTimeout(deb.current)
    const t = termo.trim()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (t.length < 2) { setAchados([]); return }
    deb.current = setTimeout(async () => {
      setBuscando(true)
      const { data } = await supabase.rpc('fn_cliente_buscar', { p_company_id: companyId, p_termo: t })
      setBuscando(false)
      const r = data as { ok?: boolean; resultados?: Achado[] } | null
      setAchados(r?.resultados ?? [])
    }, 300)
    return () => { if (deb.current) clearTimeout(deb.current) }
  }, [termo, companyId])

  const vincular = async (clienteId: string) => {
    if (salvando) return
    setSalvando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_os_vincular_cliente', { p_company_id: companyId, p_os_id: os.os_id, p_cliente_id: clienteId })
    setSalvando(false)
    const r = data as { ok?: boolean; erro?: string; cliente_nome?: string } | null
    if (error || !r?.ok) {
      setErro(r?.erro === 'ja_faturada' ? 'Esta OS já foi faturada — não dá pra trocar o cliente aqui.' : (error?.message || r?.erro || 'Falha ao vincular'))
      return
    }
    onVinculado(r.cliente_nome ?? '')
  }

  const criarEVincular = async () => {
    if (salvando) return
    const nome = novoNome.trim()
    if (nome.length < 2) { setErro('Informe o nome do cliente.'); return }
    setSalvando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_cliente_criar_inline', { p_company_id: companyId, p_nome: nome, p_cpf_cnpj: novoDoc.trim() || null })
    if (error || !data) { setSalvando(false); setErro(error?.message || 'Falha ao criar o cliente'); return }
    setSalvando(false)
    await vincular(data as string)   // dedup no criar_inline garante que não duplica
  }

  return (
    <div onClick={onFechar} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 85, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: WHITE, borderRadius: 14, padding: 18, maxWidth: 460, width: '100%', maxHeight: '82vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: ESP }}>Vincular cliente</div>
          <button onClick={onFechar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: ESP60 }}><X size={18} /></button>
        </div>
        <div style={{ fontSize: 12.5, color: ESP60, marginBottom: 12 }}>OS {os.numero ?? ''}{os.placa ? ` · ${os.placa}` : ''} — vincule o cliente para poder faturar.</div>

        {!modoCriar ? (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', border: `1px solid ${LINE}`, borderRadius: 10, padding: '0 10px', marginBottom: 10 }}>
              <Search size={16} color={ESP60} />
              <input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Buscar por nome ou CPF/CNPJ…" autoFocus
                style={{ flex: 1, border: 'none', outline: 'none', padding: '10px 0', fontSize: 14, color: ESP, background: 'transparent' }} />
            </div>
            {buscando && <div style={{ fontSize: 12, color: ESP60, padding: '4px 2px' }}>Buscando…</div>}
            {termo.trim().length >= 2 && !buscando && achados.length === 0 && (
              <div style={{ fontSize: 13, color: ESP60, padding: '8px 2px' }}>Nenhum cliente encontrado.</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {achados.map((a) => (
                <button key={a.cliente_id} onClick={() => void vincular(a.cliente_id)} disabled={salvando}
                  style={{ textAlign: 'left', background: WHITE, border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px', cursor: salvando ? 'wait' : 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: ESP }}>{a.nome}</span>
                    <span style={{ fontSize: 11.5, color: ESP60, display: 'block' }}>{[a.cnpj_cpf, a.cidade].filter(Boolean).join(' · ') || 'sem documento'}</span>
                  </span>
                  <Check size={16} color={OK} />
                </button>
              ))}
            </div>
            <button onClick={() => { setModoCriar(true); setNovoNome(termo.trim()); setErro(null) }}
              style={{ width: '100%', minHeight: 44, borderRadius: 10, border: `1px dashed ${GOLD}`, background: 'rgba(200,148,26,0.06)', color: ESP, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <UserPlus size={15} /> Não está aí? Criar cliente novo
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: ESP60, marginBottom: 8 }}>Se já existir (mesmo documento ou nome), o sistema reusa — não duplica.</div>
            <label style={{ fontSize: 11, color: ESP60 }}>Nome do cliente</label>
            <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} autoFocus
              style={{ width: '100%', border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px', fontSize: 14, color: ESP, marginBottom: 10, boxSizing: 'border-box' }} />
            <label style={{ fontSize: 11, color: ESP60 }}>CPF/CNPJ (opcional, mas recomendado)</label>
            <input value={novoDoc} onChange={(e) => setNovoDoc(e.target.value)} inputMode="numeric" placeholder="só números ou formatado"
              style={{ width: '100%', border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px', fontSize: 14, color: ESP, marginBottom: 12, boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setModoCriar(false); setErro(null) }} style={{ flex: 1, minHeight: 44, borderRadius: 10, border: `1px solid ${LINE}`, background: WHITE, color: ESP, fontWeight: 700, cursor: 'pointer' }}>Voltar à busca</button>
              <button onClick={() => void criarEVincular()} disabled={salvando} style={{ flex: 1, minHeight: 44, borderRadius: 10, border: 'none', background: OK, color: '#fff', fontWeight: 800, cursor: salvando ? 'wait' : 'pointer' }}>
                {salvando ? 'Salvando…' : 'Criar e vincular'}
              </button>
            </div>
          </>
        )}
        {erro && <div style={{ fontSize: 13, color: RED, fontWeight: 700, marginTop: 10 }}>{erro}</div>}
      </div>
    </div>
  )
}
