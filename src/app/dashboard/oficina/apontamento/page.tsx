'use client'
// OFICINA · APONTAMENTO DO MECÂNICO 💎 (tempo real por serviço). Mobile-first, mão suja.
// Onda 1 · 3.3/3.4: o EXECUTOR é o mecânico logado (id), não texto solto; cronômetro grande ao vivo;
// dois toques (abrir OS → Iniciar/Concluir); sem campo de hora no fluxo (o relógio é a fonte, RD-60) —
// ajuste manual fica atrás de "ajustar", e só depois de concluir; observação por voz.
// 🚫 SEM R$ — margem aqui é em HORAS. Custo/preço é da GE.
import React, { useEffect, useState, useRef, useCallback, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Timer, ChevronLeft, Play, Square } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { PlacaInline } from '../_components/PlacaInline'
import { useOficinaRamo } from '@/lib/oficina/ramo'

const ESP = '#3D2314'; const BG = '#FAF7F2'; const GOLD = '#C8941A'; const LINE = '#E7DECF'; const ESP60 = 'rgba(61,35,20,0.55)'
const OK = '#166534'; const RED = '#A32D2D'; const AMBER = '#B45309'

type Apont = { id: string; status: string; tempo_real_h: number | null; iniciado_em: string | null; finalizado_em: string | null; mecanico_nome: string | null }
type ItemAp = { item_id: string; servico_id: string | null; descricao: string; tempo_estimado_h: number | null; severidade: string; apontamento: Apont | null }
type PecaAp = { item_id: string; descricao: string; quantidade: number | null }
type OSLinha = { id: string; numero: string; cliente_nome: string | null; placa: string | null; marca: string | null; modelo: string | null }
type Mecanico = { id: string; nome: string }

// ── Web Speech (pt-BR, gratuito) — mesmo padrão do RespostaInline/VozSoap ──
type RecResultAlt = { transcript: string }
type RecResult = ArrayLike<RecResultAlt> & { isFinal: boolean }
type RecEvent = { resultIndex: number; results: ArrayLike<RecResult> }
type RecLike = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void;
  onresult: ((e: RecEvent) => void) | null; onerror: (() => void) | null; onend: (() => void) | null }
type RecCtor = new () => RecLike
function getRecCtor(): RecCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

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

// quem está logado = o executor por padrão (3.4: mecanico_id é quem trabalha, não quem clica)
function useLoggedUser(): Mecanico | null {
  const [u, setU] = useState<Mecanico | null>(null)
  useEffect(() => {
    let vivo = true
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { if (vivo) setU(null); return }
      const { data } = await supabase.from('users').select('full_name, email').eq('id', user.id).maybeSingle()
      const nome = (data?.full_name?.trim() || data?.email || 'Você') as string
      if (vivo) setU({ id: user.id, nome })
    })()
    return () => { vivo = false }
  }, [])
  return u
}

