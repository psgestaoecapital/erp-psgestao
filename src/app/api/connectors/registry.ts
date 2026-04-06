// Universal Connector Registry — PS Gestão BPO
// Each connector follows the same interface, making it easy to add new integrations

export interface Connector {
  id: string;
  nome: string;
  categoria: "erp" | "banco" | "fiscal" | "pagamento";
  status: "ativo" | "em_breve" | "planejado";
  icon: string;
  cor: string;
  descricao: string;
  campos_config: { key: string; label: string; tipo: string; placeholder: string }[];
  endpoints: string[];
  dados_disponiveis: string[];
}

export const CONNECTORS: Connector[] = [
  // === ERPs ===
  {
    id: "omie", nome: "Omie", categoria: "erp", status: "ativo", icon: "🟢", cor: "#22C55E",
    descricao: "ERP completo. Integração com paginação total já implementada.",
    campos_config: [
      { key: "app_key", label: "App Key", tipo: "text", placeholder: "Chave do aplicativo Omie" },
      { key: "app_secret", label: "App Secret", tipo: "password", placeholder: "Secret do aplicativo Omie" },
    ],
    endpoints: ["empresa", "categorias", "produtos", "clientes", "contas_pagar", "contas_receber", "vendas", "estoque", "resumo"],
    dados_disponiveis: ["Contas a pagar", "Contas a receber", "Clientes", "Fornecedores", "Categorias", "Produtos", "Vendas", "Estoque"],
  },
  {
    id: "nibo", nome: "Nibo", categoria: "erp", status: "em_breve", icon: "🔵", cor: "#3B82F6",
    descricao: "Gestão financeira para contadores. API REST + OAuth 2.0.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Chave da API Nibo" },
      { key: "company_id", label: "ID da Empresa", tipo: "text", placeholder: "ID no Nibo" },
    ],
    endpoints: ["lancamentos", "clientes", "fornecedores", "boletos", "categorias", "contas_bancarias"],
    dados_disponiveis: ["Lançamentos", "Clientes", "Fornecedores", "Boletos", "NFS-e", "Conciliação"],
  },
  {
    id: "bomcontrole", nome: "Bom Controle", categoria: "erp", status: "em_breve", icon: "🟠", cor: "#F97316",
    descricao: "ERP multiempresa com módulo BPO. API RESTful + Token.",
    campos_config: [
      { key: "token", label: "Token de Autenticação", tipo: "text", placeholder: "Token do Bom Controle" },
    ],
    endpoints: ["financeiro", "clientes", "vendas", "estoque", "nfe", "boletos"],
    dados_disponiveis: ["Financeiro", "CRM", "Estoque", "NF-e", "Boletos", "Contratos"],
  },
  {
    id: "contaazul", nome: "ContaAzul", categoria: "erp", status: "em_breve", icon: "🔷", cor: "#0EA5E9",
    descricao: "Gestão financeira para PMEs. API REST + OAuth 2.0.",
    campos_config: [
      { key: "client_id", label: "Client ID", tipo: "text", placeholder: "OAuth Client ID" },
      { key: "client_secret", label: "Client Secret", tipo: "password", placeholder: "OAuth Secret" },
    ],
    endpoints: ["clientes", "vendas", "cobrancas", "categorias", "lancamentos"],
    dados_disponiveis: ["Clientes", "Vendas", "Cobranças", "Categorias", "Lançamentos", "NFS-e"],
  },
  {
    id: "bling", nome: "Bling", categoria: "erp", status: "em_breve", icon: "🟣", cor: "#8B5CF6",
    descricao: "ERP para e-commerce e varejo. API REST.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Chave da API Bling" },
    ],
    endpoints: ["pedidos", "produtos", "nfe", "financeiro", "contatos"],
    dados_disponiveis: ["Pedidos", "Produtos", "NF-e", "Financeiro", "Contatos"],
  },
  {
    id: "controlle", nome: "Controlle", categoria: "erp", status: "em_breve", icon: "🟤", cor: "#A16207",
    descricao: "Gestão financeira com Open Finance via Belvo.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Chave Controlle" },
    ],
    endpoints: ["transacoes", "categorias", "contas"],
    dados_disponiveis: ["Transações bancárias", "Categorias", "Contas", "Extratos"],
  },
  {
    id: "granatum", nome: "Granatum", categoria: "erp", status: "planejado", icon: "🟡", cor: "#EAB308",
    descricao: "Gestão financeira simples. API REST + Token.",
    campos_config: [
      { key: "access_token", label: "Access Token", tipo: "text", placeholder: "Token do Granatum" },
    ],
    endpoints: ["lancamentos", "clientes", "categorias", "contas_bancarias", "fluxo_caixa"],
    dados_disponiveis: ["Lançamentos", "Clientes", "Categorias", "Fluxo de caixa", "Relatórios"],
  },
  // === BANCOS / OPEN FINANCE ===
  {
    id: "pluggy", nome: "Pluggy", categoria: "banco", status: "em_breve", icon: "🏦", cor: "#06B6D4",
    descricao: "Open Finance — 300+ bancos. Extratos, saldos, investimentos.",
    campos_config: [
      { key: "client_id", label: "Client ID", tipo: "text", placeholder: "Pluggy Client ID" },
      { key: "client_secret", label: "Client Secret", tipo: "password", placeholder: "Pluggy Secret" },
    ],
    endpoints: ["accounts", "transactions", "investments", "identity"],
    dados_disponiveis: ["Extratos bancários", "Saldos", "Investimentos", "Cartões de crédito"],
  },
  {
    id: "belvo", nome: "Belvo", categoria: "banco", status: "em_breve", icon: "🏛️", cor: "#14B8A6",
    descricao: "Open Finance — 200+ instituições. Dados fiscais e bancários.",
    campos_config: [
      { key: "secret_id", label: "Secret ID", tipo: "text", placeholder: "Belvo Secret ID" },
      { key: "secret_password", label: "Secret Password", tipo: "password", placeholder: "Belvo Password" },
    ],
    endpoints: ["accounts", "transactions", "balances", "tax_returns"],
    dados_disponiveis: ["Contas", "Transações", "Saldos", "Dados fiscais"],
  },
  // === PAGAMENTOS ===
  {
    id: "asaas", nome: "Asaas", categoria: "pagamento", status: "em_breve", icon: "💳", cor: "#10B981",
    descricao: "Cobranças, boletos, Pix, cartão. API completa de pagamentos.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Chave da API Asaas" },
    ],
    endpoints: ["cobrancas", "pagamentos", "transferencias", "pix"],
    dados_disponiveis: ["Cobranças", "Pagamentos", "Transferências Pix", "Boletos", "Split"],
  },
  {
    id: "cora", nome: "Cora", categoria: "pagamento", status: "planejado", icon: "💰", cor: "#EC4899",
    descricao: "Conta digital PJ. Boletos, Pix, gestão financeira.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Chave da API Cora" },
    ],
    endpoints: ["boletos", "pix", "transferencias", "extrato"],
    dados_disponiveis: ["Boletos", "Pix", "Transferências", "Extrato"],
  },
  // === FISCAL ===
  {
    id: "enotas", nome: "eNotas", categoria: "fiscal", status: "em_breve", icon: "📄", cor: "#6366F1",
    descricao: "Emissão de NFS-e para 1.000+ municípios.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Chave da API eNotas" },
    ],
    endpoints: ["nfse_emitir", "nfse_consultar", "empresas"],
    dados_disponiveis: ["Emissão NFS-e", "Consulta NFS-e", "Empresas"],
  },
  {
    id: "focusnfe", nome: "Focus NFe", categoria: "fiscal", status: "planejado", icon: "🧾", cor: "#8B5CF6",
    descricao: "NF-e, NFC-e, NFS-e, CT-e. API completa fiscal.",
    campos_config: [
      { key: "token", label: "Token", tipo: "text", placeholder: "Token Focus NFe" },
    ],
    endpoints: ["nfe", "nfce", "nfse", "cte"],
    dados_disponiveis: ["NF-e", "NFC-e", "NFS-e", "CT-e", "Manifestação"],
  },
];

export const getConnector = (id: string) => CONNECTORS.find(c => c.id === id);
export const getActiveConnectors = () => CONNECTORS.filter(c => c.status === "ativo");
export const getConnectorsByCategory = (cat: string) => CONNECTORS.filter(c => c.categoria === cat);
