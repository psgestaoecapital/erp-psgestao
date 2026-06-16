export type SidebarStatus = 'pronto' | 'parcial' | 'em_breve'

export interface SidebarSubItemNode {
  id: string
  label: string
  href: string
  status: SidebarStatus
  badge?: string
  matchPaths?: string[]
}

export interface SidebarModuleNode {
  id: string
  label: string
  href?: string
  items?: SidebarSubItemNode[]
  status: SidebarStatus
  separator?: boolean
  matchPaths?: string[]
}

// ADMIN-CONECTORES-NO-MENU-v1 · bloco reutilizavel
// Quando outras areas (BPO, Wealth, Industrial) ganharem config propria,
// basta dar o mesmo ...MODULOS_ADMIN no array delas.
const MODULOS_ADMIN: SidebarModuleNode[] = [
  {
    id: 'administracao',
    label: 'Administração',
    status: 'pronto',
    items: [
      { id: 'admin', label: 'Admin', href: '/dashboard/admin',
        status: 'pronto', matchPaths: ['/dashboard/admin'] },
      { id: 'conectores', label: 'Conectores & APIs', href: '/dashboard/conectores',
        status: 'pronto', matchPaths: ['/dashboard/conectores'] },
      { id: 'conexoes-bancarias', label: 'Conexões Bancárias', href: '/dashboard/financeiro/conexoes-bancarias',
        status: 'pronto', matchPaths: ['/dashboard/financeiro/conexoes-bancarias'] },
    ],
  },
];

