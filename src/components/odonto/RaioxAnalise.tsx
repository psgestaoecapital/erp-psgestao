'use client'
// IA-2.1 · Painel de revisão do raio-x analisado por IA. ASSISTIVO (Pilar 1/CFO): a IA SUGERE regiões
// de atenção com confiança; NADA entra no odontograma sem o dentista aceitar. Aceite → grava a condição
// via fn_odonto_odontograma_marcar (reuso OD-3) com nota de origem/revisor. Estados honestos (RD-51).
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { TOK } from './ui'
import type { ImagemOdonto } from './ImagensFicha'
import { Sparkles, X, ShieldAlert, Check } from 'lucide-react'

type Achado = { dente_fdi: string | null; tipo_achado: string; confianca: string; observacao: string }
type Resp = { ok?: boolean; cache?: boolean; inconclusivo?: boolean; achados?: Achado[]; aviso?: string; error?: string; ia_desativada?: boolean; budget_pausado?: boolean; nao_imagem?: boolean }

const TIPO_L: Record<string, string> = { carie: 'Cárie', perda_ossea: 'Perda óssea', lesao_periapical: 'Lesão periapical', restauracao: 'Restauração', outro: 'Outro achado' }
const COND_MAP: Record<string, string> = { carie: 'carie', restauracao: 'restauracao' }   // mapeiam a cor do odontograma; os demais gravam o tipo cru
const CONF: Record<string, { l: string; cor: string; bg: string }> = {
  alta: { l: 'Confiança alta', cor: TOK.red, bg: '#FBEBEB' },
  media: { l: 'Confiança média', cor: '#B45309', bg: '#FBF0DF' },
  baixa: { l: 'Confiança baixa', cor: TOK.gray, bg: '#F1F1F0' },
}

