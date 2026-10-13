'use client'
// IA-1.5 · Página PÚBLICA de aceite do orçamento (sem login) — o paciente abre pelo link do WhatsApp,
// vê o plano bonito e Aceita pelo celular → vira contrato + a receber na GE (fn_odonto_proposta_aceitar).
// Fora do /dashboard (o middleware só protege /api/dev/*). Só o token dá acesso; não expõe a clínica.
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const C = { esp: '#3D2314', espM: '#6B5D4F', off: '#FAF7F2', cream: '#F0ECE3', gold: '#C8941A',
  border: '#E0D8CC', green: '#16A34A', greenSoft: '#DCFCE7', red: '#DC2626', redSoft: '#FEE2E2', muted: 'rgba(61,35,20,0.55)' }
const brl = (n: number) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Item = { descricao: string; dente: string | null; faces: string | null; valor: number }
type Proposta = { ok: boolean; erro?: string; status?: string; expirado?: boolean; clinica?: string; paciente?: string
  titulo?: string; itens?: Item[]; total?: number; desconto?: number; liquido?: number; parcelas?: number; entrada?: number; forma?: string
  expira_em?: string; respondido_em?: string }

const FORMA_L: Record<string, string> = { boleto: 'boleto', pix: 'PIX', cartao: 'cartão', dinheiro: 'dinheiro' }

