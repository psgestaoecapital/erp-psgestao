'use client'

// Raiz da Indústria. Antes mostrava uma grade de 200+ KPIs GERADOS COM Math.random() (mockup) — violava RD-98 p1
// (sem tela morta / sem dado ilustrativo na DEMO). O próprio banner já dizia que os indicadores REAIS estão na
// Inteligência da planta. Então a raiz passa a encaminhar para o painel real (/dashboard/inteligencia), com um
// destino honesto visível como fallback — nenhum número fabricado.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const DESTINO = '/dashboard/inteligencia'
const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', bd: '#E7DED3', m: '#6B5D4F' }

export default function IndustriaRaiz() {
  const router = useRouter()
  useEffect(() => { router.replace(DESTINO) }, [router])

  return (
    <div style={{ background: C.off, minHeight: '100%', color: C.esp, padding: 'clamp(16px, 4vw, 48px)' }}>
      <div style={{ maxWidth: 560, margin: '8vh auto 0', display: 'grid', gap: 14, textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: C.m }}>Indústria</div>
        <h1 style={{ margin: 0, fontFamily: 'Georgia, serif', fontWeight: 400, fontSize: 'clamp(22px, 3.2vw, 30px)' }}>
          Abrindo a Inteligência da planta
        </h1>
        <p style={{ margin: 0, fontSize: 15, color: C.m, lineHeight: 1.5 }}>
          Os indicadores reais da sua indústria ficam na Inteligência da planta — produção, abate, RH, produtividade e
          comercial, cada painel acende assim que houver operação lançada.
        </p>
        <div>
          <Link
            href={DESTINO}
            style={{ display: 'inline-block', font: 'inherit', fontSize: 14, fontWeight: 600, padding: '10px 18px', borderRadius: 10, border: `1px solid ${C.esp}`, background: C.esp, color: '#fff', textDecoration: 'none' }}
          >
            Ir para a Inteligência da planta
          </Link>
        </div>
      </div>
    </div>
  )
}
