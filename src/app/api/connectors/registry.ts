// Universal Connector Registry — PS Gestao BPO v8.7
// 40+ conectores organizados por categoria
// Cada conector segue a mesma interface para integração padronizada

export interface Connector {
  id: string;
  nome: string;
  categoria: "erp_financeiro" | "erp_enterprise" | "erp_industrial" | "erp_agro" | "rh_ponto" | "manutencao" | "logistica" | "banco" | "fiscal" | "pagamento";
  status: "ativo" | "em_breve" | "planejado";
  icon: string;
  cor: string;
  descricao: string;
  campos_config: { key: string; label: string; tipo: string; placeholder: string }[];
  endpoints: string[];
  dados_disponiveis: string[];
  integracao: string;
}

export const CONNECTORS: Connector[] = [

  // ═══════════════════════════════════════════════════════════
  // ERPs FINANCEIROS / PME
  // ═══════════════════════════════════════════════════════════
  {
    id: "omie", nome: "Omie", categoria: "erp_financeiro", status: "ativo", icon: "O", cor: "#22C55E",
    descricao: "ERP completo para PMEs. Integracaoo com paginacao total implementada.",
    campos_config: [
      { key: "app_key", label: "App Key", tipo: "text", placeholder: "Chave do aplicativo Omie" },
      { key: "app_secret", label: "App Secret", tipo: "password", placeholder: "Secret do aplicativo Omie" },
    ],
    endpoints: ["empresa", "categorias", "produtos", "clientes", "contas_pagar", "contas_receber", "vendas", "estoque", "resumo"],
    dados_disponiveis: ["Contas a pagar", "Contas a receber", "Clientes", "Fornecedores", "Categorias", "Produtos", "Vendas", "Estoque"],
    integracao: "API REST JSON-RPC com paginacao",
  },
  {
    id: "contaazul", nome: "ContaAzul", categoria: "erp_financeiro", status: "em_breve", icon: "CA", cor: "#0EA5E9",
    descricao: "Gestao financeira para PMEs. API REST + OAuth 2.0. 3M+ empresas.",
    campos_config: [
      { key: "client_id", label: "Client ID", tipo: "text", placeholder: "OAuth Client ID" },
      { key: "client_secret", label: "Client Secret", tipo: "password", placeholder: "OAuth Secret" },
    ],
    endpoints: ["clientes", "vendas", "cobrancas", "categorias", "lancamentos"],
    dados_disponiveis: ["Clientes", "Vendas", "Cobrancas", "Categorias", "Lancamentos", "NFS-e"],
    integracao: "API REST + OAuth 2.0",
  },
  {
    id: "bling", nome: "Bling", categoria: "erp_financeiro", status: "em_breve", icon: "BL", cor: "#8B5CF6",
    descricao: "ERP para e-commerce e varejo. Integracao com marketplaces. API REST v3.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Chave da API Bling v3" },
    ],
    endpoints: ["pedidos", "produtos", "nfe", "financeiro", "contatos", "estoque"],
    dados_disponiveis: ["Pedidos", "Produtos", "NF-e", "Financeiro", "Contatos", "Estoque"],
    integracao: "API REST v3 + OAuth 2.0",
  },
  {
    id: "nibo", nome: "Nibo", categoria: "erp_financeiro", status: "em_breve", icon: "NB", cor: "#3B82F6",
    descricao: "Gestao financeira para contadores. 50K+ escritorios. API REST + OAuth 2.0.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Chave da API Nibo" },
      { key: "company_id", label: "ID da Empresa", tipo: "text", placeholder: "ID no Nibo" },
    ],
    endpoints: ["lancamentos", "clientes", "fornecedores", "boletos", "categorias", "contas_bancarias"],
    dados_disponiveis: ["Lancamentos", "Clientes", "Fornecedores", "Boletos", "NFS-e", "Conciliacao"],
    integracao: "API REST + Bearer Token",
  },
  {
    id: "granatum", nome: "Granatum", categoria: "erp_financeiro", status: "planejado", icon: "GR", cor: "#EAB308",
    descricao: "Gestao financeira simples para PMEs. API REST + Token.",
    campos_config: [
      { key: "access_token", label: "Access Token", tipo: "text", placeholder: "Token do Granatum" },
    ],
    endpoints: ["lancamentos", "clientes", "categorias", "contas_bancarias", "fluxo_caixa"],
    dados_disponiveis: ["Lancamentos", "Clientes", "Categorias", "Fluxo de caixa", "Relatorios"],
    integracao: "API REST + Token",
  },
  {
    id: "controlle", nome: "Controlle", categoria: "erp_financeiro", status: "planejado", icon: "CT", cor: "#A16207",
    descricao: "Gestao financeira com Open Finance via Belvo. Conciliacao automatica.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Chave Controlle" },
    ],
    endpoints: ["transacoes", "categorias", "contas"],
    dados_disponiveis: ["Transacoes bancarias", "Categorias", "Contas", "Extratos"],
    integracao: "API REST + Token",
  },
  {
    id: "tiny", nome: "Tiny ERP", categoria: "erp_financeiro", status: "planejado", icon: "TN", cor: "#F97316",
    descricao: "ERP para e-commerce. Integracao com Mercado Livre, Shopee, Amazon. API REST.",
    campos_config: [
      { key: "token", label: "Token API", tipo: "text", placeholder: "Token do Tiny" },
    ],
    endpoints: ["pedidos", "produtos", "nfe", "financeiro", "contatos"],
    dados_disponiveis: ["Pedidos", "Produtos", "NF-e", "Financeiro", "Estoque"],
    integracao: "API REST + Token",
  },
  {
    id: "vhsys", nome: "vhsys", categoria: "erp_financeiro", status: "planejado", icon: "VH", cor: "#06B6D4",
    descricao: "ERP para PMEs. Maior homologacao NFS-e do Brasil. 10+ anos de mercado.",
    campos_config: [
      { key: "access_token", label: "Access Token", tipo: "text", placeholder: "Token vhsys" },
      { key: "secret_token", label: "Secret Token", tipo: "password", placeholder: "Secret vhsys" },
    ],
    endpoints: ["clientes", "produtos", "vendas", "financeiro", "nfe", "nfse"],
    dados_disponiveis: ["Clientes", "Produtos", "Vendas", "Financeiro", "NF-e", "NFS-e"],
    integracao: "API REST + Token duplo",
  },
  {
    id: "webmais", nome: "WebMais", categoria: "erp_financeiro", status: "planejado", icon: "WM", cor: "#10B981",
    descricao: "ERP para industrias e distribuidoras. Gestao fiscal completa.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Chave WebMais" },
    ],
    endpoints: ["financeiro", "producao", "estoque", "vendas", "compras"],
    dados_disponiveis: ["Financeiro", "Producao", "Estoque", "Vendas", "Compras", "NF-e"],
    integracao: "API REST",
  },
  {
    id: "nomus", nome: "Nomus", categoria: "erp_financeiro", status: "planejado", icon: "NM", cor: "#6366F1",
    descricao: "ERP industrial brasileiro. PCP, estoque, custos, qualidade.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Chave Nomus" },
    ],
    endpoints: ["producao", "estoque", "financeiro", "qualidade"],
    dados_disponiveis: ["Producao", "Estoque", "Financeiro", "Qualidade", "Custos"],
    integracao: "API REST / CSV Export",
  },

  // ═══════════════════════════════════════════════════════════
  // ERPs ENTERPRISE / GRANDES
  // ═══════════════════════════════════════════════════════════
  {
    id: "totvs", nome: "TOTVS Protheus", categoria: "erp_enterprise", status: "planejado", icon: "TV", cor: "#DC2626",
    descricao: "Maior ERP do Brasil. Protheus + RM. API REST + SOAP. Todos os segmentos.",
    campos_config: [
      { key: "base_url", label: "URL do Servidor", tipo: "text", placeholder: "https://servidor:porta" },
      { key: "user", label: "Usuario", tipo: "text", placeholder: "Usuario REST" },
      { key: "password", label: "Senha", tipo: "password", placeholder: "Senha REST" },
    ],
    endpoints: ["financeiro", "contabil", "estoque", "producao", "rh", "fiscal"],
    dados_disponiveis: ["Financeiro", "Contabil", "Estoque", "Producao", "RH", "Fiscal", "Compras"],
    integracao: "API REST Protheus / SOAP RM",
  },
  {
    id: "sap", nome: "SAP Business One", categoria: "erp_enterprise", status: "planejado", icon: "SAP", cor: "#0070F2",
    descricao: "ERP global para medias empresas. Service Layer API REST.",
    campos_config: [
      { key: "base_url", label: "Service Layer URL", tipo: "text", placeholder: "https://servidor:50000" },
      { key: "company_db", label: "Database", tipo: "text", placeholder: "Nome do banco" },
      { key: "user", label: "Usuario", tipo: "text", placeholder: "manager" },
      { key: "password", label: "Senha", tipo: "password", placeholder: "Senha SAP" },
    ],
    endpoints: ["BusinessPartners", "Invoices", "PurchaseInvoices", "JournalEntries", "Items"],
    dados_disponiveis: ["Parceiros", "Faturas", "Compras", "Lancamentos contabeis", "Itens", "Estoque"],
    integracao: "Service Layer REST API (OData)",
  },
  {
    id: "senior", nome: "Senior Sistemas", categoria: "erp_enterprise", status: "planejado", icon: "SR", cor: "#7C3AED",
    descricao: "ERP catarinense para medias/grandes. Forte em manufatura, RH e servicos.",
    campos_config: [
      { key: "base_url", label: "URL Senior", tipo: "text", placeholder: "https://plataforma.senior.com.br" },
      { key: "access_key", label: "Access Key", tipo: "text", placeholder: "Chave de acesso" },
      { key: "secret", label: "Secret", tipo: "password", placeholder: "Secret" },
    ],
    endpoints: ["hcm", "erp", "gestao_empresarial", "manufatura"],
    dados_disponiveis: ["RH/Folha", "Financeiro", "Estoque", "Producao", "Compras", "Vendas"],
    integracao: "API REST Senior X Platform",
  },
  {
    id: "sankhya", nome: "Sankhya", categoria: "erp_enterprise", status: "planejado", icon: "SK", cor: "#059669",
    descricao: "ERP flexivel e customizavel. Forte em distribuicao e industria.",
    campos_config: [
      { key: "base_url", label: "URL Sankhya", tipo: "text", placeholder: "https://servidor" },
      { key: "user", label: "Usuario", tipo: "text", placeholder: "Usuario" },
      { key: "password", label: "Senha", tipo: "password", placeholder: "Senha" },
    ],
    endpoints: ["financeiro", "estoque", "vendas", "compras", "producao"],
    dados_disponiveis: ["Financeiro", "Estoque", "Vendas", "Compras", "Producao", "Fiscal"],
    integracao: "API REST + Webservices SOAP",
  },

  // ═══════════════════════════════════════════════════════════
  // ERPs INDUSTRIAIS / ESPECIFICOS
  // ═══════════════════════════════════════════════════════════
  {
    id: "atak", nome: "Atak / Frigosoft", categoria: "erp_industrial", status: "em_breve", icon: "AT", cor: "#B91C1C",
    descricao: "ERP especializado em frigorificos. Chao de fabrica + administrativo. Bovinos, suinos, aves.",
    campos_config: [
      { key: "base_url", label: "URL Servidor", tipo: "text", placeholder: "https://servidor-atak" },
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Chave da API" },
    ],
    endpoints: ["producao", "abate", "estoque", "vendas", "financeiro", "nfe"],
    dados_disponiveis: ["Producao/Abate", "Rendimentos", "Estoque", "Vendas", "Financeiro", "NF-e", "Rastreabilidade"],
    integracao: "API REST / SQL Server direto / CSV Export",
  },
  {
    id: "arpa", nome: "Arpa Control", categoria: "erp_industrial", status: "em_breve", icon: "AR", cor: "#92400E",
    descricao: "ERP industrial sobre PostgreSQL. Integracao via read direto no banco.",
    campos_config: [
      { key: "pg_host", label: "Host PostgreSQL", tipo: "text", placeholder: "192.168.x.x" },
      { key: "pg_port", label: "Porta", tipo: "text", placeholder: "5432" },
      { key: "pg_database", label: "Database", tipo: "text", placeholder: "arpa_db" },
      { key: "pg_user", label: "Usuario", tipo: "text", placeholder: "readonly_user" },
      { key: "pg_password", label: "Senha", tipo: "password", placeholder: "Senha" },
    ],
    endpoints: ["financeiro", "estoque", "producao", "vendas"],
    dados_disponiveis: ["Financeiro", "Estoque", "Producao", "Vendas", "Compras", "NF-e"],
    integracao: "PostgreSQL read-only direto",
  },
  {
    id: "paripassu", nome: "PariPassu", categoria: "erp_industrial", status: "planejado", icon: "PP", cor: "#15803D",
    descricao: "Rastreabilidade e qualidade para industria alimenticia. APPCC, BPF.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Token PariPassu" },
    ],
    endpoints: ["rastreabilidade", "qualidade", "inspecao", "lotes"],
    dados_disponiveis: ["Rastreabilidade", "Qualidade", "APPCC", "Lotes", "Inspecoes SIF"],
    integracao: "API REST",
  },
  {
    id: "bomcontrole", nome: "Bom Controle", categoria: "erp_industrial", status: "planejado", icon: "BC", cor: "#F97316",
    descricao: "ERP multiempresa com modulo BPO. API RESTful + Token.",
    campos_config: [
      { key: "token", label: "Token", tipo: "text", placeholder: "Token do Bom Controle" },
    ],
    endpoints: ["financeiro", "clientes", "vendas", "estoque", "nfe", "boletos"],
    dados_disponiveis: ["Financeiro", "CRM", "Estoque", "NF-e", "Boletos", "Contratos"],
    integracao: "API REST + Token",
  },

  // ═══════════════════════════════════════════════════════════
  // ERPs AGRO
  // ═══════════════════════════════════════════════════════════
  {
    id: "siagri", nome: "Siagri / Aliare", categoria: "erp_agro", status: "planejado", icon: "SI", cor: "#16A34A",
    descricao: "Maior ERP para agronegocio do Brasil. 30% dos distribuidores de insumos. Aliare (Siagri + Datacoper).",
    campos_config: [
      { key: "base_url", label: "URL Servidor", tipo: "text", placeholder: "https://servidor-siagri" },
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Token" },
    ],
    endpoints: ["financeiro", "estoque", "vendas", "compras", "safra"],
    dados_disponiveis: ["Financeiro", "Estoque", "Vendas", "Compras", "Safra", "Insumos"],
    integracao: "SQL Server direto / CSV Export",
  },

  // ═══════════════════════════════════════════════════════════
  // RH / PONTO ELETRONICO
  // ═══════════════════════════════════════════════════════════
  {
    id: "iopoint", nome: "IO Point", categoria: "rh_ponto", status: "em_breve", icon: "IO", cor: "#2563EB",
    descricao: "Ponto eletronico inteligente com reconhecimento facial e GPS. Sede em SMO/SC.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Token IO Point" },
      { key: "empresa_id", label: "ID Empresa", tipo: "text", placeholder: "ID da empresa" },
    ],
    endpoints: ["registros", "espelho_ponto", "horas_extras", "banco_horas", "escalas"],
    dados_disponiveis: ["Registros de ponto", "Espelho ponto", "Horas extras", "Banco de horas", "Escalas", "Absenteismo"],
    integracao: "API REST / Export CSV/PDF",
  },
  {
    id: "pontotel", nome: "Pontotel", categoria: "rh_ponto", status: "planejado", icon: "PT", cor: "#7C3AED",
    descricao: "Sistema de ponto com fechamento de folha mais rapido do Brasil. API REST.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Token Pontotel" },
    ],
    endpoints: ["registros", "folha", "horas_extras", "ferias"],
    dados_disponiveis: ["Registros", "Folha de ponto", "Horas extras", "Ferias", "Timesheet"],
    integracao: "API REST + Webhooks",
  },
  {
    id: "dominio", nome: "Dominio Sistemas", categoria: "rh_ponto", status: "planejado", icon: "DM", cor: "#0369A1",
    descricao: "Sistema contabil e fiscal Thomson Reuters. Forte em folha de pagamento.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Token Dominio" },
    ],
    endpoints: ["folha", "contabil", "fiscal", "patrimonial"],
    dados_disponiveis: ["Folha de pagamento", "Contabilidade", "Fiscal", "Patrimonial"],
    integracao: "Export XML/CSV + API",
  },

  // ═══════════════════════════════════════════════════════════
  // MANUTENCAO / QUALIDADE
  // ═══════════════════════════════════════════════════════════
  {
    id: "produttivo", nome: "Produttivo", categoria: "manutencao", status: "em_breve", icon: "PD", cor: "#2DD4BF",
    descricao: "App de OS, checklists e planos de manutencao digital. Relatorios com foto.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Token Produttivo" },
    ],
    endpoints: ["ordens_servico", "checklists", "equipamentos", "clientes"],
    dados_disponiveis: ["Ordens de servico", "Checklists", "Equipamentos", "MTBF", "MTTR", "Nao conformidades"],
    integracao: "API REST",
  },
  {
    id: "engeman", nome: "Engeman", categoria: "manutencao", status: "planejado", icon: "EG", cor: "#0891B2",
    descricao: "Software de gestao de manutencao industrial. PCM completo.",
    campos_config: [
      { key: "base_url", label: "URL Servidor", tipo: "text", placeholder: "URL do Engeman" },
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Token" },
    ],
    endpoints: ["ordens_servico", "equipamentos", "planos_manutencao", "indicadores"],
    dados_disponiveis: ["OS preventiva/corretiva", "Equipamentos", "Planos PCM", "OEE", "MTBF", "MTTR"],
    integracao: "API REST / SQL Server",
  },
  {
    id: "manusis", nome: "Manusis", categoria: "manutencao", status: "planejado", icon: "MN", cor: "#4338CA",
    descricao: "CMMS/EAM para gestao de ativos e manutencao industrial.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Token Manusis" },
    ],
    endpoints: ["ordens_servico", "ativos", "indicadores"],
    dados_disponiveis: ["OS", "Ativos", "Indicadores", "Custos manutencao"],
    integracao: "API REST",
  },
  {
    id: "checklistfacil", nome: "Checklist Facil", categoria: "manutencao", status: "planejado", icon: "CF", cor: "#059669",
    descricao: "Plataforma de auditorias e checklists digitais. 300K+ checklists/ano.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Token Checklist Facil" },
    ],
    endpoints: ["checklists", "nao_conformidades", "planos_acao", "indicadores"],
    dados_disponiveis: ["Checklists", "Nao conformidades", "Planos de acao", "Indicadores de qualidade"],
    integracao: "API REST + Webhooks",
  },

  // ═══════════════════════════════════════════════════════════
  // LOGISTICA / FROTA / RASTREAMENTO
  // ═══════════════════════════════════════════════════════════
  {
    id: "brasilsat", nome: "Brasil Sat", categoria: "logistica", status: "em_breve", icon: "BS", cor: "#CA8A04",
    descricao: "Rastreamento GPS de frotas, veiculos e cargas. Telemetria completa.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Token Brasil Sat" },
      { key: "empresa_id", label: "ID Empresa", tipo: "text", placeholder: "ID no sistema" },
    ],
    endpoints: ["veiculos", "posicoes", "rotas", "combustivel", "alertas"],
    dados_disponiveis: ["Posicao GPS", "Rotas", "Km rodados", "Combustivel", "Velocidade", "Telemetria"],
    integracao: "API REST / CSV Export",
  },
  {
    id: "sascar", nome: "Sascar / Michelin", categoria: "logistica", status: "planejado", icon: "SC", cor: "#1D4ED8",
    descricao: "Gestao de frotas e telemetria avancada. Grupo Michelin.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Token Sascar" },
    ],
    endpoints: ["veiculos", "viagens", "combustivel", "manutencao", "motoristas"],
    dados_disponiveis: ["Veiculos", "Viagens", "Combustivel", "Manutencao", "Motoristas", "Jornada"],
    integracao: "API REST",
  },
  {
    id: "worldsat", nome: "World Sat", categoria: "logistica", status: "planejado", icon: "WS", cor: "#0E7490",
    descricao: "Rastreamento veicular 24h. GPS + telemetria. Frotas pesadas.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Token World Sat" },
    ],
    endpoints: ["veiculos", "posicoes", "alertas", "cercas_eletronicas"],
    dados_disponiveis: ["Posicao GPS", "Alertas", "Cercas eletronicas", "Velocidade"],
    integracao: "API REST / GPRS",
  },

  // ═══════════════════════════════════════════════════════════
  // OPEN FINANCE / BANCOS
  // ═══════════════════════════════════════════════════════════
  {
    id: "pluggy", nome: "Pluggy", categoria: "banco", status: "em_breve", icon: "PG", cor: "#06B6D4",
    descricao: "Open Finance — 300+ bancos brasileiros. Extratos, saldos, investimentos.",
    campos_config: [
      { key: "client_id", label: "Client ID", tipo: "text", placeholder: "Pluggy Client ID" },
      { key: "client_secret", label: "Client Secret", tipo: "password", placeholder: "Pluggy Secret" },
    ],
    endpoints: ["accounts", "transactions", "investments", "identity"],
    dados_disponiveis: ["Extratos bancarios", "Saldos", "Investimentos", "Cartoes de credito"],
    integracao: "API REST + OAuth 2.0",
  },
  {
    id: "belvo", nome: "Belvo", categoria: "banco", status: "em_breve", icon: "BV", cor: "#14B8A6",
    descricao: "Open Finance — 200+ instituicoes. Dados fiscais e bancarios.",
    campos_config: [
      { key: "secret_id", label: "Secret ID", tipo: "text", placeholder: "Belvo Secret ID" },
      { key: "secret_password", label: "Secret Password", tipo: "password", placeholder: "Belvo Password" },
    ],
    endpoints: ["accounts", "transactions", "balances", "tax_returns"],
    dados_disponiveis: ["Contas", "Transacoes", "Saldos", "Dados fiscais"],
    integracao: "API REST + Basic Auth",
  },

  // ═══════════════════════════════════════════════════════════
  // PAGAMENTOS / COBRANCA
  // ═══════════════════════════════════════════════════════════
  {
    id: "asaas", nome: "Asaas", categoria: "pagamento", status: "em_breve", icon: "AS", cor: "#10B981",
    descricao: "Cobrancas, boletos, Pix, cartao. API completa de pagamentos.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Chave da API Asaas" },
    ],
    endpoints: ["cobrancas", "pagamentos", "transferencias", "pix"],
    dados_disponiveis: ["Cobrancas", "Pagamentos", "Transferencias Pix", "Boletos", "Split"],
    integracao: "API REST + Webhooks",
  },
  {
    id: "cora", nome: "Cora", categoria: "pagamento", status: "planejado", icon: "CR", cor: "#EC4899",
    descricao: "Conta digital PJ. Boletos, Pix, gestao financeira.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Chave da API Cora" },
    ],
    endpoints: ["boletos", "pix", "transferencias", "extrato"],
    dados_disponiveis: ["Boletos", "Pix", "Transferencias", "Extrato"],
    integracao: "API REST + OAuth 2.0",
  },
  {
    id: "iugu", nome: "Iugu", categoria: "pagamento", status: "planejado", icon: "IU", cor: "#A855F7",
    descricao: "Plataforma de pagamentos. Boletos, Pix, cartao, assinaturas.",
    campos_config: [
      { key: "api_token", label: "API Token", tipo: "text", placeholder: "Token Iugu" },
    ],
    endpoints: ["faturas", "assinaturas", "transferencias", "clientes"],
    dados_disponiveis: ["Faturas", "Assinaturas", "Transferencias", "Clientes"],
    integracao: "API REST",
  },

  // ═══════════════════════════════════════════════════════════
  // FISCAL / NF-e
  // ═══════════════════════════════════════════════════════════
  {
    id: "enotas", nome: "eNotas", categoria: "fiscal", status: "em_breve", icon: "EN", cor: "#6366F1",
    descricao: "Emissao de NFS-e para 1.000+ municipios brasileiros.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Chave da API eNotas" },
    ],
    endpoints: ["nfse_emitir", "nfse_consultar", "empresas"],
    dados_disponiveis: ["Emissao NFS-e", "Consulta NFS-e", "Empresas"],
    integracao: "API REST",
  },
  {
    id: "focusnfe", nome: "Focus NFe", categoria: "fiscal", status: "planejado", icon: "FN", cor: "#8B5CF6",
    descricao: "NF-e, NFC-e, NFS-e, CT-e. API completa fiscal para todos os documentos.",
    campos_config: [
      { key: "token", label: "Token", tipo: "text", placeholder: "Token Focus NFe" },
    ],
    endpoints: ["nfe", "nfce", "nfse", "cte", "mdfe"],
    dados_disponiveis: ["NF-e", "NFC-e", "NFS-e", "CT-e", "MDF-e", "Manifestacao"],
    integracao: "API REST + Token",
  },

  // ═══════════════════════════════════════════════════════════
  // MES / CHAO DE FABRICA / SCADA
  // ═══════════════════════════════════════════════════════════
  {
    id: "scada", nome: "SCADA / OPC-UA", categoria: "erp_industrial", status: "planejado", icon: "SC", cor: "#64748B",
    descricao: "Supervisorio industrial. Dados de sensores, CLPs, temperatura, pressao em tempo real.",
    campos_config: [
      { key: "opc_url", label: "OPC-UA Endpoint", tipo: "text", placeholder: "opc.tcp://servidor:4840" },
    ],
    endpoints: ["tags", "alarmes", "historico", "tendencias"],
    dados_disponiveis: ["Temperatura", "Pressao", "Vazao", "Nivel", "Alarmes", "OEE real-time"],
    integracao: "OPC-UA / Modbus TCP / MQTT",
  },
  {
    id: "lims", nome: "LIMS (Laboratorio)", categoria: "erp_industrial", status: "planejado", icon: "LM", cor: "#0F766E",
    descricao: "Sistema de gestao de laboratorio. Analises microbiologicas, fisico-quimicas.",
    campos_config: [
      { key: "api_key", label: "API Key", tipo: "text", placeholder: "Token LIMS" },
    ],
    endpoints: ["amostras", "resultados", "laudos", "equipamentos"],
    dados_disponiveis: ["Amostras", "Resultados analiticos", "Laudos", "Calibracoes"],
    integracao: "API REST / HL7 / CSV",
  },
];

