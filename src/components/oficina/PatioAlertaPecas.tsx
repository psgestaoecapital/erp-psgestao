'use client'
// RD-41 · Pátio — alerta "mecânico solicitou peça" estilo notificação (ícone + badge de não-vistas).
// RD-26: reusa a MESMA fonte que já alimenta o painel GE — fn_oficina_peca_solicitacoes_listar
// (pendentes = status 'solicitado'). "Visto" é local (localStorage por empresa): abrir a lista
// zera o badge sem mexer no status real da solicitação (quem decide aprova/compra na tela própria).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Bell, Package, ArrowUpRight } from 'lucide-react'

const ESP = '#3D2314', ESP60 = '#6B5D4F', GOLD = '#C8941A', RED = '#B91C1C', LINE = '#E7DECF'
type Pend = { id: string; os_numero: string | null; descricao: string; quantidade: number }

export function PatioAlertaPecas({ companyId }: { companyId: string }) {
  const [pend, setPend] = useState<Pend[]>([])
  const [aberto, setAberto] = useState(false)
  const [vistas, setVistas] = useState<Set<string>>(new Set())
  const ref = useRef<HTMLDivElement>(null)
  const chave = `patio_pecas_vistas_${companyId}`

  // carrega o set de "vistas" do localStorage (por empresa)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { const raw = localStorage.getItem(chave); if (raw) setVistas(new Set(JSON.parse(raw) as string[])) } catch { /* noop */ }
  }, [chave])

  const carregar = useCallback(async () => {
    const { data } = await supabase.rpc('fn_oficina_peca_solicitacoes_listar', { p_company_id: companyId, p_os_id: null })
    const lista = ((data as { id: string; os_numero: string | null; descricao: string; quantidade: number; status: string }[]) ?? [])
      .filter((s) => s.status === 'solicitado')
      .map((s) => ({ id: s.id, os_numero: s.os_numero, descricao: s.descricao, quantidade: Number(s.quantidade) }))
    setPend(lista)
  }, [companyId])

  // primeira carga + atualização periódica (leve; só solicitações 'solicitado')
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar()
    const i = setInterval(() => { void carregar() }, 30000)
    return () => clearInterval(i)
  }, [carregar])

  // fecha ao clicar fora
  useEffect(() => {
    if (!aberto) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [aberto])

  const naoVistas = useMemo(() => pend.filter((p) => !vistas.has(p.id)).length, [pend, vistas])

  const abrir = () => {
    setAberto((v) => !v)
    if (!aberto && pend.length) {
      // marca todas as pendentes atuais como vistas → zera o badge (honesto: some ao ver)
      const novo = new Set(vistas); pend.forEach((p) => novo.add(p.id)); setVistas(novo)
      try { localStorage.setItem(chave, JSON.stringify(Array.from(novo))) } catch { /* noop */ }
    }
  }

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button type="button" onClick={abrir} aria-label="Solicitações de peça" title="Solicitações de peça"
        style={{ position: 'relative', width: 40, height: 40, borderRadius: 10, border: `1px solid ${LINE}`, background: '#fff', color: ESP, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
        <Bell size={18} />
        {naoVistas > 0 && (
          <span style={{ position: 'absolute', top: -6, right: -6, minWidth: 18, height: 18, padding: '0 4px', borderRadius: 999, background: RED, color: '#fff', fontSize: 10.5, fontWeight: 800, lineHeight: '18px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }}>
            {naoVistas}
          </span>
        )}
      </button>

      {aberto && (
        <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 300, maxWidth: 'calc(100vw - 24px)', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, boxShadow: '0 8px 24px rgba(61,35,20,.14)', zIndex: 40, overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', borderBottom: `1px solid ${LINE}`, fontSize: 12.5, fontWeight: 800, color: ESP, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Package size={15} color={GOLD} /> Solicitações de peça · {pend.length}
          </div>
          {pend.length === 0 ? (
            <div style={{ padding: '14px 12px', fontSize: 12.5, color: ESP60 }}>Nenhuma solicitação pendente.</div>
          ) : (
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              {pend.map((p) => (
                <div key={p.id} style={{ padding: '9px 12px', borderBottom: `0.5px solid ${LINE}`, fontSize: 12.5, color: ESP }}>
                  <div style={{ fontWeight: 700 }}>{p.quantidade}× {p.descricao}</div>
                  <div style={{ fontSize: 11, color: ESP60 }}>OS {p.os_numero ?? '—'}</div>
                </div>
              ))}
            </div>
          )}
          <a href="/dashboard/oficina/solicitacoes" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '10px 12px', fontSize: 12.5, fontWeight: 700, color: GOLD, textDecoration: 'none', borderTop: `1px solid ${LINE}` }}>
            Abrir solicitações <ArrowUpRight size={14} />
          </a>
        </div>
      )}
    </div>
  )
}
