'use client'

// Central de Melhorias · Fase 1 — tela do usuário. Registra a dificuldade com foto MARCADA.
// Coordenadas RELATIVAS (0..1) — a marcação acompanha a foto em qualquer tamanho de tela (aceite #1).
// A IA analisa a foto no envio (edge sugestao-analisar, que JÁ lê marcacoes), mas a sugestão vale
// mesmo se a IA falhar (§3). Foto é OPCIONAL (decisão do CEO).
//
// Atrito mata o uso: sair do sistema, print, salvar, voltar, procurar na pasta = 5 passos e a pessoa
// volta pro WhatsApp. Então: COLAR (Ctrl+V), ARRASTAR, ou CÂMERA no celular; e MARCAR direto na tela
// (seta/retângulo/círculo + texto). "esse botão não salva" vira "botão de salvar na tela X não
// submete" — com marcação é apontamento, sem é só foto.

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC', blue: '#2F5AA8',
}
const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none' }
const CATS = [['bug', '🐞 Bug'], ['melhoria', '💡 Melhoria'], ['duvida', '❓ Dúvida'], ['erro_dado', '📊 Erro de dado']]
const PRIOS = ['baixa', 'media', 'alta', 'critica']
const STAT_LABEL: Record<string, string> = { nova: 'Nova', em_analise: 'Em análise', aceita: 'Aceita', em_desenvolvimento: 'Em desenvolvimento', concluida: 'Concluída', recusada: 'Recusada', duplicada: 'Duplicada', arquivada: 'Arquivada', implementado: 'Implementado' }
// status terminais: o trabalho acabou. Não faz sentido o selo "não analisada pela IA" nesses — eles
// parecem pendentes de processamento quando estão completos (o que confundia, ex.: a do Rodrigo já
// implementada aparecendo como "não analisada").
const STATUS_TERMINAL = ['concluida', 'recusada', 'duplicada', 'arquivada', 'implementado']

// Marca: coords em PERCENTUAL (0..1). seta = ponto (x,y). retangulo/circulo = CENTRO (x,y) + tamanho (w,h).
type Ferramenta = 'seta' | 'retangulo' | 'circulo'
type Marca = { tipo: Ferramenta; x: number; y: number; w?: number; h?: number; texto?: string }
type Minha = { id: string; titulo: string | null; descricao: string; categoria: string | null; status: string; resposta: string | null; resposta_aprovada: boolean; confirmado_pelo_autor: boolean; tem_ia?: boolean; ia_analise: Record<string, unknown> | null; created_at: string }

const FERRAMENTAS: [Ferramenta, string][] = [['seta', '➤ Seta'], ['retangulo', '▭ Retângulo'], ['circulo', '◯ Círculo']]

