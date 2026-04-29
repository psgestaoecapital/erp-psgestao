'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import BpoLandingRedirect from '@/components/bpo/BpoLandingRedirect'
import { supabase } from '@/lib/supabase'
import PSGCBadge from '@/components/psgc/PSGCBadge'
import { SelectedCompanyProvider } from '@/contexts/SelectedCompanyContext'

/* ═══════════════════════════════════════════════════════════════
   PS GESTÃO ERP — LAYOUT v11.1
   Botões Sync e Contexto adicionados no topbar (admin)
   ═══════════════════════════════════════════════════════════════ */

type MenuItem = {
  href: string
  label: string
  icon: React.ReactNode
  modKey?: string
  badge?: string
}

type MenuGroup = {
  label: string
  items: MenuItem[]
}

const Icon = {
  Home: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  Calendar: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>,
  Package: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" x2="12" y1="22" y2="12"/></svg>,
  Warehouse: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/><path d="M6 18h12"/><path d="M6 14h12"/><rect width="12" height="12" x="6" y="10"/></svg>,
  Users: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  Truck: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>,
  FileText: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>,
  Target: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  ClipboardList: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>,
  ShoppingCart: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>,
  BarChart: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/></svg>,
  Wallet: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>,
  Landmark: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>,
  TrendingUp: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>,
  RefreshCw: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>,
  Sparkles: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>,
  Bot: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>,
  PieChart: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>,
  Shield: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>,
  Calculator: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/></svg>,
  Factory: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M17 18h1"/><path d="M12 18h1"/><path d="M7 18h1"/></svg>,
  Leaf: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96c1.4 9.3 4.1 15.84-9.2 17Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>,
  Briefcase: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>,
  TrendingDown: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>,
  Palette: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>,
  Hammer: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"/></svg>,
  Settings: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>,
  Bell: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>,
  Search: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>,
  ChevronRight: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>,
  ChevronDown: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>,
  Menu: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>,
  X: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>,
  LogOut: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>,
  Building: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>,
  Upload: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>,
  HelpCircle: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>,
  BookOpen: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>,
  FlaskConical: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/></svg>,
  Eye: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>,
  Gem: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/></svg>,
  Monitor: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>,
  Megaphone: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>,
  Database: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>,
  Wrench: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>,
  DollarSign: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
}

type PlanoTipo = 'comercio' | 'industrial' | 'agro' | 'bpo' | 'wealth' | 'producao'

