import {
  Home, Wallet, CreditCard, Coins, AlertTriangle, FileText, ArrowLeftRight,
  TrendingUp, HeartPulse, Plus, FileBarChart, Repeat, Calculator,
  PieChart, BarChart3, Activity, Receipt, Shield, ScanBarcode, Sparkles,
  Settings, Briefcase, BookOpen, Package, Users, Truck, Banknote,
  Network, Layers, Inbox, Sun, Target, Eye, MessageSquare, Lock,
  Bot, Clock, Calendar, UserCheck, HardHat, Files, CheckCircle, FileCheck,
  Sliders,
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
      { label: 'Conciliação · Inbox', href: '/dashboard/financeiro/conciliacao/inbox', icon: Inbox, status: 'pronto' },
      { label: 'Fluxo de Caixa', href: '/dashboard/financeiro/fluxo-caixa', icon: TrendingUp, status: 'pronto' },
      { label: 'Saúde Financeira', href: '/dashboard/financeiro/saude', icon: HeartPulse, status: 'pronto' },
      { label: 'Contas Unificado', href: '/dashboard/contas', icon: Banknote, status: 'pronto' },
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
      { label: 'Configurar DRE', href: '/dashboard/dre-divisional/configurar', icon: Sliders, status: 'pronto' },
      { label: 'Análises Financeiras', href: '/dashboard/analises', icon: BarChart3, status: 'pronto' },
      { label: 'Operacional', href: '/dashboard/operacional', icon: Activity, status: 'pronto' },
      { label: 'Resultado (DRE)', href: '/dashboard/dre-divisional', icon: Receipt, status: 'pronto' },
    ],
  },
  {
    id: 'cadastros',
    label: 'Cadastros',
    icon: BookOpen,
    items: [
      { label: 'Clientes', href: '/dashboard/cadastros/clientes', icon: Users, status: 'pronto' },
      { label: 'Fornecedores', href: '/dashboard/cadastros/fornecedores', icon: Truck, status: 'pronto' },
      { label: 'Produtos', href: '/dashboard/cadastros/produtos', icon: Package, status: 'pronto', badge: 'NFe' },
      { label: 'Plano de Contas', href: '/dashboard/cadastros/plano-contas', icon: BookOpen, status: 'pronto' },
      { label: 'Contas Bancárias', href: '/dashboard/cadastros/contas-bancarias', icon: Banknote, status: 'pronto' },
      { label: 'Linhas de Negócio', href: '/dashboard/cadastros/linhas-negocio', icon: Network, status: 'pronto' },
      { label: 'Divisões LDN', href: '/dashboard/cadastros/divisoes', icon: Layers, status: 'pronto' },
      { label: 'Contratos Recorrentes', href: '/dashboard/cadastros/contratos-recorrentes', icon: Repeat, status: 'pronto' },
    ],
  },
  {
    id: 'bpo',
    label: 'BPO Financeiro',
    icon: Briefcase,
    items: [
      { label: 'Painel BPO', href: '/dashboard/bpo', icon: Briefcase, status: 'pronto' },
      { label: 'Inbox', href: '/dashboard/bpo/inbox', icon: Inbox, status: 'pronto' },
      { label: 'Meu Dia', href: '/dashboard/bpo/meu-dia', icon: Sun, status: 'pronto' },
      { label: 'Modo Foco', href: '/dashboard/bpo/foco', icon: Target, status: 'pronto' },
      { label: 'Supervisão', href: '/dashboard/bpo/supervisao', icon: Eye, status: 'pronto' },
      { label: 'Conversas', href: '/dashboard/bpo/conversas', icon: MessageSquare, status: 'pronto' },
      { label: 'Fechamento Mensal', href: '/dashboard/bpo/fechamento', icon: Lock, status: 'pronto' },
      { label: 'Automação IA', href: '/dashboard/bpo/automacao', icon: Bot, status: 'pronto' },
      { label: 'Rotinas Automáticas', href: '/dashboard/bpo/rotinas', icon: Clock, status: 'pronto' },
    ],
  },
  {
    id: 'compliance',
    label: 'Compliance',
    icon: Shield,
    items: [
      { label: 'Painel Compliance', href: '/dashboard/compliance', icon: Shield, status: 'pronto' },
      { label: 'Calendário Legal IA', href: '/dashboard/compliance/calendario', icon: Calendar, status: 'pronto' },
      { label: 'Funcionários', href: '/dashboard/compliance/funcionarios', icon: UserCheck, status: 'pronto' },
      { label: 'Prestadores', href: '/dashboard/compliance/prestadores', icon: HardHat, status: 'pronto' },
      { label: 'EPI', href: '/dashboard/compliance/epi', icon: Shield, status: 'pronto' },
      { label: 'Matriz de Documentos', href: '/dashboard/compliance/matriz', icon: Files, status: 'pronto' },
      { label: 'Validação Automática', href: '/dashboard/compliance/validacao-automatica', icon: CheckCircle, status: 'pronto' },
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
  {
    id: 'configuracoes',
    label: 'Configurações',
    icon: Settings,
    items: [
      { label: 'Fiscal · A1 + Focus NFe', href: '/dashboard/configuracoes/fiscal', icon: FileCheck, status: 'pronto', badge: 'NFe' },
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
