'use client'

// Central de Melhorias · Fase 1 — tela do usuário. Registra a dificuldade com foto marcada
// (coordenadas RELATIVAS, 0..1 — a marcação acompanha a foto em qualquer tamanho de tela, aceite #1).
// A IA analisa a foto no envio (edge function), mas a sugestão vale mesmo se a IA falhar (§3).
// Foto é OPCIONAL (decisão do CEO). Minhas sugestões listam com rótulo do que é IA (RD-51).

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC', blue: '#2F5AA8',
}
const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none' }
const CATS = [['bug', '🐞 Bug'], ['melhoria', '💡 Melhoria'], ['duvida', '❓ Dúvida'], ['erro_dado', '📊 Erro de dado']]
const PRIOS = ['baixa', 'media', 'alta', 'critica']
const STAT_LABEL: Record<string, string> = { nova: 'Nova', em_analise: 'Em análise', aceita: 'Aceita', em_desenvolvimento: 'Em desenvolvimento', concluida: 'Concluída', recusada: 'Recusada', duplicada: 'Duplicada' }
type Marca = { tipo: string; x: number; y: number; texto?: string }
type Minha = { id: string; titulo: string | null; descricao: string; categoria: string | null; status: string; resposta: string | null; tem_ia?: boolean; ia_analise: Record<string, unknown> | null; created_at: string }

