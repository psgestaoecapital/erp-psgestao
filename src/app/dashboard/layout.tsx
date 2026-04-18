'use client'

import HelpWidget from '@/components/HelpWidget'
import LgpdConsentModal from '@/components/LgpdConsentModal'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PLANO_MODULOS, PLANOS, isAdminRole, type Plano } from '@/lib/planos'

// ═══ NÚCLEO: módulos inclusos em todos os planos ═══
const NUCLEO = [
  { href: '/dashboard',              label: 'Visão Diária',  icon: '📅', modKey: 'visao-diaria' },
  { href: '/dashboard/dados',        label: 'Dados',         icon: '📊', modKey: 'dados' },
  { href: '/dashboard/operacional',  label: 'Operacional',   icon: '⚙️', modKey: 'operacional' },
  { href: '/dashboard/rateio',       label: 'Rateio',        icon: '⚗️', modKey: 'rateio' },
  { href: '/dashboard/orcamento',    label: 'Orçamento',     icon: '💰', modKey: 'orcamento' },
  { href: '/dashboard/importar',     label: 'Importar',      icon: '📥', modKey: 'importar' },
  { href: '/dashboard/ajuda',        label: 'Ajuda',         icon: '❓', modKey: 'ajuda' },
  { href: '/dashboard/consultor-ia', label: 'Consultor IA',  icon: '🤖', modKey: 'consultor-ia' },
  { href: '/dashboard/contador',     label: 'Contador',      icon: '📒', modKey: 'contador' },
  { href: '/dashboard/assessor',     label: 'PS Assessor',   icon: '🤝', modKey: 'assessor' },
  { href: '/dashboard/anti-fraude',  label: 'Anti-Fraude',   icon: '🛡️', modKey: 'anti-fraude-basico' },
  { href: '/dashboard/custeio',      label: 'Custeio',       icon: '🎯', modKey: 'custeio' },
]

