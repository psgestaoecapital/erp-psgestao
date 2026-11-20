'use client'

// Reunião gravada → transcrição (IA) → ata sugerida + ações 5W2H (CEO 20/11). Núcleo do Plano de Ação.
// IA PROPÕE, humano CONFIRMA: nenhuma ação entra no quadro sem o toque de "Confirmar". O áudio sobe DIRETO do
// navegador para o Storage privado (nunca pela rota — limite de 4,5 MB), em trechos de ~10 min; a rota transcreve e
// APAGA o áudio. RD-95: "?" em todo campo/ação. RD-100: nada de nome de fornecedor de IA — é "IA"/"transcrição automática".
// LGPD: consentimento obrigatório antes de gravar (avisar os participantes).

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const ESP = '#3D2314'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const MUT = 'rgba(61,35,20,0.6)'
const VERM = '#B23B3B'
const VERDE = '#2F7D4F'
const SEG_MS = 10 * 60 * 1000 // trecho de 10 min

const box: React.CSSProperties = { background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14 }
const inp: React.CSSProperties = { width: '100%', padding: '7px 9px', border: `0.5px solid ${LINE}`, borderRadius: 8, fontSize: 13, color: ESP, background: '#FFF', boxSizing: 'border-box' }
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: ESP, color: '#FAF7F2', border: `0.5px solid ${ESP}` }
const btnSec: React.CSSProperties = { ...btn, background: '#FFF', color: ESP, border: `0.5px solid ${LINE}` }
const rotulo: React.CSSProperties = { display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 600, color: ESP, marginBottom: 3 }

type Segmento = { id: string; seq: number; origem: string; status: string; erro: string | null; duracao_seg: number | null; apagado_em: string | null }
type Proposta = {
  id: string; titulo: string | null; o_que: string | null; por_que: string | null; onde: string | null
  setor_id: string | null; quando: string | null; responsavel_user_id: string | null; responsavel_nome: string | null
  como: string | null; custo_estimado: number | null; prioridade: string; evidencia: string | null; minuto: string | null
  confianca: string | null; status: string; acao_id: string | null
}
type Reuniao = { id: string; ia_status: string; ia_erro: string | null; ata_ia: string | null; ia_custo_usd: number | null; ia_minutos: number | null; consentimento_em: string | null; ata: string | null }
type Dados = { ok: boolean; reuniao?: Reuniao; segmentos?: Segmento[]; propostas?: Proposta[] }

type Recog = { continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void }

function escolherMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const c of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
    try { if (MediaRecorder.isTypeSupported(c)) return c } catch { /* ignore */ }
  }
  return ''
}
const baseMime = (m: string) => (m.split(';')[0] || 'audio/webm')
const PRI_ROTULO: Record<string, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' }

