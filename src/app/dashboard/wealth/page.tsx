// src/app/dashboard/wealth/page.tsx
// Placeholder PR-W1: rota /dashboard/wealth ativa, identidade visual PS,
// aguardando PRs Sprint 2 (W2 lista clientes, W3 IPS, W4 posicoes,
// W5 proventos). Backend Wealth completo ja em producao (12 tabelas,
// 8 RPCs, RLS multi-tenant LGPD, 5 templates IPS, 2 buckets storage).

'use client'

const C = {
  espresso: '#3D2314',
  espressoLt: '#5D4534',
  offwhite: '#FAF7F2',
  gold: '#C8941A',
  goldLt: '#FFF8EC',
  beigeLt: '#f5f0e8',
  borderLt: '#ece3d2',
  ink: '#1a1a1a',
  muted: 'rgba(61, 35, 20, 0.55)',
}

const proximas = [
  'Cadastro e listagem de clientes Wealth',
  'IPS (Investment Policy Statement) versionado',
  'Posições, transações e proventos por cliente',
  'Importação OFX/Excel das corretoras',
  'Relatórios PDF mensais com narrativa IA',
]

export default function WealthHomePage() {
  return (
    <div style={{ background: C.offwhite, minHeight: '100vh', color: C.ink, padding: '32px 24px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        {/* Header */}
        <header style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 80, height: 80, borderRadius: 40, background: C.espresso, marginBottom: 16 }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={C.gold} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>
            </svg>
          </div>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', color: C.gold, margin: 0 }}>Multi Family Office</p>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 36, fontWeight: 400, margin: '6px 0 6px', color: C.espresso }}>Wealth · MFO</h1>
          <p style={{ fontSize: 15, color: C.muted, margin: 0 }}>Gestão de patrimônio de clientes da consultoria PS Gestão</p>
        </header>

        {/* Card principal */}
        <section style={{ background: '#FFFFFF', borderRadius: 12, border: `1px solid ${C.gold}`, padding: 28, marginBottom: 16, boxShadow: '0 1px 3px rgba(61,35,20,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
            <div style={{ width: 44, height: 44, borderRadius: 8, background: C.goldLt, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.gold} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="20" height="8" rx="1"/><path d="M17 14v7"/><path d="M7 14v7"/><path d="M17 3v3"/><path d="M7 3v3"/><path d="M10 14 2.3 6.3"/><path d="m14 6 7.7 7.7"/><path d="m8 6 8 8"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, color: C.espresso, margin: '0 0 10px' }}>Módulo em construção</h2>
              <p style={{ fontSize: 14, color: C.espressoLt, lineHeight: 1.6, margin: '0 0 10px' }}>
                O backend Wealth está pronto em produção: <strong>12 tabelas</strong> com RLS multi-tenant LGPD,
                {' '}<strong>8 RPCs</strong> operacionais (cálculo de posição, snapshot mensal, validação IPS,
                cálculo de DY, consolidação familiar, importação, atualização de cotações, métricas) e
                {' '}<strong>5 templates IPS</strong> pré-configurados (Conservador → Agressivo).
              </p>
              <p style={{ fontSize: 14, color: C.espressoLt, lineHeight: 1.6, margin: '0 0 14px' }}>
                As próximas entregas trarão a interface completa para gestão das carteiras:
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {proximas.map((p) => (
                  <li key={p} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: C.espresso }}>
                    <span style={{ width: 6, height: 6, borderRadius: 6, background: C.gold, flexShrink: 0 }} />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Aviso privacidade */}
        <section style={{ background: '#FFFFFF', borderRadius: 8, border: `1px solid ${C.borderLt}`, padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.espresso} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <p style={{ fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.5 }}>
            Acesso restrito a admins e AAI/CFP responsáveis. Dados patrimoniais com RLS isolada por consultor (LGPD Art. 37).
          </p>
        </section>
      </div>
    </div>
  )
}
