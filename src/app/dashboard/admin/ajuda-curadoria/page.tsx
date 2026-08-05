'use client'
// Central de Ajuda · F0 Fatia 4 — tela do CURADOR (PS_ADMIN). Revisa os rascunhos que a IA gerou,
// vê o diff com o texto anterior, os [VERIFICAR]/needs_human, e PUBLICA ou DESCARTA. IA nunca publica.
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314', MUT = '#6B5D4F', BG = '#FAF7F2', LINE = '#E7DECF', GOLD = '#C8941A', RED = '#A32D2D', GREEN = '#166534'

type Item = {
  artigo_id: string; titulo: string; vertical: string | null; rota_ref: string | null
  corpo_md: string | null; corpo_md_anterior: string | null; needs_human: boolean; is_gap: boolean
}
type Stats = { total: number; publicados: number; rascunho_curado: number; needs_human: number; gaps: number }

// realça [VERIFICAR] no texto (sem lib de markdown — render simples com destaque).
function Texto({ md }: { md: string | null }) {
  if (!md) return <span style={{ color: MUT, fontStyle: 'italic' }}>(vazio)</span>
  const parts = md.split(/(\[VERIFICAR\])/g)
  return <span style={{ whiteSpace: 'pre-wrap' }}>{parts.map((p, i) => p === '[VERIFICAR]'
    ? <mark key={i} style={{ background: '#FEE2E2', color: RED, fontWeight: 700, padding: '0 3px', borderRadius: 3 }}>[VERIFICAR]</mark>
    : <span key={i}>{p}</span>)}</span>
}