export function RaioxAnalise({ companyId, pacienteId, imagem, imagemUrl, onClose, onMarcado }: {
  companyId: string; pacienteId: string; imagem: ImagemOdonto; imagemUrl?: string; onClose: () => void; onMarcado: () => void
}) {
  const [achados, setAchados] = useState<Achado[] | null>(null)
  const [analisando, setAnalisando] = useState(false)
  const [inconclusivo, setInconclusivo] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [salvando, setSalvando] = useState(false)
  const [ok, setOk] = useState<string | null>(null)
  const [revisor, setRevisor] = useState<string>('')

  useEffect(() => {
    void supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id
      if (!uid) return
      const { data: u } = await supabase.from('users').select('full_name, email').eq('id', uid).maybeSingle()
      const r = u as { full_name?: string; email?: string } | null
      setRevisor(r?.full_name || r?.email || 'profissional')
    })
  }, [])

  const analisar = useCallback(async (force: boolean) => {
    setAnalisando(true); setAviso(null); setOk(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setAviso('sessão'); return }
      const res = await fetch('/api/odonto/raiox-analise', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ company_id: companyId, imagem_id: imagem.id, force }),
      })
      const j = await res.json() as Resp
      if (j.ok) { setAchados(j.achados ?? []); setInconclusivo(!!j.inconclusivo); setSel(new Set()) }
      else setAviso(j.aviso || j.error || 'Não foi possível analisar agora.')
    } catch { setAviso('falha de rede') } finally { setAnalisando(false) }
  }, [companyId, imagem.id])

  useEffect(() => { void analisar(false) }, [analisar])

  const toggle = (i: number) => setSel((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n })

  const aceitar = async () => {
    if (!achados || sel.size === 0) return
    setSalvando(true)
    let n = 0
    for (const i of sel) {
      const a = achados[i]
      if (!a?.dente_fdi) continue
      const condicao = COND_MAP[a.tipo_achado] ?? a.tipo_achado
      const obs = `IA raio-x (${CONF[a.confianca]?.l ?? a.confianca}) · ${a.observacao || TIPO_L[a.tipo_achado] || a.tipo_achado} · revisado por ${revisor}`
      const { data, error } = await supabase.rpc('fn_odonto_odontograma_marcar', {
        p_company_id: companyId, p_paciente_id: pacienteId, p_dente: a.dente_fdi, p_condicao: condicao, p_observacao: obs,
      })
      if (!error && (data as { ok?: boolean })?.ok !== false) n++
    }
    setSalvando(false)
    setOk(`${n} condição(ões) marcada(s) no odontograma (revisado por ${revisor}).`)
    onMarcado()
  }

  const marcaveis = (achados ?? []).filter((a) => a.dente_fdi).length

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(61,35,20,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 720, maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: `0.5px solid ${TOK.line}` }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 800, color: TOK.gold }}><Sparkles size={16} /> Análise assistida do raio-x</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: TOK.mut }}><X size={20} /></button>
        </div>

        <div style={{ padding: 14, overflowY: 'auto' }}>
          {/* enquadramento assistivo (Pilar 1) */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#FBF3DE', border: `0.5px solid ${TOK.gold}`, borderRadius: 10, padding: '9px 11px', marginBottom: 12 }}>
            <ShieldAlert size={16} style={{ color: '#8A6A1E', flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 11.5, color: '#5D4534', lineHeight: 1.45 }}>
              <strong>Sugestão da IA — segunda opinião.</strong> Não é diagnóstico. Revise cada ponto e marque só o que você confirmar; a responsabilidade clínica é do profissional.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 12 }}>
            {imagemUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imagemUrl} alt={imagem.arquivo_nome} style={{ width: '100%', maxHeight: 260, objectFit: 'contain', background: '#000', borderRadius: 10 }} />
            )}

            {analisando && !achados ? (
              <div style={{ fontSize: 13, color: TOK.mut }}>A IA está lendo o raio-x…</div>
            ) : aviso ? (
              <div style={{ fontSize: 13, color: TOK.mut }}>{aviso} <button onClick={() => void analisar(true)} style={{ background: 'none', border: 'none', color: TOK.gold, fontWeight: 700, cursor: 'pointer' }}>tentar de novo</button></div>
            ) : inconclusivo ? (
              <div style={{ fontSize: 13, color: TOK.mut }}>A IA não identificou pontos com segurança nesta imagem — <strong>avalie manualmente</strong>. (Qualidade/enquadramento podem limitar a leitura.)</div>
            ) : (achados ?? []).length === 0 ? (
              <div style={{ fontSize: 13, color: TOK.mut }}>Nenhuma região de atenção sugerida. Avalie manualmente se necessário.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11.5, color: TOK.mut }}>Marque os pontos que você confirma. Nada é gravado sem o seu aceite.</div>
                {(achados ?? []).map((a, i) => {
                  const c = CONF[a.confianca] ?? CONF.baixa
                  const podeMarcar = !!a.dente_fdi
                  return (
                    <label key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', border: `0.5px solid ${sel.has(i) ? TOK.gold : TOK.line}`, borderRadius: 10, padding: '9px 11px', cursor: podeMarcar ? 'pointer' : 'default', opacity: podeMarcar ? 1 : 0.7 }}>
                      <input type="checkbox" disabled={!podeMarcar} checked={sel.has(i)} onChange={() => toggle(i)} style={{ marginTop: 3, accentColor: TOK.gold }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: TOK.esp }}>{TIPO_L[a.tipo_achado] ?? a.tipo_achado}</span>
                          {a.dente_fdi ? <span style={{ fontSize: 10.5, fontWeight: 800, background: TOK.esp, color: '#fff', padding: '1px 7px', borderRadius: 999 }}>dente {a.dente_fdi}</span>
                                       : <span style={{ fontSize: 10.5, color: TOK.mut }}>sem dente atribuído</span>}
                          <span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 8px', borderRadius: 999, background: c.bg, color: c.cor }}>{c.l}</span>
                        </div>
                        {a.observacao && <div style={{ fontSize: 12, color: TOK.mut, marginTop: 2 }}>{a.observacao}</div>}
                        {!podeMarcar && <div style={{ fontSize: 10.5, color: TOK.mut, marginTop: 2 }}>Sem dente definido — registre manualmente se confirmar.</div>}
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
            {ok && <div style={{ fontSize: 12.5, color: TOK.green, fontWeight: 600 }}>{ok}</div>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: `0.5px solid ${TOK.line}`, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => void analisar(true)} disabled={analisando} style={{ background: 'none', border: `0.5px solid ${TOK.line}`, borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, color: TOK.esp, cursor: analisando ? 'not-allowed' : 'pointer' }}>Reanalisar</button>
          <button onClick={() => void aceitar()} disabled={salvando || sel.size === 0 || marcaveis === 0}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: TOK.gold, color: '#fff', border: 'none', borderRadius: 999, padding: '9px 18px', fontSize: 13.5, fontWeight: 700, cursor: (salvando || sel.size === 0) ? 'not-allowed' : 'pointer', opacity: (salvando || sel.size === 0) ? 0.5 : 1 }}>
            <Check size={16} /> {salvando ? 'Marcando…' : `Aceitar selecionados${sel.size ? ` (${sel.size})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
