'use client'

// ConversaChamado — o chamado é CONVERSA. Histórico de ida e volta + compositor de resposta.
// Usado na tela do autor (melhorias) E na fila PS (atendimento) — a MESMA conversa dos dois lados.
// Quem fala como quem: a RPC fn_sugestao_mensagem_enviar decide o papel por auth.uid() (autor do
// chamado × fila PS), o front não precisa mandar papel. O autor NÃO vê a leitura da IA (RD-51: IA é
// palpite pro atendente) — só o PS. Confirmar (funcionou/não) segue como ação SEPARADA, na tela do autor.

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { uploadFotoSugestao } from '@/lib/sugestaoUpload'
import FotoMarcador, { type FotoSel, type Marca } from './FotoMarcador'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', blue: '#2F5AA8', red: '#B42318', redBg: '#FDECEC',
}
const brDate = (d: string) => d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

type Anexo = { url: string; marcacoes: Marca[] }
type Msg = {
  id: string; papel: 'autor' | 'ps'; texto: string | null; autor_email: string | null; criado_em: string
  ia_analise: Record<string, string> | null; anexos: Anexo[]
}

export default function ConversaChamado({ sugestaoId, userId, ehSuporte, onAfterSend }: {
  sugestaoId: string
  userId: string
  ehSuporte: boolean
  onAfterSend?: () => void
}) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [carregando, setCarregando] = useState(true)
  const [texto, setTexto] = useState('')
  const [foto, setFoto] = useState<FotoSel>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [autorChamadoId, setAutorChamadoId] = useState<string | null>(null)
  const fimRef = useRef<HTMLDivElement>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    // o dono da pasta das fotos da conversa é o AUTOR do chamado (os dois lados leem — ver sugestaoUpload)
    const { data: sug } = await supabase.from('sugestoes').select('user_id').eq('id', sugestaoId).maybeSingle()
    setAutorChamadoId((sug as { user_id?: string } | null)?.user_id ?? null)
    const { data: rows } = await supabase.from('sugestao_mensagem')
      .select('id,papel,texto,autor_email,criado_em,ia_analise')
      .eq('sugestao_id', sugestaoId).order('criado_em', { ascending: true })
    const base = (rows as Omit<Msg, 'anexos'>[] ?? [])
    // anexos das mensagens (foto com marcação) — assina cada URL do bucket privado
    const { data: anx } = await supabase.from('sugestao_anexo')
      .select('mensagem_id, storage_path, marcacoes, ordem')
      .eq('sugestao_id', sugestaoId).not('mensagem_id', 'is', null).order('ordem')
    const porMsg: Record<string, Anexo[]> = {}
    for (const a of (anx as { mensagem_id: string; storage_path: string; marcacoes: Marca[] }[] ?? [])) {
      const { data: signed } = await supabase.storage.from('sugestoes-anexos').createSignedUrl(a.storage_path, 3600)
      if (signed?.signedUrl) (porMsg[a.mensagem_id] ||= []).push({ url: signed.signedUrl, marcacoes: Array.isArray(a.marcacoes) ? a.marcacoes : [] })
    }
    setMsgs(base.map((m) => ({ ...m, anexos: porMsg[m.id] || [] })))
    setCarregando(false)
  }, [sugestaoId])
  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => { if (msgs.length) setTimeout(() => fimRef.current?.scrollIntoView({ block: 'nearest' }), 40) }, [msgs.length])

  const enviar = useCallback(async () => {
    if (!texto.trim() && !foto) { setErro('Escreva uma mensagem ou anexe uma foto.'); return }
    setEnviando(true); setErro(null)
    try {
      let anexos: { storage_path: string; marcacoes: Marca[] }[] = []
      if (foto) {
        // pasta = autor do chamado (os dois lados leem). Fallback pro próprio uid se ainda não carregou.
        const path = await uploadFotoSugestao(foto.file, autorChamadoId ?? userId).catch((e) => { setErro('Falha ao enviar a foto: ' + String(e)); return null })
        if (path === null) { setEnviando(false); return }
        anexos = [{ storage_path: path, marcacoes: foto.marcas }]
      }
      const { data, error } = await supabase.rpc('fn_sugestao_mensagem_enviar', {
        p_sugestao_id: sugestaoId, p_user: userId, p_texto: texto.trim() || null, p_anexos: anexos,
      })
      const r = data as { ok?: boolean; erro?: string; mensagem_id?: string; tem_foto?: boolean } | null
      if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha ao enviar'); setEnviando(false); return }
      // se mandou foto, dispara a IA na foto NOVA (ligada à mensagem) — sem bloquear
      if (r.tem_foto && r.mensagem_id) {
        void supabase.functions.invoke('sugestao-analisar', { body: { mensagem_id: r.mensagem_id } }).catch(() => {})
      }
      setTexto(''); setFoto(null)
      await carregar()
      onAfterSend?.()
    } finally { setEnviando(false) }
  }, [texto, foto, sugestaoId, userId, autorChamadoId, carregar, onAfterSend])

  return (
    <div style={{ marginTop: 10, borderTop: `1px dashed ${C.border}`, paddingTop: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.espM, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>💬 Conversa do chamado</div>

      {carregando ? <div style={{ fontSize: 12, color: C.espL }}>carregando…</div> : msgs.length === 0 ? (
        <div style={{ fontSize: 12, color: C.espL, fontStyle: 'italic', marginBottom: 6 }}>Sem mensagens ainda. Escreva abaixo — dá pra anexar uma foto nova.</div>
      ) : (
        <div style={{ display: 'grid', gap: 8, marginBottom: 8 }}>
          {msgs.map((m) => {
            const daPS = m.papel === 'ps'
            return (
              <div key={m.id} style={{ display: 'flex', justifyContent: daPS ? 'flex-start' : 'flex-end' }}>
                <div style={{ maxWidth: '85%', background: daPS ? '#EEF3FB' : C.cream, border: `1px solid ${daPS ? '#D8E2F2' : C.border}`, borderRadius: 10, padding: '8px 10px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: daPS ? C.blue : C.espM, marginBottom: 2 }}>{daPS ? 'Equipe PS' : 'Você / autor'} · {brDate(m.criado_em)}</div>
                  {m.texto && <div style={{ fontSize: 12.5, color: C.esp, whiteSpace: 'pre-wrap' }}>{m.texto}</div>}
                  {m.anexos.map((a, ai) => (
                    <div key={ai} style={{ position: 'relative', display: 'inline-block', marginTop: 6, maxWidth: '100%' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.url} alt="" style={{ maxWidth: '100%', maxHeight: 320, borderRadius: 8, border: `1px solid ${C.border}`, display: 'block' }} />
                      {a.marcacoes.map((mk, mi) => (
                        <div key={mi} title={mk.texto} style={{ position: 'absolute', left: `${mk.x * 100}%`, top: `${mk.y * 100}%`, transform: 'translate(-50%,-50%)', width: 20, height: 20, borderRadius: 999, background: 'rgba(180,35,24,0.85)', color: '#fff', fontSize: 10.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff' }}>{mi + 1}</div>
                      ))}
                    </div>
                  ))}
                  {/* IA da foto desta mensagem — SÓ pro PS, sempre rotulada (RD-51) */}
                  {ehSuporte && m.ia_analise && (
                    <div style={{ marginTop: 6, background: '#F3F6FC', border: '1px solid #D8E2F2', borderRadius: 8, padding: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.blue, marginBottom: 2 }}>🤖 Leitura da IA (palpite)</div>
                      <div style={{ fontSize: 11.5, color: C.esp }}>{m.ia_analise.resumo}</div>
                      <div style={{ fontSize: 10.5, color: C.espM }}>tela: {m.ia_analise.tela_identificada || '—'} · sev.: {m.ia_analise.severidade || '—'} · passo: {m.ia_analise.proximo_passo || '—'}</div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          <div ref={fimRef} />
        </div>
      )}

      {erro && <div style={{ background: C.redBg, color: C.red, padding: '7px 10px', borderRadius: 8, fontSize: 12, marginBottom: 6 }} onClick={() => setErro(null)}>{erro}</div>}

      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10 }}>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={ehSuporte ? 'Responder ao autor…' : 'Escreva ou mande uma foto de um novo erro — o chamado volta pra equipe sem encerrar.'} rows={2}
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none', resize: 'vertical' }} />
        <div style={{ marginTop: 8 }}>
          <FotoMarcador value={foto} onChange={setFoto} compact />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button disabled={enviando || (!texto.trim() && !foto)} onClick={() => void enviar()}
            style={{ padding: '8px 16px', border: 'none', borderRadius: 8, background: (enviando || (!texto.trim() && !foto)) ? C.espL : C.gold, color: '#fff', fontWeight: 700, cursor: (enviando || (!texto.trim() && !foto)) ? 'not-allowed' : 'pointer', fontSize: 12.5 }}>
            {enviando ? 'Enviando…' : 'Enviar mensagem'}
          </button>
        </div>
      </div>
    </div>
  )
}
