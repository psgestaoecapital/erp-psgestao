// ═══════════════════════════════════════════════════
// PS GESTÃO E CAPITAL — SISTEMA DE PERMISSÕES
// Camada 1: Plano da empresa → módulos disponíveis
// Camada 2: Role do usuário → o que vê dentro do plano
// ═══════════════════════════════════════════════════

export type Plano = 'erp_cs' | 'bpo' | 'industrial' | 'assessoria' | 'wealth';

export const PLANOS: Record<Plano, { nome: string; cor: string; preco: string }> = {
  erp_cs: { nome: 'ERP Comércio & Serviço', cor: '#22C55E', preco: 'R$ 297-497/mês' },
  bpo: { nome: 'BPO Financeiro', cor: '#3B82F6', preco: 'R$ 997-2.497/mês' },
  industrial: { nome: 'Industrial', cor: '#F97316', preco: 'R$ 1.497-4.997/mês' },
  assessoria: { nome: 'Assessoria Empresarial', cor: '#A855F7', preco: 'R$ 2.997-9.997/mês' },
  wealth: { nome: 'PS Wealth MFO', cor: '#D4AF37', preco: 'R$ 2K-200K/mês' },
};

// ═══ CAMADA 1: Plano → Módulos ═══
// ✅ = incluso | 🔒 = addon | ❌ = não disponível
// Mapeado como: 'full' | 'addon' | 'none'
type Acesso = 'full' | 'addon' | 'none';

export const PLANO_MODULOS: Record<string, Record<Plano, Acesso>> = {
  // DASHBOARD
  'visao-diaria':       { erp_cs: 'full', bpo: 'full', industrial: 'full', assessoria: 'full', wealth: 'none' },
  'visao-mensal':       { erp_cs: 'full', bpo: 'full', industrial: 'full', assessoria: 'full', wealth: 'none' },
  'dashboard-geral':    { erp_cs: 'full', bpo: 'full', industrial: 'full', assessoria: 'full', wealth: 'none' },
  'dashboard-negocios': { erp_cs: 'full', bpo: 'full', industrial: 'full', assessoria: 'full', wealth: 'none' },
  'dashboard-resultado':{ erp_cs: 'full', bpo: 'full', industrial: 'full', assessoria: 'full', wealth: 'none' },
  'dashboard-balanco':  { erp_cs: 'full', bpo: 'full', industrial: 'full', assessoria: 'full', wealth: 'none' },
  'dashboard-indicadores':{ erp_cs:'full', bpo: 'full', industrial: 'full', assessoria: 'full', wealth: 'none' },
  'dashboard-financeiro':{ erp_cs: 'full', bpo: 'full', industrial: 'full', assessoria: 'full', wealth: 'none' },
  'dashboard-precos':   { erp_cs: 'full', bpo: 'full', industrial: 'full', assessoria: 'full', wealth: 'none' },
  // RELATÓRIOS IA
  'relatorio-rapido':   { erp_cs: 'full', bpo: 'full', industrial: 'full', assessoria: 'full', wealth: 'none' },
  'relatorio-v19':      { erp_cs: 'addon', bpo: 'full', industrial: 'full', assessoria: 'full', wealth: 'none' },
  'consultor-ia':       { erp_cs: 'addon', bpo: 'addon', industrial: 'full', assessoria: 'full', wealth: 'none' },
  // ENTRADA DE DADOS
  'dados':              { erp_cs: 'full', bpo: 'full', industrial: 'full', assessoria: 'full', wealth: 'full' },
  'conectores':         { erp_cs: 'full', bpo: 'full', industrial: 'full', assessoria: 'full', wealth: 'full' },
  'importar':           { erp_cs: 'full', bpo: 'full', industrial: 'full', assessoria: 'full', wealth: 'full' },
  'importar-universal': { erp_cs: 'full', bpo: 'full', industrial: 'full', assessoria: 'full', wealth: 'full' },
  // ANTI-FRAUDE
  'anti-fraude-basico': { erp_cs: 'full', bpo: 'full', industrial: 'full', assessoria: 'full', wealth: 'none' },
  'anti-fraude-full':   { erp_cs: 'addon', bpo: 'full', industrial: 'addon', assessoria: 'addon', wealth: 'none' },
  'anti-fraude-bpo':    { erp_cs: 'none', bpo: 'full', industrial: 'none', assessoria: 'none', wealth: 'none' },
  // BPO
  'bpo':                { erp_cs: 'none', bpo: 'full', industrial: 'none', assessoria: 'addon', wealth: 'none' },
  'bpo-automacao':      { erp_cs: 'none', bpo: 'full', industrial: 'none', assessoria: 'addon', wealth: 'none' },
  'bpo-rotinas':        { erp_cs: 'none', bpo: 'full', industrial: 'none', assessoria: 'none', wealth: 'none' },
  'bpo-conciliacao':    { erp_cs: 'none', bpo: 'full', industrial: 'none', assessoria: 'none', wealth: 'none' },
  'bpo-supervisor':     { erp_cs: 'none', bpo: 'full', industrial: 'none', assessoria: 'none', wealth: 'none' },
  // INDUSTRIAL / CUSTO
  'custo':              { erp_cs: 'none', bpo: 'none', industrial: 'full', assessoria: 'addon', wealth: 'none' },
  'ficha-tecnica':      { erp_cs: 'none', bpo: 'none', industrial: 'full', assessoria: 'none', wealth: 'none' },
  'industrial':         { erp_cs: 'none', bpo: 'none', industrial: 'full', assessoria: 'none', wealth: 'none' },
  'industrial-ceo':     { erp_cs: 'none', bpo: 'none', industrial: 'full', assessoria: 'none', wealth: 'none' },
  'rateio':             { erp_cs: 'full', bpo: 'addon', industrial: 'full', assessoria: 'addon', wealth: 'none' },
  'orcamento':          { erp_cs: 'full', bpo: 'addon', industrial: 'full', assessoria: 'addon', wealth: 'none' },
  'operacional':        { erp_cs: 'full', bpo: 'none', industrial: 'full', assessoria: 'none', wealth: 'none' },
  'viabilidade':        { erp_cs: 'full', bpo: 'none', industrial: 'full', assessoria: 'full', wealth: 'none' },
  // ASSESSORIA
  'assessor':           { erp_cs: 'none', bpo: 'none', industrial: 'none', assessoria: 'full', wealth: 'addon' },
  'assessor-ceo':       { erp_cs: 'none', bpo: 'none', industrial: 'none', assessoria: 'full', wealth: 'addon' },
  'plano-acao':         { erp_cs: 'full', bpo: 'none', industrial: 'none', assessoria: 'full', wealth: 'none' },
  'onboarding':         { erp_cs: 'full', bpo: 'full', industrial: 'none', assessoria: 'full', wealth: 'none' },
  // OUTROS
  'wealth':             { erp_cs: 'none', bpo: 'none', industrial: 'none', assessoria: 'addon', wealth: 'full' },
  'noc':                { erp_cs: 'none', bpo: 'none', industrial: 'none', assessoria: 'none', wealth: 'none' },
  'contador':           { erp_cs: 'full', bpo: 'full', industrial: 'addon', assessoria: 'addon', wealth: 'addon' },
  'admin':              { erp_cs: 'full', bpo: 'full', industrial: 'full', assessoria: 'full', wealth: 'addon' },
  'ajuda':              { erp_cs: 'full', bpo: 'full', industrial: 'full', assessoria: 'full', wealth: 'full' },
};

