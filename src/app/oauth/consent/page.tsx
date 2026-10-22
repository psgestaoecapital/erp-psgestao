'use client'
// Canal PS · consentimento OAuth (CEO 07/10 16:20). O Supabase Auth do ERP é o servidor de autorização do conector MCP
// (/api/mcp); quando a Claude do sócio pede acesso, o Supabase manda o navegador para cá com ?authorization_id=…
// (configurar em Authentication › OAuth Server › "Authorization path" = /oauth/consent). O sócio entra com o PRÓPRIO
// usuário do ERP e permite (ou nega). A Claude passa a agir como ele — só com as ferramentas do Canal PS, pelas RPCs com
// guarda: chamados só da carteira dele e tarefas só para o Code dele.
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314', OFF = '#FAF7F2', DOU = '#C8941A', BRANCO = '#FFFFFF', BD = '#E7DED3', TXM = '#6B5D4F'

type Detalhes = { authorization_id: string; client: { name: string; uri: string }; user: { email: string }; scope?: string }

export default function ConsentimentoCanalPs() {
  const [id, setId] = useState<string | null>(null)
  const [logado, setLogado] = useState<boolean | null>(null)
  const [det, setDet] = useState<Detalhes | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const carregar = async (authId: string) => {
    const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authId)
    if (error) { setErro(`Não consegui ler o pedido de acesso: ${error.message}`); return }
    if (data && 'redirect_url' in data && data.redirect_url) { window.location.href = data.redirect_url; return }
    setDet(data as unknown as Detalhes)
  }

  useEffect(() => {
    const authId = new URLSearchParams(window.location.search).get('authorization_id')
    void (async () => {
      const { data } = await supabase.auth.getSession()
      setId(authId); setLogado(!!data.session)
      if (!authId) { setErro('Link de autorização incompleto (falta authorization_id). Comece de novo pela Claude.'); return }
      if (data.session) await carregar(authId)
    })()
  }, [])

  const entrar = async () => {
    setOcupado(true); setErro(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    setOcupado(false)
    if (error) { setErro('E-mail ou senha incorretos.'); return }
    setLogado(true)
    if (id) await carregar(id)
  }
  const decidir = async (permitir: boolean) => {
    if (!id) return
    setOcupado(true); setErro(null)
    const r = permitir ? await supabase.auth.oauth.approveAuthorization(id) : await supabase.auth.oauth.denyAuthorization(id)
    if (r.error) { setErro(r.error.message); setOcupado(false) }
  }

  const campo = { border: `1px solid ${BD}`, borderRadius: 8, padding: '10px 12px', color: ESP, background: OFF, fontFamily: 'inherit', fontSize: 14, width: '100%' } as const
  const botao = (primario: boolean) => ({ background: primario ? ESP : BRANCO, color: primario ? OFF : ESP, border: `1px solid ${ESP}`, borderRadius: 8,
    padding: '10px 18px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: ocupado ? 0.6 : 1 }) as const

  return (
    <main style={{ minHeight: '100vh', background: OFF, color: ESP, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}>
      <div data-testid="oauth-consent" style={{ background: BRANCO, border: `1px solid ${BD}`, borderTop: `4px solid ${DOU}`, borderRadius: 14, padding: 24, width: '100%', maxWidth: 440 }}>
        <div style={{ fontSize: 12, color: DOU, fontWeight: 700, letterSpacing: 0.5 }}>PS GESTÃO · CANAL PS</div>
        <h1 style={{ fontSize: 20, margin: '6px 0 12px' }}>Conectar a sua Claude ao ERP</h1>

        {erro && <div role="alert" style={{ background: '#FEE2E2', color: '#B91C1C', borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 12 }}>{erro}</div>}

        {logado === false && id && (
          <div style={{ display: 'grid', gap: 10 }}>
            <p style={{ fontSize: 14, margin: 0, color: TXM }}>Entre com o <b>seu</b> usuário do ERP para autorizar.</p>
            <input aria-label="E-mail" placeholder="E-mail" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} style={campo} />
            <input aria-label="Senha" placeholder="Senha" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void entrar() }} style={campo} />
            <button disabled={ocupado} onClick={() => void entrar()} style={botao(true)}>Entrar</button>
          </div>
        )}

        {det && (
          <div style={{ display: 'grid', gap: 12 }}>
            <p style={{ fontSize: 14, margin: 0 }}>
              <b>{det.client?.name || 'Um aplicativo'}</b> quer acessar o Canal PS como <b>{det.user?.email}</b>.
            </p>
            <ul style={{ fontSize: 13, color: TXM, margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
              <li>ver os chamados da <b>sua carteira</b> (e só eles);</li>
              <li>mandar tarefas ao <b>seu</b> Code e ler as respostas dele;</li>
              <li>ver as PRs do seu Code e pedir o OK do CEO para pedidos de núcleo.</li>
            </ul>
            <p style={{ fontSize: 12, color: TXM, margin: 0 }}>Nada além disso: sem acesso a outras empresas, sem SQL, e cada chamada fica registrada.</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button data-testid="oauth-permitir" disabled={ocupado} onClick={() => void decidir(true)} style={botao(true)}>Permitir</button>
              <button data-testid="oauth-negar" disabled={ocupado} onClick={() => void decidir(false)} style={botao(false)}>Negar</button>
            </div>
          </div>
        )}

        {logado && !det && !erro && <p style={{ fontSize: 14, color: TXM }}>Conferindo o pedido de acesso…</p>}
      </div>
    </main>
  )
}