// Sidebar shared default · Gestao Empresarial (Onda 1)
// Outros areas (BPO, Wealth, Industrial etc) ganham configs proprias no proximo PR
export const SIDEBAR_GESTAO_EMPRESARIAL: SidebarModuleNode[] = [
  {
    id: 'inicio',
    label: 'Início',
    href: '/dashboard/gestao-empresarial',
    matchPaths: ['/dashboard/home', '/dashboard/gestao-empresarial'],
    status: 'pronto',
  },
  {
    id: 'financeiro',
    label: 'Financeiro',
    status: 'pronto',
    items: [
      { id: 'receber', label: 'A Receber', href: '/dashboard/financeiro/receber', status: 'pronto', badge: 'NFSe' },
      { id: 'pagar', label: 'A Pagar', href: '/dashboard/financeiro/pagar', status: 'pronto' },
      { id: 'nova-receita', label: 'Nova Receita', href: '/dashboard/financeiro/nova-receita', status: 'pronto' },
      { id: 'nova-despesa', label: 'Nova Despesa', href: '/dashboard/financeiro/nova-despesa', status: 'pronto' },
      { id: 'fluxo-caixa', label: 'Fluxo de Caixa', href: '/dashboard/financeiro/fluxo-caixa', status: 'pronto' },
      { id: 'extrato', label: 'Extrato Bancário', href: '/dashboard/financeiro/extrato', status: 'parcial' },
      { id: 'inadimplentes', label: 'Inadimplentes', href: '/dashboard/financeiro/inadimplentes', status: 'pronto' },
      { id: 'saude', label: 'Saúde Financeira', href: '/dashboard/financeiro/saude', status: 'pronto' },
    ],
  },
  {
    id: 'financiamento',
    label: 'Financiamento',
    href: '/dashboard/gestao-empresarial/financiamento',
    status: 'pronto',
  },
  {
    id: 'conciliacao',
    label: 'Conciliação',
    status: 'pronto',
    items: [
      { id: 'inbox', label: 'Inbox', href: '/dashboard/financeiro/conciliacao/inbox', status: 'pronto' },
      { id: 'conciliar', label: 'Conciliar', href: '/dashboard/conciliacao', status: 'pronto' },
    ],
  },
  {
    id: 'vendas-fiscal',
    label: 'Vendas & Fiscal',
    status: 'pronto',
    items: [
      { id: 'vendas-faturamento', label: 'Vendas / Faturamento', href: '/dashboard/commerce/otc', status: 'pronto' },
      { id: 'os', label: 'Ordens de Serviço', href: '/dashboard/os', status: 'pronto', badge: 'mobile' },
      { id: 'hub-fiscal', label: 'Hub Fiscal', href: '/dashboard/fiscal', status: 'pronto' },
      { id: 'nfse-emitidas', label: 'NFSe Emitidas', href: '/dashboard/fiscal/nfse', status: 'pronto' },
      { id: 'nfe-emitidas', label: 'NFe Emitidas', href: '/dashboard/fiscal/nfe', status: 'pronto', badge: 'NFe' },
      { id: 'nfe-devolucao', label: 'NFe Devolução de compra', href: '/dashboard/fiscal/nfe/devolucao', status: 'pronto' },
      { id: 'nfe-devol-venda', label: 'NFe Devolução de venda', href: '/dashboard/fiscal/nfe/devolucao-venda', status: 'pronto' },
      { id: 'nfe-remessa', label: 'NFe Remessa / diversa', href: '/dashboard/fiscal/nfe/remessa', status: 'pronto' },
      { id: 'gov-nfse', label: 'NFSe Nacional gov.br', href: '/dashboard/fiscal/gov-nfse', status: 'parcial', badge: 'gov.br' },
    ],
  },
  {
    id: 'compras',
    label: 'Compras',
    status: 'parcial',
    items: [
      { id: 'pedidos', label: 'Pedidos de Compra', href: '/dashboard/commerce/compras?area=gestao_empresarial', status: 'pronto', matchPaths: ['/dashboard/commerce/compras', '/dashboard/compras'] },
      { id: 'mde', label: 'NFes Recebidas (MDe)', href: '/dashboard/fiscal/mde', status: 'em_breve' },
      { id: 'fornecedores', label: 'Fornecedores', href: '/dashboard/cadastros/fornecedores', status: 'parcial' },
    ],
  },
  {
    id: 'estoque',
    label: 'Estoque',
    status: 'parcial',
    items: [
      { id: 'produtos', label: 'Produtos', href: '/dashboard/commerce/estoque?tab=produtos&area=gestao_empresarial', status: 'pronto', matchPaths: ['/dashboard/commerce/estoque', '/dashboard/estoque'] },
      { id: 'movimentacoes', label: 'Movimentações', href: '/dashboard/commerce/estoque?tab=movimentacoes&area=gestao_empresarial', status: 'pronto', matchPaths: ['/dashboard/commerce/estoque', '/dashboard/estoque'] },
    ],
  },
  {
    id: 'contratos',
    label: 'Contratos',
    status: 'pronto',
    items: [
      { id: 'ativos', label: 'Contratos Ativos', href: '/dashboard/contratos', status: 'pronto' },
      { id: 'recorrentes', label: 'Contratos Recorrentes', href: '/dashboard/cadastros/contratos-recorrentes', status: 'pronto' },
    ],
  },
  {
    id: 'cadastros',
    label: 'Cadastros',
    status: 'pronto',
    items: [
      { id: 'clientes', label: 'Clientes', href: '/dashboard/cadastros/clientes', status: 'parcial' },
      { id: 'fornecedores', label: 'Fornecedores', href: '/dashboard/cadastros/fornecedores', status: 'parcial' },
      { id: 'produtos', label: 'Produtos', href: '/dashboard/cadastros/produtos', status: 'pronto' },
      { id: 'servicos', label: 'Serviços', href: '/dashboard/cadastros/servicos', status: 'pronto', badge: 'NFSe' },
      { id: 'plano-contas', label: 'Plano de Contas', href: '/dashboard/cadastros/plano-contas', status: 'pronto' },
      { id: 'contas-bancarias', label: 'Contas Bancárias', href: '/dashboard/cadastros/contas-bancarias', status: 'parcial' },
      { id: 'divisoes-ldn', label: 'Divisões / LDN', href: '/dashboard/cadastros/linhas-negocio', status: 'parcial' },
    ],
  },
  {
    id: 'analises-dre',
    label: 'Análises & DRE',
    status: 'parcial',
    items: [
      { id: 'dre-divisional', label: 'DRE Divisional', href: '/dashboard/dre-divisional', status: 'parcial' },
      { id: 'configurar-dre', label: 'Configurar DRE', href: '/dashboard/dre-divisional/configurar', status: 'pronto' },
      { id: 'analises', label: 'Análises Financeiras', href: '/dashboard/analises', status: 'parcial' },
      { id: 'contas-unificadas', label: 'Contas Unificadas', href: '/dashboard/contas', status: 'pronto' },
    ],
  },
  {
    id: 'inteligencia',
    label: 'Inteligência',
    status: 'pronto',
    items: [
      { id: 'consultor-ia', label: 'Consultor IA', href: '/dashboard/consultor-ia', status: 'pronto', badge: 'IA' },
      { id: 'previsao', label: 'Previsão de Caixa', href: '/dashboard/previsao', status: 'parcial' },
      { id: 'score', label: 'Score Inadimplência', href: '/dashboard/score', status: 'parcial' },
      { id: 'anti-fraude', label: 'Anti-Fraude', href: '/dashboard/anti-fraude', status: 'parcial' },
    ],
  },
  // ADMIN-CONECTORES-NO-MENU-v1: bloco reutilizavel · ver MODULOS_ADMIN no topo
  ...MODULOS_ADMIN,
  // separator
  {
    id: 'configuracoes',
    label: 'Configurações',
    status: 'pronto',
    separator: true,
    items: [
      { id: 'empresa', label: 'Empresa', href: '/dashboard/configuracoes/empresa', status: 'em_breve' },
      { id: 'fiscal', label: 'Fiscal (A1 + Focus NFe)', href: '/dashboard/configuracoes/fiscal', status: 'pronto', badge: 'NFe' },
    ],
  },
  {
    id: 'sair',
    label: 'Sair',
    href: '/api/auth/logout',
    status: 'pronto',
    separator: true,
  },
]
