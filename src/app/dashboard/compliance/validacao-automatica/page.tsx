'use client'

import Link from 'next/link'

export const dynamic = 'force-dynamic'

const C = {
  espresso: '#3D2314',
  offwhite: '#FAF7F2',
  gold: '#C8941A',
  beigeLt: '#f5f0e8',
  borderLt: '#ece3d2',
  ink: '#1a1a1a',
  muted: 'rgba(61, 35, 20, 0.55)',
  green: '#2d6a3e',
  greenBg: '#e8f3ec',
  amber: '#8a6a10',
  amberBg: '#fdf4e0',
  gray: '#6b6b6b',
}

export default function ValidacaoAutomaticaPlaceholderPage() {
  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
        <header style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>
            <Link href="/dashboard/compliance" style={{ color: 'inherit', textDecoration: 'none' }}>Compliance</Link>
            {' '}&gt;{' '}Validação Automática
          </p>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>
            Validação Automática
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: C.muted }}>
            Consulta automatizada de CNDT, CND Federal e CRF FGTS — Sprint C1.
          </p>
        </header>

        <section
          style={{
            background: 'white',
            borderRadius: 12,
            padding: '40px 32px',
            boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)',
            border: `1px solid ${C.borderLt}`,
            textAlign: 'center',
          }}
        >
          <SvgShield />

          <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, margin: '12px 0 4px', color: C.espresso }}>
            Validação Automática em construção
          </h2>
          <p style={{ margin: '0 auto 24px', fontSize: 14, color: C.muted, maxWidth: 520 }}>
            O backend já está ativo (APIs <code>/api/compliance/consultas</code> e
            <code> /api/compliance/worker</code>). A tela completa com KPIs, tabela e
            consulta avulsa chega no próximo PR.
          </p>

          <ul style={listaStatus()}>
            <ItemStatus
              cor={C.green}
              corBg={C.greenBg}
              titulo="3 provedores cadastrados"
              texto="cndt_tst · negativa_federal · negativa_fgts"
            />
            <ItemStatus
              cor={C.green}
              corBg={C.greenBg}
              titulo="Worker CNDT funcional"
              texto="Scrape do portal TST com extração de número, emissão e validade."
            />
            <ItemStatus
              cor={C.amber}
              corBg={C.amberBg}
              titulo="RFB e Caixa aguardando API licenciada"
              texto="Portais usam reCAPTCHA / CAPTCHA imagem — marcados como captcha_required até integração via Serpro / Serasa / gov.br Conecta+."
            />
          </ul>

          <div style={{ marginTop: 28 }}>
            <Link
              href="/dashboard/compliance"
              style={{
                padding: '12px 20px', borderRadius: 8,
                border: `1px solid ${C.borderLt}`,
                backgroundColor: 'white', color: C.espresso,
                fontSize: 13, fontWeight: 600,
                textDecoration: 'none', display: 'inline-block',
              }}
            >
              ← Voltar para Compliance
            </Link>
          </div>
        </section>
      </div>
    </div>
  )
}

function ItemStatus({ cor, corBg, titulo, texto }: { cor: string; corBg: string; titulo: string; texto: string }) {
  return (
    <li style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 12px', borderRadius: 8, background: C.beigeLt, marginBottom: 8 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: corBg, color: cor, fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
        ✓
      </span>
      <div style={{ textAlign: 'left' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.espresso }}>{titulo}</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{texto}</div>
      </div>
    </li>
  )
}

function listaStatus() {
  return {
    listStyle: 'none',
    padding: 0,
    margin: '12px auto 0',
    maxWidth: 520,
    textAlign: 'left' as const,
  }
}

function SvgShield() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={C.gold} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto', display: 'block' }}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}
