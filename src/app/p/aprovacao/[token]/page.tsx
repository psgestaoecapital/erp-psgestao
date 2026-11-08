'use client'
// Página PÚBLICA de aprovação do JOB pelo cliente (sem login). O cliente abre pelo link que a agência envia,
// vê o job e Aprova ou Pede ajustes pelo celular. Fora do /dashboard (o middleware só protege /api/dev/*).
// Só o token dá acesso; a RPC SECURITY DEFINER devolve APENAS o job do token (nunca outro job/empresa).
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const C = { esp: '#3D2314', espM: '#6B5D4F', off: '#FAF7F2', cream: '#F0ECE3', gold: '#C8941A',
  border: '#E0D8CC', green: '#1F7A3D', greenSoft: '#DCFCE7', red: '#B91C1C', redSoft: '#FEE2E2', muted: 'rgba(61,35,20,0.55)' }
const brl = (n: number | null | undefined) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Job = {
  ok: boolean; erro?: string
  agencia?: string; cliente?: string; titulo?: string; numero?: string | null; descricao?: string | null
  valor?: number | null; prazo?: string | null; status?: string
  origem?: string | null; aprovado_por?: string | null; aprovado_em?: string | null; ajustes_em?: string | null
  disponivel?: boolean; ja_aprovado?: boolean
}

export default function AprovacaoJobPage() {
  const params = useParams()
  const token = params?.token as string
  const [j, setJ] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [nome, setNome] = useState('')
  const [consent, setConsent] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [modoAjustes, setModoAjustes] = useState(false)
  const [ajustes, setAjustes] = useState('')
  const [resultado, setResultado] = useState<'aprovado' | 'ajustes' | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null

  const carregar = useCallback(async () => {
    if (!token) return
    setLoading(true)
    const { data, error } = await supabase.rpc('fn_pm_job_aprovacao_por_token', { p_token: token })
    const r = data as Job | null
    if (error || !r?.ok) setErro(r?.erro || 'não encontrado')
    else { setJ(r); if (r.ja_aprovado) setResultado('aprovado') }
    setLoading(false)
  }, [token])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const aprovar = async () => {
    if (!consent || enviando) return
    setEnviando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_pm_job_aprovar_publico', { p_token: token, p_nome: nome || null, p_ip: null, p_user_agent: ua })
    const r = data as { ok?: boolean; erro?: string } | null
    setEnviando(false)
    if (error || !r?.ok) { setErro(r?.erro || 'Não foi possível registrar a aprovação. Tente novamente.'); return }
    setResultado('aprovado')
  }
  const pedirAjustes = async () => {
    if (enviando) return
    setEnviando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_pm_job_solicitar_ajustes_publico', { p_token: token, p_texto: ajustes || null, p_nome: nome || null, p_ip: null, p_user_agent: ua })
    const r = data as { ok?: boolean; erro?: string } | null
    setEnviando(false)
    if (error || !r?.ok) { setErro(r?.erro || 'Não foi possível registrar o seu pedido. Tente novamente.'); return }
    setResultado('ajustes')
  }

  return (
    <Shell agencia={j?.agencia}>
      {loading ? (
        <p style={{ textAlign: 'center', color: C.muted, fontSize: 14 }}>Carregando o job…</p>
      ) : erro && !j ? (
        <Estado emoji="🔍" titulo="Job não encontrado" linha="Confira o link com a agência — ele pode ter sido digitado errado ou já não estar disponível." />
      ) : resultado === 'aprovado' ? (
        <Estado emoji="✅" titulo="Job aprovado!" linha={`Obrigado${nome ? `, ${nome}` : ''}! A ${j?.agencia ?? 'agência'} recebeu a sua aprovação e vai dar sequência. Pode fechar esta página.`} cor={C.green} />
      ) : resultado === 'ajustes' ? (
        <Estado emoji="✍️" titulo="Pedido de ajustes enviado" linha={`A ${j?.agencia ?? 'agência'} recebeu o seu pedido e vai revisar o job. Você receberá um novo link quando estiver pronto.`} />
      ) : !j?.disponivel ? (
        <Estado emoji="⏳" titulo="Este job não está aguardando aprovação" linha="Pode ser que ele já tenha sido aprovado ou ainda esteja em produção. Fale com a agência se tiver dúvida." />
      ) : (
        <>
          <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 22, color: C.esp, margin: '0 0 4px' }}>Olá{j?.cliente ? `, ${j.cliente}` : ''}!</h2>
          <p style={{ color: C.espM, fontSize: 14, margin: '0 0 18px' }}>A {j?.agencia ?? 'agência'} enviou este trabalho para a sua aprovação. Dê uma olhada e, se estiver tudo certo, é só aprovar. 👇</p>

          <div style={card}>
            <div style={cardTit}>Trabalho{j?.numero ? ` · nº ${j.numero}` : ''}</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.esp, marginBottom: 6 }}>{j?.titulo}</div>
            {j?.descricao && <p style={{ fontSize: 14, color: C.espM, margin: '0 0 8px', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{j.descricao}</p>}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: C.espM }}>
              {typeof j?.valor === 'number' && j.valor > 0 && <span>Valor: <strong style={{ color: C.gold }}>{brl(j.valor)}</strong></span>}
              {j?.prazo && <span>Prazo: {new Date(j.prazo + 'T00:00:00').toLocaleDateString('pt-BR')}</span>}
            </div>
          </div>

          <label style={{ display: 'block', fontSize: 12.5, color: C.espM, marginBottom: 6 }}>Seu nome (para registrarmos quem aprovou)</label>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Como você se chama?"
            style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', fontSize: 15, color: C.esp, background: '#fff', marginBottom: 14 }} />

          {!modoAjustes ? (
            <>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 2, width: 18, height: 18, accentColor: C.gold, flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: C.esp, lineHeight: 1.5 }}>Confirmo que revisei este trabalho e o aprovo. Concordo com o registro desta aprovação (data, origem e identificação) para fins de comprovação — LGPD.</span>
              </label>

              {erro && <div style={{ background: C.redSoft, color: '#991B1B', padding: '10px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{erro}</div>}

              <button onClick={() => void aprovar()} disabled={!consent || enviando}
                style={{ width: '100%', minHeight: 54, borderRadius: 12, border: 'none', background: (consent && !enviando) ? C.green : C.border, color: '#fff', fontSize: 16, fontWeight: 800, cursor: (consent && !enviando) ? 'pointer' : 'not-allowed', marginBottom: 10 }}>
                {enviando ? 'Registrando…' : '✓ Aprovar trabalho'}
              </button>
              <button onClick={() => { setModoAjustes(true); setErro(null) }} disabled={enviando}
                style={{ width: '100%', minHeight: 44, borderRadius: 12, border: `1px solid ${C.border}`, background: '#fff', color: C.espM, fontSize: 13.5, fontWeight: 600, cursor: enviando ? 'not-allowed' : 'pointer' }}>
                Pedir ajustes
              </button>
            </>
          ) : (
            <>
              <label style={{ display: 'block', fontSize: 12.5, color: C.espM, marginBottom: 6 }}>O que você gostaria de ajustar?</label>
              <textarea value={ajustes} onChange={(e) => setAjustes(e.target.value)} rows={4} placeholder="Descreva o que precisa mudar…"
                style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', fontSize: 15, color: C.esp, background: '#fff', marginBottom: 12, resize: 'vertical' }} />

              {erro && <div style={{ background: C.redSoft, color: '#991B1B', padding: '10px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{erro}</div>}

              <button onClick={() => void pedirAjustes()} disabled={enviando}
                style={{ width: '100%', minHeight: 54, borderRadius: 12, border: 'none', background: enviando ? C.border : C.esp, color: '#fff', fontSize: 16, fontWeight: 800, cursor: enviando ? 'not-allowed' : 'pointer', marginBottom: 10 }}>
                {enviando ? 'Enviando…' : 'Enviar pedido de ajustes'}
              </button>
              <button onClick={() => { setModoAjustes(false); setErro(null) }} disabled={enviando}
                style={{ width: '100%', minHeight: 44, borderRadius: 12, border: `1px solid ${C.border}`, background: '#fff', color: C.espM, fontSize: 13.5, fontWeight: 600, cursor: enviando ? 'not-allowed' : 'pointer' }}>
                Voltar
              </button>
            </>
          )}
        </>
      )}
    </Shell>
  )
}

