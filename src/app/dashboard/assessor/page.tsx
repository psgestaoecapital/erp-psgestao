'use client'

import React from 'react'
import { useRouter } from 'next/navigation'

const C = { bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2', muted: '#B0AB9F', green: '#4CAF50', blue: '#42A5F5', teal: '#009688' }

const MODULOS = [
  { id: 'onboarding', label: 'Cadastro', desc: 'Cadastrar assessoria com white-label (logo, cores, nome)', icon: 'C', color: C.gold },
  { id: 'clientes', label: 'Clientes', desc: 'Gestao de clientes da assessoria', icon: 'U', color: C.blue },
  { id: 'diagnosticos', label: 'Diagnosticos', desc: 'Diagnostico inteligente via CSV ou conector ERP', icon: 'D', color: C.teal },
  { id: 'plano-acao', label: 'Plano de Acao', desc: 'Acoes monitoradas com prazo, responsavel e progresso', icon: 'P', color: C.green },
  { id: 'dashboard-ceo', label: 'Dashboard CEO', desc: 'Visao executiva para o empresario: KPIs, ABC, fluxo de caixa', icon: 'E', color: '#FF9800' },
]

export default function AssessorPage() {
  const router = useRouter()

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.text }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: C.gold, margin: 0 }}>PS Assessor</h1>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Plataforma SaaS white-label para assessorias empresariais</div>
      </div>

      {/* Pricing */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { plano: 'Starter', preco: 'R$ 497/mes', clientes: '5 clientes', cor: C.muted },
          { plano: 'Pro', preco: 'R$ 1.497/mes', clientes: '20 clientes', cor: C.gold },
          { plano: 'Enterprise', preco: 'R$ 3.497/mes', clientes: 'Ilimitado', cor: C.teal },
        ].map((p, i) => (
          <div key={i} style={{ background: C.card, borderRadius: 8, padding: 14, borderTop: '3px solid ' + p.cor, textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: p.cor }}>{p.plano}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: '6px 0' }}>{p.preco}</div>
            <div style={{ fontSize: 10, color: C.muted }}>{p.clientes}</div>
          </div>
        ))}
      </div>

      {/* Modulos */}
      <div style={{ fontSize: 14, fontWeight: 700, color: C.gold, marginBottom: 10 }}>Modulos</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
        {MODULOS.map(m => (
          <div key={m.id} onClick={() => router.push('/dashboard/assessor/' + m.id)}
            style={{ background: C.card, borderRadius: 8, padding: 16, cursor: 'pointer', borderLeft: '3px solid ' + m.color, transition: '0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#241c14')}
            onMouseLeave={e => (e.currentTarget.style.background = C.card)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: m.color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18, color: m.color }}>{m.icon}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{m.label}</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{m.desc}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}