const MENU: Record<PlanoTipo, MenuGroup[]> = {
  comercio: [
    { label: 'DADOS', items: [
      { href: '/dashboard/importar-universal', label: 'Importar Dados', icon: <Icon.Upload />, badge: 'NOVO' },
    ]},
    { label: 'CADASTROS', items: [
      { href: '/dashboard/produtos', label: 'Produtos', icon: <Icon.Package /> },
      { href: '/dashboard/clientes', label: 'Clientes', icon: <Icon.Users /> },
      { href: '/dashboard/fornecedores', label: 'Fornecedores', icon: <Icon.Truck /> },
      { href: '/dashboard/contratos', label: 'Contratos', icon: <Icon.RefreshCw /> },
    ]},
    { label: 'VENDAS', items: [
      { href: '/dashboard/orcamentos', label: 'Orçamentos', icon: <Icon.FileText /> },
      { href: '/dashboard/pedidos', label: 'Pedidos', icon: <Icon.Target /> },
      { href: '/dashboard/os', label: 'Ordens de Serviço', icon: <Icon.ClipboardList /> },
    ]},
    { label: 'COMPRAS', items: [
      { href: '/dashboard/cotacoes', label: 'Cotações', icon: <Icon.BarChart /> },
      { href: '/dashboard/compras', label: 'Pedidos de Compra', icon: <Icon.ShoppingCart /> },
    ]},
    { label: 'ESTOQUE', items: [
      { href: '/dashboard/estoque', label: 'Estoque', icon: <Icon.Warehouse /> },
    ]},
    { label: 'FINANCEIRO', items: [
      { href: '/dashboard/analises', label: 'Análises Financeiras', icon: <Icon.PieChart />, badge: 'PRO' },
      { href: '/dashboard/dre-divisional', label: 'DRE Divisional', icon: <Icon.PieChart />, badge: 'PRO' },
      { href: '/dashboard/operacional', label: 'Operacional', icon: <Icon.Settings /> },
      { href: '/dashboard/contas', label: 'Contas a Pagar/Receber', icon: <Icon.Wallet /> },
      { href: '/dashboard/conciliacao', label: 'Conciliação', icon: <Icon.Landmark /> },
      { href: '/dashboard/rateio', label: 'Rateio', icon: <Icon.FlaskConical /> },
      { href: '/dashboard/orcamento', label: 'Budget Anual', icon: <Icon.BarChart /> },
      { href: '/dashboard/viabilidade', label: 'Viabilidade', icon: <Icon.Target /> },
    ]},
    { label: 'INTELIGÊNCIA', items: [
      { href: '/dashboard/score', label: 'Score de Inadimplência', icon: <Icon.TrendingDown />, badge: 'IA' },
      { href: '/dashboard/previsao', label: 'Previsão de Caixa', icon: <Icon.TrendingUp />, badge: 'IA' },
      { href: '/dashboard/consultor-ia', label: 'Consultor IA', icon: <Icon.Bot />, badge: 'IA' },
    ]},
    { label: 'SERVIÇOS PS', items: [
      { href: '/dashboard/contador', label: 'Portal Contador', icon: <Icon.Calculator /> },
      { href: '/dashboard/assessor', label: 'PS Assessor', icon: <Icon.Briefcase /> },
      { href: '/dashboard/anti-fraude', label: 'Anti-Fraude', icon: <Icon.Shield /> },
      { href: '/dashboard/custeio', label: 'Custeio', icon: <Icon.PieChart /> },
    ]},
    { label: 'COMPLIANCE', items: [
      { href: '/dashboard/compliance', label: 'Dashboard Compliance', icon: <Icon.Shield /> },
      { href: '/dashboard/compliance/funcionarios', label: 'Funcionários', icon: <Icon.Users /> },
      { href: '/dashboard/compliance/prestadores', label: 'Prestadores PJ/MEI', icon: <Icon.Briefcase />, badge: 'NOVO' },
      { href: '/dashboard/compliance/empresa', label: 'Docs da Empresa', icon: <Icon.FileText /> },
      { href: '/dashboard/compliance/matriz', label: 'Matriz de Conformidade', icon: <Icon.ClipboardList /> },
      { href: '/dashboard/compliance/validacao-automatica', label: 'Validação Automática', icon: <Icon.Shield />, badge: 'PRO' },
    ]},
  ],
  industrial: [
    { label: 'DADOS', items: [
      { href: '/dashboard/importar-universal', label: 'Importar Dados', icon: <Icon.Upload />, badge: 'NOVO' },
    ]},
    { label: 'CADASTROS', items: [
      { href: '/dashboard/produtos', label: 'Produtos', icon: <Icon.Package /> },
      { href: '/dashboard/clientes', label: 'Clientes', icon: <Icon.Users /> },
      { href: '/dashboard/fornecedores', label: 'Fornecedores', icon: <Icon.Truck /> },
    ]},
    { label: 'OPERAÇÃO', items: [
      { href: '/dashboard/orcamentos', label: 'Orçamentos', icon: <Icon.FileText /> },
      { href: '/dashboard/pedidos', label: 'Pedidos', icon: <Icon.Target /> },
      { href: '/dashboard/cotacoes', label: 'Cotações', icon: <Icon.BarChart /> },
      { href: '/dashboard/compras', label: 'Compras', icon: <Icon.ShoppingCart /> },
      { href: '/dashboard/estoque', label: 'Estoque', icon: <Icon.Warehouse /> },
    ]},
    { label: 'PRODUÇÃO INDUSTRIAL', items: [
      { href: '/dashboard/ficha-tecnica', label: 'Ficha Técnica', icon: <Icon.BookOpen /> },
      { href: '/dashboard/industrial', label: 'Industrial', icon: <Icon.Factory /> },
      { href: '/dashboard/custeio', label: 'Custeio Absorção', icon: <Icon.Calculator /> },
      { href: '/dashboard/custo-industrial', label: 'Custo Industrial', icon: <Icon.PieChart /> },
      { href: '/dashboard/custo', label: 'Custo Simples', icon: <Icon.DollarSign /> },
    ]},
    { label: 'FINANCEIRO', items: [
      { href: '/dashboard/analises', label: 'Análises Financeiras', icon: <Icon.PieChart />, badge: 'PRO' },
      { href: '/dashboard/dre-divisional', label: 'DRE Divisional', icon: <Icon.PieChart />, badge: 'PRO' },
      { href: '/dashboard/operacional', label: 'Operacional', icon: <Icon.Settings /> },
      { href: '/dashboard/contas', label: 'Contas', icon: <Icon.Wallet /> },
      { href: '/dashboard/conciliacao', label: 'Conciliação', icon: <Icon.Landmark /> },
      { href: '/dashboard/rateio', label: 'Rateio', icon: <Icon.FlaskConical /> },
      { href: '/dashboard/orcamento', label: 'Budget', icon: <Icon.BarChart /> },
      { href: '/dashboard/viabilidade', label: 'Viabilidade', icon: <Icon.Target /> },
    ]},
    { label: 'INTELIGÊNCIA', items: [
      { href: '/dashboard/score', label: 'Score', icon: <Icon.TrendingDown />, badge: 'IA' },
      { href: '/dashboard/previsao', label: 'Previsão', icon: <Icon.TrendingUp />, badge: 'IA' },
      { href: '/dashboard/consultor-ia', label: 'Consultor IA', icon: <Icon.Bot />, badge: 'IA' },
      { href: '/dashboard/anti-fraude', label: 'Anti-Fraude', icon: <Icon.Shield /> },
    ]},
  ],
  agro: [
    { label: 'DADOS', items: [
      { href: '/dashboard/importar-universal', label: 'Importar Dados', icon: <Icon.Upload />, badge: 'NOVO' },
    ]},
    { label: 'CADASTROS', items: [
      { href: '/dashboard/produtos', label: 'Produtos', icon: <Icon.Package /> },
      { href: '/dashboard/clientes', label: 'Clientes', icon: <Icon.Users /> },
      { href: '/dashboard/fornecedores', label: 'Fornecedores', icon: <Icon.Truck /> },
    ]},
    { label: 'OPERAÇÃO', items: [
      { href: '/dashboard/orcamentos', label: 'Orçamentos', icon: <Icon.FileText /> },
      { href: '/dashboard/pedidos', label: 'Pedidos', icon: <Icon.Target /> },
      { href: '/dashboard/cotacoes', label: 'Cotações', icon: <Icon.BarChart /> },
      { href: '/dashboard/compras', label: 'Compras', icon: <Icon.ShoppingCart /> },
      { href: '/dashboard/estoque', label: 'Estoque', icon: <Icon.Warehouse /> },
    ]},
    { label: 'FINANCEIRO', items: [
      { href: '/dashboard/analises', label: 'Análises Financeiras', icon: <Icon.PieChart />, badge: 'PRO' },
      { href: '/dashboard/dre-divisional', label: 'DRE Divisional', icon: <Icon.PieChart />, badge: 'PRO' },
      { href: '/dashboard/operacional', label: 'Operacional', icon: <Icon.Settings /> },
      { href: '/dashboard/contas', label: 'Contas', icon: <Icon.Wallet /> },
      { href: '/dashboard/conciliacao', label: 'Conciliação', icon: <Icon.Landmark /> },
      { href: '/dashboard/rateio', label: 'Rateio', icon: <Icon.FlaskConical /> },
      { href: '/dashboard/orcamento', label: 'Budget', icon: <Icon.BarChart /> },
      { href: '/dashboard/viabilidade', label: 'Viabilidade', icon: <Icon.Target /> },
      { href: '/dashboard/custeio', label: 'Custeio', icon: <Icon.Calculator /> },
    ]},
    { label: 'INTELIGÊNCIA', items: [
      { href: '/dashboard/score', label: 'Score', icon: <Icon.TrendingDown />, badge: 'IA' },
      { href: '/dashboard/previsao', label: 'Previsão', icon: <Icon.TrendingUp />, badge: 'IA' },
      { href: '/dashboard/anti-fraude', label: 'Anti-Fraude', icon: <Icon.Shield /> },
    ]},
  ],
  bpo: [
    { label: 'DADOS', items: [
      { href: '/dashboard/importar-universal', label: 'Importar Dados', icon: <Icon.Upload />, badge: 'NOVO' },
    ]},
    { label: 'CENTRAL DE OPERAÇÕES', items: [
      { href: '/dashboard/bpo/inbox', label: 'Inbox do Operador', icon: <Icon.ClipboardList />, badge: 'NOVO' },
      { href: '/dashboard/bpo', label: 'Painel BPO', icon: <Icon.Briefcase /> },
      { href: '/dashboard/bpo/automacao', label: 'Automações', icon: <Icon.Bot />, badge: 'IA' },
      { href: '/dashboard/anti-fraude', label: 'Anti-Fraude', icon: <Icon.Shield /> },
      { href: '/dashboard/conciliacao', label: 'Conciliação', icon: <Icon.Landmark /> },
      { href: '/dashboard/bpo/rotinas', label: 'Rotinas', icon: <Icon.Calendar /> },
      { href: '/dashboard/bpo/supervisor', label: 'Supervisor', icon: <Icon.Eye /> },
    ]},
    { label: 'CADASTROS BPO', items: [
      { href: '/dashboard/clientes', label: 'Clientes', icon: <Icon.Users /> },
      { href: '/dashboard/fornecedores', label: 'Fornecedores', icon: <Icon.Truck /> },
      { href: '/dashboard/contratos', label: 'Contratos', icon: <Icon.RefreshCw /> },
    ]},
    { label: 'OPERAÇÃO FINANCEIRA', items: [
      { href: '/dashboard/analises', label: 'Análises Financeiras', icon: <Icon.PieChart />, badge: 'PRO' },
      { href: '/dashboard/dre-divisional', label: 'DRE Divisional', icon: <Icon.PieChart />, badge: 'PRO' },
      { href: '/dashboard/contas', label: 'Contas a Pagar/Receber', icon: <Icon.Wallet /> },
      { href: '/dashboard/custeio', label: 'Custeio', icon: <Icon.Calculator /> },
      { href: '/dashboard/noc', label: 'NOC', icon: <Icon.Monitor /> },
    ]},
    { label: 'INTELIGÊNCIA IA', items: [
      { href: '/dashboard/consultor-ia', label: 'Consultor IA', icon: <Icon.Bot />, badge: 'IA' },
      { href: '/dashboard/score', label: 'Score Inadimplência', icon: <Icon.TrendingDown />, badge: 'IA' },
      { href: '/dashboard/previsao', label: 'Previsão de Caixa', icon: <Icon.TrendingUp />, badge: 'IA' },
    ]},
    { label: 'ADMINISTRAÇÃO', items: [
      { href: '/admin/operadores', label: 'Operadores & Atribuições', icon: <Icon.Users />, badge: 'ADM' },
    ]},
  ],
  wealth: [
    { label: 'DADOS', items: [
      { href: '/dashboard/importar-universal', label: 'Importar Dados', icon: <Icon.Upload />, badge: 'NOVO' },
    ]},
    { label: 'WEALTH MFO', items: [
      { href: '/dashboard/wealth', label: 'PS Wealth', icon: <Icon.Gem />, badge: 'MFO' },
    ]},
  ],
  producao: [
    { label: 'DADOS', items: [
      { href: '/dashboard/importar-universal', label: 'Importar Dados', icon: <Icon.Upload />, badge: 'NOVO' },
    ]},
    { label: 'CADASTROS', items: [
      { href: '/dashboard/produtos', label: 'Produtos/Serviços', icon: <Icon.Package /> },
      { href: '/dashboard/clientes', label: 'Clientes', icon: <Icon.Users /> },
      { href: '/dashboard/fornecedores', label: 'Fornecedores', icon: <Icon.Truck /> },
      { href: '/dashboard/contratos', label: 'Contratos', icon: <Icon.RefreshCw /> },
    ]},
    { label: 'OPERAÇÃO', items: [
      { href: '/dashboard/orcamentos', label: 'Orçamentos', icon: <Icon.FileText /> },
      { href: '/dashboard/pedidos', label: 'Pedidos', icon: <Icon.Target /> },
      { href: '/dashboard/os', label: 'Ordens de Serviço', icon: <Icon.ClipboardList /> },
      { href: '/dashboard/cotacoes', label: 'Cotações', icon: <Icon.BarChart /> },
      { href: '/dashboard/compras', label: 'Compras', icon: <Icon.ShoppingCart /> },
      { href: '/dashboard/estoque', label: 'Estoque', icon: <Icon.Warehouse /> },
    ]},
    { label: 'PRODUÇÃO', items: [
      { href: '/dashboard/producao', label: 'Produção Marketing', icon: <Icon.Megaphone /> },
    ]},
    { label: 'FINANCEIRO', items: [
      { href: '/dashboard/analises', label: 'Análises Financeiras', icon: <Icon.PieChart />, badge: 'PRO' },
      { href: '/dashboard/dre-divisional', label: 'DRE Divisional', icon: <Icon.PieChart />, badge: 'PRO' },
      { href: '/dashboard/operacional', label: 'Operacional', icon: <Icon.Settings /> },
      { href: '/dashboard/contas', label: 'Contas', icon: <Icon.Wallet /> },
      { href: '/dashboard/conciliacao', label: 'Conciliação', icon: <Icon.Landmark /> },
      { href: '/dashboard/rateio', label: 'Rateio', icon: <Icon.FlaskConical /> },
      { href: '/dashboard/orcamento', label: 'Budget', icon: <Icon.BarChart /> },
    ]},
    { label: 'INTELIGÊNCIA', items: [
      { href: '/dashboard/score', label: 'Score', icon: <Icon.TrendingDown />, badge: 'IA' },
      { href: '/dashboard/previsao', label: 'Previsão', icon: <Icon.TrendingUp />, badge: 'IA' },
      { href: '/dashboard/anti-fraude', label: 'Anti-Fraude', icon: <Icon.Shield /> },
    ]},
    { label: 'SERVIÇOS', items: [
      { href: '/dashboard/contador', label: 'Contador', icon: <Icon.Calculator /> },
    ]},
  ],
}