export default function ReuniaoGravacaoIA({ reuniaoId, companyId, rota, onAta, onAcoesConfirmadas }: {
  reuniaoId: string; companyId: string; rota: string; onAta?: (texto: string) => void; onAcoesConfirmadas?: () => void
}) {
  const [dados, setDados] = useState<Dados | null>(null)
  const [consentido, setConsentido] = useState(false)
  const [estado, setEstado] = useState<'idle' | 'gravando' | 'pausado'>('idle')
  const [draft, setDraft] = useState('')
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')
  const [processando, setProcessando] = useState(false)
  const [ataEdit, setAtaEdit] = useState('')

  const streamRef = useRef<MediaStream | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const seqRef = useRef(0)
  const offsetRef = useRef(0)
  const segIniRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pararDeVezRef = useRef(false)
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null)
  const recogRef = useRef<Recog | null>(null)

  const token = useCallback(async () => (await supabase.auth.getSession()).data.session?.access_token ?? '', [])

  const recarregar = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('fn_reuniao_ia_obter', { p_reuniao_id: reuniaoId })
      if (error) { setErro(erroAmigavel(error)); return }
      const d = data as Dados
      setDados(d)
      if (d?.reuniao?.consentimento_em) setConsentido(true)
      if (d?.reuniao?.ata_ia && !ataEdit) setAtaEdit(d.reuniao.ata_ia)
    } catch (e) { setErro(erroAmigavel(e)) }
  }, [reuniaoId, ataEdit])

  useEffect(() => { void recarregar() }, [reuniaoId]) // eslint-disable-line react-hooks/exhaustive-deps

  const api = useCallback(async (path: string, body: Record<string, unknown>) => {
    const t = await token()
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify(body) })
    return res.json().catch(() => ({}))
  }, [token])

  const garantirConsentimento = useCallback(async () => {
    if (consentido) return true
    const { data, error } = await supabase.rpc('fn_reuniao_ia_consentir', { p_reuniao_id: reuniaoId })
    if (error || !(data as { ok?: boolean })?.ok) { setErro('Marque o aviso de gravação antes de começar.'); return false }
    setConsentido(true); return true
  }, [consentido, reuniaoId])

  // sobe um trecho ao storage, registra e dispara a transcrição
  const processarTrecho = useCallback(async (blob: Blob, mime: string, duracaoSeg: number, origem: 'gravacao' | 'arquivo') => {
    const seq = seqRef.current++
    const offset = offsetRef.current
    offsetRef.current += duracaoSeg
    const ext = baseMime(mime).includes('mp4') ? 'm4a' : baseMime(mime).includes('ogg') ? 'ogg' : baseMime(mime).includes('mpeg') ? 'mp3' : 'webm'
    const path = `${companyId}/${reuniaoId}/${seq}-${Date.now()}.${ext}`
    setMsg('Enviando o áudio…')
    const up = await supabase.storage.from('reuniao-audio').upload(path, blob, { contentType: baseMime(mime), upsert: true })
    if (up.error) { setErro('Não consegui enviar o áudio: ' + erroAmigavel(up.error)); return }
    const { data: reg, error: regErr } = await supabase.rpc('fn_reuniao_ia_segmento_registrar', {
      p_reuniao_id: reuniaoId, p_seq: seq, p_origem: origem, p_path: path, p_mime: baseMime(mime), p_duracao: duracaoSeg, p_offset: offset,
    })
    const segId = (reg as { segmento_id?: string })?.segmento_id
    if (regErr || !segId) { setErro('Falha ao registrar o trecho: ' + erroAmigavel(regErr)); return }
    await recarregar()
    setMsg('Transcrevendo…')
    const r = await api('/api/plano-acao/reuniao/transcrever', { reuniao_id: reuniaoId, segmento_id: segId })
    if (!r?.ok) setErro(r?.aviso || 'A transcrição automática falhou neste trecho.')
    else setMsg('')
    await recarregar()
  }, [companyId, reuniaoId, api, recarregar])

  // encerra o MediaRecorder atual (resolve com o blob do trecho)
  const pararRecorder = useCallback(() => new Promise<Blob | null>((resolve) => {
    const rec = recRef.current
    if (!rec || rec.state === 'inactive') { resolve(null); return }
    rec.onstop = () => { const b = chunksRef.current.length ? new Blob(chunksRef.current, { type: rec.mimeType }) : null; chunksRef.current = []; resolve(b) }
    try { rec.stop() } catch { resolve(null) }
  }), [])

  const iniciarSegmento = useCallback(() => {
    const stream = streamRef.current
    if (!stream) return
    const mime = escolherMime()
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
    chunksRef.current = []
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data) }
    recRef.current = rec
    segIniRef.current = Date.now()
    rec.start()
    // rotaciona em 10 min: fecha este trecho e, se a gravação continua, abre o próximo
    timerRef.current = setTimeout(async () => {
      if (estado === 'pausado') return
      const dur = (Date.now() - segIniRef.current) / 1000
      const b = await pararRecorder()
      if (b) void processarTrecho(b, b.type || mime, dur, 'gravacao')
      if (!pararDeVezRef.current) iniciarSegmento()
    }, SEG_MS)
  }, [estado, pararRecorder, processarTrecho])

  const iniciarReconhecimento = useCallback(() => {
    const W = window as unknown as { webkitSpeechRecognition?: new () => Recog; SpeechRecognition?: new () => Recog }
    const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition
    if (!Ctor) return
    try {
      const r = new Ctor()
      r.continuous = true; r.interimResults = true; r.lang = 'pt-BR'
      r.onresult = (e) => {
        let txt = ''
        for (let i = e.resultIndex; i < e.results.length; i++) txt += e.results[i][0].transcript
        if (txt) setDraft((d) => (d + ' ' + txt).slice(-2000))
      }
      r.onerror = () => { /* rascunho é best-effort */ }
      r.start(); recogRef.current = r
    } catch { /* sem reconhecimento ao vivo: sem problema, a transcrição real vem da IA */ }
  }, [])

  const comecar = useCallback(async () => {
    setErro('')
    if (!(await garantirConsentimento())) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      pararDeVezRef.current = false
      seqRef.current = (dados?.segmentos?.length ?? 0)
      offsetRef.current = (dados?.segmentos ?? []).reduce((s, g) => s + Number(g.duracao_seg ?? 0), 0)
      try { const nav = navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }; wakeRef.current = (await nav.wakeLock?.request('screen')) ?? null } catch { /* sem wakelock */ }
      iniciarReconhecimento()
      iniciarSegmento()
      setEstado('gravando')
    } catch { setErro('Não consegui acessar o microfone. Libere o microfone para este site e tente de novo.') }
  }, [garantirConsentimento, dados, iniciarReconhecimento, iniciarSegmento])

  const pausar = useCallback(() => { try { recRef.current?.pause() } catch { /* */ } try { recogRef.current?.stop() } catch { /* */ } setEstado('pausado') }, [])
  const retomar = useCallback(() => { try { recRef.current?.resume() } catch { /* */ } iniciarReconhecimento(); setEstado('gravando') }, [iniciarReconhecimento])

  const encerrar = useCallback(async () => {
    pararDeVezRef.current = true
    if (timerRef.current) clearTimeout(timerRef.current)
    try { recogRef.current?.stop() } catch { /* */ }
    const dur = (Date.now() - segIniRef.current) / 1000
    const b = await pararRecorder()
    streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null
    try { await wakeRef.current?.release() } catch { /* */ } wakeRef.current = null
    setEstado('idle'); setDraft('')
    if (b && dur > 1) await processarTrecho(b, b.type || escolherMime(), dur, 'gravacao')
  }, [pararRecorder, processarTrecho])

  const enviarArquivo = useCallback(async (file: File) => {
    setErro(''); setProcessando(true)
    try {
      if (!(await garantirConsentimento())) return
      seqRef.current = (dados?.segmentos?.length ?? 0)
      offsetRef.current = (dados?.segmentos ?? []).reduce((s, g) => s + Number(g.duracao_seg ?? 0), 0)
      let dur = 0
      try { dur = await new Promise<number>((res) => { const a = new Audio(); a.preload = 'metadata'; a.onloadedmetadata = () => res(Number.isFinite(a.duration) ? a.duration : 0); a.onerror = () => res(0); a.src = URL.createObjectURL(file) }) } catch { dur = 0 }
      await processarTrecho(file, file.type || 'audio/mpeg', dur, 'arquivo')
    } finally { setProcessando(false) }
  }, [garantirConsentimento, dados, processarTrecho])

  const gerarAta = useCallback(async () => {
    setErro(''); setProcessando(true); setMsg('Gerando a ata e as ações…')
    try {
      const r = await api('/api/plano-acao/reuniao/extrair', { reuniao_id: reuniaoId })
      if (!r?.ok) setErro(r?.aviso || 'Não consegui gerar a ata agora.')
      else { setMsg(''); if (r.ata) setAtaEdit(r.ata) }
      await recarregar()
    } finally { setProcessando(false) }
  }, [api, reuniaoId, recarregar])

  const confirmar = useCallback(async (p: Proposta, campos: Record<string, unknown>) => {
    const { data, error } = await supabase.rpc('fn_reuniao_ia_proposta_confirmar', { p_proposta_id: p.id, p_campos: campos })
    if (error || !(data as { ok?: boolean })?.ok) { setErro('Não consegui criar a ação: ' + ((data as { erro?: string })?.erro || erroAmigavel(error))); return }
    setMsg('Ação criada no quadro.'); await recarregar(); onAcoesConfirmadas?.()
  }, [recarregar, onAcoesConfirmadas])

  const descartar = useCallback(async (p: Proposta) => {
    const { error } = await supabase.rpc('fn_reuniao_ia_proposta_descartar', { p_proposta_id: p.id })
    if (error) { setErro(erroAmigavel(error)); return }
    await recarregar()
  }, [recarregar])

  const confirmarTodas = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_reuniao_ia_confirmar_todas', { p_reuniao_id: reuniaoId })
    if (error) { setErro(erroAmigavel(error)); return }
    setMsg(`${(data as { confirmadas?: number })?.confirmadas ?? 0} ação(ões) criada(s).`); await recarregar(); onAcoesConfirmadas?.()
  }, [reuniaoId, recarregar, onAcoesConfirmadas])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); streamRef.current?.getTracks().forEach((t) => t.stop()); void wakeRef.current?.release() }, [])

  const reun = dados?.reuniao
  const segs = dados?.segmentos ?? []
  const props = dados?.propostas ?? []
  const pendentes = props.filter((p) => p.status === 'proposta')
  const transcritos = segs.filter((s) => s.status === 'transcrito').length
  const custo = Number(reun?.ia_custo_usd ?? 0)

  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 8, paddingTop: 12, borderTop: `0.5px dashed ${LINE}` }} data-testid="reuniao-ia">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13, color: ESP }}>Gravar e gerar ata com IA</strong>
        <span style={{ fontSize: 11, color: MUT, display: 'flex', alignItems: 'center' }}>
          Custo da IA: US$ {custo.toFixed(2)}<AjudaCampo chave="industrial.plano_acao.reuniao_ia.custo" rota={rota} />
        </span>
      </div>

      {/* consentimento (LGPD) */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: ESP }}>
        <input type="checkbox" data-testid="reuniao-ia-consentimento" checked={consentido} disabled={consentido || estado !== 'idle'} onChange={() => void garantirConsentimento()} />
        <span style={{ display: 'flex', alignItems: 'center' }}>Avisei os participantes que a reunião será gravada<AjudaCampo chave="industrial.plano_acao.reuniao_ia.consentimento" rota={rota} /></span>
      </label>

      {/* gravar ao vivo */}
      <div style={box}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {estado === 'idle' && (
            <button type="button" style={btn} data-testid="reuniao-ia-gravar" onClick={() => void comecar()}>● Gravar</button>
          )}
          {estado === 'gravando' && <>
            <span style={{ fontSize: 13, color: VERM, fontWeight: 600 }}>● Gravando…</span>
            <button type="button" style={btnSec} onClick={pausar}>Pausar</button>
            <button type="button" style={btn} data-testid="reuniao-ia-encerrar" onClick={() => void encerrar()}>Encerrar</button>
          </>}
          {estado === 'pausado' && <>
            <span style={{ fontSize: 13, color: MUT, fontWeight: 600 }}>❚❚ Pausado</span>
            <button type="button" style={btnSec} onClick={retomar}>Retomar</button>
            <button type="button" style={btn} data-testid="reuniao-ia-encerrar" onClick={() => void encerrar()}>Encerrar</button>
          </>}
          <AjudaCampo chave="industrial.plano_acao.reuniao_ia.gravar" rota={rota} />
          <AjudaCampo chave="industrial.plano_acao.reuniao_ia.pausar" rota={rota} />
          <AjudaCampo chave="industrial.plano_acao.reuniao_ia.encerrar" rota={rota} />
        </div>
        {(estado !== 'idle') && (
          <div style={{ marginTop: 8 }}>
            <div style={{ ...rotulo, color: MUT }}>Texto ao vivo (rascunho)<AjudaCampo chave="industrial.plano_acao.reuniao_ia.texto_vivo" rota={rota} /></div>
            <div style={{ fontSize: 12, color: MUT, maxHeight: 72, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{draft || 'Ouvindo…'}</div>
          </div>
        )}
      </div>

      {/* enviar arquivo (Plano B) */}
      <label style={{ ...box, display: 'block' }}>
        <span style={rotulo}>Enviar uma gravação pronta<AjudaCampo chave="industrial.plano_acao.reuniao_ia.enviar_arquivo" rota={rota} /></span>
        <input type="file" accept="audio/*" data-testid="reuniao-ia-arquivo" disabled={processando || estado !== 'idle'}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void enviarArquivo(f); e.currentTarget.value = '' }} style={{ fontSize: 13 }} />
        <div style={{ fontSize: 11, color: MUT, marginTop: 4 }}>mp3, m4a, wav, webm ou ogg — da reunião gravada no celular, Meet, Teams etc.</div>
      </label>

      {/* trechos transcritos + gerar ata */}
      {segs.length > 0 && (
        <div style={box}>
          <div style={{ fontSize: 13, color: ESP }}>{transcritos} de {segs.length} trecho(s) transcrito(s)</div>
          {segs.some((s) => s.status === 'erro') && <div style={{ fontSize: 12, color: VERM, marginTop: 4 }}>Algum trecho falhou — reenvie ou grave de novo esse trecho.</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" style={{ ...btn, opacity: (transcritos === 0 || processando) ? 0.5 : 1 }} data-testid="reuniao-ia-gerar-ata" disabled={transcritos === 0 || processando} onClick={() => void gerarAta()}>
              {processando ? 'Processando…' : 'Gerar ata e ações'}
            </button>
          </div>
        </div>
      )}

      {msg && <div style={{ fontSize: 12, color: VERDE }}>{msg}</div>}
      {erro && <div style={{ fontSize: 12, color: VERM }} data-testid="reuniao-ia-erro">{erro}</div>}

      {/* ata sugerida */}
      {reun?.ata_ia && (
        <label style={{ ...box, display: 'block' }}>
          <span style={rotulo}>Ata sugerida (revise antes de usar)<AjudaCampo chave="industrial.plano_acao.reuniao_ia.ata_sugerida" rota={rota} /></span>
          <textarea data-testid="reuniao-ia-ata" value={ataEdit} onChange={(e) => setAtaEdit(e.target.value)} rows={5} style={{ ...inp, resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" style={btnSec} data-testid="reuniao-ia-usar-ata" onClick={() => { onAta?.(ataEdit); setMsg('Ata copiada para o campo acima — confira e salve a reunião.') }}>Usar como ata<AjudaCampo chave="industrial.plano_acao.reuniao_ia.usar_como_ata" rota={rota} /></button>
          </div>
        </label>
      )}

      {/* ações propostas */}
      {props.length > 0 && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <strong style={{ fontSize: 13, color: ESP, display: 'flex', alignItems: 'center' }}>Ações propostas pela IA ({pendentes.length} a decidir)<AjudaCampo chave="industrial.plano_acao.reuniao_ia.acao_cartao" rota={rota} /></strong>
            {pendentes.length > 0 && <button type="button" style={btnSec} data-testid="reuniao-ia-confirmar-todas" onClick={() => void confirmarTodas()}>Confirmar todas<AjudaCampo chave="industrial.plano_acao.reuniao_ia.confirmar_todas" rota={rota} /></button>}
          </div>
          {props.map((p) => <CartaoProposta key={p.id} p={p} rota={rota} onConfirmar={confirmar} onDescartar={descartar} />)}
        </div>
      )}
    </div>
  )
}