// ═══ CAMADA 2: Role → Abas do Dashboard ═══
export const ROLE_TABS: Record<string, string[]> = {
  adm_investimentos: ['geral','visao_diaria','negocios','resultado','balanco','indicadores','financeiro','precos','relatorio'],
  adm:               ['geral','visao_diaria','negocios','resultado','balanco','indicadores','financeiro','precos','relatorio'],
  acesso_total:      ['geral','visao_diaria','negocios','resultado','balanco','indicadores','financeiro','precos','relatorio'],
  socio:             ['geral','visao_diaria','negocios','resultado','balanco','indicadores','financeiro','precos','relatorio'],
  diretor_industrial:['geral','visao_diaria','negocios','resultado','balanco','indicadores','financeiro','precos'],
  gerente_planta:    ['geral','visao_diaria','negocios','resultado','financeiro'],
  financeiro:        ['geral','visao_diaria','resultado','balanco','indicadores','financeiro','precos'],
  comercial:         ['geral','negocios','precos'],
  supervisor:        ['geral','negocios','resultado'],
  coordenador:       ['geral','negocios','resultado'],
  operacional:       ['geral','negocios'],
  consultor:         ['geral','visao_diaria','negocios','resultado','balanco','indicadores','financeiro','precos','relatorio'],
  conselheiro:       ['geral','resultado','financeiro','relatorio'],
  operador_bpo:      ['geral','visao_diaria','resultado','financeiro'],
  supervisor_bpo:    ['geral','visao_diaria','negocios','resultado','financeiro'],
  gestor_mfo:        ['geral','visao_diaria','negocios','resultado','balanco','indicadores','financeiro','precos','relatorio'],
  analista:          ['geral','visao_diaria','resultado','indicadores'],
  contador:          ['geral','resultado','balanco','indicadores'],
  visualizador:      ['geral'],
};

