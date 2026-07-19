'use client'

// Placeholder ÚNICO e neutro (qualquer área) para itens de menu ativos ainda sem tela — status
// "Previsto" no menu. Evita 404: em vez de a RPC sintetizar um caminho morto, o item aponta pra cá.
// Mesmo desenho do previsto/[slug] da Gestão Empresarial (RD-26), porém sem amarrar a uma área.
// Lê o módulo por id (slug), mostra nome/descrição/prioridade + botão "Voltar ao início".

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type Modulo = { id: string; nome: string; grupo: string | null; descricao: string | null; prioridade: string | null }

const C = { espresso: '#3D2314', offWhite: '#FAF7F2', dourado: '#C8941A', cinza: '#E7DECF' }

function Badge({ texto, cor, bg }: { texto: string; cor: string; bg: string }) {
  return (
    <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', background: bg, color: cor }}>{texto}</span>
  )
}
function badgePrioridade(p: string | null) {
  const s = (p ?? 'media').toLowerCase()
  if (s === 'alta') return { texto: 'Prioridade alta', cor: '#7A1212', bg: '#FCE4E4' }
  if (s === 'baixa') return { texto: 'Prioridade baixa', cor: '#3D2314', bg: '#E7DECF' }
  return { texto: 'Prioridade média', cor: '#7A5A0F', bg: '#FEF3C7' }
}

export default function EmConstrucaoPage() {
  const params = useParams<{ slug: string }>()
  const slug = params?.slug ?? ''
  const [modulo, setModulo] = useState<Modulo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    void (async () => {
      const { data } = await supabase.from('module_catalog')
        .select('id, nome, grupo, descricao, prioridade').eq('id', slug).maybeSingle()
      if (!alive) return
      setModulo((data as Modulo | null) ?? null)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [slug])

  const nome = modulo?.nome ?? 'Funcionalidade'
  const prio = badgePrioridade(modulo?.prioridade ?? null)

  return (
    <div style={{ background: C.offWhite, minHeight: '100vh' }}>
      <header style={{ background: C.espresso, color: C.offWhite, padding: '20px 24px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <p style={{ margin: 0, fontSize: 11, color: C.dourado, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>PS Gestão</p>
          <h1 style={{ margin: '8px 0 0', fontSize: 22, fontWeight: 700, color: C.offWhite }}>{loading ? 'Carregando…' : nome}</h1>
        </div>
      </header>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '24px 20px' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          <Badge texto="Previsto" cor={C.espresso} bg={C.cinza} />
          <Badge {...prio} />
        </div>

        <section style={{ background: '#fff', border: `0.5px solid ${C.cinza}`, borderRadius: 10, padding: 20, marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 14, color: 'rgba(61,35,20,0.65)', textTransform: 'uppercase', letterSpacing: 0.6 }}>O que essa função vai fazer</h2>
          <p style={{ margin: '10px 0 0', fontSize: 14, color: C.espresso, lineHeight: 1.55 }}>
            Esta função está prevista no roadmap. {modulo?.descricao || 'Em breve, a descrição detalhada.'}
          </p>
        </section>

        <section style={{ background: '#FFF9EE', border: `0.5px dashed ${C.dourado}`, borderRadius: 10, padding: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: '#7A5A0F' }}>Quer adiantar essa entrega? Fala com o time da PS — quem pede, antecipa.</p>
        </section>

        <div style={{ marginTop: 24 }}>
          <Link href="/dashboard" style={{ display: 'inline-block', padding: '10px 18px', borderRadius: 8, background: C.dourado, color: C.espresso, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>Voltar ao início</Link>
        </div>
      </main>
    </div>
  )
}
