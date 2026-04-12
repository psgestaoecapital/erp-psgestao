'use client'

import HelpWidget from '@/components/HelpWidget'


import React, { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const MENU = [
  { href: '/dashboard',                  label: 'Visao Diaria',  icon: '📅' },
  { href: '/dashboard/dados',             label: 'Dados',         icon: '📊' },
  { href: '/dashboard/rateio',            label: 'Rateio',        icon: '⚗️' },
  { href: '/dashboard/orcamento',         label: 'Orcamento',     icon: '💰' },
  { href: '/dashboard/ficha-tecnica',     label: 'Ficha Tecnica', icon: '📋' },
  { href: '/dashboard/viabilidade',       label: 'Viabilidade',   icon: '📈' },
  { href: '/dashboard/ajuda',             label: 'Ajuda',         icon: '❓' },
  { href: '/dashboard/industrial',        label: 'Industrial',    icon: '🏭' },
  { href: '/dashboard/custo',             label: 'Custo',         icon: '💲' },
  { href: '/dashboard/anti-fraude',       label: 'Anti-Fraude',   icon: '🛡️' },
  { href: '/dashboard/operacional',       label: 'Operacional',   icon: '⚙️' },
  { href: '/dashboard/importar',          label: 'Importar',      icon: '📥' },
  { href: '/dashboard/noc',               label: 'NOC',           icon: '📡' },
  { href: '/dashboard/wealth',            label: 'Wealth',        icon: '🏰' },
  { href: '/dashboard/consultor-ia',      label: 'Consultor IA',  icon: '🤖' },
  { href: '/dashboard/contador',          label: 'Contador',      icon: '📈' },
  { href: '/dashboard/assessor',         label: 'PS Assessor',   icon: '🤝' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [demo, setDemo] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      setEmail(session.user.email || '')
      setRole(session.user.user_metadata?.role || 'viewer')
    })
  }, [router])

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

        {MENU.map(item => (
          <a key={item.href} href={item.href} style={st(active(item.href))}
            onClick={e => { e.preventDefault(); router.push(item.href) }}>
            <span style={{ fontSize: 16 }}>{item.icon}</span>
            <span>{item.label}</span>
          </a>
        ))}

        {(role === 'admin' || role === 'acesso_total') && (
          <a href='/dashboard/admin' style={st(active('/dashboard/admin'))}
            onClick={e => { e.preventDefault(); router.push('/dashboard/admin') }}>
            <span style={{ fontSize: 16 }}>⚙️</span>
            <span>Admin</span>
          </a>
        )}

        {(role === 'admin' || role === 'acesso_total' || role === 'dev') && (
          <a href='/dashboard/dev' style={st(active('/dashboard/dev'))}
            onClick={e => { e.preventDefault(); router.push('/dashboard/dev') }}>
            <span style={{ fontSize: 16 }}>🛠️</span>
            <span>Dev</span>
          </a>
        )}

        {/* PS Assessor */}
        {(role === 'admin' || role === 'acesso_total' || role === 'assessor_admin' || role === 'assessor_usuario') && (
          <a href='/dashboard/assessor' style={st(active('/dashboard/assessor'))}
            onClick={e => { e.preventDefault(); router.push('/dashboard/assessor') }}>
            <span style={{ fontSize: 16 }}>🤝</span>
            <span>PS Assessor</span>
          </a>
        )}

        <div style={{ width:1, height:20, background:'#2A2822', margin:'0 4px', flexShrink:0 }} />

        <button onClick={() => setDemo(d => !d)} style={{
          ...st(demo), cursor:'pointer',
        }}>
          <span style={{ fontSize: 16 }}>🎭</span>
          <span style={{ color: demo ? '#C6973F':'#B0AB9F' }}>{demo ? 'Demo ON':'Demo'}</span>
        </button>

        <div style={{ flex: 1 }} />

        {email && (
          <span style={{ fontSize:9, color:'#6B6560', whiteSpace:'nowrap', marginRight:4 }}>
            {email.split('@')[0]}
          </span>
        )}

        <span style={{ fontSize: 9, color: '#C8941A', fontWeight: 600, whiteSpace: 'nowrap', padding: '2px 6px', background: '#C8941A15', borderRadius: 4, marginRight: 4 }}>v8.1.0</span>

        <button onClick={signOut} style={{
          fontSize:10, color:'#B0AB9F', background:'transparent',
          border:'1px solid #2A2822', borderRadius:6, cursor:'pointer',
          padding:'4px 10px', whiteSpace:'nowrap', flexShrink:0,
        }}>Sair</button>
      </header>

      {demo && (
        <style dangerouslySetInnerHTML={{ __html: '.demo-hide{filter:blur(4px)!important}' }} />
      )}

      <main>{children}</main>
      <HelpWidget />
    </div>
  )
}