export default function AjudaCuradoriaPage() {
  const [ok, setOk] = useState<boolean | null>(null)
  const [itens, setItens] = useState<Item[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [soNeedsHuman, setSoNeedsHuman] = useState(false)
  const [loading, setLoading] = useState(true)
  const [curando, setCurando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editTxt, setEditTxt] = useState('')

  const carregar = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.rpc('fn_ajuda_curadoria_listar', { p_vertical: null, p_so_needs_human: soNeedsHuman })
    const r = data as { ok?: boolean; itens?: Item[]; stats?: Stats } | null
    setOk(r?.ok ?? false)
    setItens(r?.itens ?? [])
    setStats(r?.stats ?? null)
    setLoading(false)
  }, [soNeedsHuman])
  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t) }, [msg])

  // Curar próximo lote: pega a fila (grounded) → API Claude → aplica cada rascunho (RPC admin-gated).
  async function curarLote() {
    setCurando(true); setMsg(null)
    const { data: fila } = await supabase.rpc('fn_ajuda_curadoria_fila', { p_limite: 8, p_incluir_gaps: true })
    const f = fila as { ok?: boolean; itens?: Array<Record<string, unknown>> } | null
    const lista = f?.itens ?? []
    if (!f?.ok || lista.length === 0) { setCurando(false); setMsg('Nada novo pra curar.'); return }
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      const res = await fetch('/api/ajuda/curar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ itens: lista }),
      })
      const d = await res.json() as { ok?: boolean; error?: string; resultados?: Array<{ artigo_id: string; corpo_novo: string; needs_human: boolean; erro?: string }> }
      if (!res.ok || !d.ok) { setMsg('❌ ' + (d.error ?? 'falha na curadoria')); setCurando(false); return }
      let aplicados = 0
      for (const r of d.resultados ?? []) {
        if (!r.corpo_novo && !r.needs_human) continue
        const { data: ap } = await supabase.rpc('fn_ajuda_curar_aplicar', { p_artigo_id: r.artigo_id, p_corpo_md: r.corpo_novo || null, p_needs_human: r.needs_human })
        if ((ap as { ok?: boolean } | null)?.ok) aplicados++
      }
      setMsg(`✅ ${aplicados} artigo(s) curado(s) pela IA — revise e publique abaixo.`)
      await carregar()
    } catch (e) {
      setMsg('❌ ' + (e instanceof Error ? e.message : 'erro'))
    } finally { setCurando(false) }
  }

  async function acao(rpc: string, artigo_id: string, sucesso: string) {
    const { data } = await supabase.rpc(rpc, { p_artigo_id: artigo_id })
    const r = data as { ok?: boolean; erro?: string } | null
    setMsg(r?.ok ? sucesso : '❌ ' + (r?.erro ?? 'falha'))
    await carregar()
  }
  async function salvarEdicao(artigo_id: string) {
    const { data } = await supabase.rpc('fn_ajuda_artigo_salvar_corpo', { p_artigo_id: artigo_id, p_corpo_md: editTxt })
    const r = data as { ok?: boolean; erro?: string } | null
    setMsg(r?.ok ? 'Texto salvo.' : '❌ ' + (r?.erro ?? 'falha'))
    setEditId(null); await carregar()
  }

  if (ok === false) return <div style={{ padding: 24, color: MUT, background: BG, minHeight: '100vh' }}>Acesso restrito à equipe PS (curadoria). Fale com o administrador.</div>

  return (
    <div style={{ background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '20px 16px 80px' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>Central de Ajuda</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 4px' }}>Curadoria IA</h1>
        <p style={{ fontSize: 13, color: MUT, margin: '0 0 14px' }}>A IA rascunha ancorada no material da tela — <b>ela nunca publica</b>. Você revisa, corrige e publica. <code>[VERIFICAR]</code> = falta info (não invente).</p>

        {stats && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {([['Publicados', stats.publicados, GREEN], ['Rascunhos p/ revisar', stats.rascunho_curado, GOLD], ['Precisam de você', stats.needs_human, RED], ['Gaps', stats.gaps, MUT], ['Total', stats.total, ESP]] as const).map(([l, v, c]) => (
              <div key={l} style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: '8px 12px', background: '#fff', minWidth: 96 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: c }}>{v}</div>
                <div style={{ fontSize: 11, color: MUT }}>{l}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          <button onClick={() => void curarLote()} disabled={curando} style={{ ...btnGold, opacity: curando ? 0.6 : 1 }}>
            {curando ? 'Curando com IA…' : '✨ Curar próximo lote (IA)'}
          </button>
          <label style={{ fontSize: 12, color: MUT, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={soNeedsHuman} onChange={(e) => setSoNeedsHuman(e.target.checked)} /> só os que precisam de mim
          </label>
        </div>

        {loading ? <div style={{ color: MUT, fontSize: 13 }}>Carregando…</div>
          : itens.length === 0 ? <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 28, textAlign: 'center', color: MUT }}>Nenhum rascunho pendente. Clique em <b>Curar próximo lote</b> pra a IA rascunhar os próximos artigos.</div>
          : itens.map((it) => (
            <div key={it.artigo_id} style={{ background: '#fff', border: `1px solid ${it.needs_human ? RED : LINE}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{it.titulo}</div>
                  <div style={{ fontSize: 11, color: MUT }}>{it.vertical || '—'} · <span style={{ fontFamily: 'ui-monospace, monospace' }}>{it.rota_ref}</span></div>
                </div>
                {it.needs_human && <span style={{ fontSize: 11, fontWeight: 700, color: RED, background: '#FEE2E2', padding: '3px 8px', borderRadius: 999 }}>⚠ precisa de você</span>}
              </div>

              {editId === it.artigo_id ? (
                <div style={{ marginTop: 10 }}>
                  <textarea value={editTxt} onChange={(e) => setEditTxt(e.target.value)} rows={8} style={{ width: '100%', border: `1px solid ${LINE}`, borderRadius: 8, padding: 10, fontSize: 13, fontFamily: 'inherit', color: ESP, boxSizing: 'border-box', resize: 'vertical' }} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={() => void salvarEdicao(it.artigo_id)} style={btnGold}>Salvar</button>
                    <button onClick={() => setEditId(null)} style={btnGhost}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                  <div style={{ background: BG, border: `1px solid ${LINE}`, borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', color: MUT, fontWeight: 700, marginBottom: 4 }}>Antes</div>
                    <div style={{ fontSize: 12.5, color: MUT }}><Texto md={it.corpo_md_anterior} /></div>
                  </div>
                  <div style={{ background: '#F1F6EC', border: `1px solid ${GREEN}33`, borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', color: GREEN, fontWeight: 700, marginBottom: 4 }}>Depois (IA)</div>
                    <div style={{ fontSize: 12.5, color: ESP }}><Texto md={it.corpo_md} /></div>
                  </div>
                </div>
              )}

              {editId !== it.artigo_id && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button onClick={() => void acao('fn_ajuda_artigo_publicar', it.artigo_id, `Publicado: ${it.titulo}`)} style={btnGold}>✓ Publicar</button>
                  <button onClick={() => { setEditId(it.artigo_id); setEditTxt(it.corpo_md ?? '') }} style={btnGhost}>✎ Editar</button>
                  <button onClick={() => void acao('fn_ajuda_artigo_descartar', it.artigo_id, `Descartado (restaurado): ${it.titulo}`)} style={{ ...btnGhost, color: RED, borderColor: RED }}>↩ Descartar</button>
                </div>
              )}
            </div>
          ))}
      </div>
      {msg && <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESP, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60, maxWidth: '92%', textAlign: 'center' }}>{msg}</div>}
    </div>
  )
}

const btnGold: CSSProperties = { background: GOLD, color: '#3D2314', border: 'none', borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const btnGhost: CSSProperties = { background: '#fff', color: ESP, border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