// ═══════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════

export const getConnector = (id: string) => CONNECTORS.find(c => c.id === id);
export const getActiveConnectors = () => CONNECTORS.filter(c => c.status === "ativo");
export const getConnectorsByCategory = (cat: string) => CONNECTORS.filter(c => c.categoria === cat);
export const getConnectorsByStatus = (status: string) => CONNECTORS.filter(c => c.status === status);

export const CATEGORIES = [
  { id: "erp_financeiro", nome: "ERPs Financeiros / PME", icon: "💰", count: CONNECTORS.filter(c => c.categoria === "erp_financeiro").length },
  { id: "erp_enterprise", nome: "ERPs Enterprise", icon: "🏢", count: CONNECTORS.filter(c => c.categoria === "erp_enterprise").length },
  { id: "erp_industrial", nome: "ERPs Industriais", icon: "🏭", count: CONNECTORS.filter(c => c.categoria === "erp_industrial").length },
  { id: "erp_agro", nome: "ERPs Agro", icon: "🌾", count: CONNECTORS.filter(c => c.categoria === "erp_agro").length },
  { id: "rh_ponto", nome: "RH / Ponto Eletronico", icon: "👥", count: CONNECTORS.filter(c => c.categoria === "rh_ponto").length },
  { id: "manutencao", nome: "Manutencao / Qualidade", icon: "🔧", count: CONNECTORS.filter(c => c.categoria === "manutencao").length },
  { id: "logistica", nome: "Logistica / Frota", icon: "🚛", count: CONNECTORS.filter(c => c.categoria === "logistica").length },
  { id: "banco", nome: "Open Finance / Bancos", icon: "🏦", count: CONNECTORS.filter(c => c.categoria === "banco").length },
  { id: "fiscal", nome: "Fiscal / NF-e", icon: "📄", count: CONNECTORS.filter(c => c.categoria === "fiscal").length },
  { id: "pagamento", nome: "Pagamentos / Cobranca", icon: "💳", count: CONNECTORS.filter(c => c.categoria === "pagamento").length },
];

export const STATS = {
  total: CONNECTORS.length,
  ativos: CONNECTORS.filter(c => c.status === "ativo").length,
  em_breve: CONNECTORS.filter(c => c.status === "em_breve").length,
  planejados: CONNECTORS.filter(c => c.status === "planejado").length,
  categorias: CATEGORIES.length,
};
