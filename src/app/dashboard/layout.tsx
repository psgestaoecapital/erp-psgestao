'use client'

import HelpWidget from '@/components/HelpWidget'
import React, { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PLANO_MODULOS, isAdminRole, type Plano } from '@/lib/planos'

// Menu items with module key for permission check
const MENU: { href: string; label: string; icon: string; modKey: string }[] = [
  { href: '/dashboard',              label: 'Visao Diaria',  icon: '📅', modKey: 'visao-diaria' },
  { href: '/dashboard/dados',        label: 'Dados',         icon: '📊', modKey: 'dados' },
  { href: '/dashboard/rateio',       label: 'Rateio',        icon: '⚗️', modKey: 'rateio' },
  { href: '/dashboard/orcamento',    label: 'Orcamento',     icon: '💰', modKey: 'orcamento' },
  { href: '/dashboard/ficha-tecnica',label: 'Ficha Tecnica', icon: '📋', modKey: 'ficha-tecnica' },
  { href: '/dashboard/viabilidade',  label: 'Viabilidade',   icon: '📈', modKey: 'viabilidade' },
  { href: '/dashboard/ajuda',        label: 'Ajuda',         icon: '❓', modKey: 'ajuda' },
  { href: '/dashboard/industrial',   label: 'Industrial',    icon: '🏭', modKey: 'industrial' },
  { href: '/dashboard/custo',        label: 'Custo',         icon: '💲', modKey: 'custo' },
  { href: '/dashboard/anti-fraude',  label: 'Anti-Fraude',   icon: '🛡️', modKey: 'anti-fraude-basico' },
  { href: '/dashboard/operacional',  label: 'Operacional',   icon: '⚙️', modKey: 'operacional' },
  { href: '/dashboard/importar',     label: 'Importar',      icon: '📥', modKey: 'importar' },
  { href: '/dashboard/noc',          label: 'NOC',           icon: '📡', modKey: 'noc' },
  { href: '/dashboard/wealth',       label: 'Wealth',        icon: '🏰', modKey: 'wealth' },
  { href: '/dashboard/consultor-ia', label: 'Consultor IA',  icon: '🤖', modKey: 'consultor-ia' },
  { href: '/dashboard/contador',     label: 'Contador',      icon: '📈', modKey: 'contador' },
  { href: '/dashboard/assessor',     label: 'PS Assessor',   icon: '🤝', modKey: 'assessor' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [plano, setPlano] = useState<string>('erp_cs')
  const [demo, setDemo] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ps_demo_mode')
      if (saved === 'true') setDemo(true)
    }
  }, [])

  const toggleDemo = () => {
    setDemo(d => {
      const next = !d
      if (typeof window !== 'undefined') localStorage.setItem('ps_demo_mode', String(next))
      return next
    })
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      setEmail(session.user.email || '')
      // Read role from users table
      const { data: up } = await supabase.from('users').select('role').eq('id', session.user.id).single()
      const userRole = up?.role || session.user.user_metadata?.role || 'viewer'
      setRole(userRole)

      // Read selected company's plan
      if (!isAdminRole(userRole)) {
        const empresaSel = typeof window !== 'undefined' ? localStorage.getItem('ps_empresa_sel') : null
        if (empresaSel && empresaSel !== 'consolidado' && !empresaSel.startsWith('group_')) {
          const { data: comp } = await supabase.from('companies').select('plano').eq('id', empresaSel).single()
          if (comp?.plano) setPlano(comp.plano)
        } else {
          // User has specific companies — get the "best" plan
          const { data: uc } = await supabase.from('user_companies').select('company_id').eq('user_id', session.user.id)
          if (uc?.length) {
            const { data: comps } = await supabase.from('companies').select('plano').in('id', uc.map(u => u.company_id))
            // Use highest-tier plan
            const planOrder = ['wealth', 'assessoria', 'industrial', 'bpo', 'erp_cs']
            const bestPlan = comps?.map(c => c.plano || 'erp_cs').sort((a, b) => planOrder.indexOf(a) - planOrder.indexOf(b))[0] || 'erp_cs'
            setPlano(bestPlan)
          }
        }
      }
    })
  }, [router])

  const isAdm = isAdminRole(role)

  // Filter menu by plan
  const visibleMenu = MENU.filter(item => {
    if (isAdm) return true
    const modPerms = PLANO_MODULOS[item.modKey]
    if (!modPerms) return true // unknown module = show
    const access = modPerms[plano as Plano]
    return access === 'full' || access === 'addon'
  })

  const signOut = async () => { await supabase.auth.signOut(); router.push('/login') }

  const active = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : !!pathname?.startsWith(href)

  const st = (on: boolean): React.CSSProperties => ({
    fontSize: 10, color: on ? '#C6973F' : '#B0AB9F', textDecoration: 'none',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
    minWidth: 44, cursor: 'pointer', padding: '2px 4px', borderRadius: 6,
    background: on ? '#C6973F12' : 'transparent',
    border: on ? '1px solid #C6973F30' : '1px solid transparent',
    fontWeight: on ? 600 : 400,
  })

  return (
    <div style={{ minHeight: '100vh', background: '#0F0F0F', color: '#FAF7F2' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: '#1A1410', borderBottom: '1px solid #2A2822',
        padding: '6px 12px', display: 'flex', alignItems: 'center',
        gap: 4, overflowX: 'auto',
      }}>

        <a href='/dashboard' style={{
          ...st(false), minWidth: 52, marginRight: 6,
          color: '#C6973F', fontWeight: 700, fontSize: 9, letterSpacing: '0.06em'
        }}>
          <span style={{ fontSize: 16, fontWeight: 900 }}>PS</span>
          <span>GESTAO</span>
        </a>

        {visibleMenu.map(item => (
          <a key={item.href} href={item.href} style={st(active(item.href))}
            onClick={e => { e.preventDefault(); router.push(item.href) }}>
            <span style={{ fontSize: 16 }}>{item.icon}</span>
            <span>{item.label}</span>
          </a>
        ))}

        {isAdm && (
          <a href='/dashboard/admin' style={st(active('/dashboard/admin'))}
            onClick={e => { e.preventDefault(); router.push('/dashboard/admin') }}>
            <span style={{ fontSize: 16 }}>⚙️</span>
            <span>Admin</span>
          </a>
        )}

        {isAdm && (
          <a href='/dashboard/dev' style={st(active('/dashboard/dev'))}
            onClick={e => { e.preventDefault(); router.push('/dashboard/dev') }}>
            <span style={{ fontSize: 16 }}>🛠️</span>
            <span>Dev</span>
          </a>
        )}

        <div style={{ width:1, height:20, background:'#2A2822', margin:'0 4px', flexShrink:0 }} />

        <button onClick={toggleDemo} style={{
          ...st(demo), cursor:'pointer',
        }}>
          <span style={{ fontSize: 16 }}>🎭</span>
          <span style={{ color: demo ? '#C6973F':'#B0AB9F' }}>{demo ? 'Demo ON':'Demo'}</span>
        </button>

        <div style={{ flex: 1 }} />

        {email && (
          <span style={{ fontSize:9, color:'#6B6560', whiteSpace:'nowrap', marginRight:4, filter: demo ? 'blur(6px)' : 'none' }}>
            {email.split('@')[0]}
          </span>
        )}

        <span style={{ fontSize: 9, color: '#C8941A', fontWeight: 600, whiteSpace: 'nowrap', padding: '2px 6px', background: '#C8941A15', borderRadius: 4, marginRight: 4 }}>v8.7.5</span>

        <button onClick={signOut} style={{
          fontSize:10, color:'#B0AB9F', background:'transparent',
          border:'1px solid #2A2822', borderRadius:6, cursor:'pointer',
          padding:'4px 10px', whiteSpace:'nowrap', flexShrink:0,
        }}>Sair</button>
      </header>

      {demo && (
        <style dangerouslySetInnerHTML={{ __html: [
          '.ps-demo .ps-blur{filter:blur(8px)!important;user-select:none!important}',
          '.ps-demo .demo-hide{filter:blur(8px)!important;user-select:none!important}',
          '.ps-demo td:not(:first-child){color:transparent!important;text-shadow:0 0 10px currentColor!important}',
        ].join('') }} />
      )}

      <main className={demo ? 'ps-demo' : ''}>{children}</main>
      <HelpWidget />
    </div>
  )
}
