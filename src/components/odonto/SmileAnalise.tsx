'use client'
// IA-2.2 · Smile Design (Fase 1) · painel de revisão. ILUSTRATIVO, não promessa (Pilar 1/RD-51): a IA
// analisa a foto e SUGERE um plano estético; o dentista valida e envia o que aceitar para o orçamento
// (reusa fn_odonto_plano_salvar, OD-2). Preços NÃO vêm da IA — o dentista precifica no "Apresentar Plano".
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { TOK } from './ui'
import type { ImagemOdonto } from './ImagensFicha'
import { Sparkles, X, ShieldAlert, Check } from 'lucide-react'

type PlanoItem = { procedimento: string; dentes: string[]; obs: string; confianca: string }
type Analise = { cor: string; alinhamento: string; formato: string; gengiva: string }
type Resp = { ok?: boolean; cache?: boolean; inconclusivo?: boolean; analise?: Analise; oportunidades?: string[]; plano_sugerido?: PlanoItem[]; aviso?: string; error?: string }

const CONF: Record<string, { l: string; cor: string; bg: string }> = {
  alta: { l: 'alta', cor: TOK.green, bg: '#E7F3EA' },
  media: { l: 'média', cor: '#B45309', bg: '#FBF0DF' },
  baixa: { l: 'baixa', cor: TOK.gray, bg: '#F1F1F0' },
}

