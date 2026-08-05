'use client'
// Central de Ajuda · F0 Fatia 3 — widget "?" in-app contextual. Frontend puro: consome
// fn_ajuda_buscar / fn_ajuda_registrar_uso (#873/#874) — RD-26, zero backend novo.
// Grounding (RD-51): mostra só o que a busca retorna. Contextual (rota atual = boost) e por papel
// (Pilar 2 — a fn filtra papel_min/tenant). Custo ~zero (FTS, RD-42). Mobile-first (Pilar 3).
import React, { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { useAcesso, type PapelGestao } from '@/hooks/useAcesso'

const ESP = '#3D2314', MUT = 'rgba(61,35,20,0.6)', BG = '#FAF7F2', LINE = '#E7DECF', GOLD = '#C8941A', GREEN = '#166534', RED = '#A32D2D'

type Resultado = { artigo_id: string; titulo: string; resumo: string | null; rota_ref: string | null; vertical: string | null; fonte: string; score: number }

const papelInt = (p: PapelGestao): number =>
  p === 'CLIENT_OWNER' ? 4 : p === 'CLIENT_MANAGER' ? 3 : p === 'CLIENT_OPERATOR' ? 2 : 1

export default function AjudaWidget() {
  const router = useRouter()
  const pathname = usePathname()
  const { sel, companyIds } = useCompanyIds()
  const activeCompany = sel && sel !== 'consolidado' && !sel.startsWith('group_') ? sel : (companyIds.length === 1 ? companyIds[0] : null)
  const { papel } = useAcesso(activeCompany)

  const [aberto, setAberto] = useState(false)
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState<Resultado[]>([])
  const [buscando, setBuscando] = useState(false)
  const [buscou, setBuscou] = useState(false)
  const [feedback, setFeedback] = useState<Record<string, 'sim' | 'nao'>>({})
  const [toast, setToast] = useState<string | null>(null)
  const gapRegistrado = React.useRef<string>('')  // evita registrar o mesmo gap 2x
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const registrarUso = useCallback((pergunta: string, resolveu: boolean, artigoId?: string | null) => {
    void supabase.rpc('fn_ajuda_registrar_uso', {
      p_company_id: activeCompany, p_pergunta: pergunta, p_resolveu: resolveu,
      p_artigo_id: artigoId ?? null, p_rota: pathname, p_papel: papelInt(papel),
    })
  }, [activeCompany, pathname, papel])

  const buscar = useCallback(async (q: string) => {
    const t = q.trim()
    if (t.length < 2) { setResultados([]); setBuscou(false); return }
    setBuscando(true)
    const { data } = await supabase.rpc('fn_ajuda_buscar', {
      p_company_id: activeCompany, p_termo: t, p_rota_atual: pathname, p_papel: papelInt(papel),
    })
    const r = data as { ok?: boolean; resultados?: Resultado[] } | null
    const lista = r?.ok ? (r.resultados ?? []) : []
    setResultados(lista); setBuscando(false); setBuscou(true)
    // gap (RD-51): busca sem resposta → registra pra curadoria (uma vez por termo).
    if (lista.length === 0 && gapRegistrado.current !== t.toLowerCase()) {
      gapRegistrado.current = t.toLowerCase()
      registrarUso(t, false, null)
    }
  }, [activeCompany, pathname, papel, registrarUso])

  const onTermo = (v: string) => {
    setTermo(v); setBuscou(false)
    if (timer.current) clearTimeout(timer.current)
    if (v.trim().length < 2) { setResultados([]); return }
    timer.current = setTimeout(() => { void buscar(v) }, 300)
  }

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t) }, [toast])
  // fecha ao trocar de rota (o usuário navegou pra tela sugerida)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setAberto(false) }, [pathname])

  function irParaTela(rota: string | null, artigoId: string) {
    if (!rota) return
    registrarUso(termo.trim(), true, artigoId)
    setAberto(false)
    router.push(rota)
  }
  function avaliar(artigoId: string, ok: boolean) {
    setFeedback((f) => ({ ...f, [artigoId]: ok ? 'sim' : 'nao' }))
    registrarUso(termo.trim(), ok, artigoId)
    setToast(ok ? 'Que bom! 👍' : 'Obrigado — vamos melhorar isso.')
  }
  function falarSuporte() {
    registrarUso(termo.trim(), false, null)
    setToast('Sua dúvida foi encaminhada à equipe PS.')
  }

  return (
    <>
      <button type="button" onClick={() => setAberto(true)} aria-label="Ajuda"
        style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 900, width: 52, height: 52, borderRadius: '50%', border: 'none', background: GOLD, color: '#fff', fontSize: 24, fontWeight: 800, cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,.18)' }}>
        ?
      </button>

      {aberto && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 950, background: 'rgba(61,35,20,0.4)', display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setAberto(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, background: BG, height: '100%', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 24px rgba(0,0,0,.15)' }}>
            <div style={{ padding: '14px 16px', borderBottom: `1px solid ${LINE}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>Central de Ajuda</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: ESP }}>Como podemos ajudar?</div>
              </div>
              <button type="button" onClick={() => setAberto(false)} aria-label="Fechar" style={{ background: 'none', border: 'none', fontSize: 22, color: MUT, cursor: 'pointer', minWidth: 44, minHeight: 44 }}>✕</button>
            </div>

            <div style={{ padding: 16 }}>
              <input autoFocus value={termo} onChange={(e) => onTermo(e.target.value)}
                placeholder="Ex.: como emito uma nota fiscal"
                style={{ width: '100%', border: `1px solid ${LINE}`, borderRadius: 10, padding: '11px 12px', fontSize: 15, color: ESP, background: '#fff', boxSizing: 'border-box' }} />
              {buscando && <div style={{ fontSize: 12, color: MUT, marginTop: 8 }}>buscando…</div>}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 24px' }}>
              {resultados.map((r) => {
                const atual = r.rota_ref && r.rota_ref === pathname
                return (
                  <div key={r.artigo_id} style={{ background: '#fff', border: `1px solid ${atual ? GOLD : LINE}`, borderRadius: 12, padding: 12, marginBottom: 10 }}>
                    {atual && <div style={{ fontSize: 10, fontWeight: 700, color: GOLD, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>desta tela</div>}
                    <div style={{ fontSize: 14, fontWeight: 700, color: ESP }}>{r.titulo}</div>
                    {r.resumo && <div style={{ fontSize: 12.5, color: MUT, marginTop: 3 }}>{r.resumo}</div>}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                      {r.rota_ref && (
                        <button type="button" onClick={() => irParaTela(r.rota_ref, r.artigo_id)}
                          style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                          Ir para a tela →
                        </button>
                      )}
                      <span style={{ fontSize: 11, color: MUT, marginLeft: 'auto' }}>Isso ajudou?</span>
                      <button type="button" onClick={() => avaliar(r.artigo_id, true)} disabled={!!feedback[r.artigo_id]}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, opacity: feedback[r.artigo_id] === 'sim' ? 1 : feedback[r.artigo_id] ? 0.35 : 0.75, color: GREEN }}>👍</button>
                      <button type="button" onClick={() => avaliar(r.artigo_id, false)} disabled={!!feedback[r.artigo_id]}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, opacity: feedback[r.artigo_id] === 'nao' ? 1 : feedback[r.artigo_id] ? 0.35 : 0.75, color: RED }}>👎</button>
                    </div>
                  </div>
                )
              })}

              {buscou && !buscando && resultados.length === 0 && termo.trim().length >= 2 && (
                <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 18, textAlign: 'center' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: ESP }}>Não encontrei uma resposta pra isso ainda.</div>
                  <div style={{ fontSize: 12.5, color: MUT, margin: '6px 0 12px' }}>Registramos sua dúvida — a equipe PS vai preparar esse conteúdo.</div>
                  <button type="button" onClick={falarSuporte} style={{ background: ESP, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Falar com o suporte</button>
                </div>
              )}

              {!buscou && termo.trim().length < 2 && (
                <div style={{ fontSize: 12.5, color: MUT, padding: '8px 2px' }}>Digite sua dúvida em português — a ajuda é da própria tela onde você está.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && <div style={{ position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)', background: ESP, color: '#fff', padding: '9px 16px', borderRadius: 999, fontSize: 13, zIndex: 960 }}>{toast}</div>}
    </>
  )
}