// ═══ BOXES: módulos exclusivos por plano ═══
const PLAN_BOXES: { plano: Plano; items: { href: string; label: string; icon: string; modKey: string }[] }[] = [
  {
    plano: 'erp_cs',
    items: [
      { href: '/dashboard/viabilidade',  label: 'Viabilidade',     icon: '📈', modKey: 'viabilidade' },
    ],
  },
  {
    plano: 'industrial',
    items: [
      { href: '/dashboard/ficha-tecnica',label: 'Ficha Técnica',   icon: '📋', modKey: 'ficha-tecnica' },
      { href: '/dashboard/industrial',   label: 'Industrial',      icon: '🏭', modKey: 'industrial' },
      { href: '/dashboard/viabilidade',  label: 'Viabilidade',     icon: '📈', modKey: 'viabilidade' },
      { href: '/dashboard/custo',        label: 'Custo',           icon: '💲', modKey: 'custo' },
    ],
  },
  {
    plano: 'agro',
    items: [
      { href: '/dashboard/viabilidade',  label: 'Viabilidade',     icon: '📈', modKey: 'viabilidade' },
    ],
  },
  {
    plano: 'bpo',
    items: [
      { href: '/dashboard/noc',          label: 'NOC',             icon: '📡', modKey: 'noc' },
    ],
  },
  {
    plano: 'wealth',
    items: [
      { href: '/dashboard/wealth',       label: 'Wealth',          icon: '🏰', modKey: 'wealth' },
    ],
  },
  {
    plano: 'producao',
    items: [
      { href: '/dashboard/producao',     label: 'Produção',        icon: '🎨', modKey: 'producao' },
    ],
  },
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
  const [openBox, setOpenBox] = useState<string | null>(null)
  const lastActivity = useRef(Date.now())
  const timeoutMinutes = useRef(30)

  const updateActivity = useCallback(() => {
    lastActivity.current = Date.now()
    setTimeoutWarning(false)
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ps_demo_mode')
      if (saved === 'true') setDemo(true)
    }
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

  useEffect(() => {
    const interval = setInterval(() => {
      if (isAdminRole(role)) return
      const elapsed = (Date.now() - lastActivity.current) / 1000 / 60
      const limit = timeoutMinutes.current
      if (limit <= 0) return
      if (elapsed >= limit) {
        supabase.auth.signOut().then(() => router.push('/login'))
        return
      }
      if (elapsed >= limit - 2) {
        setTimeoutWarning(true)
        setTimeoutSeconds(Math.round((limit - elapsed) * 60))
      } else {
        setTimeoutWarning(false)
      }
    }, 15000)
    return () => clearInterval(interval)
  }, [role, router])

  function checkTimeRestriction(config: any) {
    if (!config || !config.ativo) return true
    const now = new Date()
    const dia = now.getDay()
    const hora = now.getHours() * 100 + now.getMinutes()
    const diasPermitidos = config.dias_semana || ['seg','ter','qua','qui','sex','sab','dom']
    const diaHoje = Object.entries(DIAS_MAP).find(([, v]) => v === dia)?.[0] || ''
    if (!diasPermitidos.includes(diaHoje)) {
      setBlockMsg(`Acesso permitido apenas nos dias: ${diasPermitidos.join(', ').toUpperCase()}`)
      return false
    }
    const inicio = parseInt((config.horario_inicio || '00:00').replace(':', ''))
    const fim = parseInt((config.horario_fim || '23:59').replace(':', ''))
    if (hora < inicio || hora > fim) {
      setBlockMsg(`Acesso permitido apenas das ${config.horario_inicio} às ${config.horario_fim}`)
      return false
    }
    return true
  }

  const logAudit = useCallback(async (action: string, detail?: string, mod?: string) => {
    try {
      await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: null, user_email: email, action, detail, module: mod })
      })
    } catch {}
  }, [email])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      const userEmail = session.user.email || ''
      setEmail(userEmail)
      const { data: up } = await supabase.from('users').select('role').eq('id', session.user.id).single()
      const userRole = up?.role || session.user.user_metadata?.role || 'viewer'
      setRole(userRole)

      fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: session.user.id, user_email: userEmail, action: 'login', detail: `Role: ${userRole}` })
      }).catch(() => {})

      if (!isAdminRole(userRole)) {
        const { data: config } = await supabase.from('access_config').select('*').eq('role', userRole).eq('ativo', true).single()
        if (config) {
          timeoutMinutes.current = config.timeout_minutos || 30
          if (!checkTimeRestriction(config)) {
            setBlocked(true)
            fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ user_id: session.user.id, user_email: userEmail, action: 'access_blocked', detail: blockMsg })
            }).catch(() => {})
          }
        }
        const empresaSel = typeof window !== 'undefined' ? localStorage.getItem('ps_empresa_sel') : null
        if (empresaSel && empresaSel !== 'consolidado' && !empresaSel.startsWith('group_')) {
          const { data: comp } = await supabase.from('companies').select('plano').eq('id', empresaSel).single()
          if (comp?.plano) setPlano(comp.plano)
        } else {
          const { data: uc } = await supabase.from('user_companies').select('company_id').eq('user_id', session.user.id)
          if (uc?.length) {
            const { data: comps } = await supabase.from('companies').select('plano').in('id', uc.map(u => u.company_id))
            const planOrder = ['wealth', 'assessoria', 'producao', 'industrial', 'agro', 'bpo', 'erp_cs']
            const bestPlan = comps?.map(c => c.plano || 'erp_cs').sort((a, b) => planOrder.indexOf(a) - planOrder.indexOf(b))[0] || 'erp_cs'
            setPlano(bestPlan)
          }
        }
      }
    })
  }, [router])

  useEffect(() => {
    if (isAdminRole(role) || blocked) return
    const interval = setInterval(async () => {
      const { data: config } = await supabase.from('access_config').select('*').eq('role', role).eq('ativo', true).single()
      if (config && !checkTimeRestriction(config)) setBlocked(true)
    }, 300000)
    return () => clearInterval(interval)
  }, [role, blocked])

  const lastPath = useRef('')
  useEffect(() => {
    if (email && pathname && pathname !== lastPath.current) {
      lastPath.current = pathname
      const mod = pathname.replace('/dashboard/', '').replace('/dashboard', 'home').split('/')[0]
      logAudit('page_visit', pathname, mod)
    }
  }, [pathname, email, logAudit])

  const isAdm = isAdminRole(role)

  const canSee = (modKey: string) => {
    if (isAdm) return true
    const modPerms = PLANO_MODULOS[modKey]
    if (!modPerms) return true
    const access = modPerms[plano as Plano]
    return access === 'full' || access === 'addon'
  }

  const visibleNucleo = NUCLEO.filter(item => canSee(item.modKey))
  const visibleBoxes = PLAN_BOXES.map(box => ({
    ...box,
    items: box.items.filter(item => canSee(item.modKey)),
    info: PLANOS[box.plano],
  })).filter(box => isAdm || box.items.length > 0)

  const signOut = async () => { logAudit('logout'); await supabase.auth.signOut(); router.push('/login') }

  const active = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : !!pathname?.startsWith(href)

  const iconSt = (on: boolean): React.CSSProperties => ({
    fontSize: 10, color: on ? '#C6973F' : '#B0AB9F', textDecoration: 'none',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
    minWidth: 40, cursor: 'pointer', padding: '3px 4px', borderRadius: 6,
    background: on ? '#C6973F12' : 'transparent',
    border: on ? '1px solid #C6973F30' : '1px solid transparent',
    fontWeight: on ? 600 : 400, transition: 'all 0.15s',
  })

  const navigateTo = (href: string) => { router.push(href); setOpenBox(null) }

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
      {timeoutWarning && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, background: '#EF444420', borderBottom: '1px solid #EF444440', padding: '6px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: '#EF4444', fontWeight: 600 }}>Sessão expira em {timeoutSeconds}s por inatividade</span>
          <button onClick={updateActivity} style={{ padding: '4px 12px', borderRadius: 6, background: '#22C55E20', border: '1px solid #22C55E40', color: '#22C55E', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>Continuar</button>
        </div>
      )}

      <header style={{ position: 'sticky', top: timeoutWarning ? 33 : 0, zIndex: 50, background: '#1A1410', borderBottom: '1px solid #2A2822' }}>

        {/* ═══ LINHA 1: Logo + Núcleo + User ═══ */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '4px 10px', overflowX: 'auto' }}>
          <a href='/dashboard' style={{ ...iconSt(false), minWidth: 48, marginRight: 2, color: '#C6973F', fontWeight: 700, fontSize: 9, letterSpacing: '0.06em' }}>
            <span style={{ fontSize: 15, fontWeight: 900 }}>PS</span>
            <span>GESTÃO</span>
          </a>

          <span style={{ fontSize: 8, color: '#C6973F80', padding: '2px 6px', textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap', flexShrink: 0 }}>Núcleo</span>

          {visibleNucleo.map(item => (
            <a key={item.href} href={item.href} style={iconSt(active(item.href))}
              onClick={e => { e.preventDefault(); navigateTo(item.href) }}>
              <span style={{ fontSize: 14 }}>{item.icon}</span>
              <span style={{ fontSize: 9 }}>{item.label}</span>
            </a>
          ))}

          <div style={{ flex: 1 }} />

          {email && (
            <span style={{ fontSize: 9, color: '#6B6560', whiteSpace: 'nowrap', marginRight: 4, filter: demo ? 'blur(6px)' : 'none' }}>
              {email.split('@')[0]}
            </span>
          )}
          <span style={{ fontSize: 9, color: '#C8941A', fontWeight: 600, whiteSpace: 'nowrap', padding: '2px 6px', background: '#C8941A15', borderRadius: 4, marginRight: 4 }}>v8.8.0</span>
          <button onClick={signOut} style={{ fontSize: 10, color: '#B0AB9F', background: 'transparent', border: '1px solid #2A2822', borderRadius: 6, cursor: 'pointer', padding: '4px 10px', whiteSpace: 'nowrap', flexShrink: 0 }}>Sair</button>
        </div>

        {/* ═══ LINHA 2: Planos + Admin ═══ */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '3px 10px', borderTop: '1px solid #2A2822', overflowX: 'auto' }}>
          <span style={{ fontSize: 8, color: '#C6973F', padding: '2px 6px', textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap', flexShrink: 0, background: '#C6973F10', borderRadius: 3, fontWeight: 600 }}>Planos</span>

          {visibleBoxes.map(box => {
            const isOpen = openBox === box.plano
            const hasActiveChild = box.items.some(i => active(i.href))
            return (
              <div key={box.plano} style={{ position: 'relative' }}>
                <button
                  onClick={() => {
                    if (box.items.length === 1) { navigateTo(box.items[0].href); return }
                    setOpenBox(isOpen ? null : box.plano)
                  }}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                    minWidth: 48, padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
                    background: isOpen || hasActiveChild ? box.info.cor + '15' : 'transparent',
                    border: `1px solid ${isOpen || hasActiveChild ? box.info.cor + '40' : box.info.cor + '20'}`,
                    color: isOpen || hasActiveChild ? box.info.cor : '#B0AB9F',
                    fontSize: 9, fontWeight: isOpen || hasActiveChild ? 600 : 400,
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: 14 }}>{box.info.icon}</span>
                  <span style={{ whiteSpace: 'nowrap' }}>{box.info.nome.replace('ERP ', '').replace('PS ', '')}</span>
                </button>

                {isOpen && box.items.length > 1 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                    marginTop: 6, background: '#1E1E1B', border: `1px solid ${box.info.cor}40`,
                    borderRadius: 10, padding: 10, zIndex: 999, minWidth: 170,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: box.info.cor, marginBottom: 8, textAlign: 'center', whiteSpace: 'nowrap', borderBottom: `1px solid ${box.info.cor}20`, paddingBottom: 6 }}>
                      {box.info.icon} {box.info.nome}
                    </div>
                    {box.items.map(item => (
                      <a key={item.href} href={item.href}
                        onClick={e => { e.preventDefault(); navigateTo(item.href) }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '7px 10px', borderRadius: 6, textDecoration: 'none',
                          background: active(item.href) ? box.info.cor + '15' : 'transparent',
                          border: active(item.href) ? `1px solid ${box.info.cor}30` : '1px solid transparent',
                          color: active(item.href) ? box.info.cor : '#B0AB9F',
                          fontSize: 12, fontWeight: active(item.href) ? 600 : 400,
                          cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: 2,
                        }}
                      >
                        <span style={{ fontSize: 14 }}>{item.icon}</span>
                        <span>{item.label}</span>
                      </a>
                    ))}
                    <div style={{ fontSize: 8, color: '#706C64', marginTop: 6, textAlign: 'center', borderTop: '1px solid #2A282240', paddingTop: 5 }}>{box.info.preco}</div>
                  </div>
                )}
              </div>
            )
          })}

          <div style={{ width: 1, height: 20, background: '#2A2822', margin: '0 3px', flexShrink: 0 }} />

          {isAdm && (
            <a href='/dashboard/admin' style={iconSt(active('/dashboard/admin'))}
              onClick={e => { e.preventDefault(); navigateTo('/dashboard/admin') }}>
              <span style={{ fontSize: 14 }}>⚙️</span>
              <span style={{ fontSize: 9 }}>Admin</span>
            </a>
          )}
          {isAdm && (
            <a href='/dashboard/dev' style={iconSt(active('/dashboard/dev'))}
              onClick={e => { e.preventDefault(); navigateTo('/dashboard/dev') }}>
              <span style={{ fontSize: 14 }}>🛠️</span>
              <span style={{ fontSize: 9 }}>Dev</span>
            </a>
          )}

          <button onClick={toggleDemo} style={{ ...iconSt(demo), cursor: 'pointer' }}>
            <span style={{ fontSize: 14 }}>🎭</span>
            <span style={{ fontSize: 9, color: demo ? '#C6973F' : '#B0AB9F' }}>{demo ? 'Demo ON' : 'Demo'}</span>
          </button>
        </div>
      </header>

      {openBox && <div onClick={() => setOpenBox(null)} style={{ position: 'fixed', inset: 0, zIndex: 48 }} />}

      {demo && (
        <style dangerouslySetInnerHTML={{ __html: [
          '.ps-demo .ps-blur{filter:blur(8px)!important;user-select:none!important}',
          '.ps-demo .demo-hide{filter:blur(8px)!important;user-select:none!important}',
          '.ps-demo td:not(:first-child){color:transparent!important;text-shadow:0 0 10px currentColor!important}',
        ].join('') }} />
      )}

      <main className={demo ? 'ps-demo' : ''}>{children}</main>
      <HelpWidget />
      <LgpdConsentModal />
      <div style={{ textAlign: 'center', padding: '12px 16px', borderTop: '1px solid #2A2822', background: '#1A1410', fontSize: 10, color: '#918C82' }}>
        <a href='/termos' target='_blank' style={{ color: '#C8941A', textDecoration: 'none', margin: '0 8px' }}>Termos de Uso</a>
        ·
        <a href='/privacidade' target='_blank' style={{ color: '#C8941A', textDecoration: 'none', margin: '0 8px' }}>Política de Privacidade</a>
        ·
        <a href='mailto:paravizi-salvi@gpconsultoriadeinvestimentos.com' style={{ color: '#C8941A', textDecoration: 'none', margin: '0 8px' }}>DPO</a>
        <div style={{ marginTop: 4, fontSize: 9, color: '#706C64' }}>PS Gestão e Capital LTDA · CNPJ 60.866.510/0001-78 · São Miguel do Oeste/SC</div>
      </div>
    </div>
  )
}
