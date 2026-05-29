import {
  Building2, Briefcase, Rocket, Coins, Factory, ShoppingBag,
  ShieldCheck, Brain, UserCheck, Workflow, Calculator, Plug,
  type LucideIcon,
} from 'lucide-react'

export interface AreaConfig {
  id: string
  label: string
  shortLabel?: string
  icon: LucideIcon
  hubRoute: string
  description?: string
  visivel: boolean
}

// 12 áreas operacionais visíveis (RD-33)
export const AREAS_VISIVEIS: AreaConfig[] = [
  {
    id: 'gestao_empresarial',
    label: 'Gestão Empresarial',
    shortLabel: 'GE',
    icon: Building2,
    hubRoute: '/dashboard/gestao-empresarial',
    description: 'Hub financeiro completo · DRE · Inadimplentes · Saúde',
    visivel: true,
  },
  {
    id: 'bpo',
    label: 'BPO Financeiro',
    shortLabel: 'BPO',
    icon: Briefcase,
    hubRoute: '/dashboard/bpo',
    description: 'Operação terceirizada multi-empresa',
    visivel: true,
  },
  {
    id: 'pm',
    label: 'Produção & Marketing',
    shortLabel: 'PEM',
    icon: Rocket,
    hubRoute: '/dashboard/pm',
    description: 'Agência · briefings · jobs · timesheet · mídia',
    visivel: true,
  },
  {
    id: 'wealth',
    label: 'Wealth (CVM 19)',
    shortLabel: 'Wealth',
    icon: Coins,
    hubRoute: '/dashboard/wealth',
    description: 'Consultoria de investimentos regulada',
    visivel: true,
  },
  {
    id: 'industrial',
    label: 'Industrial',
    icon: Factory,
    hubRoute: '/dashboard/industrial',
    description: 'Custo industrial · ficha técnica · custeio',
    visivel: true,
  },
  {
    id: 'commerce',
    label: 'Comércio',
    icon: ShoppingBag,
    hubRoute: '/dashboard/commerce',
    description: 'Varejo · estoque · vendas',
    visivel: true,
  },
  {
    id: 'compliance',
    label: 'Compliance',
    icon: ShieldCheck,
    hubRoute: '/dashboard/compliance',
    description: 'LGPD · CVM · Reforma Tributária · obrigações',
    visivel: true,
  },
  {
    id: 'inteligencia',
    label: 'Inteligência',
    icon: Brain,
    hubRoute: '/dashboard/consultor-ia',
    description: 'Consultor IA · Anti-fraude · Score',
    visivel: true,
  },
  {
    id: 'assessor',
    label: 'Assessor',
    icon: UserCheck,
    hubRoute: '/dashboard/assessor',
    description: 'Painel do AAI · clientes Wealth',
    visivel: true,
  },
  {
    id: 'operacao',
    label: 'Operação',
    icon: Workflow,
    hubRoute: '/dashboard/orcamentos',
    description: 'Orçamentos · pedidos · cotações · compras',
    visivel: true,
  },
  {
    id: 'contador',
    label: 'Contador',
    icon: Calculator,
    hubRoute: '/dashboard/contador',
    description: 'Painel do contador externo',
    visivel: true,
  },
  {
    id: 'integrations',
    label: 'Integrações',
    icon: Plug,
    hubRoute: '/dashboard/integrations',
    description: 'ContaAzul · Pluggy · Omie · APIs',
    visivel: true,
  },
]

export function detectarAreaAtiva(pathname: string): AreaConfig | null {
  if (!pathname) return null
  const matches = AREAS_VISIVEIS
    .filter((a) => pathname.startsWith(a.hubRoute))
    .sort((a, b) => b.hubRoute.length - a.hubRoute.length)
  if (matches.length > 0) return matches[0]
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('area_atual_id')
    if (stored) return AREAS_VISIVEIS.find((a) => a.id === stored) ?? null
  }
  return null
}