// ═══ CAMADA 2: Role → Módulos do menu ═══
export const ROLE_MODULOS: Record<string, string[]> = {
  adm_investimentos: ['*'], // acesso irrestrito
  adm:               ['*'],
  acesso_total:      ['*'],
  socio:             ['dashboard','dados','conectores','importar','anti-fraude','rateio','orcamento','viabilidade','relatorio','consultor-ia','ajuda'],
  diretor_industrial:['dashboard','industrial','custo','ficha-tecnica','operacional','rateio','orcamento','ajuda'],
  gerente_planta:    ['dashboard','industrial','custo','operacional','ajuda'],
  financeiro:        ['dashboard','dados','conectores','importar','anti-fraude','rateio','orcamento','contador','ajuda'],
  comercial:         ['dashboard','ajuda'],
  supervisor:        ['dashboard','industrial','operacional','ajuda'],
  coordenador:       ['dashboard','operacional','ajuda'],
  operacional:       ['dashboard','operacional','ajuda'],
  consultor:         ['dashboard','dados','anti-fraude','consultor-ia','assessor','relatorio','ajuda'],
  conselheiro:       ['dashboard','relatorio','ajuda'],
  operador_bpo:      ['dashboard','bpo','anti-fraude','dados','conectores','importar','ajuda'],
  supervisor_bpo:    ['dashboard','bpo','anti-fraude','dados','conectores','noc','ajuda'],
  gestor_mfo:        ['dashboard','wealth','dados','anti-fraude','relatorio','ajuda'],
  analista:          ['dashboard','wealth','ajuda'],
  contador:          ['dashboard','contador','ajuda'],
  visualizador:      ['dashboard','ajuda'],
};

export const ROLE_NAMES: Record<string, string> = {
  adm_investimentos: 'Admin Investimentos',
  adm: 'Administrador',
  acesso_total: 'Acesso Total',
  socio: 'Sócio/CEO',
  diretor_industrial: 'Diretor Industrial',
  gerente_planta: 'Gerente de Planta',
  financeiro: 'Financeiro',
  comercial: 'Comercial',
  supervisor: 'Supervisor',
  coordenador: 'Coordenador',
  operacional: 'Operacional',
  consultor: 'Consultor Externo',
  conselheiro: 'Conselheiro',
  operador_bpo: 'Operador BPO',
  supervisor_bpo: 'Supervisor BPO',
  gestor_mfo: 'Gestor MFO',
  analista: 'Analista',
  contador: 'Contador',
  cliente_pf: 'Cliente PF/PJ',
  compliance: 'Compliance',
  visualizador: 'Visualizador',
};

// ═══ Roles disponíveis por plano (para convites) ═══
export const ROLES_POR_PLANO: Record<Plano, string[]> = {
  erp_cs:     ['adm','socio','financeiro','comercial','operacional','contador','visualizador'],
  bpo:        ['adm','operador_bpo','supervisor_bpo','socio','contador'],
  industrial: ['adm','diretor_industrial','gerente_planta','supervisor','operacional','socio'],
  assessoria: ['adm','consultor','socio','conselheiro'],
  wealth:     ['adm','gestor_mfo','analista','cliente_pf','compliance'],
};

// ═══ Helper functions ═══

export function isAdminRole(role: string): boolean {
  return role === 'adm' || role === 'admin' || role === 'acesso_total' || role === 'adm_investimentos';
}

export function canAccessModule(plano: Plano | string, modulo: string): Acesso {
  const p = plano as Plano;
  return PLANO_MODULOS[modulo]?.[p] || 'none';
}

export function getMenuItems(plano: Plano | string, role: string) {
  // Admin investimentos vê tudo
  if (isAdminRole(role)) return 'all';

  const roleModulos = ROLE_MODULOS[role];
  if (!roleModulos) return [];
  if (roleModulos.includes('*')) return 'all';

  // Filter by plan + role
  return roleModulos.filter(mod => {
    const access = canAccessModule(plano, mod);
    return access === 'full' || access === 'addon';
  });
}

export function getRoleTabs(role: string): string[] {
  return ROLE_TABS[role] || ROLE_TABS.visualizador;
}