export default function MelhoriasPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const searchParams = useSearchParams()
  // rota #5: se o usuário chegou pelo ícone do cabeçalho, a rota anterior vem no ?from — assim ele
  // não precisa explicar onde estava. Fallback: a própria tela de melhorias.
  const rotaOrigem = (searchParams.get('from') || '').trim() || '/dashboard/melhorias'

  const [f, setF] = useState({ categoria: 'bug', titulo: '', descricao: '', prioridade: 'media' })
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [marcas, setMarcas] = useState<Marca[]>([])
  const [tool, setTool] = useState<Ferramenta>('seta')
  const [draw, setDraw] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [minhas, setMinhas] = useState<Minha[]>([])
  const [verArquivadas, setVerArquivadas] = useState(false)
  const [ehSuporte, setEhSuporte] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const camInputRef = useRef<HTMLInputElement>(null)
  const textoRefs = useRef<Record<number, HTMLInputElement | null>>({})

  const carregar = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: u } = await supabase.from('users').select('system_role').eq('id', user.id).maybeSingle()
    setEhSuporte(['PS_ADMIN', 'PS_SUPPORT'].includes((u as { system_role?: string } | null)?.system_role || ''))
    // Arquivadas saem da lista por padrão (viram consulta via filtro), como o CEO pediu.
    let q = supabase.from('sugestoes').select('id,titulo,descricao,categoria,status,resposta,resposta_aprovada,confirmado_pelo_autor,ia_analise,created_at').eq('user_id', user.id)
    q = verArquivadas ? q.eq('status', 'arquivada') : q.neq('status', 'arquivada')
    const { data } = await q.order('created_at', { ascending: false }).limit(50)
    setMinhas(((data as Minha[]) ?? []).map((m) => ({ ...m, tem_ia: !!m.ia_analise, resposta: m.resposta_aprovada ? m.resposta : null })))
  }, [verArquivadas])
  useEffect(() => { void carregar() }, [carregar])

  // O AUTOR confirma se a resposta resolveu. Funcionou → concluida; não → reabre com motivo (RD-38:
  // quem diz que resolveu é quem abriu, não o merge).
  const confirmar = useCallback(async (id: string, funcionou: boolean) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    let motivo: string | null = null
    if (!funcionou) {
      motivo = window.prompt('O que ainda não resolveu? (obrigatório — a equipe volta a mexer)') || ''
      if (!motivo.trim()) { setErro('Diga o que não resolveu para reabrir.'); return }
    }
    const { data, error } = await supabase.rpc('fn_sugestao_confirmar', { p_id: id, p_user: user.id, p_funcionou: funcionou, p_motivo: motivo })
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha ao confirmar'); return }
    setMsg(funcionou ? 'Que bom! Chamado concluído. 🎉' : 'Reabrimos — a equipe volta a trabalhar nisso.')
    void carregar()
  }, [carregar])

  const escolherFoto = useCallback((fl: File | null) => {
    setFile(fl); setMarcas([]); setDraw(null)
    setPreview((old) => { if (old) URL.revokeObjectURL(old); return fl ? URL.createObjectURL(fl) : null })
  }, [])

  // COLAR (Ctrl+V): pega a primeira imagem do clipboard. Funciona colando na área de anexo OU na
  // descrição — o usuário aperta PrintScreen e cola aqui, sem arquivo intermediário.
  const onPaste = useCallback((e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData?.items || []).find((it) => it.type.startsWith('image/'))
    if (!item) return
    const blob = item.getAsFile()
    if (!blob) return
    e.preventDefault()
    const ext = (blob.type.split('/')[1] || 'png').split('+')[0]
    escolherFoto(new File([blob], `print-${Date.now()}.${ext}`, { type: blob.type }))
    setMsg('Print colado. Marque onde está o problema.')
  }, [escolherFoto])

  // ARRASTAR E SOLTAR a imagem sobre o formulário. Mesmo destino do colar.
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const fl = Array.from(e.dataTransfer?.files || []).find((x) => x.type.startsWith('image/'))
    if (fl) { escolherFoto(fl); setMsg('Imagem recebida. Marque onde está o problema.') }
  }, [escolherFoto])

  function pct(e: React.PointerEvent) {
    const img = imgRef.current; if (!img) return { x: 0, y: 0 }
    const r = img.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    }
  }
  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault(); const p = pct(e); setDraw({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!draw || tool === 'seta') return
    const p = pct(e); setDraw((d) => (d ? { ...d, x1: p.x, y1: p.y } : d))
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!draw) return
    const p = pct(e)
    const dx = Math.abs(p.x - draw.x0), dy = Math.abs(p.y - draw.y0)
    let nova: Marca
    if (tool === 'seta' || (dx < 0.02 && dy < 0.02)) {
      nova = { tipo: tool, x: p.x, y: p.y, ...(tool !== 'seta' ? { w: 0.12, h: 0.12 } : {}) }
    } else {
      nova = { tipo: tool, x: (draw.x0 + p.x) / 2, y: (draw.y0 + p.y) / 2, w: dx, h: dy }
    }
    setDraw(null)
    setMarcas((m) => {
      const idx = m.length
      setTimeout(() => textoRefs.current[idx]?.focus(), 30) // foca o texto da marca nova
      return [...m, nova]
    })
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
        p_sugestao: { tipo: f.categoria === 'melhoria' ? 'melhoria' : 'bug', titulo: f.titulo.trim() || null, descricao: f.descricao.trim(), prioridade: f.prioridade, categoria: f.categoria, rota: rotaOrigem, area: selInfo.tipo === 'empresa' ? 'gestao_empresarial' : null },
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

  // retângulo de preview (durante o arraste), em % → estilo
  const previewBox = draw && tool !== 'seta'
    ? { left: `${Math.min(draw.x0, draw.x1) * 100}%`, top: `${Math.min(draw.y0, draw.y1) * 100}%`, width: `${Math.abs(draw.x1 - draw.x0) * 100}%`, height: `${Math.abs(draw.y1 - draw.y0) * 100}%` }
    : null

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 980, margin: '0 auto', color: C.esp }}
      onPaste={onPaste}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>💡 Central de Melhorias</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Registrar uma dificuldade</h1>
        </div>
        {ehSuporte && <a href="/dashboard/atendimento" style={{ fontSize: 13, color: C.white, background: C.esp, padding: '8px 14px', borderRadius: 8, textDecoration: 'none', fontWeight: 700 }}>Ir para a fila de atendimento →</a>}
      </div>
      <p style={{ color: C.espM, fontSize: 13, margin: '6px 0 4px' }}>Cole um print (Ctrl+V), arraste a imagem ou use a câmera — marque onde está o problema e descreva. A foto é opcional. Nada some — vira uma sugestão que a gente trabalha até concluir.</p>
      {rotaOrigem !== '/dashboard/melhorias' && (
        <p style={{ color: C.espL, fontSize: 12, margin: '0 0 12px' }}>Registrando a partir de <b style={{ color: C.espM }}>{rotaOrigem}</b> — a tela vai junto, você não precisa explicar onde estava.</p>
      )}

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
        <textarea value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} onPaste={onPaste} placeholder="descreva a dificuldade — o que você tentou fazer e o que aconteceu (pode colar um print com Ctrl+V aqui)" rows={3} style={{ ...inp, width: '100%', marginTop: 10, boxSizing: 'border-box', resize: 'vertical' }} />

        {/* Área de anexo: colar / arrastar / arquivo / câmera */}
        {!preview && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            style={{ marginTop: 12, border: `1.5px dashed ${dragOver ? C.gold : C.border}`, background: dragOver ? C.amberBg : C.cream, borderRadius: 10, padding: '16px 14px', textAlign: 'center', transition: 'all .12s' }}
          >
            <div style={{ fontSize: 13, color: C.espM, fontWeight: 600 }}>Cole um print com <b style={{ color: C.esp }}>Ctrl+V</b>, arraste a imagem aqui</div>
            <div style={{ fontSize: 11.5, color: C.espL, margin: '3px 0 10px' }}>ou escolha do dispositivo</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <label style={{ ...inp, cursor: 'pointer', fontWeight: 600, color: C.esp }}>
                🖼️ Escolher arquivo
                <input type="file" accept="image/*" onChange={(e) => escolherFoto((e.target as any).files?.[0] ?? null)} style={{ display: 'none' }} />
              </label>
              {/* Câmera no celular: capture=environment abre a câmera traseira direto (não só a galeria) */}
              <label style={{ ...inp, cursor: 'pointer', fontWeight: 600, color: C.esp }}>
                📷 Tirar foto
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <input ref={camInputRef} type="file" accept="image/*" capture="environment" onChange={(e) => escolherFoto((e.target as any).files?.[0] ?? null)} style={{ display: 'none' }} />
              </label>
            </div>
          </div>
        )}

        {preview && (
          <div style={{ marginTop: 12 }}>
            {/* barra de ferramentas de marcação */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{ fontSize: 11.5, color: C.espM, fontWeight: 600 }}>Marcar com:</span>
              {FERRAMENTAS.map(([t, label]) => (
                <button key={t} type="button" onClick={() => setTool(t)}
                  style={{ fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${tool === t ? C.gold : C.border}`, background: tool === t ? C.amberBg : C.white, color: tool === t ? C.amber : C.espM }}>
                  {label}
                </button>
              ))}
              <span style={{ fontSize: 11, color: C.espL, marginLeft: 'auto' }}>
                {tool === 'seta' ? 'toque onde está o problema' : 'arraste sobre a área'} · {marcas.length} marcação(ões)
                {marcas.length > 0 && <button onClick={() => setMarcas([])} style={{ marginLeft: 6, border: 'none', background: 'none', color: C.red, cursor: 'pointer', fontSize: 11 }}>limpar</button>}
              </span>
              <button type="button" onClick={() => escolherFoto(null)} style={{ border: 'none', background: 'none', color: C.espL, cursor: 'pointer', fontSize: 11 }}>trocar imagem</button>
            </div>

            <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', userSelect: 'none' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img ref={imgRef} src={preview} alt="" draggable={false}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
                style={{ maxWidth: '100%', maxHeight: 460, borderRadius: 8, border: `1px solid ${C.border}`, cursor: 'crosshair', display: 'block', touchAction: 'none' }} />
              {marcas.map((m, i) => {
                if (m.tipo === 'seta') {
                  return (
                    <div key={i} title={m.texto} style={{ position: 'absolute', left: `${m.x * 100}%`, top: `${m.y * 100}%`, transform: 'translate(-50%,-50%)', width: 24, height: 24, borderRadius: 999, background: 'rgba(180,35,24,0.9)', color: C.white, fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff', pointerEvents: 'none' }}>{i + 1}</div>
                  )
                }
                const w = (m.w ?? 0.1), h = (m.h ?? 0.1)
                return (
                  <div key={i} title={m.texto} style={{ position: 'absolute', left: `${(m.x - w / 2) * 100}%`, top: `${(m.y - h / 2) * 100}%`, width: `${w * 100}%`, height: `${h * 100}%`, border: `2.5px solid ${C.red}`, borderRadius: m.tipo === 'circulo' ? '50%' : 6, boxShadow: '0 0 0 1.5px #fff', pointerEvents: 'none' }}>
                    <span style={{ position: 'absolute', top: -11, left: -8, width: 20, height: 20, borderRadius: 999, background: C.red, color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff' }}>{i + 1}</span>
                  </div>
                )
              })}
              {previewBox && (
                <div style={{ position: 'absolute', ...previewBox, border: `2px dashed ${C.red}`, borderRadius: tool === 'circulo' ? '50%' : 6, pointerEvents: 'none' }} />
              )}
            </div>

            {/* lista de marcas com texto — é o texto que faz a IA entender o apontamento */}
            {marcas.length > 0 && (
              <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                {marcas.map((m, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 999, background: C.red, color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                    <input
                      ref={(el) => { textoRefs.current[i] = el }}
                      value={m.texto ?? ''}
                      onChange={(e) => setMarcas((arr) => arr.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))}
                      placeholder="o que há de errado aqui? (ex.: botão de salvar não submete)"
                      style={{ ...inp, flex: 1 }} />
                    <button type="button" onClick={() => setMarcas((arr) => arr.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', color: C.espL, cursor: 'pointer', fontSize: 16, lineHeight: 1 }} title="remover marcação">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button disabled={!podeEnviar} onClick={() => void enviar()} style={{ padding: '9px 18px', border: 'none', borderRadius: 8, background: podeEnviar ? C.gold : C.espL, color: C.white, fontWeight: 700, cursor: podeEnviar ? 'pointer' : 'not-allowed' }}>{busy ? 'Enviando…' : 'Enviar sugestão'}</button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, margin: '4px 0 10px' }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{verArquivadas ? 'Sugestões arquivadas' : 'Minhas sugestões'}</h2>
        <button type="button" onClick={() => setVerArquivadas((v) => !v)} style={{ border: 'none', background: 'none', color: C.blue, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          {verArquivadas ? '← voltar às ativas' : 'ver arquivadas'}
        </button>
      </div>
      {minhas.length === 0 ? <div style={{ fontSize: 13, color: C.espL, fontStyle: 'italic' }}>{verArquivadas ? 'Nenhuma sugestão arquivada.' : 'Você ainda não abriu nenhuma.'}</div> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {minhas.map((m) => (
            <div key={m.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 14 }}>{m.titulo || m.descricao.slice(0, 60)}</b>
                <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: m.status === 'concluida' ? C.greenBg : m.status === 'recusada' ? C.redBg : C.cream, color: m.status === 'concluida' ? C.green : m.status === 'recusada' ? C.red : C.espM, fontWeight: 700 }}>{STAT_LABEL[m.status] || m.status}</span>
              </div>
              <div style={{ fontSize: 12.5, color: C.espM, marginTop: 4 }}>{m.descricao}</div>
              {/* A resposta só aparece ao autor DEPOIS de aprovada (§2.1) — em carregar já vem null se não aprovada. */}
              {m.resposta && (
                <div style={{ marginTop: 6, background: C.cream, padding: '8px 10px', borderRadius: 8 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: C.esp, textTransform: 'uppercase', letterSpacing: 0.4 }}>Resposta da equipe PS</div>
                  <div style={{ fontSize: 12.5, color: C.esp, marginTop: 3, whiteSpace: 'pre-wrap' }}>{m.resposta}</div>
                  {m.status !== 'concluida' && !m.confirmado_pelo_autor && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      <button onClick={() => void confirmar(m.id, true)} style={{ background: C.green, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Funcionou ✓</button>
                      <button onClick={() => void confirmar(m.id, false)} style={{ background: '#fff', color: C.red, border: `1px solid ${C.red}`, borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Ainda não resolveu</button>
                    </div>
                  )}
                </div>
              )}
              <div style={{ fontSize: 10.5, marginTop: 6 }}>
                {m.tem_ia
                  ? <span style={{ color: C.blue }}>🤖 análise da IA disponível ao atendente</span>
                  : (!STATUS_TERMINAL.includes(m.status) && <span style={{ color: C.espL }}>não analisada pela IA</span>)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
