'use client'

// Pagina placeholder unica e parametrizada para os modulos da Gestao
// Empresarial marcados como "Previsto" no module_catalog (status='previsto'
// no feature_catalog). Le o slug da URL, busca o modulo correspondente e
// exibe nome, descricao, prioridade e badge. Identidade Espresso, mobile-first.

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type ModuloPrevisto = {
  id: string
  nome: string
  subgrupo: string | null
  descricao: string | null
  prioridade: string | null
}

const CORES = {
  espresso: '#3D2314',
  offWhite: '#FAF7F2',
  dourado: '#C8941A',
  cinzaSuave: '#E7DECF',
}

function Badge({ texto, cor, bg }: { texto: string; cor: string; bg: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '4px 10px', borderRadius: 999,
      fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
      background: bg, color: cor,
    }}>{texto}</span>
  )
}

function badgePrioridade(p: string | null) {
  const s = (p ?? 'media').toLowerCase()
  if (s === 'alta') return { texto: 'Prioridade alta', cor: '#7A1212', bg: '#FCE4E4' }
  if (s === 'baixa') return { texto: 'Prioridade baixa', cor: '#3D2314', bg: '#E7DECF' }
  return { texto: 'Prioridade media', cor: '#7A5A0F', bg: '#FEF3C7' }
}

export default function GestaoEmpresarialPrevistoPage() {
  const params = useParams<{ slug: string }>()
  const slug = params?.slug ?? ''
  const [modulo, setModulo] = useState<ModuloPrevisto | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setErro(null)
    void (async () => {
      const { data, error } = await supabase
        .from('module_catalog')
        .select('id, nome, subgrupo, descricao, prioridade')
        .eq('id', slug)
        .maybeSingle()
      if (!alive) return
      if (error) setErro(error.message)
      else setModulo(data as ModuloPrevisto | null)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [slug])

  if (loading) {
    return <div style={{ background: CORES.offWhite, minHeight: '100vh', padding: 32, color: CORES.espresso }}>Carregando…</div>
  }
  if (erro || !modulo) {
    return (
      <div style={{ background: CORES.offWhite, minHeight: '100vh', padding: 32, color: CORES.espresso }}>
        <p>Não encontrei essa funcionalidade. {erro ? `(${erro})` : ''}</p>
        <p style={{ marginTop: 12 }}>
          <Link href="/dashboard/gestao-empresarial" style={{ color: CORES.dourado, fontWeight: 600 }}>
            Voltar para a Gestão Empresarial
          </Link>
        </p>
      </div>
    )
  }

  const prio = badgePrioridade(modulo.prioridade)

  return (
    <div style={{ background: CORES.offWhite, minHeight: '100vh' }}>
      <header style={{
        background: CORES.espresso, color: CORES.offWhite, padding: '20px 24px',
      }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <p style={{ margin: 0, fontSize: 11, color: CORES.dourado, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>
            Gestão Empresarial
          </p>
          <h1 style={{ margin: '8px 0 0', fontSize: 22, fontWeight: 700, color: CORES.offWhite }}>
            {modulo.nome}
          </h1>
        </div>
      </header>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '24px 20px' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          <Badge texto="Previsto" cor="#3D2314" bg={CORES.cinzaSuave} />
          <Badge {...prio} />
        </div>

        <section style={{
          background: '#FFFFFF', border: `0.5px solid ${CORES.cinzaSuave}`,
          borderRadius: 10, padding: 20, marginBottom: 18,
        }}>
          <h2 style={{ margin: 0, fontSize: 14, color: 'rgba(61,35,20,0.65)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
            O que essa função vai fazer
          </h2>
          <p style={{ margin: '10px 0 0', fontSize: 14, color: CORES.espresso, lineHeight: 1.55 }}>
            Esta função está prevista. {modulo.descricao || 'Em breve descrição detalhada.'}
          </p>
        </section>

        <section style={{
          background: '#FFF9EE', border: `0.5px dashed ${CORES.dourado}`,
          borderRadius: 10, padding: 16,
        }}>
          <p style={{ margin: 0, fontSize: 13, color: '#7A5A0F' }}>
            Quer adiantar essa entrega? Fala com o time da PS — quem pede, antecipa.
          </p>
        </section>

        <div style={{ marginTop: 24 }}>
          <Link href="/dashboard/gestao-empresarial" style={{
            display: 'inline-block', padding: '10px 18px', borderRadius: 6,
            background: CORES.dourado, color: CORES.espresso,
            fontWeight: 700, fontSize: 13, textDecoration: 'none',
          }}>
            Voltar para a Gestão Empresarial
          </Link>
        </div>
      </main>
    </div>
  )
}