const PLANO_LABEL: Record<PlanoTipo, string> = {
  comercio: 'Comércio & Serviços',
  industrial: 'Industrial',
  agro: 'Agro',
  bpo: 'BPO Financeiro',
  wealth: 'Wealth MFO',
  producao: 'Produção & Marketing',
}

const PLANO_ICON: Record<PlanoTipo, React.ReactNode> = {
  comercio: <Icon.Building />,
  industrial: <Icon.Factory />,
  agro: <Icon.Leaf />,
  bpo: <Icon.Briefcase />,
  wealth: <Icon.Gem />,
  producao: <Icon.Palette />,
}

// Mapeia rotulo do badge pro variant do PSGCBadge
const badgeVariant = (b: string): 'primary' | 'default' | 'info' => {
  if (b === 'NOVO' || b === 'PRO') return 'primary'
  if (b === 'IA') return 'default'
  if (b === 'ADM') return 'info'
  return 'primary'
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [userRole, setUserRole] = useState<string>('')
  const [companies, setCompanies] = useState<any[]>([])
  const [groups, setGroups] = useState<any[]>([])
  const [selCompany, setSelCompany] = useState('')
  const [currentPlano, setCurrentPlano] = useState<PlanoTipo>('comercio')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [showCompanyMenu, setShowCompanyMenu] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showPlanoMenu, setShowPlanoMenu] = useState(false)
  const [buscaEmpresa, setBuscaEmpresa] = useState('')
  const [demoMode, setDemoMode] = useState(false)

  // Gate dev tools: so aparece em localhost ou quando NEXT_PUBLIC_SHOW_DEV_TOOLS=true
  const showDevTools = process.env.NEXT_PUBLIC_SHOW_DEV_TOOLS === 'true'
    || (typeof window !== 'undefined' && window.location.hostname === 'localhost')

  // Filtro BPO: rotas /dashboard/bpo/* e /dashboard/anti-fraude veem so v_bpo_clientes_ativos
  const isBpoRoute = pathname?.startsWith('/dashboard/bpo') || pathname?.startsWith('/dashboard/anti-fraude') || false

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadUser() }, [isBpoRoute])

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('ps_plano_atual') : null
    if (saved && saved in MENU) setCurrentPlano(saved as PlanoTipo)
    const collapsed = typeof window !== 'undefined' ? localStorage.getItem('ps_sidebar_collapsed') : null
    if (collapsed === '1') setSidebarCollapsed(true)
    const demo = typeof window !== 'undefined' ? localStorage.getItem('ps_demo_mode') : null
    if (demo === 'true') setDemoMode(true)
  }, [])

  // Sidebar troca automatica pra 'BPO Financeiro' em rotas /bpo/*; restaura plano anterior ao sair.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (isBpoRoute && currentPlano !== 'bpo') {
      localStorage.setItem('ps_plano_anterior', currentPlano)
      setCurrentPlano('bpo')
      localStorage.setItem('ps_plano_atual', 'bpo')
    }
    if (!isBpoRoute && currentPlano === 'bpo') {
      const anterior = localStorage.getItem('ps_plano_anterior')
      if (anterior && anterior in MENU) {
        setCurrentPlano(anterior as PlanoTipo)
        localStorage.setItem('ps_plano_atual', anterior)
        localStorage.removeItem('ps_plano_anterior')
      }
    }
  }, [isBpoRoute, currentPlano])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!demoMode) return
    const applyBlur = () => {
      const main = document.querySelector('main')
      if (!main) return
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, null)
      const toMark = new Set<HTMLElement>()
      let node: Node | null
      while ((node = walker.nextNode())) {
        const txt = node.nodeValue || ''
        if (/R\$|\d+[\.,]\d{2}|^\s*\d{1,3}([\.,]\d{3})+/.test(txt)) {
          let el = node.parentElement
          if (el && el.tagName !== 'MAIN') toMark.add(el)
        }
      }
      toMark.forEach(el => el.classList.add('ps-blur'))
    }
    applyBlur()
    const observer = new MutationObserver(applyBlur)
    const main = document.querySelector('main')
    if (main) observer.observe(main, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      document.querySelectorAll('.ps-blur').forEach(el => el.classList.remove('ps-blur'))
    }
  }, [demoMode])

  const toggleDemo = () => {
    setDemoMode(d => {
      const n = !d
      if (typeof window !== 'undefined') localStorage.setItem('ps_demo_mode', String(n))
      return n
    })
  }

  const loadUser = async () => {
    const { data: { user: u } } = await supabase.auth.getUser()
    if (!u) { router.push('/login'); return }
    setUser(u)
    const { data: up } = await supabase.from('users').select('*').eq('id', u.id).single()
    if (up?.role) setUserRole(up.role)
    const { data: grps } = await supabase.from('company_groups').select('*').order('nome')
    setGroups(grps || [])
    let d: any[] = []
    if (up?.role === 'adm' || up?.role === 'acesso_total' || up?.role === 'adm_investimentos') {
      // Em rotas BPO, admin ve so clientes BPO ativos (filtra Mariele/PDOIS/Proplay automaticamente)
      const r = isBpoRoute
        ? await supabase.from('v_bpo_clientes_ativos').select('*').order('nome_fantasia')
        : await supabase.from('companies').select('*').order('nome_fantasia')
      d = r.data || []
    } else {
      const r = await supabase.from('user_companies').select('companies(*)').eq('user_id', u.id)
      d = (r.data || []).map((uc: any) => uc.companies).filter(Boolean)
    }
    setCompanies(d)
    if (d.length > 0) {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('ps_empresa_sel') : null
      if (saved === 'consolidado' || saved?.startsWith('group_')) {
        setSelCompany(saved)
      } else {
        const match = saved ? d.find((c: any) => c.id === saved) : null
        setSelCompany(match ? match.id : (d.length > 1 ? 'consolidado' : d[0].id))
      }
    }
  }

  const selectCompany = (id: string) => {
    setSelCompany(id)
    if (typeof window !== 'undefined') localStorage.setItem('ps_empresa_sel', id)
    setShowCompanyMenu(false)
    setBuscaEmpresa('')
  }

  const selectPlano = (p: PlanoTipo) => {
    setCurrentPlano(p)
    if (typeof window !== 'undefined') localStorage.setItem('ps_plano_atual', p)
    setShowPlanoMenu(false)
    setMobileMenuOpen(false)
  }

  const toggleSidebar = () => {
    const newVal = !sidebarCollapsed
    setSidebarCollapsed(newVal)
    if (typeof window !== 'undefined') localStorage.setItem('ps_sidebar_collapsed', newVal ? '1' : '0')
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const breadcrumb = React.useMemo(() => {
    if (!pathname) return []
    const groups = MENU[currentPlano] || []
    for (const group of groups) {
      for (const item of group.items) {
        if (pathname === item.href || pathname.startsWith(item.href + '/')) {
          return [
            { label: PLANO_LABEL[currentPlano], href: '/dashboard' },
            { label: group.label, href: null },
            { label: item.label, href: item.href },
          ]
        }
      }
    }
    return [{ label: PLANO_LABEL[currentPlano], href: '/dashboard' }]
  }, [pathname, currentPlano])

  const currentCompany = companies.find(c => c.id === selCompany)
  const userInitials = user?.email ? user.email.slice(0, 2).toUpperCase() : '??'
  const menuGroups = MENU[currentPlano] || []

  const gruposComEmpresas = React.useMemo(() => {
    return groups
      .map((g: any) => ({ ...g, empresas: companies.filter((c: any) => c.group_id === g.id) }))
      .filter((g: any) => g.empresas.length > 0)
  }, [groups, companies])

  const empresasSemGrupo = React.useMemo(() => {
    return companies.filter((c: any) => !c.group_id || !groups.find((g: any) => g.id === c.group_id))
  }, [companies, groups])

  const empresasFiltradasBusca = React.useMemo(() => {
    if (!buscaEmpresa.trim()) return []
    const b = buscaEmpresa.toLowerCase()
    const bNum = buscaEmpresa.replace(/\D/g, '')
    return companies.filter((c: any) =>
      (c.nome_fantasia || '').toLowerCase().includes(b) ||
      (c.razao_social || '').toLowerCase().includes(b) ||
      (c.cnpj || '').includes(bNum)
    ).slice(0, 20)
  }, [buscaEmpresa, companies])

  const selLabel = React.useMemo(() => {
    if (selCompany === 'consolidado') {
      return { icon: '📊', label: 'Todas as Empresas', sub: `${companies.length} empresas · Consolidado` }
    }
    if (selCompany.startsWith('group_')) {
      const gid = selCompany.replace('group_', '')
      const grp = groups.find((g: any) => g.id === gid)
      const emps = companies.filter((c: any) => c.group_id === gid)
      return { icon: '📁', label: grp?.nome || 'Grupo', sub: `${emps.length} empresas · Grupo` }
    }
    const c = companies.find(c => c.id === selCompany)
    return { icon: '🏢', label: c?.nome_fantasia || c?.razao_social || 'Selecionar', sub: '' }
  }, [selCompany, companies, groups])

  const isAdmin = userRole === 'adm' || userRole === 'acesso_total' || userRole === 'adm_investimentos'

  return (
    <>
      <BpoLandingRedirect />
      <style jsx global>{`
        :root {
          --ps-bg: #FAF7F2;
          --ps-bg2: #FAF7F2;
          --ps-bg3: #F0ECE3;
          --ps-bg4: #E8E1D3;
          --ps-text: #3D2314;
          --ps-text-m: #6B5D4F;
          --ps-text-d: #5A3A2A;
          --ps-border: #E0D8CC;
          --ps-border-l: #EDE7DA;
          --ps-gold: #C8941A;
          --ps-gold-d: #A57A15;
          --ps-gold-l: #E8B84E;
          --ps-gold-bg: #FDF7E8;
          --ps-green: #5C8D3F;
          --ps-green-bg: #EBF3ED;
          --ps-red: #C44536;
          --ps-red-bg: #F6E8E8;
          --ps-amber: #D89627;
          --ps-amber-bg: #FAF0DF;
          --ps-blue: #3D6FA8;
          --ps-blue-bg: #E7EDF5;
          --ps-font-display: 'Fraunces', Georgia, serif;
          --ps-font-body: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          --ps-font-mono: 'JetBrains Mono', 'Courier New', monospace;
          --ps-radius-sm: 6px;
          --ps-radius: 10px;
          --ps-radius-lg: 14px;
          --ps-shadow-sm: 0 1px 2px rgba(61, 35, 20, 0.04);
          --ps-shadow: 0 2px 8px rgba(61, 35, 20, 0.06), 0 1px 2px rgba(61, 35, 20, 0.04);
          --ps-shadow-lg: 0 10px 32px rgba(61, 35, 20, 0.08), 0 2px 6px rgba(61, 35, 20, 0.04);
          --sidebar-width: 260px;
          --sidebar-collapsed: 68px;
          --topbar-height: 64px;
        }
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;0,9..144,800;1,9..144,400&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: var(--ps-bg); color: var(--ps-text); font-family: var(--ps-font-body); font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
        body { overflow-x: hidden; }
        h1, h2, h3, h4, h5, h6 { font-family: var(--ps-font-display); font-weight: 600; letter-spacing: -0.01em; color: var(--ps-text); }
        button, input, select, textarea { font-family: inherit; }
        ::-webkit-scrollbar { width: 10px; height: 10px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--ps-border); border-radius: 10px; border: 2px solid var(--ps-bg); }
        ::-webkit-scrollbar-thumb:hover { background: var(--ps-text-d); }
        a, button { transition: all 0.15s ease-out; }
        @media (max-width: 1024px) {
          .ps-sidebar { transform: translateX(-100%); width: var(--sidebar-width) !important; }
          .ps-sidebar.open { transform: translateX(0) !important; }
          .ps-main { margin-left: 0 !important; }
          .ps-mobile-menu { display: flex !important; }
          .ps-mobile-close { display: flex !important; }
        }
        @media (max-width: 640px) {
          .ps-breadcrumb { display: none; }
        }
      `}</style>

      <div style={{ minHeight: '100vh', background: 'var(--ps-bg)', display: 'flex' }}>
        <aside
          style={{
            position: 'fixed', top: 0, left: mobileMenuOpen ? 0 : undefined, bottom: 0,
            width: sidebarCollapsed ? 'var(--sidebar-collapsed)' : 'var(--sidebar-width)',
            background: 'var(--ps-bg2)', borderRight: '1px solid var(--ps-border)',
            display: 'flex', flexDirection: 'column', zIndex: 40,
            transition: 'width 0.2s ease-out, transform 0.2s ease-out',
            transform: mobileMenuOpen ? 'translateX(0)' : undefined,
          }}
          className={`ps-sidebar ${mobileMenuOpen ? 'open' : ''}`}
        >
          <div style={{ padding: sidebarCollapsed ? '20px 0' : '20px 24px', borderBottom: '1px solid var(--ps-border-l)', display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : 'space-between', gap: 12, minHeight: 'var(--topbar-height)' }}>
            <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'var(--ps-text)' }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: 'linear-gradient(135deg, var(--ps-text) 0%, #5A3A28 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ps-gold)', fontFamily: 'var(--ps-font-display)', fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', boxShadow: '0 2px 6px rgba(61,35,20,0.2)', flexShrink: 0 }}>PS</div>
              {!sidebarCollapsed && (
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontFamily: 'var(--ps-font-display)', fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1 }}>PS Gestão</div>
                  <div style={{ fontSize: 10, color: 'var(--ps-text-d)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 2 }}>Capital & ERP</div>
                </div>
              )}
            </Link>
            <button className="ps-mobile-close" onClick={() => setMobileMenuOpen(false)} style={{ display: 'none', background: 'none', border: 'none', color: 'var(--ps-text-m)', cursor: 'pointer', padding: 4 }}>
              <Icon.X />
            </button>
          </div>

          {!sidebarCollapsed && (
            <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--ps-border-l)', position: 'relative' }}>
              <button onClick={() => setShowPlanoMenu(!showPlanoMenu)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--ps-bg3)', border: '1px solid var(--ps-border-l)', borderRadius: 8, cursor: 'pointer', textAlign: 'left', color: 'var(--ps-text)' }}>
                <div style={{ color: 'var(--ps-gold)', flexShrink: 0 }}>{PLANO_ICON[currentPlano]}</div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: 9, color: 'var(--ps-text-d)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Área</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ps-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{PLANO_LABEL[currentPlano]}</div>
                </div>
                <div style={{ color: 'var(--ps-text-d)', transform: showPlanoMenu ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}><Icon.ChevronDown /></div>
              </button>
              {showPlanoMenu && (
                <div style={{ position: 'absolute', top: 'calc(100% - 2px)', left: 16, right: 16, background: 'var(--ps-bg2)', border: '1px solid var(--ps-border)', borderRadius: 10, boxShadow: 'var(--ps-shadow-lg)', zIndex: 50, overflow: 'hidden', marginTop: 4 }}>
                  {(Object.keys(MENU) as PlanoTipo[]).map(p => (
                    <button key={p} onClick={() => selectPlano(p)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: currentPlano === p ? 'var(--ps-gold-bg)' : 'transparent', border: 'none', borderBottom: '1px solid var(--ps-border-l)', cursor: 'pointer', textAlign: 'left', color: currentPlano === p ? 'var(--ps-gold-d)' : 'var(--ps-text)', fontWeight: currentPlano === p ? 600 : 400 }} onMouseEnter={e => (e.currentTarget.style.background = currentPlano === p ? 'var(--ps-gold-bg)' : 'var(--ps-bg3)')} onMouseLeave={e => (e.currentTarget.style.background = currentPlano === p ? 'var(--ps-gold-bg)' : 'transparent')}>
                      <div style={{ color: currentPlano === p ? 'var(--ps-gold)' : 'var(--ps-text-d)' }}>{PLANO_ICON[p]}</div>
                      <span style={{ fontSize: 13 }}>{PLANO_LABEL[p]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            <NavItem href="/dashboard" label="Dashboard" icon={<Icon.Home />} active={pathname === '/dashboard'} collapsed={sidebarCollapsed} onClick={() => setMobileMenuOpen(false)} />
            <NavItem href="/dashboard/visao-mensal" label="Visão Mensal" icon={<Icon.Calendar />} active={pathname === '/dashboard/visao-mensal'} collapsed={sidebarCollapsed} onClick={() => setMobileMenuOpen(false)} />

            {menuGroups.map((group, idx) => (
              <div key={idx} style={{ marginTop: 18 }}>
                {!sidebarCollapsed && (
                  <div style={{ padding: '0 20px 6px', fontSize: 10, fontWeight: 700, color: 'var(--ps-gold-d)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{group.label}</div>
                )}
                {sidebarCollapsed && idx > 0 && (<div style={{ margin: '6px 14px', height: 1, background: 'var(--ps-border-l)' }} />)}
                {group.items.map(item => (
                  <NavItem key={item.href} href={item.href} label={item.label} icon={item.icon} badge={item.badge} active={pathname === item.href || pathname.startsWith(item.href + '/')} collapsed={sidebarCollapsed} onClick={() => setMobileMenuOpen(false)} />
                ))}
              </div>
            ))}

            {/* Seção ADMINISTRAÇÃO — só para admins */}
            {isAdmin && (
              <div style={{ marginTop: 18 }}>
                {!sidebarCollapsed && (
                  <div style={{ padding: '0 20px 6px', fontSize: 10, fontWeight: 700, color: 'var(--ps-gold-d)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>ADMINISTRAÇÃO SISTEMA</div>
                )}
                {sidebarCollapsed && (<div style={{ margin: '6px 14px', height: 1, background: 'var(--ps-border-l)' }} />)}
                <NavItem href="/admin/sync-status" label="Status Sync Omie" icon={<Icon.RefreshCw />} active={pathname === '/admin/sync-status'} collapsed={sidebarCollapsed} onClick={() => setMobileMenuOpen(false)} />
                <NavItem href="/admin/projeto" label="Contexto do Projeto" icon={<Icon.BookOpen />} active={pathname === '/admin/projeto'} collapsed={sidebarCollapsed} onClick={() => setMobileMenuOpen(false)} />
              </div>
            )}
          </nav>

          <div style={{ borderTop: '1px solid var(--ps-border-l)', padding: sidebarCollapsed ? '12px 8px' : '12px 16px' }}>
            {!sidebarCollapsed ? (
              <div style={{ position: 'relative' }}>
                <button onClick={() => setShowUserMenu(!showUserMenu)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'transparent', border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left', color: 'var(--ps-text)' }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--ps-bg3)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--ps-gold)', color: 'var(--ps-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{userInitials}</div>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email?.split('@')[0] || 'Usuário'}</div>
                    <div style={{ fontSize: 10, color: 'var(--ps-text-d)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email || ''}</div>
                  </div>
                  <div style={{ color: 'var(--ps-text-d)' }}><Icon.ChevronDown /></div>
                </button>
                {showUserMenu && (
                  <div style={{ position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--ps-bg2)', border: '1px solid var(--ps-border)', borderRadius: 10, boxShadow: 'var(--ps-shadow-lg)', overflow: 'hidden' }}>
                    {isAdmin && (
                      <Link href="/dashboard/admin" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', color: 'var(--ps-gold-d)', textDecoration: 'none', fontSize: 13, borderBottom: '1px solid var(--ps-border-l)', background: 'var(--ps-gold-bg)', fontWeight: 600 }} onClick={() => setShowUserMenu(false)}>
                        <Icon.Settings />
                        <span>Painel Administrativo</span>
                      </Link>
                    )}
                    <Link href="/dashboard/ajuda" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', color: 'var(--ps-text)', textDecoration: 'none', fontSize: 13, borderBottom: '1px solid var(--ps-border-l)' }} onClick={() => setShowUserMenu(false)}>
                      <Icon.HelpCircle />
                      <span>Ajuda</span>
                    </Link>
                    <button onClick={signOut} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'none', border: 'none', color: 'var(--ps-red)', cursor: 'pointer', fontSize: 13, textAlign: 'left' }}>
                      <Icon.LogOut />
                      <span>Sair</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button onClick={() => setSidebarCollapsed(false)} title={user?.email} style={{ width: 48, height: 48, borderRadius: 8, background: 'var(--ps-gold)', color: 'var(--ps-text)', border: 'none', cursor: 'pointer', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 }}>
                {userInitials}
              </button>
            )}
            <button onClick={toggleSidebar} style={{ width: '100%', marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '6px 10px', background: 'transparent', border: '1px solid var(--ps-border-l)', borderRadius: 6, cursor: 'pointer', color: 'var(--ps-text-d)', fontSize: 11 }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--ps-bg3)'; e.currentTarget.style.color = 'var(--ps-text)' }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ps-text-d)' }} title={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}>
              <div style={{ transform: sidebarCollapsed ? 'rotate(180deg)' : 'none', display: 'flex' }}><Icon.ChevronRight /></div>
              {!sidebarCollapsed && <span>Recolher</span>}
            </button>
          </div>
        </aside>

        {mobileMenuOpen && (<div className="ps-overlay" onClick={() => setMobileMenuOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', zIndex: 35 }} />)}

        <div style={{ flex: 1, marginLeft: sidebarCollapsed ? 'var(--sidebar-collapsed)' : 'var(--sidebar-width)', minWidth: 0, transition: 'margin-left 0.2s ease-out' }} className="ps-main">
          <header style={{ height: 'var(--topbar-height)', background: 'var(--ps-bg2)', borderBottom: '1px solid var(--ps-border)', display: 'flex', alignItems: 'center', padding: '0 24px', gap: 16, position: 'sticky', top: 0, zIndex: 30, backdropFilter: 'blur(8px)', backgroundColor: 'rgba(255,255,255,0.92)' }}>
            <button className="ps-mobile-menu" onClick={() => setMobileMenuOpen(true)} style={{ display: 'none', background: 'none', border: 'none', color: 'var(--ps-text)', cursor: 'pointer', padding: 6 }}><Icon.Menu /></button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, overflow: 'hidden' }} className="ps-breadcrumb">
              {breadcrumb.map((crumb, i) => (
                <React.Fragment key={i}>
                  {i > 0 && (<div style={{ color: 'var(--ps-text-d)', display: 'flex' }}><Icon.ChevronRight /></div>)}
                  {crumb.href ? (
                    <Link href={crumb.href} style={{ fontSize: 13, color: i === breadcrumb.length - 1 ? 'var(--ps-text)' : 'var(--ps-text-m)', textDecoration: 'none', fontWeight: i === breadcrumb.length - 1 ? 600 : 500, whiteSpace: 'nowrap' }}>{crumb.label}</Link>
                  ) : (
                    <span style={{ fontSize: 13, color: 'var(--ps-text-d)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, whiteSpace: 'nowrap' }}>{crumb.label}</span>
                  )}
                </React.Fragment>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {!isBpoRoute && (<div style={{ position: 'relative' }}>
                <button onClick={() => setShowCompanyMenu(!showCompanyMenu)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: 'var(--ps-bg3)', border: '1px solid var(--ps-border-l)', borderRadius: 8, cursor: 'pointer', color: 'var(--ps-text)', fontSize: 13, fontWeight: 500, minWidth: 220, maxWidth: 320 }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--ps-bg4)')} onMouseLeave={e => (e.currentTarget.style.background = 'var(--ps-bg3)')}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>{selLabel.icon}</span>
                  <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0, flex: 1, textAlign: 'left' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>{selLabel.label}</div>
                    {selLabel.sub && <div style={{ fontSize: 9, color: 'var(--ps-text-d)', fontWeight: 500 }}>{selLabel.sub}</div>}
                  </div>
                  <div style={{ color: 'var(--ps-text-d)', flexShrink: 0 }}><Icon.ChevronDown /></div>
                </button>
                {showCompanyMenu && (
                  <>
                    <div onClick={() => setShowCompanyMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                    <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, width: 380, maxHeight: 480, overflowY: 'auto', background: 'var(--ps-bg2)', border: '1px solid var(--ps-border)', borderRadius: 10, boxShadow: 'var(--ps-shadow-lg)', zIndex: 50 }}>
                      {companies.length > 5 && (
                        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--ps-border-l)', position: 'sticky', top: 0, background: 'var(--ps-bg2)', zIndex: 1 }}>
                          <input type="text" autoFocus value={buscaEmpresa} onChange={e => setBuscaEmpresa(e.target.value)} placeholder="🔍 Buscar por nome ou CNPJ..." style={{ width: '100%', padding: '8px 12px', background: 'var(--ps-bg3)', border: '1px solid var(--ps-border-l)', borderRadius: 6, fontSize: 12, outline: 'none', color: 'var(--ps-text)', fontFamily: 'inherit' }} />
                        </div>
                      )}
                      {buscaEmpresa.trim() ? (
                        <div>
                          <div style={{ padding: '6px 14px', fontSize: 9, fontWeight: 700, color: 'var(--ps-text-d)', letterSpacing: '0.1em', textTransform: 'uppercase', background: 'var(--ps-bg3)' }}>{empresasFiltradasBusca.length} resultado(s)</div>
                          {empresasFiltradasBusca.map((c: any) => (
                            <CompanyItem key={c.id} ativo={selCompany === c.id} onClick={() => { selectCompany(c.id); setBuscaEmpresa(''); }} label={c.nome_fantasia || c.razao_social} sublabel={c.cnpj} icon="🏢" />
                          ))}
                          {empresasFiltradasBusca.length === 0 && (<div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 12, color: 'var(--ps-text-d)' }}>Nenhuma empresa encontrada</div>)}
                        </div>
                      ) : (
                        <>
                          {companies.length > 1 && (<CompanyItem ativo={selCompany === 'consolidado'} onClick={() => selectCompany('consolidado')} label="Todas as Empresas" sublabel={`${companies.length} empresas · Consolidado total`} icon="📊" destaque />)}
                          {gruposComEmpresas.length > 0 && (
                            <>
                              <div style={{ padding: '10px 14px 4px', fontSize: 9, fontWeight: 700, color: 'var(--ps-text-d)', letterSpacing: '0.12em', textTransform: 'uppercase', background: 'var(--ps-bg3)', borderTop: '1px solid var(--ps-border-l)' }}>Grupos Empresariais ({gruposComEmpresas.length})</div>
                              {gruposComEmpresas.map((g: any) => (
                                <React.Fragment key={g.id}>
                                  <CompanyItem ativo={selCompany === `group_${g.id}`} onClick={() => selectCompany(`group_${g.id}`)} label={g.nome} sublabel={`${g.empresas.length} empresas · Consolidado do grupo`} icon="📁" destaque />
                                  {g.empresas.map((c: any) => (<CompanyItem key={c.id} ativo={selCompany === c.id} onClick={() => selectCompany(c.id)} label={c.nome_fantasia || c.razao_social} sublabel={c.cnpj} icon="└" indent />))}
                                </React.Fragment>
                              ))}
                            </>
                          )}
                          {empresasSemGrupo.length > 0 && (
                            <>
                              <div style={{ padding: '10px 14px 4px', fontSize: 9, fontWeight: 700, color: 'var(--ps-text-d)', letterSpacing: '0.12em', textTransform: 'uppercase', background: 'var(--ps-bg3)', borderTop: '1px solid var(--ps-border-l)' }}>{gruposComEmpresas.length > 0 ? 'Outras Empresas' : 'Empresas'} ({empresasSemGrupo.length})</div>
                              {empresasSemGrupo.map((c: any) => (<CompanyItem key={c.id} ativo={selCompany === c.id} onClick={() => selectCompany(c.id)} label={c.nome_fantasia || c.razao_social} sublabel={c.cnpj} icon="🏢" />))}
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>)}

              {!isBpoRoute && <div style={{ width: 1, height: 24, background: 'var(--ps-border)' }} />}

              <TopButton icon={<Icon.Database />} label="Dados / Conectores" onClick={() => router.push('/dashboard/dados')} />
              <TopButton icon={<Icon.Upload />} label="Importar" onClick={() => router.push('/dashboard/importar-universal')} />
              <TopButton icon={<Icon.Bell />} label="Notificações" />
              <TopButton icon={<Icon.HelpCircle />} label="Ajuda" onClick={() => router.push('/dashboard/ajuda')} />

              <button onClick={toggleDemo} title={demoMode ? 'Modo Demo ATIVO — valores ocultados' : 'Ativar modo Demo (oculta valores sensíveis)'} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: demoMode ? 'var(--ps-gold-bg)' : 'transparent', border: `1px solid ${demoMode ? 'var(--ps-gold)' : 'transparent'}`, borderRadius: 8, cursor: 'pointer', color: demoMode ? 'var(--ps-gold-d)' : 'var(--ps-text-m)', fontSize: 11, fontWeight: demoMode ? 600 : 400 }} onMouseEnter={e => { if (!demoMode) { e.currentTarget.style.background = 'var(--ps-bg3)'; e.currentTarget.style.color = 'var(--ps-text)'; } }} onMouseLeave={e => { if (!demoMode) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ps-text-m)'; } }}>
                <span style={{ fontSize: 13 }}>🎭</span>
                <span>{demoMode ? 'Demo ON' : 'Demo'}</span>
              </button>

              {isAdmin && (
                <>
                  <div style={{ width: 1, height: 24, background: 'var(--ps-border)' }} />
                  {showDevTools && (
                    <>
                      <button onClick={() => window.location.href = '/admin/sync-status'} title="Status de Sincronização Omie" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'transparent', border: '1px solid transparent', borderRadius: 8, cursor: 'pointer', color: 'var(--ps-text-m)', fontSize: 11 }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--ps-bg3)'; e.currentTarget.style.color = 'var(--ps-text)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ps-text-m)'; }}>
                        <span style={{ fontSize: 13 }}>🔄</span>
                        <span>Sync</span>
                      </button>
                      <button onClick={() => window.location.href = '/admin/projeto'} title="Contexto do Projeto" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'transparent', border: '1px solid transparent', borderRadius: 8, cursor: 'pointer', color: 'var(--ps-text-m)', fontSize: 11 }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--ps-bg3)'; e.currentTarget.style.color = 'var(--ps-text)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ps-text-m)'; }}>
                        <span style={{ fontSize: 13 }}>📋</span>
                        <span>Contexto</span>
                      </button>
                      <button onClick={() => router.push('/dashboard/dev')} title="Central de Desenvolvimento" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'transparent', border: '1px solid transparent', borderRadius: 8, cursor: 'pointer', color: 'var(--ps-text-m)', fontSize: 11 }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--ps-bg3)'; e.currentTarget.style.color = 'var(--ps-text)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ps-text-m)'; }}>
                        <span style={{ fontSize: 13 }}>🛠️</span>
                        <span>Dev</span>
                      </button>
                    </>
                  )}
                  <button onClick={() => router.push('/dashboard/admin')} title="Painel Administrativo" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'var(--ps-gold-bg)', border: '1px solid var(--ps-gold)', borderRadius: 8, cursor: 'pointer', color: 'var(--ps-gold-d)', fontSize: 11, fontWeight: 600 }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--ps-gold)'; e.currentTarget.style.color = 'var(--ps-bg)' }} onMouseLeave={e => { e.currentTarget.style.background = 'var(--ps-gold-bg)'; e.currentTarget.style.color = 'var(--ps-gold-d)' }}>
                    <Icon.Settings />
                    <span>Admin</span>
                  </button>
                </>
              )}
            </div>
          </header>

          {demoMode && (
            <style dangerouslySetInnerHTML={{ __html: `
              .ps-demo main::before {
                content: '🎭 MODO DEMO — valores ocultados';
                position: fixed; top: 76px; left: 50%; transform: translateX(-50%);
                background: var(--ps-gold); color: #FFFFFF; padding: 6px 16px;
                border-radius: 20px; font-size: 11px; font-weight: 700;
                z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                pointer-events: none; letter-spacing: 0.3px;
              }
              .ps-blur { filter: blur(8px) !important; user-select: none !important; transition: filter 0.2s; }
              .ps-demo .demo-hide { filter: blur(8px) !important; user-select: none !important; }
            `}}/>
          )}

          <main className={demoMode ? 'ps-demo' : ''} style={{ padding: '24px', minHeight: 'calc(100vh - var(--topbar-height))' }}>
            <SelectedCompanyProvider>
              {children}
            </SelectedCompanyProvider>
          </main>
        </div>
      </div>
    </>
  )
}

function NavItem({ href, label, icon, active, collapsed, badge, onClick }: { href: string; label: string; icon: React.ReactNode; active: boolean; collapsed: boolean; badge?: string; onClick?: () => void }) {
  return (
    <Link href={href} onClick={onClick} title={collapsed ? label : undefined} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: collapsed ? '10px 24px' : '9px 20px', margin: collapsed ? '2px 10px' : '1px 12px', color: active ? 'var(--ps-text)' : 'var(--ps-text-m)', textDecoration: 'none', fontSize: 13, fontWeight: active ? 600 : 500, borderRadius: 8, background: active ? 'var(--ps-gold-bg)' : 'transparent', borderLeft: active && !collapsed ? '2px solid var(--ps-gold)' : '2px solid transparent', position: 'relative', whiteSpace: 'nowrap', overflow: 'hidden' }} onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'var(--ps-bg3)'; e.currentTarget.style.color = 'var(--ps-text)' } }} onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ps-text-m)' } }}>
      <div style={{ color: active ? 'var(--ps-gold)' : 'var(--ps-text-d)', flexShrink: 0, display: 'flex' }}>{icon}</div>
      {!collapsed && (
        <>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
          {badge && <PSGCBadge variant={badgeVariant(badge)} size="sm">{badge}</PSGCBadge>}
        </>
      )}
    </Link>
  )
}

function TopButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} title={label} style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid transparent', borderRadius: 8, cursor: 'pointer', color: 'var(--ps-text-m)' }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--ps-bg3)'; e.currentTarget.style.borderColor = 'var(--ps-border-l)'; e.currentTarget.style.color = 'var(--ps-text)' }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.color = 'var(--ps-text-m)' }}>
      {icon}
    </button>
  )
}

function CompanyItem({ ativo, onClick, label, sublabel, icon, indent, destaque }: { ativo: boolean; onClick: () => void; label: string; sublabel?: string; icon?: string; indent?: boolean; destaque?: boolean }) {
  return (
    <button onClick={onClick} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: `10px ${indent ? 28 : 14}px`, background: ativo ? 'var(--ps-gold-bg)' : 'transparent', border: 'none', borderBottom: '1px solid var(--ps-border-l)', cursor: 'pointer', textAlign: 'left', color: ativo ? 'var(--ps-gold-d)' : 'var(--ps-text)', borderLeft: ativo ? '3px solid var(--ps-gold)' : '3px solid transparent' }} onMouseEnter={e => { if (!ativo) e.currentTarget.style.background = 'var(--ps-bg3)' }} onMouseLeave={e => { if (!ativo) e.currentTarget.style.background = 'transparent' }}>
      {icon && (<span style={{ fontSize: indent ? 10 : 14, flexShrink: 0, color: indent ? 'var(--ps-text-d)' : undefined, width: indent ? 12 : 20, textAlign: 'center' }}>{icon}</span>)}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: ativo || destaque ? 600 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
        {sublabel && (<div style={{ fontSize: 10, color: 'var(--ps-text-d)', fontFamily: sublabel.match(/^\d/) ? 'var(--ps-font-mono)' : 'inherit', marginTop: 2 }}>{sublabel}</div>)}
      </div>
    </button>
  )
}