function CartaoProposta({ p, rota, onConfirmar, onDescartar }: {
  p: Proposta; rota: string; onConfirmar: (p: Proposta, campos: Record<string, unknown>) => void | Promise<void>; onDescartar: (p: Proposta) => void | Promise<void>
}) {
  const [oQue, setOQue] = useState(p.o_que ?? p.titulo ?? '')
  const [quem, setQuem] = useState(p.responsavel_nome ?? '')
  const [quando, setQuando] = useState(p.quando ?? '')
  const [prioridade, setPrioridade] = useState(p.prioridade || 'media')
  const [salvando, setSalvando] = useState(false)
  const decidida = p.status !== 'proposta'

  const confirmar = async () => {
    setSalvando(true)
    try { await onConfirmar(p, { o_que: oQue, titulo: oQue, responsavel_nome: quem, quando: quando || null, prioridade }) }
    finally { setSalvando(false) }
  }

  return (
    // data-ajuda cobre os campos do cartão (RD-95, régua _ajuda-lib); o "?" visível é o do cabeçalho "acao_cartao".
    <div style={{ ...box, borderColor: decidida ? LINE : GOLD, opacity: p.status === 'descartada' ? 0.55 : 1 }} data-ajuda="reuniao_ia.acao_cartao" data-testid="reuniao-ia-proposta">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: MUT, fontWeight: 700 }}>
          {p.status === 'confirmada' ? '✓ Virou ação' : p.status === 'descartada' ? 'Descartada' : 'Proposta'}
          {p.minuto ? ` · min ${p.minuto}` : ''}{p.confianca ? ` · confiança ${p.confianca}` : ''}
        </span>
        <span style={{ fontSize: 11, color: MUT }}>Prioridade sugerida: {PRI_ROTULO[p.prioridade] ?? p.prioridade}</span>
      </div>

      {/* data-ajuda nos campos do cartão: a ajuda visível é o "?" do cabeçalho (acao_cartao), que descreve os 5W2H. */}
      <div style={{ display: 'grid', gap: 8 }}>
        <label data-ajuda="acao_cartao">
          <span style={rotulo}>O que será feito</span>
          <textarea value={oQue} onChange={(e) => setOQue(e.target.value)} rows={2} disabled={decidida} style={{ ...inp, resize: 'vertical' }} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          <label data-ajuda="acao_cartao">
            <span style={rotulo}>Quem (responsável)</span>
            <input value={quem} onChange={(e) => setQuem(e.target.value)} disabled={decidida} placeholder="Nome citado" style={inp} />
          </label>
          <label data-ajuda="acao_cartao">
            <span style={rotulo}>Quando (prazo)</span>
            <input type="date" value={quando} onChange={(e) => setQuando(e.target.value)} disabled={decidida} style={inp} />
          </label>
          <label data-ajuda="acao_cartao">
            <span style={rotulo}>Prioridade</span>
            <select value={prioridade} onChange={(e) => setPrioridade(e.target.value)} disabled={decidida} style={{ ...inp, padding: '7px 9px' }}>
              <option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option>
            </select>
          </label>
        </div>
        {(p.por_que || p.onde || p.como || p.custo_estimado != null) && (
          <div style={{ fontSize: 12, color: MUT, display: 'grid', gap: 2 }}>
            {p.por_que && <span><b>Por quê:</b> {p.por_que}</span>}
            {p.onde && <span><b>Onde:</b> {p.onde}</span>}
            {p.como && <span><b>Como:</b> {p.como}</span>}
            {p.custo_estimado != null && <span><b>Quanto:</b> R$ {Number(p.custo_estimado).toLocaleString('pt-BR')}</span>}
          </div>
        )}
        {p.evidencia && <div style={{ fontSize: 11, color: MUT, fontStyle: 'italic', borderLeft: `2px solid ${LINE}`, paddingLeft: 8 }}>“{p.evidencia}”</div>}
      </div>

      {!decidida && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button type="button" style={{ ...btn, opacity: salvando || !oQue.trim() ? 0.5 : 1 }} disabled={salvando || !oQue.trim()} data-testid="reuniao-ia-confirmar" onClick={() => void confirmar()}>
            {salvando ? 'Criando…' : 'Confirmar'}<AjudaCampo chave="industrial.plano_acao.reuniao_ia.confirmar" rota={rota} />
          </button>
          <button type="button" style={btnSec} data-testid="reuniao-ia-descartar" onClick={() => void onDescartar(p)}>Descartar<AjudaCampo chave="industrial.plano_acao.reuniao_ia.descartar" rota={rota} /></button>
        </div>
      )}
    </div>
  )
}