function Shell({ children, agencia }: { children: React.ReactNode; agencia?: string }) {
  return (
    <div style={{ minHeight: '100vh', background: C.off, padding: 'clamp(12px,4vw,24px)', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <header style={{ textAlign: 'center', marginBottom: 22, paddingTop: 10 }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: C.esp }}>{agencia || 'Sua agência'}</div>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2, textTransform: 'uppercase', marginTop: 2 }}>Aprovação do trabalho</div>
        </header>
        {children}
        <footer style={{ marginTop: 30, paddingTop: 14, borderTop: `1px solid ${C.border}`, fontSize: 10, color: C.muted, textAlign: 'center' }}>
          Aprovação digital com registro de integridade · LGPD
        </footer>
      </div>
    </div>
  )
}

function Estado({ emoji, titulo, linha, cor }: { emoji: string; titulo: string; linha: string; cor?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: 20 }}>
      <div style={{ fontSize: 56, marginBottom: 12 }}>{emoji}</div>
      <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 24, color: cor || C.esp, margin: '0 0 8px' }}>{titulo}</h2>
      <p style={{ color: C.espM, fontSize: 14, margin: 0, lineHeight: 1.5 }}>{linha}</p>
    </div>
  )
}

const card: React.CSSProperties = { background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 14 }
const cardTit: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: C.gold, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }
