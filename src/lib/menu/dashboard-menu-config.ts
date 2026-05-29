import {
  Home, Wallet, CreditCard, Coins, AlertTriangle, FileText, ArrowLeftRight,
  TrendingUp, HeartPulse, Plus, FileBarChart, Repeat, Calculator,
  PieChart, BarChart3, Activity, Receipt, Shield, ScanBarcode, Sparkles,
  type LucideIcon,
} from 'lucide-react'

export type MenuStatus = 'pronto' | 'parcial' | 'em_dev' | 'planejado'

export interface MenuItem {
  label: string
  href: string
  icon: LucideIcon
  status?: MenuStatus
  badge?: string
  featureFlag?: string
}

export interface MenuGroup {
  id: string
  label: string
  icon: LucideIcon
  items: MenuItem[]
}

// Configuracao unica · aplica pra TODAS areas do dashboard
// Hrefs refletem rotas reais do projeto (IPO #35 auto-corrigiu spec)
export const DASHBOARD_MENU_GROUPS: MenuGroup[] = [
  {
    id: 'inicio',
    label: 'Início',
    icon: Home,
    items: [
      { label: 'Consultor IA', href: '/dashboard/consultor-ia', icon: Sparkles, status: 'parcial' },
    ],
  },
  {
    id: 'financeiro',
    label: 'Financeiro',
    icon: Wallet,
    items: [
      { label: 'Despesas a Pagar', href: '/dashboard/financeiro/pagar', icon: CreditCard, status: 'pronto' },
      { label: 'Receitas a Receber', href: '/dashboard/financeiro/receber', icon: Coins, status: 'pronto' },
      { label: 'Inadimplentes', href: '/dashboard/financeiro/inadimplentes', icon: AlertTriangle, status: 'pronto' },
      { label: 'Extrato Conta Corrente', href: '/dashboard/financeiro/extrato', icon: FileText, status: 'pronto' },
      { label: 'Conciliação Bancária', href: '/dashboard/financeiro/conciliacao', icon: ArrowLeftRight, status: 'pronto' },
      { label: 'Fluxo de Caixa', href: '/dashboard/financeiro/fluxo-caixa', icon: TrendingUp, status: 'pronto' },
      { label: 'Saúde Financeira', href: '/dashboard/financeiro/saude', icon: HeartPulse, status: 'pronto' },
      { label: 'Nova Despesa', href: '/dashboard/financeiro/nova-despesa', icon: Plus, status: 'pronto' },
      { label: 'Nova Receita', href: '/dashboard/financeiro/nova-receita', icon: Plus, status: 'pronto' },
    ],
  },
  {
    id: 'contratos',
    label: 'Contratos & Vendas',
    icon: FileBarChart,
    items: [
      { label: 'Cobranças Recorrentes', href: '/dashboard/cadastros/contratos-recorrentes', icon: Repeat, status: 'pronto' },
      { label: 'Contratos Recorrentes', href: '/dashboard/contratos', icon: FileText, status: 'pronto' },
      { label: 'Orçamento', href: '/dashboard/orcamento', icon: Calculator, status: 'pronto' },
    ],
  },
  {
    id: 'analises',
    label: 'Análises & Relatórios',
    icon: BarChart3,
    items: [
      { label: 'DRE Divisional', href: '/dashboard/dre-divisional', icon: PieChart, status: 'pronto' },
      { label: 'Análises Financeiras', href: '/dashboard/analises', icon: BarChart3, status: 'pronto' },
      { label: 'Operacional', href: '/dashboard/operacional', icon: Activity, status: 'pronto' },
      { label: 'Resultado (DRE)', href: '/dashboard/dre-divisional', icon: Receipt, status: 'pronto' },
    ],
  },
  {
    id: 'inteligencia',
    label: 'Inteligência & Proteção',
    icon: Shield,
    items: [
      { label: 'Score de Inadimplência', href: '/dashboard/score', icon: ScanBarcode, status: 'parcial' },
      { label: 'Anti-Fraude Boletos', href: '/dashboard/anti-fraude', icon: Shield, status: 'pronto' },
    ],
  },
]

export function statusTagClasses(status?: MenuStatus): string {
  switch (status) {
    case 'pronto':
      return 'bg-[#C0DD97] text-[#173404]'
    case 'parcial':
      return 'bg-[#FAC775] text-[#412402]'
    case 'em_dev':
      return 'bg-[#85B7EB] text-[#042C53]'
    case 'planejado':
      return 'bg-gray-200 text-gray-600'
    default:
      return ''
  }
}

export function statusTagLabel(status?: MenuStatus): string {
  switch (status) {
    case 'pronto': return 'PRONTO'
    case 'parcial': return 'PARCIAL'
    case 'em_dev': return 'EM DEV'
    case 'planejado': return 'PLANEJADO'
    default: return ''
  }
}