export function SmileAnalise({ companyId, pacienteId, imagem, imagemUrl, onClose, onEnviado }: {
  companyId: string; pacienteId: string; imagem: ImagemOdonto; imagemUrl?: string; onClose: () => void; onEnviado: () => void
}) {
  const [r, setR] = useState<Resp | null>(null)
  const [analisando, setAnalisando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [enviando, setEnviando] = useState(false)
  const [ok, setOk] = useState<string | null>(null)

  const analisar = useCallback(async (force: boolean) => {
    setAnalisando(true); setAviso(null); setOk(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setAviso('sessão'); return }
      const res = await fetch('/api/odonto/smile-analise', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ company_id: companyId, imagem_id: imagem.id, force }),
      })
      const j = await res.json() as Resp
      if (j.ok) { setR(j); setSel(new Set()) }
      else setAviso(j.aviso || j.error || 'Não foi possível analisar agora.')
    } catch { setAviso('falha de rede') } finally { setAnalisando(false) }
  }, [companyId, imagem.id])

  useEffect(() => { void analisar(false) }, [analisar])

  const toggle = (i: number) => setSel((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n })

  const enviarOrcamento = async () => {
    if (!r?.plano_sugerido || sel.size === 0) return
    setEnviando(true)
    const itens = Array.from(sel).map((i, ix) => {
      const p = r.plano_sugerido![i]
      const dente = p.dentes.length ? p.dentes.join(', ') : null
      const desc = p.obs ? `${p.procedimento} — ${p.obs}` : p.procedimento
      return { descricao: desc.slice(0, 200), dente, valor: 0, status: 'proposto', ordem: ix }
    })
    const { data, error } = await supabase.rpc('fn_odonto_plano_salvar', {
      p_company_id: companyId,
      p_plano: { paciente_id: pacienteId, titulo: `Plano estético (IA sorriso) ${new Date().toLocaleDateString('pt-BR')}`, status: 'orcamento', desconto: 0 },
      p_itens: itens, p_plano_id: null,
    })
    setEnviando(false)
    if (error || (data as { ok?: boolean; id?: string } | null)?.ok === false) { setAviso('Falha ao criar o orçamento.'); return }
    setOk(`${itens.length} item(ns) enviados para um orçamento. Abra em Plano & Orçamento para precificar e apresentar.`)
    onEnviado()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(61,35,20,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 760, maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: `0.5px solid ${TOK.line}` }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 800, color: TOK.gold }}><Sparkles size={16} /> Análise de sorriso (IA)</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: TOK.mut }}><X size={20} /></button>
        </div>

        <div style={{ padding: 14, overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#FBF3DE', border: `0.5px solid ${TOK.gold}`, borderRadius: 10, padding: '9px 11px', marginBottom: 12 }}>
            <ShieldAlert size={16} style={{ color: '#8A6A1E', flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 11.5, color: '#5D4534', lineHeight: 1.45 }}>
              <strong>Prévia estética — sugestão, não promessa de resultado.</strong> O resultado real depende da avaliação clínica. Envie ao orçamento só o que você validar; os valores você define no plano.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 12 }}>
            {imagemUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imagemUrl} alt={imagem.arquivo_nome} style={{ width: '100%', maxHeight: 240, objectFit: 'contain', background: '#000', borderRadius: 10 }} />
            )}

            {analisando && !r ? (
              <div style={{ fontSize: 13, color: TOK.mut }}>A IA está analisando o sorriso…</div>
            ) : aviso ? (
              <div style={{ fontSize: 13, color: TOK.mut }}>{aviso} <button onClick={() => void analisar(true)} style={{ background: 'none', border: 'none', color: TOK.gold, fontWeight: 700, cursor: 'pointer' }}>tentar de novo</button></div>
            ) : r?.inconclusivo ? (
              <div style={{ fontSize: 13, color: TOK.mut }}>Não foi possível analisar o sorriso nesta foto — use uma foto frontal com o sorriso visível.</div>
            ) : r ? (
              <>
                {/* análise estética */}
                {(r.analise && (r.analise.cor || r.analise.alinhamento || r.analise.formato || r.analise.gengiva)) && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 8 }}>
                    {([['Cor', r.analise.cor], ['Alinhamento', r.analise.alinhamento], ['Formato', r.analise.formato], ['Gengiva', r.analise.gengiva]] as const).filter(([, v]) => v).map(([k, v]) => (
                      <div key={k} style={{ border: `0.5px solid ${TOK.line}`, borderRadius: 10, padding: '8px 10px' }}>
                        <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: TOK.gold }}>{k}</div>
                        <div style={{ fontSize: 12.5, color: TOK.esp, marginTop: 2 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                )}
                {(r.oportunidades ?? []).length > 0 && (
                  <div style={{ fontSize: 12.5, color: TOK.esp }}>
                    <strong style={{ color: TOK.gold }}>Oportunidades:</strong> {(r.oportunidades ?? []).join(' · ')}
                  </div>
                )}

                {/* plano sugerido */}
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: TOK.esp, marginBottom: 6 }}>Plano sugerido (marque o que aceitar)</div>
                  {(r.plano_sugerido ?? []).length === 0 ? (
                    <div style={{ fontSize: 12.5, color: TOK.mut }}>Sem sugestões de procedimento para esta foto.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {(r.plano_sugerido ?? []).map((p, i) => {
                        const c = CONF[p.confianca] ?? CONF.baixa
                        return (
                          <label key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', border: `0.5px solid ${sel.has(i) ? TOK.gold : TOK.line}`, borderRadius: 10, padding: '9px 11px', cursor: 'pointer' }}>
                            <input type="checkbox" checked={sel.has(i)} onChange={() => toggle(i)} style={{ marginTop: 3, accentColor: TOK.gold }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 13.5, fontWeight: 700, color: TOK.esp }}>{p.procedimento}</span>
                                {p.dentes.length > 0 && <span style={{ fontSize: 10.5, fontWeight: 800, background: TOK.esp, color: '#fff', padding: '1px 7px', borderRadius: 999 }}>dentes {p.dentes.join(', ')}</span>}
                                <span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 8px', borderRadius: 999, background: c.bg, color: c.cor }}>confiança {c.l}</span>
                              </div>
                              {p.obs && <div style={{ fontSize: 12, color: TOK.mut, marginTop: 2 }}>{p.obs}</div>}
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : null}
            {ok && <div style={{ fontSize: 12.5, color: TOK.green, fontWeight: 600 }}>{ok}</div>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: `0.5px solid ${TOK.line}`, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => void analisar(true)} disabled={analisando} style={{ background: 'none', border: `0.5px solid ${TOK.line}`, borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, color: TOK.esp, cursor: analisando ? 'not-allowed' : 'pointer' }}>Reanalisar</button>
          <button onClick={() => void enviarOrcamento()} disabled={enviando || sel.size === 0}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: TOK.gold, color: '#fff', border: 'none', borderRadius: 999, padding: '9px 18px', fontSize: 13.5, fontWeight: 700, cursor: (enviando || sel.size === 0) ? 'not-allowed' : 'pointer', opacity: (enviando || sel.size === 0) ? 0.5 : 1 }}>
            <Check size={16} /> {enviando ? 'Enviando…' : `Enviar ao orçamento${sel.size ? ` (${sel.size})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
