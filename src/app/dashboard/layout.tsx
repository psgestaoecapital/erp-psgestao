'use client'

import HelpWidget from '@/components/HelpWidget'
import LgpdConsentModal from '@/components/LgpdConsentModal'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PLANO_MODULOS, PLANOS, isAdminRole, type Plano } from '@/lib/planos'

const THEME_LIGHT = `--ps-bg:#FAF7F2;--ps-bg2:#FFFFFF;--ps-bg3:#F0ECE3;--ps-text:#3D2314;--ps-text-m:#6B5D4F;--ps-text-d:#9C8E80;--ps-border:#E0D8CC;--ps-gold:#C8941A;--ps-gold-bg:#C8941A12;--ps-gold-border:#C8941A30;--ps-gold-text:#8B6512;--ps-header:#FFFFFF;--ps-header-border:#E8E0D4;`
const THEME_DARK = `--ps-bg:#0F0F0F;--ps-bg2:#1A1410;--ps-bg3:#1E1E1B;--ps-text:#FAF7F2;--ps-text-m:#B0AB9F;--ps-text-d:#706C64;--ps-border:#2A2822;--ps-gold:#C6973F;--ps-gold-bg:#C6973F12;--ps-gold-border:#C6973F30;--ps-gold-text:#C6973F;--ps-header:#1A1410;--ps-header-border:#2A2822;`