export default function MelhoriasPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [f, setF] = useState({ categoria: 'bug', titulo: '', descricao: '', prioridade: 'media' })
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [marcas, setMarcas] = useState<Marca[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [minhas, setMinhas] = useState<Minha[]>([])
  const [ehSuporte, setEhSuporte] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  const carregar = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: u } = await supabase.from('users').select('system_role').eq('id', user.id).maybeSingle()
    setEhSuporte(['PS_ADMIN', 'PS_SUPPORT'].includes((u as { system_role?: string } | null)?.system_role || ''))
    const { data } = await supabase.from('sugestoes').select('id,titulo,descricao,categoria,status,resposta,ia_analise,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(30)
    setMinhas(((data as Minha[]) ?? []).map((m) => ({ ...m, tem_ia: !!m.ia_analise })))
  }, [])
  useEffect(() => { void carregar() }, [carregar])

  function escolherFoto(fl: File | null) {
    setFile(fl); setMarcas([])
    if (preview) URL.revokeObjectURL(preview)
    setPreview(fl ? URL.createObjectURL(fl) : null)
  }
  function marcarNaFoto(e: React.MouseEvent<HTMLImageElement>) {
    const img = imgRef.current; if (!img) return
    const r = img.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    const texto = window.prompt('O que há de errado aqui?') || ''
    setMarcas((m) => [...m, { tipo: 'seta', x, y, texto }])
  }

  async function enviar() {
    if (!companyId) { setErro('Selecione uma empresa específica no topo.'); return }
    if (!f.descricao.trim()) { setErro('Descreva a dificuldade.'); return }
    setBusy(true); setErro(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setErro('Sessão expirada.'); setBusy(false); return }

      let anexos: { storage_path: string; marcacoes: Marca[] }[] = []
      if (file) {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
        const path = `${user.id}/${crypto.randomUUID()}/foto.${ext}`
        const up = await supabase.storage.from('sugestoes-anexos').upload(path, file, { upsert: false })
        if (up.error) { setErro('Falha ao enviar a foto: ' + up.error.message); setBusy(false); return }
        anexos = [{ storage_path: path, marcacoes: marcas }]
      }

      const { data, error } = await supabase.rpc('fn_sugestao_criar', {
        p_company_id: companyId,
        p_sugestao: { tipo: f.categoria === 'melhoria' ? 'melhoria' : 'bug', titulo: f.titulo.trim() || null, descricao: f.descricao.trim(), prioridade: f.prioridade, categoria: f.categoria, rota: '/dashboard/melhorias', area: selInfo.tipo === 'empresa' ? 'gestao_empresarial' : null },
        p_anexos: anexos,
        p_user: user.id,
      })
      const r = data as { ok?: boolean; id?: string; erro?: string } | null
      if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha ao registrar'); setBusy(false); return }

      // dispara a IA sem bloquear (se falhar, a sugestão continua válida)
      void supabase.functions.invoke('sugestao-analisar', { body: { sugestao_id: r.id } }).catch(() => {})

      setF({ categoria: 'bug', titulo: '', descricao: '', prioridade: 'media' }); escolherFoto(null)
      setMsg('Sugestão registrada. A IA vai analisar em instantes.'); void carregar()
    } finally { setBusy(false) }
  }

  const podeEnviar = useMemo(() => !!companyId && !!f.descricao.trim() && !busy, [companyId, f.descricao, busy])

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 980, margin: '0 auto', color: C.esp }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>💡 Central de Melhorias</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Registrar uma dificuldade</h1>
        </div>
        {ehSuporte && <a href="/dashboard/atendimento" style={{ fontSize: 13, color: C.white, background: C.esp, padding: '8px 14px', borderRadius: 8, textDecoration: 'none', fontWeight: 700 }}>Ir para a fila de atendimento →</a>}
      </div>
      <p style={{ color: C.espM, fontSize: 13, margin: '6px 0 14px' }}>Tire um print, marque onde está o problema e descreva. A foto é opcional. Nada some — vira uma sugestão que a gente trabalha até concluir.</p>

      {msg && <div style={{ background: C.greenBg, color: C.green, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }} onClick={() => setMsg(null)}>{msg}</div>}
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }} onClick={() => setErro(null)}>{erro}</div>}

      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={{ fontSize: 12, color: C.espM }}>Tipo
            <select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} style={{ ...inp, width: '100%', marginTop: 4 }}>{CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label style={{ fontSize: 12, color: C.espM }}>Prioridade
            <select value={f.prioridade} onChange={(e) => setF({ ...f, prioridade: e.target.value })} style={{ ...inp, width: '100%', marginTop: 4 }}>{PRIOS.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          </label>
        </div>
        <input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="título curto (opcional)" style={{ ...inp, width: '100%', marginTop: 10, boxSizing: 'border-box' }} />
        <textarea value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder="descreva a dificuldade — o que você tentou fazer e o que aconteceu" rows={3} style={{ ...inp, width: '100%', marginTop: 10, boxSizing: 'border-box', resize: 'vertical' }} />

        <div style={{ marginTop: 12 }}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <input type="file" accept="image/*" onChange={(e) => escolherFoto((e.target as any).files?.[0] ?? null)} style={{ fontSize: 12 }} />
          {preview && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: C.espM, marginBottom: 4 }}>Clique na imagem para marcar onde está o problema · {marcas.length} marcação(ões) {marcas.length > 0 && <button onClick={() => setMarcas([])} style={{ marginLeft: 6, border: 'none', background: 'none', color: C.red, cursor: 'pointer', fontSize: 11 }}>limpar</button>}</div>
              <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img ref={imgRef} src={preview} alt="" onClick={marcarNaFoto} style={{ maxWidth: '100%', maxHeight: 420, borderRadius: 8, border: `1px solid ${C.border}`, cursor: 'crosshair', display: 'block' }} />
                {marcas.map((m, i) => (
                  <div key={i} title={m.texto} style={{ position: 'absolute', left: `${m.x * 100}%`, top: `${m.y * 100}%`, transform: 'translate(-50%,-50%)', width: 22, height: 22, borderRadius: 999, background: 'rgba(180,35,24,0.85)', color: C.white, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff', pointerEvents: 'none' }}>{i + 1}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button disabled={!podeEnviar} onClick={() => void enviar()} style={{ padding: '9px 18px', border: 'none', borderRadius: 8, background: podeEnviar ? C.gold : C.espL, color: C.white, fontWeight: 700, cursor: podeEnviar ? 'pointer' : 'not-allowed' }}>{busy ? 'Enviando…' : 'Enviar sugestão'}</button>
        </div>
      </div>

      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '4px 0 10px' }}>Minhas sugestões</h2>
      {minhas.length === 0 ? <div style={{ fontSize: 13, color: C.espL, fontStyle: 'italic' }}>Você ainda não abriu nenhuma.</div> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {minhas.map((m) => (
            <div key={m.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 14 }}>{m.titulo || m.descricao.slice(0, 60)}</b>
                <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: m.status === 'concluida' ? C.greenBg : m.status === 'recusada' ? C.redBg : C.cream, color: m.status === 'concluida' ? C.green : m.status === 'recusada' ? C.red : C.espM, fontWeight: 700 }}>{STAT_LABEL[m.status] || m.status}</span>
              </div>
              <div style={{ fontSize: 12.5, color: C.espM, marginTop: 4 }}>{m.descricao}</div>
              {m.resposta && <div style={{ fontSize: 12, color: C.esp, marginTop: 6, background: C.cream, padding: '6px 8px', borderRadius: 6 }}><b>Resposta:</b> {m.resposta}</div>}
              <div style={{ fontSize: 10.5, marginTop: 6 }}>
                {m.tem_ia
                  ? <span style={{ color: C.blue }}>🤖 análise da IA disponível ao atendente</span>
                  : <span style={{ color: C.espL }}>não analisada pela IA</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