export default function AceitePage() {
  const params = useParams()
  const token = params?.token as string
  const [p, setP] = useState<Proposta | null>(null)
  const [loading, setLoading] = useState(true)
  const [consent, setConsent] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<'aceita' | 'recusada' | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!token) return
    setLoading(true)
    const { data, error } = await supabase.rpc('fn_odonto_proposta_por_token', { p_token: token })
    const r = data as Proposta | null
    if (error || !r?.ok) setErro(r?.erro || 'não encontrado')
    else { setP(r); if (r.status === 'aceita') setResultado('aceita'); if (r.status === 'recusada') setResultado('recusada') }
    setLoading(false)
  }, [token])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const aceitar = async () => {
    if (!consent || enviando) return
    setEnviando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_odonto_proposta_aceitar', { p_token: token, p_ip: null, p_nome: p?.paciente ?? null })
    const r = data as { ok?: boolean; erro?: string } | null
    setEnviando(false)
    if (error || !r?.ok) { setErro(r?.erro || 'Não foi possível registrar o aceite. Tente novamente.'); return }
    setResultado('aceita')
  }
  const recusar = async () => {
    if (enviando) return
    if (!confirm('Tem certeza que deseja recusar este orçamento?')) return
    setEnviando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_odonto_proposta_recusar', { p_token: token, p_motivo: null })
    const r = data as { ok?: boolean; erro?: string } | null
    setEnviando(false)
    if (error || !r?.ok) { setErro(r?.erro || 'Não foi possível registrar.'); return }
    setResultado('recusada')
  }

  const parcelaValor = (): string => {
    if (!p) return ''
    const np = Math.max(1, p.parcelas ?? 1); const ent = Math.max(0, p.entrada ?? 0); const resto = Math.max(0, (p.liquido ?? 0) - ent)
    return `${np}x de ${brl(resto / np)}${ent > 0 ? ` (entrada ${brl(ent)})` : ''}`
  }

  return (
    <Shell clinica={p?.clinica}>
      {loading ? (
        <p style={{ textAlign: 'center', color: C.muted, fontSize: 14 }}>Carregando o seu orçamento…</p>
      ) : erro && !p ? (
        <Estado emoji="🔍" titulo="Orçamento não encontrado" linha="Confira o link com a sua clínica — ele pode ter expirado ou sido digitado errado." />
      ) : resultado === 'aceita' ? (
        <Estado emoji="✅" titulo="Orçamento aceito!" linha={`Combinado, ${p?.paciente ?? ''}! A ${p?.clinica ?? 'clínica'} já recebeu a sua confirmação e vai entrar em contato para agendar. Pode fechar esta página.`} cor={C.green} />
      ) : resultado === 'recusada' ? (
        <Estado emoji="🤝" titulo="Tudo bem!" linha="Registramos que este orçamento não seguirá agora. Se mudar de ideia, fale com a sua clínica." />
      ) : p?.expirado ? (
        <Estado emoji="⏰" titulo="Este link expirou" linha="Peça um novo orçamento à sua clínica para continuar." />
      ) : (
        <>
          <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 22, color: C.esp, margin: '0 0 4px' }}>Olá, {p?.paciente}!</h2>
          <p style={{ color: C.espM, fontSize: 14, margin: '0 0 18px' }}>Este é o seu plano de tratamento{p?.titulo ? ` · ${p.titulo}` : ''}. Dê uma olhada e, se estiver tudo certo, é só aceitar por aqui. 🦷</p>

          <div style={card}>
            <div style={cardTit}>Procedimentos ({p?.itens?.length ?? 0})</div>
            {(p?.itens ?? []).length === 0 ? (
              <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>Sem itens neste orçamento.</p>
            ) : (
              <div>
                {(p?.itens ?? []).map((it, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderTop: i ? `1px solid ${C.border}` : 'none' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: C.esp }}>{it.descricao}</div>
                      {(it.dente || it.faces) && <div style={{ fontSize: 11.5, color: C.muted }}>{it.dente ? `dente ${it.dente}` : ''}{it.faces ? ` · ${it.faces}` : ''}</div>}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.esp, whiteSpace: 'nowrap' }}>{brl(it.valor)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={card}>
            {(p?.desconto ?? 0) > 0 && (
              <div style={linha}><span style={{ color: C.espM }}>Subtotal</span><span>{brl(p?.total ?? 0)}</span></div>
            )}
            {(p?.desconto ?? 0) > 0 && (
              <div style={linha}><span style={{ color: C.green }}>Desconto</span><span style={{ color: C.green }}>- {brl(p?.desconto ?? 0)}</span></div>
            )}
            <div style={{ ...linha, borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 4 }}>
              <span style={{ fontWeight: 700, color: C.esp }}>Total</span>
              <span style={{ fontWeight: 800, fontSize: 20, color: C.gold }}>{brl(p?.liquido ?? 0)}</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 13, color: C.esp, background: C.cream, borderRadius: 8, padding: '8px 10px' }}>
              💳 {parcelaValor()} · {FORMA_L[p?.forma ?? 'boleto'] ?? p?.forma}
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 2, width: 18, height: 18, accentColor: C.gold, flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, color: C.esp, lineHeight: 1.5 }}>Li e concordo com o plano e os valores acima, e autorizo o início do tratamento. Concordo com o registro deste aceite (LGPD).</span>
          </label>

          {erro && <div style={{ background: C.redSoft, color: '#991B1B', padding: '10px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{erro}</div>}

          <button onClick={() => void aceitar()} disabled={!consent || enviando}
            style={{ width: '100%', minHeight: 54, borderRadius: 12, border: 'none', background: (consent && !enviando) ? C.green : C.border, color: '#fff', fontSize: 16, fontWeight: 800, cursor: (consent && !enviando) ? 'pointer' : 'not-allowed', marginBottom: 10 }}>
            {enviando ? 'Registrando…' : '✓ Aceitar orçamento'}
          </button>
          <button onClick={() => void recusar()} disabled={enviando}
            style={{ width: '100%', minHeight: 44, borderRadius: 12, border: `1px solid ${C.border}`, background: '#fff', color: C.espM, fontSize: 13.5, fontWeight: 600, cursor: enviando ? 'not-allowed' : 'pointer' }}>
            Agora não
          </button>
          {p?.expira_em && <p style={{ fontSize: 11, color: C.muted, textAlign: 'center', margin: '14px 0 0' }}>Válido até {new Date(p.expira_em).toLocaleDateString('pt-BR')}</p>}
        </>
      )}
    </Shell>
  )
}

function Shell({ children, clinica }: { children: React.ReactNode; clinica?: string }) {
  return (
    <div style={{ minHeight: '100vh', background: C.off, padding: 'clamp(12px,4vw,24px)', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <header style={{ textAlign: 'center', marginBottom: 22, paddingTop: 10 }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: C.esp }}>{clinica || 'Sua clínica'}</div>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2, textTransform: 'uppercase', marginTop: 2 }}>Orçamento odontológico</div>
        </header>
        {children}
        <footer style={{ marginTop: 30, paddingTop: 14, borderTop: `1px solid ${C.border}`, fontSize: 10, color: C.muted, textAlign: 'center' }}>
          Aceite digital com registro de integridade · LGPD
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
const linha: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', fontSize: 14, color: C.esp, padding: '3px 0' }