function parseRGB(val: string): [number, number, number] | null {
  const m = val.match(/(\d+),\s*(\d+),\s*(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function enforceLight(container: HTMLElement) {
  const els = container.querySelectorAll<HTMLElement>('[style]');
  els.forEach(el => {
    const bg = el.style.backgroundColor;
    if (bg) { const rgb = parseRGB(bg); if (rgb) { const mx = Math.max(...rgb); if (mx < 20) el.style.backgroundColor = '#FAF7F2'; else if (mx < 65) el.style.backgroundColor = '#FFFFFF'; } }
    if (!bg && el.style.background) { const rgb = parseRGB(el.style.background); if (rgb) { const mx = Math.max(...rgb); if (mx < 20) el.style.background = '#FAF7F2'; else if (mx < 65) el.style.background = '#FFFFFF'; } }
    const color = el.style.color;
    if (color) { const rgb = parseRGB(color); if (rgb) { const mn = Math.min(...rgb); const mx = Math.max(...rgb); const spread = mx - mn; if (mn > 210 && spread < 30) el.style.color = '#3D2314'; else if (mn > 150 && spread < 40) el.style.color = '#6B5D4F'; else if (mn > 85 && mx < 160 && spread < 30) el.style.color = '#9C8E80'; } }
    ['borderColor','borderTopColor','borderBottomColor','borderLeftColor','borderRightColor'].forEach(prop => { const val = (el.style as any)[prop]; if (val) { const rgb = parseRGB(val); if (rgb) { const mx = Math.max(...rgb); const spread = mx - Math.min(...rgb); if (mx < 70 && spread < 20) (el.style as any)[prop] = '#E0D8CC'; } } });
    if (el.style.boxShadow && el.style.boxShadow.includes('rgba(0')) { el.style.boxShadow = el.style.boxShadow.replace(/rgba\(0,\s*0,\s*0,\s*0\.[3-9]\d*\)/g, 'rgba(0,0,0,0.06)').replace(/rgba\(0,\s*0,\s*0,\s*1\)/g, 'rgba(0,0,0,0.08)'); }
  });
}

const NUCLEO = [
  { href: '/dashboard',          label: 'Visão Diária', icon: '📅', modKey: 'visao-diaria' },
  { href: '/dashboard/dados',    label: 'Dados',        icon: '📊', modKey: 'dados' },
  { href: '/dashboard/importar', label: 'Importar',     icon: '📥', modKey: 'importar' },
  { href: '/dashboard/ajuda',    label: 'Ajuda',        icon: '❓', modKey: 'ajuda' },
]

type MenuItem = { href: string; label: string; icon: string; modKey: string }
const I = {
  operacional:  { href: '/dashboard/operacional',  label: 'Operacional',  icon: '⚙️', modKey: 'operacional' } as MenuItem,
  produtos:     { href: '/dashboard/produtos',     label: 'Produtos',     icon: '📦', modKey: 'produtos' } as MenuItem,
  clientes:     { href: '/dashboard/clientes',     label: 'Clientes',     icon: '👥', modKey: 'clientes' } as MenuItem,
  fornecedores: { href: '/dashboard/fornecedores', label: 'Fornec.',      icon: '🚚', modKey: 'fornecedores' } as MenuItem,
  orcamentos:   { href: '/dashboard/orcamentos',   label: 'Orçamentos',   icon: '💰', modKey: 'orcamentos' } as MenuItem,
  pedidos:      { href: '/dashboard/pedidos',      label: 'Pedidos',      icon: '🎯', modKey: 'pedidos' } as MenuItem,
  os:           { href: '/dashboard/os',           label: 'OS',           icon: '📋', modKey: 'os' } as MenuItem,
  conciliacao:  { href: '/dashboard/conciliacao',  label: 'Conciliação',  icon: '🏦', modKey: 'conciliacao' } as MenuItem,
  contas:       { href: '/dashboard/contas',       label: 'Contas',       icon: '💳', modKey: 'contas' } as MenuItem,
  estoque:      { href: '/dashboard/estoque',      label: 'Estoque',      icon: '🗃️', modKey: 'estoque' } as MenuItem,
  score:        { href: '/dashboard/score',        label: 'Score IA',     icon: '🎯', modKey: 'score' } as MenuItem,
  cotacoes:     { href: '/dashboard/cotacoes',     label: 'Cotações',     icon: '📊', modKey: 'cotacoes' } as MenuItem,
  compras:      { href: '/dashboard/compras',      label: 'Compras',      icon: '🛒', modKey: 'compras' } as MenuItem,
  previsao:     { href: '/dashboard/previsao',     label: 'Previsão IA',  icon: '📈', modKey: 'previsao' } as MenuItem,
  rateio:       { href: '/dashboard/rateio',       label: 'Rateio',       icon: '⚗️', modKey: 'rateio' } as MenuItem,
  budget:       { href: '/dashboard/orcamento',    label: 'Budget',       icon: '📈', modKey: 'orcamento' } as MenuItem,
  viabilidade:  { href: '/dashboard/viabilidade',  label: 'Viabilidade',  icon: '🎯', modKey: 'viabilidade' } as MenuItem,
  consultorIa:  { href: '/dashboard/consultor-ia', label: 'Consultor IA', icon: '🤖', modKey: 'consultor-ia' } as MenuItem,
  contador:     { href: '/dashboard/contador',     label: 'Contador',     icon: '📒', modKey: 'contador' } as MenuItem,
  assessor:     { href: '/dashboard/assessor',     label: 'PS Assessor',  icon: '🤝', modKey: 'assessor' } as MenuItem,
  antiFraude:   { href: '/dashboard/anti-fraude',  label: 'Anti-Fraude',  icon: '🛡️', modKey: 'anti-fraude-basico' } as MenuItem,
  custeio:      { href: '/dashboard/custeio',      label: 'Custeio',      icon: '🎯', modKey: 'custeio' } as MenuItem,
  fichaTecnica: { href: '/dashboard/ficha-tecnica',label: 'Ficha Técnica',icon: '📋', modKey: 'ficha-tecnica' } as MenuItem,
  industrial:   { href: '/dashboard/industrial',   label: 'Industrial',   icon: '🏭', modKey: 'industrial' } as MenuItem,
  custo:        { href: '/dashboard/custo',        label: 'Custo',        icon: '💲', modKey: 'custo' } as MenuItem,
  noc:          { href: '/dashboard/noc',          label: 'NOC',          icon: '📡', modKey: 'noc' } as MenuItem,
  wealth:       { href: '/dashboard/wealth',       label: 'Wealth',       icon: '🏰', modKey: 'wealth' } as MenuItem,
  producao:     { href: '/dashboard/producao',     label: 'Produção',     icon: '🎨', modKey: 'producao' } as MenuItem,
}

const PLAN_BOXES: { plano: Plano; items: MenuItem[] }[] = [
  { plano: 'erp_cs', items: [I.produtos, I.estoque, I.clientes, I.fornecedores, I.operacional, I.contas, I.conciliacao, I.orcamentos, I.pedidos, I.os, I.cotacoes, I.compras, I.score, I.previsao, I.rateio, I.budget, I.viabilidade, I.consultorIa, I.contador, I.assessor, I.antiFraude, I.custeio] },
  { plano: 'industrial', items: [I.produtos, I.estoque, I.clientes, I.fornecedores, I.operacional, I.contas, I.conciliacao, I.orcamentos, I.pedidos, I.cotacoes, I.compras, I.score, I.previsao, I.rateio, I.budget, I.viabilidade, I.consultorIa, I.antiFraude, I.custeio, I.fichaTecnica, I.industrial, I.custo] },
  { plano: 'agro', items: [I.produtos, I.estoque, I.clientes, I.fornecedores, I.operacional, I.contas, I.conciliacao, I.orcamentos, I.pedidos, I.cotacoes, I.compras, I.score, I.previsao, I.rateio, I.budget, I.viabilidade, I.antiFraude, I.custeio] },
  { plano: 'bpo', items: [I.clientes, I.fornecedores, I.contas, I.conciliacao, I.score, I.previsao, I.consultorIa, I.contador, I.assessor, I.antiFraude, I.custeio, I.noc] },
  { plano: 'wealth', items: [I.wealth] },
  { plano: 'producao', items: [I.produtos, I.estoque, I.clientes, I.fornecedores, I.operacional, I.contas, I.conciliacao, I.orcamentos, I.pedidos, I.os, I.cotacoes, I.compras, I.score, I.previsao, I.rateio, I.budget, I.contador, I.antiFraude, I.producao] },
]

const DIAS_MAP: Record<string, number> = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 }

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const mainRef = useRef<HTMLDivElement>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [plano, setPlano] = useState<string>('erp_cs')
  const [demo, setDemo] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [blocked, setBlocked] = useState(false)
  const [blockMsg, setBlockMsg] = useState('')
  const [timeoutWarning, setTimeoutWarning] = useState(false)
  const [timeoutSeconds, setTimeoutSeconds] = useState(0)
  const lastActivity = useRef(Date.now())
  const timeoutMinutes = useRef(30)
  const isDark = theme === 'dark'

  const updateActivity = useCallback(() => { lastActivity.current = Date.now(); setTimeoutWarning(false) }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ps_demo_mode'); if (saved === 'true') setDemo(true)
      const savedTheme = localStorage.getItem('ps_theme'); if (savedTheme === 'dark' || savedTheme === 'light') setTheme(savedTheme)
    }
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']
    events.forEach(e => window.addEventListener(e, updateActivity, { passive: true }))
    return () => events.forEach(e => window.removeEventListener(e, updateActivity))
  }, [updateActivity])

  const toggleDemo = () => { setDemo(d => { const n = !d; if (typeof window !== 'undefined') localStorage.setItem('ps_demo_mode', String(n)); return n }) }
  const toggleTheme = () => { setTheme(t => { const n = t === 'light' ? 'dark' : 'light'; if (typeof window !== 'undefined') localStorage.setItem('ps_theme', n); return n }) }

  useEffect(() => {
    if (isDark || !mainRef.current) return;
    const run = () => { if (mainRef.current) enforceLight(mainRef.current); };
    const timers = [60, 200, 500, 1000, 2000, 4000].map(ms => setTimeout(run, ms));
    const observer = new MutationObserver(() => { requestAnimationFrame(run); });
    observer.observe(mainRef.current, { childList: true, subtree: true });
    return () => { timers.forEach(clearTimeout); observer.disconnect(); };
  }, [isDark, pathname])

  useEffect(() => {
    const interval = setInterval(() => {
      if (isAdminRole(role)) return
      const elapsed = (Date.now() - lastActivity.current) / 1000 / 60
      const limit = timeoutMinutes.current; if (limit <= 0) return
      if (elapsed >= limit) { supabase.auth.signOut().then(() => router.push('/login')); return }
      if (elapsed >= limit - 2) { setTimeoutWarning(true); setTimeoutSeconds(Math.round((limit - elapsed) * 60)) }
      else setTimeoutWarning(false)
    }, 15000)
    return () => clearInterval(interval)
  }, [role, router])

  function checkTimeRestriction(config: any) {
    if (!config || !config.ativo) return true
    const now = new Date(); const dia = now.getDay(); const hora = now.getHours() * 100 + now.getMinutes()
    const diasPermitidos = config.dias_semana || ['seg','ter','qua','qui','sex','sab','dom']
    const diaHoje = Object.entries(DIAS_MAP).find(([, v]) => v === dia)?.[0] || ''
    if (!diasPermitidos.includes(diaHoje)) { setBlockMsg(`Acesso permitido apenas nos dias: ${diasPermitidos.join(', ').toUpperCase()}`); return false }
    const inicio = parseInt((config.horario_inicio || '00:00').replace(':', ''))
    const fim = parseInt((config.horario_fim || '23:59').replace(':', ''))
    if (hora < inicio || hora > fim) { setBlockMsg(`Acesso permitido apenas das ${config.horario_inicio} às ${config.horario_fim}`); return false }
    return true
  }

  const logAudit = useCallback(async (action: string, detail?: string, mod?: string) => {
    try { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: null, user_email: email, action, detail, module: mod }) }) } catch {}
  }, [email])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      const userEmail = session.user.email || ''; setEmail(userEmail)
      const { data: up } = await supabase.from('users').select('role').eq('id', session.user.id).single()
      const userRole = up?.role || session.user.user_metadata?.role || 'viewer'; setRole(userRole)
      fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: session.user.id, user_email: userEmail, action: 'login', detail: `Role: ${userRole}` }) }).catch(() => {})
      if (!isAdminRole(userRole)) {
        const { data: config } = await supabase.from('access_config').select('*').eq('role', userRole).eq('ativo', true).single()
        if (config) { timeoutMinutes.current = config.timeout_minutos || 30; if (!checkTimeRestriction(config)) setBlocked(true) }
        const empresaSel = typeof window !== 'undefined' ? localStorage.getItem('ps_empresa_sel') : null
        if (empresaSel && empresaSel !== 'consolidado' && !empresaSel.startsWith('group_')) {
          const { data: comp } = await supabase.from('companies').select('plano').eq('id', empresaSel).single()
          if (comp?.plano) setPlano(comp.plano)
        } else {
          const { data: uc } = await supabase.from('user_companies').select('company_id').eq('user_id', session.user.id)
          if (uc?.length) { const { data: comps } = await supabase.from('companies').select('plano').in('id', uc.map(u => u.company_id)); const planOrder = ['wealth','assessoria','producao','industrial','agro','bpo','erp_cs']; const bestPlan = comps?.map(c => c.plano || 'erp_cs').sort((a, b) => planOrder.indexOf(a) - planOrder.indexOf(b))[0] || 'erp_cs'; setPlano(bestPlan) }
        }
      }
    })
  }, [router])

  useEffect(() => {
    if (isAdminRole(role) || blocked) return
    const interval = setInterval(async () => { const { data: config } = await supabase.from('access_config').select('*').eq('role', role).eq('ativo', true).single(); if (config && !checkTimeRestriction(config)) setBlocked(true) }, 300000)
    return () => clearInterval(interval)
  }, [role, blocked])

  const lastPath = useRef('')
  useEffect(() => {
    if (email && pathname && pathname !== lastPath.current) { lastPath.current = pathname; const mod = pathname.replace('/dashboard/', '').replace('/dashboard', 'home').split('/')[0]; logAudit('page_visit', pathname, mod) }
  }, [pathname, email, logAudit])

  const isAdm = isAdminRole(role)
  const canSee = (modKey: string) => { if (isAdm) return true; const m = PLANO_MODULOS[modKey]; if (!m) return true; const a = m[plano as Plano]; return a === 'full' || a === 'addon' }
  const visibleNucleo = NUCLEO.filter(item => canSee(item.modKey))
  const visibleBoxes = PLAN_BOXES.map(box => ({ ...box, items: box.items.filter(item => canSee(item.modKey)), info: PLANOS[box.plano] })).filter(box => isAdm || box.items.length > 0)

  const signOut = async () => { logAudit('logout'); await supabase.auth.signOut(); router.push('/login') }
  const active = (href: string) => href === '/dashboard' ? pathname === '/dashboard' : !!pathname?.startsWith(href)
  const navigateTo = (href: string) => router.push(href)

  const iconSt = (on: boolean): React.CSSProperties => ({
    fontSize: 10, color: on ? 'var(--ps-gold)' : 'var(--ps-text-m)', textDecoration: 'none',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
    minWidth: 40, cursor: 'pointer', padding: '3px 4px', borderRadius: 6,
    background: on ? 'var(--ps-gold-bg)' : 'transparent',
    border: on ? '1px solid var(--ps-gold-border)' : '1px solid transparent',
    fontWeight: on ? 600 : 400, transition: 'all 0.15s',
  })

  if (blocked) return (
    <div style={{ minHeight: '100vh', background: 'var(--ps-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style dangerouslySetInnerHTML={{ __html: `:root{${THEME_LIGHT}}` }} />
      <div style={{ background: 'var(--ps-bg2)', borderRadius: 16, padding: 40, border: '1px solid var(--ps-border)', textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#EF4444', marginBottom: 8 }}>Acesso Restrito</div>
        <div style={{ fontSize: 13, color: 'var(--ps-text-m)', marginBottom: 20 }}>{blockMsg}</div>
        <button onClick={signOut} style={{ padding: '10px 24px', borderRadius: 8, background: '#C8941A', color: '#FFF', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>Sair</button>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--ps-bg)', color: 'var(--ps-text)', transition: 'background 0.3s, color 0.3s' }}>
      <style dangerouslySetInnerHTML={{ __html: `:root{${isDark ? THEME_DARK : THEME_LIGHT}}` }} />

      {timeoutWarning && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, background: '#EF444420', borderBottom: '1px solid #EF444440', padding: '6px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: '#EF4444', fontWeight: 600 }}>Sessão expira em {timeoutSeconds}s por inatividade</span>
          <button onClick={updateActivity} style={{ padding: '4px 12px', borderRadius: 6, background: '#22C55E20', border: '1px solid #22C55E40', color: '#22C55E', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>Continuar</button>
        </div>
      )}

      <header style={{ position: 'sticky', top: timeoutWarning ? 33 : 0, zIndex: 50, background: 'var(--ps-header)', borderBottom: '1px solid var(--ps-header-border)', transition: 'background 0.3s' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '4px 10px', overflowX: 'auto' }}>
          <a href='/dashboard' style={{ ...iconSt(false), minWidth: 48, marginRight: 2, color: 'var(--ps-gold)', fontWeight: 700, fontSize: 9, letterSpacing: '0.06em' }}>
            <span style={{ fontSize: 15, fontWeight: 900 }}>PS</span><span>GESTÃO</span>
          </a>
          <span style={{ fontSize: 8, color: 'var(--ps-gold)', opacity: 0.5, padding: '2px 6px', textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap', flexShrink: 0 }}>Núcleo</span>
          {visibleNucleo.map(item => (
            <a key={item.href} href={item.href} style={iconSt(active(item.href))} onClick={e => { e.preventDefault(); navigateTo(item.href) }}>
              <span style={{ fontSize: 14 }}>{item.icon}</span><span style={{ fontSize: 9 }}>{item.label}</span>
            </a>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={toggleTheme} style={{ ...iconSt(false), cursor: 'pointer', minWidth: 32 }} title={isDark ? 'Modo claro' : 'Modo escuro'}>
            <span style={{ fontSize: 14 }}>{isDark ? '☀️' : '🌙'}</span><span style={{ fontSize: 8 }}>{isDark ? 'Claro' : 'Escuro'}</span>
          </button>
          {email && <span style={{ fontSize: 9, color: 'var(--ps-text-d)', whiteSpace: 'nowrap', marginRight: 4, filter: demo ? 'blur(6px)' : 'none' }}>{email.split('@')[0]}</span>}
          <span style={{ fontSize: 9, color: 'var(--ps-gold)', fontWeight: 600, whiteSpace: 'nowrap', padding: '2px 6px', background: 'var(--ps-gold-bg)', borderRadius: 4, marginRight: 4 }}>v10.0</span>
          <button onClick={signOut} style={{ fontSize: 10, color: 'var(--ps-text-m)', background: 'transparent', border: '1px solid var(--ps-border)', borderRadius: 6, cursor: 'pointer', padding: '4px 10px', whiteSpace: 'nowrap', flexShrink: 0 }}>Sair</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'stretch', gap: 6, padding: '4px 10px', borderTop: '1px solid var(--ps-border)', overflowX: 'auto' }}>
          {visibleBoxes.map(box => {
            const hasActiveChild = box.items.some(i => active(i.href))
            return (
              <div key={box.plano} style={{ borderRadius: 10, overflow: 'hidden', flexShrink: 0, border: `1.5px solid ${hasActiveChild ? box.info.cor + '70' : box.info.cor + '35'}`, background: hasActiveChild ? box.info.cor + '06' : 'transparent', transition: 'all 0.15s' }}>
                <div style={{ background: box.info.cor + (isDark ? '30' : '18'), padding: '2px 8px', fontSize: 8, fontWeight: 700, color: box.info.cor, textTransform: 'uppercase', letterSpacing: 0.4, textAlign: 'center', whiteSpace: 'nowrap', borderBottom: `1px solid ${box.info.cor}25` }}>
                  {box.info.icon} {box.info.nome.replace('ERP ', '').replace('PS ', '')}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, padding: '2px 3px', maxWidth: 240 }}>
                  {box.items.map(item => (
                    <a key={`${box.plano}-${item.modKey}`} href={item.href} onClick={e => { e.preventDefault(); navigateTo(item.href) }}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, width: 36, padding: '2px 1px', borderRadius: 5, textDecoration: 'none', cursor: 'pointer', transition: 'all 0.15s', background: active(item.href) ? box.info.cor + '18' : 'transparent', border: active(item.href) ? `1px solid ${box.info.cor}35` : '1px solid transparent', color: active(item.href) ? box.info.cor : 'var(--ps-text-m)', fontWeight: active(item.href) ? 600 : 400 }}>
                      <span style={{ fontSize: 12 }}>{item.icon}</span>
                      <span style={{ fontSize: 7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 34, textAlign: 'center' }}>{item.label}</span>
                    </a>
                  ))}
                </div>
              </div>
            )
          })}
          <div style={{ width: 1, background: 'var(--ps-border)', margin: '0 2px', flexShrink: 0, alignSelf: 'stretch' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
            {isAdm && <a href='/dashboard/admin' style={iconSt(active('/dashboard/admin'))} onClick={e => { e.preventDefault(); navigateTo('/dashboard/admin') }}><span style={{ fontSize: 14 }}>⚙️</span><span style={{ fontSize: 9 }}>Admin</span></a>}
            {isAdm && <a href='/dashboard/dev' style={iconSt(active('/dashboard/dev'))} onClick={e => { e.preventDefault(); navigateTo('/dashboard/dev') }}><span style={{ fontSize: 14 }}>🛠️</span><span style={{ fontSize: 9 }}>Dev</span></a>}
            <button onClick={toggleDemo} style={{ ...iconSt(demo), cursor: 'pointer' }}><span style={{ fontSize: 14 }}>🎭</span><span style={{ fontSize: 9, color: demo ? 'var(--ps-gold)' : 'var(--ps-text-m)' }}>{demo ? 'Demo ON' : 'Demo'}</span></button>
          </div>
        </div>
      </header>

      {demo && <style dangerouslySetInnerHTML={{ __html: '.ps-demo .ps-blur{filter:blur(8px)!important;user-select:none!important}.ps-demo .demo-hide{filter:blur(8px)!important;user-select:none!important}.ps-demo td:not(:first-child){color:transparent!important;text-shadow:0 0 10px currentColor!important}' }} />}

      <main ref={mainRef} className={demo ? 'ps-demo' : ''}>{children}</main>
      <HelpWidget />
      <LgpdConsentModal />
      <div style={{ textAlign: 'center', padding: '12px 16px', borderTop: '1px solid var(--ps-border)', background: 'var(--ps-header)', fontSize: 10, color: 'var(--ps-text-d)', transition: 'background 0.3s' }}>
        <a href='/termos' target='_blank' style={{ color: 'var(--ps-gold)', textDecoration: 'none', margin: '0 8px' }}>Termos de Uso</a> · <a href='/privacidade' target='_blank' style={{ color: 'var(--ps-gold)', textDecoration: 'none', margin: '0 8px' }}>Política de Privacidade</a> · <a href='mailto:paravizi-salvi@gpconsultoriadeinvestimentos.com' style={{ color: 'var(--ps-gold)', textDecoration: 'none', margin: '0 8px' }}>DPO</a>
        <div style={{ marginTop: 4, fontSize: 9, color: 'var(--ps-text-d)' }}>PS Gestão e Capital LTDA · CNPJ 60.866.510/0001-78 · São Miguel do Oeste/SC</div>
      </div>
    </div>
  )
}