function fmtRelogio(iso: string | null): string {
  if (!iso) return '00:00:00'
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(hh)}:${p(mm)}:${p(ss)}`
}
function fmtH(h: number | null | undefined): string {
  if (h == null) return '—'
  const n = Number(h)
  if (n < 1) return `${Math.round(n * 60)}min`
  return `${n.toFixed(n % 1 === 0 ? 0 : 1)}h`
}

export default function ApontamentoPage() {
  const companyId = useCompanyId()
  const { config: ramo } = useOficinaRamo(companyId)
  const eu = useLoggedUser()
  const router = useRouter()
  const [lista, setLista] = useState<OSLinha[]>([])
  const [osSel, setOsSel] = useState<OSLinha | null>(null)
  const [itens, setItens] = useState<ItemAp[]>([])
  const [pecas, setPecas] = useState<PecaAp[]>([])
  // 3.4 · executor: por padrão eu (logado). Pode trocar por 1 toque (designados da OS) ou, exceção, texto.
  const [execId, setExecId] = useState<string | null>(null)
  const [execNome, setExecNome] = useState<string>('')
  const [designados, setDesignados] = useState<Mecanico[]>([])
  const [trocando, setTrocando] = useState(false)
  const [overrideNome, setOverrideNome] = useState('')
  // conclusão: relógio é a fonte; "ajustar" (por item) revela hora manual (3.1). Observação opcional por voz.
  const [ajustando, setAjustando] = useState<Set<string>>(new Set())
  const [tempoManual, setTempoManual] = useState<Record<string, string>>({})
  const [obs, setObs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [, setTick] = useState(0)

  // quando eu carrego, viro o executor padrão (se ainda não escolheram outro)
  useEffect(() => { if (eu && !execId) { setExecId(eu.id); setExecNome(eu.nome) } }, [eu, execId])
  // relógio ao vivo: 1s enquanto tiver algo em andamento
  const algumRodando = itens.some((i) => i.apontamento?.status === 'em_andamento')
  useEffect(() => { if (!algumRodando) return; const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t) }, [algumRodando])

  const carregarLista = useCallback(async () => {
    if (!companyId) return
    const { data } = await supabase.rpc('fn_oficina_os_fila', { p_company_id: companyId, p_etapa: 'apontamento' })
    setLista((data as OSLinha[]) ?? [])
  }, [companyId])
  const setPlacaLocal = (osId: string, placa: string) => setLista((p) => p.map((o) => (o.id === osId ? { ...o, placa } : o)))
  useEffect(() => { void carregarLista() }, [carregarLista])

  const carregarOS = useCallback(async (os: OSLinha) => {
    if (!companyId) return
    const { data } = await supabase.rpc('fn_oficina_apontamento_obter', { p_company_id: companyId, p_os_id: os.id })
    const d = data as { itens?: ItemAp[]; pecas?: PecaAp[] } | null
    setItens(d?.itens ?? []); setPecas(d?.pecas ?? [])
  }, [companyId])

  // mecânicos já designados NESTA OS (com id) → viram os chips de "trocar" (1 toque, sem digitar)
  const carregarDesignados = useCallback(async (osId: string) => {
    if (!companyId) return
    const { data } = await supabase.from('erp_os_mecanico')
      .select('mecanico_id, mecanico_nome').eq('company_id', companyId).eq('os_id', osId)
      .eq('ativo', true).not('mecanico_id', 'is', null)
    const seen = new Set<string>(); const out: Mecanico[] = []
    for (const r of (data ?? []) as { mecanico_id: string; mecanico_nome: string | null }[]) {
      if (!r.mecanico_id || seen.has(r.mecanico_id)) continue
      seen.add(r.mecanico_id); out.push({ id: r.mecanico_id, nome: (r.mecanico_nome ?? '').trim() || 'Mecânico' })
    }
    setDesignados(out)
  }, [companyId])

  const abrirOS = async (os: OSLinha) => {
    if (!companyId) return
    const { data } = await supabase.rpc('fn_oficina_apontamento_obter', { p_company_id: companyId, p_os_id: os.id })
    const d = data as { itens?: ItemAp[]; pecas?: PecaAp[] } | null
    if ((d?.itens ?? []).length === 0 && (d?.pecas ?? []).length === 0) { setMsg('Nada aprovado nessa OS. Faça diagnóstico + aprovação primeiro.'); return }
    setOsSel(os); setItens(d?.itens ?? []); setPecas(d?.pecas ?? [])
    setTrocando(false); setOverrideNome('')
    void carregarDesignados(os.id)
  }

  const iniciar = async (it: ItemAp) => {
    if (!companyId || !osSel) return
    setBusy(it.item_id)
    // 3.4 · manda o EXECUTOR: id quando temos (logado/designado); nome sempre (exibição). Sem id → texto (exceção).
    const { data, error } = await supabase.rpc('fn_oficina_apontamento_iniciar', {
      p_company_id: companyId, p_os_id: osSel.id, p_item_id: it.item_id,
      p_mecanico_nome: execNome || null, p_mecanico_id: execId,
    })
    setBusy(null)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || j?.ok === false) { setMsg('❌ ' + (error?.message || j?.erro)); return }
    await carregarOS(osSel)
  }

  const concluir = async (it: ItemAp) => {
    if (!companyId || !osSel || !it.apontamento) return
    setBusy(it.item_id)
    const manual = ajustando.has(it.item_id) ? tempoManual[it.item_id] : ''
    const tempo = manual && manual.trim() ? Number(manual.replace(',', '.')) : null   // vazio = relógio (RD-60)
    const nota = (obs[it.item_id] ?? '').trim() || null
    const { data, error } = await supabase.rpc('fn_oficina_apontamento_concluir', {
      p_company_id: companyId, p_apontamento_id: it.apontamento.id,
      p_tempo_real_h: tempo, p_mecanico_nome: execNome || null, p_observacao: nota,
    })
    setBusy(null)
    const j = data as { ok?: boolean; erro?: string; tempo_real_h?: number; execucao_gravada?: boolean } | null
    if (error || j?.ok === false) { setMsg('❌ ' + (error?.message || j?.erro)); return }
    setTempoManual((p) => { const n = { ...p }; delete n[it.item_id]; return n })
    setObs((p) => { const n = { ...p }; delete n[it.item_id]; return n })
    setAjustando((p) => { const n = new Set(p); n.delete(it.item_id); return n })
    setMsg(`✅ ${fmtH(j?.tempo_real_h)} registradas${j?.execucao_gravada ? ' (alimenta o tempário)' : ''}.`)
    await carregarOS(osSel)
  }

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t) }, [msg])

  if (!companyId) return <div style={{ padding: 24, color: ESP60, background: BG, minHeight: '100vh' }}>Selecione uma empresa específica no topo para abrir o Apontamento.</div>

  if (!osSel) return (
    <div style={{ background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 14px 40px' }}>
        <button onClick={() => router.push('/dashboard/oficina/patio')} style={linkBtn}><ChevronLeft size={16} /> Pátio</button>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 6 }}>🔧 Oficina · Apontamento</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}><Timer size={22} /> {ramo.automotivo ? 'Em qual carro você vai trabalhar?' : 'Em qual trabalho você vai atuar?'}</h1>
        {eu && <div style={{ fontSize: 13, color: ESP60, marginBottom: 10 }}>Você entrou como <b style={{ color: ESP }}>{eu.nome}</b> — o tempo entra no seu nome.</div>}
        {lista.length === 0 && <div style={{ color: ESP60, fontSize: 14, padding: '20px 0' }}>Nenhuma OS aprovada ainda. Passe pela Aprovação primeiro.</div>}
        {lista.map((os) => (
          <div key={os.id} onClick={() => void abrirOS(os)} style={{ width: '100%', textAlign: 'left', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 10, cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <PlacaInline companyId={companyId} osId={os.id} placa={os.placa} onSaved={(p) => setPlacaLocal(os.id, p)} />
              <span style={{ fontSize: 11, color: ESP60 }}>{os.numero}</span>
            </div>
            <div style={{ fontSize: 13, color: ESP, marginTop: 3 }}>{[os.marca, os.modelo].filter(Boolean).join(' ') || ramo.objetoLabel}{os.cliente_nome ? ` · ${os.cliente_nome}` : ''}</div>
          </div>
        ))}
      </div>
      {msg && <Toast>{msg}</Toast>}
    </div>
  )

  const totalPrev = itens.reduce((s, i) => s + (Number(i.tempo_estimado_h) || 0), 0)
  const totalReal = itens.reduce((s, i) => s + (i.apontamento?.status === 'concluido' ? (Number(i.apontamento.tempo_real_h) || 0) : 0), 0)

  return (
    <div style={{ background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 14px 96px' }}>
        <button onClick={() => setOsSel(null)} style={linkBtn}><ChevronLeft size={16} /> Trocar {ramo.objetoLabelCurto}</button>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 6 }}>🔧 Oficina · Apontamento · {osSel.numero}</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '2px 0 10px' }}>{osSel.placa} · {osSel.marca} {osSel.modelo}</h1>

        {/* 3.4 · Executor (quem trabalha) — eu por padrão; trocar por 1 toque; digitar é exceção */}
        <Sec titulo="Quem está executando">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: ESP }}>
              {execNome || 'Selecione'}{execId ? '' : ' (sem cadastro)'}
            </span>
            <button onClick={() => setTrocando((v) => !v)} style={btnLine}>{trocando ? 'Fechar' : 'Trocar'}</button>
          </div>
          {!execId && execNome && (
            <div style={{ fontSize: 11, color: AMBER, marginTop: 6 }}>⚠️ Sem cadastro ligado — o tempo fica só pelo nome. Prefira escolher alguém da lista.</div>
          )}
          {trocando && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {eu && (
                <button onClick={() => { setExecId(eu.id); setExecNome(eu.nome); setTrocando(false) }} style={chipMec(execId === eu.id)}>
                  {eu.nome} <span style={{ fontSize: 11, opacity: 0.7 }}>· você</span>
                </button>
              )}
              {designados.filter((m) => m.id !== eu?.id).map((m) => (
                <button key={m.id} onClick={() => { setExecId(m.id); setExecNome(m.nome); setTrocando(false) }} style={chipMec(execId === m.id)}>
                  {m.nome} <span style={{ fontSize: 11, opacity: 0.7 }}>· designado</span>
                </button>
              ))}
              {/* exceção (RD-51): mecânico sem cadastro → só nome, sem id */}
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={overrideNome} onChange={(e) => setOverrideNome(e.target.value)} placeholder="Outro (sem cadastro)…" style={{ ...inp, flex: 1 }} />
                <button disabled={!overrideNome.trim()} onClick={() => { setExecId(null); setExecNome(overrideNome.trim()); setTrocando(false) }} style={{ ...btnLine, opacity: overrideNome.trim() ? 1 : 0.5 }}>Usar</button>
              </div>
            </div>
          )}
        </Sec>

        <Sec titulo="Serviços aprovados">
          {itens.map((it) => {
            const ap = it.apontamento
            const rodando = ap?.status === 'em_andamento'
            const concluido = ap?.status === 'concluido'
            const real = concluido ? Number(ap!.tempo_real_h) : null
            const prev = Number(it.tempo_estimado_h) || 0
            const estourou = real != null && prev > 0 && real > prev
            const ajusta = ajustando.has(it.item_id)
            return (
              <div key={it.item_id} style={{ border: `1px solid ${rodando ? GOLD : LINE}`, borderRadius: 12, padding: 12, marginBottom: 10, background: '#fff' }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{it.descricao}</div>
                <div style={{ fontSize: 11, color: ESP60, marginTop: 2 }}>
                  Previsto {fmtH(it.tempo_estimado_h)}{it.servico_id ? ' · tempário' : ''}
                  {concluido && <> · Real <b style={{ color: estourou ? RED : OK }}>{fmtH(real)}</b>{ap?.mecanico_nome ? ` · ${ap.mecanico_nome}` : ''}</>}
                </div>

                {!ap && (
                  <button onClick={() => void iniciar(it)} disabled={busy === it.item_id} style={btnGrande(GOLD)}><Play size={20} /> Iniciar</button>
                )}

                {rodando && (
                  <div style={{ marginTop: 12 }}>
                    {/* cronômetro grande ao vivo */}
                    <div style={{ textAlign: 'center', margin: '2px 0 12px' }}>
                      <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: 1, color: ESP, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{fmtRelogio(ap!.iniciado_em)}</div>
                      <div style={{ fontSize: 12, color: GOLD, fontWeight: 700 }}>⏱ em andamento</div>
                    </div>
                    {/* observação por voz (opcional) */}
                    <VozNota valor={obs[it.item_id] ?? ''} onChange={(v) => setObs((p) => ({ ...p, [it.item_id]: v }))} />
                    {/* ajuste manual é exceção — atrás de "ajustar" (3.1: o relógio é a fonte) */}
                    {ajusta ? (
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <input value={tempoManual[it.item_id] ?? ''} onChange={(e) => setTempoManual((p) => ({ ...p, [it.item_id]: e.target.value.replace(/[^\d.,]/g, '') }))}
                          placeholder={`Horas (ex.: ${prev || 1})`} inputMode="decimal" style={{ ...inp, flex: 1 }} />
                        <button onClick={() => setAjustando((p) => { const n = new Set(p); n.delete(it.item_id); return n })} style={btnLine}>Cancelar</button>
                      </div>
                    ) : (
                      <button onClick={() => setAjustando((p) => new Set(p).add(it.item_id))} style={{ ...linkBtn, marginTop: 6 }}>Esqueci de bater o ponto — ajustar o tempo</button>
                    )}
                    <button onClick={() => void concluir(it)} disabled={busy === it.item_id} style={btnGrande(ESP)}><Square size={18} /> Concluir</button>
                  </div>
                )}

                {concluido && (
                  <button onClick={() => void iniciar(it)} disabled={busy === it.item_id} style={{ ...btnLine, marginTop: 10, width: '100%' }}>Reabrir / refazer</button>
                )}
              </div>
            )
          })}
          {itens.length === 0 && <div style={{ color: ESP60, fontSize: 13 }}>Nenhum serviço aprovado (só peças — veja abaixo).</div>}
        </Sec>

        {pecas.length > 0 && (
          <Sec titulo={`Peças aprovadas · ${pecas.length}`}>
            {pecas.map((p) => (
              <div key={p.item_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: `1px solid ${LINE}` }}>
                <span style={{ fontSize: 14, color: ESP }}>{p.descricao}</span>
                <span style={{ fontSize: 12, color: ESP60, whiteSpace: 'nowrap' }}>× {p.quantidade != null ? Number(p.quantidade) : 1}</span>
              </div>
            ))}
            <div style={{ fontSize: 11, color: ESP60, marginTop: 8 }}>Peças não têm apontamento de hora — aparecem aqui só pra você ver o escopo aprovado.</div>
          </Sec>
        )}
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: `1px solid ${LINE}`, padding: '10px 14px' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700 }}>
          <span style={{ color: ESP60 }}>Previsto <b style={{ color: ESP }}>{fmtH(totalPrev)}</b></span>
          <span style={{ color: ESP60 }}>Real <b style={{ color: totalReal > totalPrev && totalPrev > 0 ? RED : OK }}>{fmtH(totalReal)}</b></span>
        </div>
      </div>
      {msg && <Toast>{msg}</Toast>}
    </div>
  )
}

// observação por voz (opcional): textarea + ditado pt-BR (Web Speech). Some quando vazia e sem foco? não —
// mantém simples: sempre visível pequena, com botão de microfone quando o navegador suporta.
function VozNota({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  const [suporta, setSuporta] = useState(false)
  const [gravando, setGravando] = useState(false)
  const recRef = useRef<RecLike | null>(null)
  useEffect(() => { setSuporta(!!getRecCtor()); return () => { recRef.current?.stop() } }, [])
  const gravar = useCallback(() => {
    if (gravando) { recRef.current?.stop(); return }
    const Ctor = getRecCtor(); if (!Ctor) return
    const rec = new Ctor()
    rec.lang = 'pt-BR'; rec.continuous = true; rec.interimResults = true
    rec.onresult = (e) => {
      let fin = ''
      for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) fin += r[0].transcript }
      if (fin) onChange((valor ? valor.trimEnd() + ' ' : '') + fin.trim())
    }
    rec.onerror = () => setGravando(false)
    rec.onend = () => setGravando(false)
    recRef.current = rec; rec.start(); setGravando(true)
  }, [gravando, valor, onChange])
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <textarea value={valor} onChange={(e) => onChange(e.target.value)} rows={2} placeholder="Observação (opcional) — o que achou, o que faltou…"
        style={{ ...inp, flex: 1, resize: 'vertical', border: `1px solid ${gravando ? GOLD : LINE}` }} />
      {suporta && (
        <button type="button" onClick={gravar} title={gravando ? 'Parar' : 'Ditar por voz'}
          style={{ minHeight: 44, minWidth: 48, borderRadius: 10, border: `1px solid ${gravando ? RED : LINE}`, background: gravando ? '#EF444415' : '#fff', color: gravando ? RED : ESP60, cursor: 'pointer', fontSize: 18 }}>
          {gravando ? '■' : '🎙️'}
        </button>
      )}
    </div>
  )
}

function Sec({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: ESP60, fontWeight: 700, marginBottom: 10 }}>{titulo}</div>
      {children}
    </div>
  )
}
function Toast({ children }: { children: React.ReactNode }) {
  return <div style={{ position: 'fixed', bottom: 74, left: '50%', transform: 'translateX(-50%)', background: ESP, color: '#fff', padding: '10px 16px', borderRadius: 999, fontSize: 13, zIndex: 70, maxWidth: '92%', textAlign: 'center' }}>{children}</div>
}
const inp: CSSProperties = { width: '100%', padding: '11px 12px', border: `1px solid ${LINE}`, borderRadius: 10, fontSize: 15, background: '#fff', color: ESP, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }
// botão grande (mão suja): 48px+, largura total, um toque
function btnGrande(bg: string): CSSProperties {
  return { background: bg, color: bg === GOLD ? '#3D2314' : '#fff', border: 'none', borderRadius: 12, padding: '14px 16px', fontSize: 17, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', minHeight: 52, marginTop: 10 }
}
function chipMec(sel: boolean): CSSProperties {
  return { textAlign: 'left', minHeight: 48, borderRadius: 10, border: `1px solid ${sel ? ESP : LINE}`, background: sel ? ESP : '#fff', color: sel ? '#fff' : ESP, fontSize: 15, fontWeight: 700, padding: '0 14px', cursor: 'pointer' }
}
const btnLine: CSSProperties = { background: '#fff', color: ESP, border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 44 }
const linkBtn: CSSProperties = { background: 'none', border: 'none', color: ESP60, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: 0 }
