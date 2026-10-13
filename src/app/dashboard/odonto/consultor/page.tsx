'use client'
// IA-1.2 · Consultor IA da Clínica: o dono conversa com o sistema e recebe respostas com os números
// reais (fn_odonto_clinica_contexto_ia). Sob budget guard (origem odonto_consultor) + anti-alucinação.
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ShellOdonto, PageHeaderOdonto, CardOdonto, EmptyStateOdonto, BrandIcon, TOK } from '@/components/odonto/ui'
import { Sparkles, Send } from 'lucide-react'

type Turno = { role: 'user' | 'assistant'; content: string }
const CHIPS = ['Quem está sumindo?', 'Faturamento do mês?', 'Orçamentos aprovados sem agendar?', 'Como está a ocupação da agenda?', 'Quem está inadimplente?']

function useCompanyId(): string | null {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => { if (typeof window === 'undefined') return null; const v = localStorage.getItem('ps_empresa_sel'); return (!v || v === 'consolidado' || v.startsWith('group_')) ? null : v }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setId(read())
    const t = setInterval(() => { const v = read(); setId((p) => (p === v ? p : v)) }, 800)
    return () => clearInterval(t)
  }, [])
  return id
}

export default function ConsultorIaPage() {
  const companyId = useCompanyId()
  const [msgs, setMsgs] = useState<Turno[]>([])
  const [texto, setTexto] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const fimRef = useRef<HTMLDivElement>(null)

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, carregando])

  const perguntar = async (pergunta: string) => {
    const q = pergunta.trim()
    if (!q || !companyId || carregando) return
    setErro(null); setTexto('')
    const historico = msgs
    setMsgs((m) => [...m, { role: 'user', content: q }])
    setCarregando(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setErro('sessão'); setCarregando(false); return }
      const res = await fetch('/api/odonto/consultor', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ company_id: companyId, pergunta: q, historico }),
      })
      const j = await res.json() as { ok?: boolean; resposta?: string; error?: string }
      if (!res.ok || j.error) { setErro(j.error || 'falha'); setMsgs((m) => m.slice(0, -1)) }
      else setMsgs((m) => [...m, { role: 'assistant', content: j.resposta ?? '' }])
    } catch { setErro('falha de rede'); setMsgs((m) => m.slice(0, -1)) } finally { setCarregando(false) }
  }

  if (!companyId) return <ShellOdonto><EmptyStateOdonto titulo="Escolha uma clínica" linha="Selecione uma empresa específica no topo do menu para conversar com o consultor." /></ShellOdonto>

  return (
    <ShellOdonto>
      <PageHeaderOdonto icon={<BrandIcon><Sparkles size={20} /></BrandIcon>} titulo="Consultor IA da Clínica"
        subtitulo="Pergunte sobre a sua clínica — a IA responde com os números reais" />

      {msgs.length === 0 && !carregando ? (
        <CardOdonto style={{ padding: 18 }}>
          <div style={{ fontSize: 14, color: TOK.esp, marginBottom: 4 }}>Seu analista 24/7. Comece por uma pergunta:</div>
          <div style={{ fontSize: 12, color: TOK.mut, marginBottom: 12 }}>As respostas usam só os dados reais da sua clínica (pacientes, agenda, planos, financeiro). Se faltar o dado, ele avisa — não inventa.</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {CHIPS.map((c) => (
              <button key={c} onClick={() => void perguntar(c)} style={{ fontSize: 12.5, fontWeight: 600, padding: '7px 13px', borderRadius: 999, cursor: 'pointer', border: `0.5px solid ${TOK.line}`, background: '#fff', color: TOK.esp }}>{c}</button>
            ))}
          </div>
        </CardOdonto>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {msgs.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth: '85%', padding: '10px 13px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                background: m.role === 'user' ? TOK.gold : '#fff', color: m.role === 'user' ? '#fff' : TOK.esp,
                border: m.role === 'user' ? 'none' : `0.5px solid ${TOK.line}` }}>{m.content}</div>
            </div>
          ))}
          {carregando && <div style={{ fontSize: 12.5, color: TOK.mut }}>O consultor está analisando os números…</div>}
          <div ref={fimRef} />
        </div>
      )}

      {erro && <div style={{ fontSize: 12.5, color: TOK.mut, marginTop: 8 }}>Não deu para responder agora. Tente de novo.</div>}

      {/* barra de pergunta */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, position: 'sticky', bottom: 8 }}>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void perguntar(texto) }}
          placeholder="Pergunte sobre a sua clínica…" disabled={carregando}
          style={{ flex: 1, padding: '11px 14px', border: `0.5px solid ${TOK.line}`, borderRadius: 999, fontSize: 14, color: TOK.esp, background: '#fff', outline: 'none' }} />
        <button onClick={() => void perguntar(texto)} disabled={carregando || !texto.trim()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: TOK.gold, color: '#fff', border: 'none', borderRadius: 999, padding: '0 18px', fontSize: 14, fontWeight: 700, cursor: (carregando || !texto.trim()) ? 'not-allowed' : 'pointer', opacity: (carregando || !texto.trim()) ? 0.6 : 1 }}>
          <Send size={16} /> Enviar
        </button>
      </div>
    </ShellOdonto>
  )
}
