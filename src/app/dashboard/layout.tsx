'use client'

import HelpWidget from '@/components/HelpWidget'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PLANO_MODULOS, isAdminRole, type Plano } from '@/lib/planos'

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

const DIAS_MAP: Record<string, number> = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 }

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [plano, setPlano] = useState<string>('erp_cs')
  const [demo, setDemo] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [blockMsg, setBlockMsg] = useState('')
  const [timeoutWarning, setTimeoutWarning] = useState(false)
  const [timeoutSeconds, setTimeoutSeconds] = useState(0)
  const lastActivity = useRef(Date.now())
  const timeoutMinutes = useRef(30) // default 30 min

  // Track user activity
  const updateActivity = useCallback(() => {
    lastActivity.current = Date.now()
    setTimeoutWarning(false)
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ps_demo_mode')
      if (saved === 'true') setDemo(true)
    }
    // Activity listeners
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']
    events.forEach(e => window.addEventListener(e, updateActivity, { passive: true }))
    return () => events.forEach(e => window.removeEventListener(e, updateActivity))
  }, [updateActivity])

  const toggleDemo = () => {
    setDemo(d => {
      const next = !d
      if (typeof window !== 'undefined') localStorage.setItem('ps_demo_mode', String(next))
      return next
    })
  }

  // Session timeout checker — runs every 15s
  useEffect(() => {
    const interval = setInterval(() => {
      if (isAdminRole(role)) return // admin never times out
      const elapsed = (Date.now() - lastActivity.current) / 1000 / 60
      const limit = timeoutMinutes.current
      if (limit <= 0) return // no timeout configured
      
      if (elapsed >= limit) {
        supabase.auth.signOut().then(() => router.push('/login'))
        return
      }
      // Warning at 2 min before timeout
      if (elapsed >= limit - 2) {
        setTimeoutWarning(true)
        setTimeoutSeconds(Math.round((limit - elapsed) * 60))
      } else {
        setTimeoutWarning(false)
      }
    }, 15000)
    return () => clearInterval(interval)
  }, [role, router])

  // Time restriction checker
  function checkTimeRestriction(config: any) {
    if (!config || !config.ativo) return true
    const now = new Date()
    const dia = now.getDay() // 0=dom, 1=seg...
    const hora = now.getHours() * 100 + now.getMinutes()
    
    // Check day
    const diasPermitidos = config.dias_semana || ['seg','ter','qua','qui','sex','sab','dom']
    const diaHoje = Object.entries(DIAS_MAP).find(([, v]) => v === dia)?.[0] || ''
    if (!diasPermitidos.includes(diaHoje)) {
      setBlockMsg(`Acesso permitido apenas nos dias: ${diasPermitidos.join(', ').toUpperCase()}`)
      return false
    }
    
    // Check hour
    const inicio = parseInt((config.horario_inicio || '00:00').replace(':', ''))
    const fim = parseInt((config.horario_fim || '23:59').replace(':', ''))
    if (hora < inicio || hora > fim) {
      setBlockMsg(`Acesso permitido apenas das ${config.horario_inicio} às ${config.horario_fim}`)
      return false
    }
    return true
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      setEmail(session.user.email || '')
      const { data: up } = await supabase.from('users').select('role').eq('id', session.user.id).single()
      const userRole = up?.role || session.user.user_metadata?.role || 'viewer'
      setRole(userRole)

      // Load access config for this role
      if (!isAdminRole(userRole)) {
        const { data: config } = await supabase.from('access_config').select('*').eq('role', userRole).eq('ativo', true).single()
        if (config) {
          timeoutMinutes.current = config.timeout_minutos || 30
          if (!checkTimeRestriction(config)) {
            setBlocked(true)
          }
        }
        // Read company plan
        const empresaSel = typeof window !== 'undefined' ? localStorage.getItem('ps_empresa_sel') : null
        if (empresaSel && empresaSel !== 'consolidado' && !empresaSel.startsWith('group_')) {
          const { data: comp } = await supabase.from('companies').select('plano').eq('id', empresaSel).single()
          if (comp?.plano) setPlano(comp.plano)
        } else {
          const { data: uc } = await supabase.from('user_companies').select('company_id').eq('user_id', session.user.id)
          if (uc?.length) {
            const { data: comps } = await supabase.from('companies').select('plano').in('id', uc.map(u => u.company_id))
            const planOrder = ['wealth', 'assessoria', 'industrial', 'bpo', 'erp_cs']
            const bestPlan = comps?.map(c => c.plano || 'erp_cs').sort((a, b) => planOrder.indexOf(a) - planOrder.indexOf(b))[0] || 'erp_cs'
            setPlano(bestPlan)
          }
        }
      }
    })
  }, [router])

  // Re-check time restriction every 5 min
  useEffect(() => {
    if (isAdminRole(role) || blocked) return
    const interval = setInterval(async () => {
      const { data: config } = await supabase.from('access_config').select('*').eq('role', role).eq('ativo', true).single()
      if (config && !checkTimeRestriction(config)) setBlocked(true)
    }, 300000) // 5 min
    return () => clearInterval(interval)
  }, [role, blocked])

  const isAdm = isAdminRole(role)

  const visibleMenu = MENU.filter(item => {
    if (isAdm) return true
    const modPerms = PLANO_MODULOS[item.modKey]
    if (!modPerms) return true
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

  // Blocked screen
  if (blocked) return (
    <div style={{ minHeight: '100vh', background: '#0F0F0F', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#1A1410', borderRadius: 16, padding: 40, border: '1px solid #2A2822', textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#EF4444', marginBottom: 8 }}>Acesso Restrito</div>
        <div style={{ fontSize: 13, color: '#B0AB9F', marginBottom: 20 }}>{blockMsg}</div>
        <div style={{ fontSize: 11, color: '#706C64', marginBottom: 16 }}>Contate o administrador se precisar de acesso fora do horário.</div>
        <button onClick={signOut} style={{ padding: '10px 24px', borderRadius: 8, background: '#C8941A', color: '#3D2314', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>Sair</button>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#0F0F0F', color: '#FAF7F2' }}>
      {/* Timeout warning banner */}
      {timeoutWarning && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, background: '#EF444420', borderBottom: '1px solid #EF444440', padding: '6px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: '#EF4444', fontWeight: 600 }}>Sessão expira em {timeoutSeconds}s por inatividade</span>
          <button onClick={updateActivity} style={{ padding: '4px 12px', borderRadius: 6, background: '#22C55E20', border: '1px solid #22C55E40', color: '#22C55E', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>Continuar</button>
        </div>
      )}

      <header style={{
        position: 'sticky', top: timeoutWarning ? 33 : 0, zIndex: 50,
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

        <button onClick={toggleDemo} style={{ ...st(demo), cursor:'pointer' }}>
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
