// ═══════════════════════════════════════════════════
// PS GESTÃO E CAPITAL — SISTEMA DE PERMISSÕES v2.2
// 6 planos + módulo Produtos adicionado
// Atualizado: 19/04/2026
// ═══════════════════════════════════════════════════

export type Plano = 'erp_cs' | 'bpo' | 'industrial' | 'agro' | 'wealth' | 'producao' | 'assessoria';

export const PLANOS: Record<Plano, { nome: string; cor: string; preco: string; icon: string }> = {
  erp_cs:    { nome: 'ERP Comércio & Serviços', cor: '#22C55E', preco: 'R$ 297-497/mês', icon: '🏪' },
  industrial:{ nome: 'ERP Industrial',          cor: '#F97316', preco: 'R$ 1.497-4.997/mês', icon: '🏭' },
  agro:      { nome: 'ERP Agro',                cor: '#EF4444', preco: 'R$ 997-2.997/mês', icon: '🌾' },
  bpo:       { nome: 'BPO Financeiro',          cor: '#3B82F6', preco: 'R$ 997-2.497/mês', icon: '💼' },
  wealth:    { nome: 'PS Wealth MFO',           cor: '#D4AF37', preco: 'R$ 2K-200K/mês', icon: '💰' },
  producao:  { nome: 'Produção Marketing',      cor: '#A855F7', preco: 'R$ 497-997/mês', icon: '🎨' },
  assessoria:{ nome: 'Assessoria Empresarial',   cor: '#A855F7', preco: 'R$ 2.997-9.997/mês', icon: '📊' },
};

type Acesso = 'full' | 'addon' | 'none';

export const PLANO_MODULOS: Record<string, Record<Plano, Acesso>> = {
  // ═══ NÚCLEO ═══
  'visao-diaria':       { erp_cs: 'full', bpo: 'full', industrial: 'full', agro: 'full', wealth: 'full', producao: 'full', assessoria: 'full' },
  'visao-mensal':       { erp_cs: 'full', bpo: 'full', industrial: 'full', agro: 'full', wealth: 'full', producao: 'full', assessoria: 'full' },
  'dashboard-geral':    { erp_cs: 'full', bpo: 'full', industrial: 'full', agro: 'full', wealth: 'full', producao: 'full', assessoria: 'full' },
  'dashboard-negocios': { erp_cs: 'full', bpo: 'full', industrial: 'full', agro: 'full', wealth: 'full', producao: 'full', assessoria: 'full' },
  'dashboard-resultado':{ erp_cs: 'full', bpo: 'full', industrial: 'full', agro: 'full', wealth: 'full', producao: 'full', assessoria: 'full' },
  'dashboard-balanco':  { erp_cs: 'full', bpo: 'full', industrial: 'full', agro: 'full', wealth: 'full', producao: 'full', assessoria: 'full' },
  'dashboard-indicadores':{ erp_cs:'full', bpo: 'full', industrial: 'full', agro: 'full', wealth: 'full', producao: 'full', assessoria: 'full' },
  'dashboard-financeiro':{ erp_cs: 'full', bpo: 'full', industrial: 'full', agro: 'full', wealth: 'full', producao: 'full', assessoria: 'full' },
  'dashboard-precos':   { erp_cs: 'full', bpo: 'full', industrial: 'full', agro: 'full', wealth: 'full', producao: 'full', assessoria: 'full' },
  'dados':              { erp_cs: 'full', bpo: 'full', industrial: 'full', agro: 'full', wealth: 'full', producao: 'full', assessoria: 'full' },
  'conectores':         { erp_cs: 'full', bpo: 'full', industrial: 'full', agro: 'full', wealth: 'full', producao: 'full', assessoria: 'full' },
  'importar':           { erp_cs: 'full', bpo: 'full', industrial: 'full', agro: 'full', wealth: 'full', producao: 'full', assessoria: 'full' },
  'importar-universal': { erp_cs: 'full', bpo: 'full', industrial: 'full', agro: 'full', wealth: 'full', producao: 'full', assessoria: 'full' },
  'ajuda':              { erp_cs: 'full', bpo: 'full', industrial: 'full', agro: 'full', wealth: 'full', producao: 'full', assessoria: 'full' },

  // ═══ NOVO: PRODUTOS ═══
  'produtos':           { erp_cs: 'full', bpo: 'none', industrial: 'full', agro: 'full', wealth: 'none', producao: 'full', assessoria: 'addon' },

  // ═══ MÓDULOS DISTRIBUÍDOS ═══
  'operacional':        { erp_cs: 'full', bpo: 'none', industrial: 'full', agro: 'full', wealth: 'none', producao: 'full', assessoria: 'none' },
  'rateio':             { erp_cs: 'full', bpo: 'none', industrial: 'full', agro: 'full', wealth: 'none', producao: 'full', assessoria: 'addon' },
  'orcamento':          { erp_cs: 'full', bpo: 'none', industrial: 'full', agro: 'full', wealth: 'none', producao: 'full', assessoria: 'addon' },
  'viabilidade':        { erp_cs: 'full', bpo: 'none', industrial: 'full', agro: 'full', wealth: 'none', producao: 'none', assessoria: 'full' },
  'consultor-ia':       { erp_cs: 'full', bpo: 'full', industrial: 'full', agro: 'none', wealth: 'none', producao: 'none', assessoria: 'full' },
  'contador':           { erp_cs: 'full', bpo: 'full', industrial: 'none', agro: 'none', wealth: 'none', producao: 'full', assessoria: 'addon' },
  'assessor':           { erp_cs: 'full', bpo: 'full', industrial: 'none', agro: 'none', wealth: 'none', producao: 'none', assessoria: 'full' },
  'anti-fraude-basico': { erp_cs: 'full', bpo: 'full', industrial: 'full', agro: 'full', wealth: 'none', producao: 'full', assessoria: 'full' },
  'custeio':            { erp_cs: 'full', bpo: 'full', industrial: 'full', agro: 'full', wealth: 'none', producao: 'none', assessoria: 'full' },

  // ═══ RELATÓRIOS IA ═══
  'relatorio-rapido':   { erp_cs: 'full', bpo: 'full', industrial: 'full', agro: 'full', wealth: 'none', producao: 'full', assessoria: 'full' },
  'relatorio-v19':      { erp_cs: 'addon', bpo: 'full', industrial: 'full', agro: 'addon', wealth: 'none', producao: 'addon', assessoria: 'full' },

  // ═══ ANTI-FRAUDE ═══
  'anti-fraude-full':   { erp_cs: 'addon', bpo: 'full', industrial: 'addon', agro: 'addon', wealth: 'none', producao: 'none', assessoria: 'addon' },
  'anti-fraude-bpo':    { erp_cs: 'none', bpo: 'full', industrial: 'none', agro: 'none', wealth: 'none', producao: 'none', assessoria: 'none' },

  // ═══ ERP COMÉRCIO & SERVIÇOS ═══
  'plano-acao':         { erp_cs: 'full', bpo: 'none', industrial: 'none', agro: 'none', wealth: 'none', producao: 'none', assessoria: 'full' },
  'onboarding':         { erp_cs: 'full', bpo: 'full', industrial: 'none', agro: 'none', wealth: 'none', producao: 'full', assessoria: 'full' },

  // ═══ BPO ═══
  'bpo':                { erp_cs: 'none', bpo: 'full', industrial: 'none', agro: 'none', wealth: 'none', producao: 'none', assessoria: 'addon' },
  'bpo-automacao':      { erp_cs: 'none', bpo: 'full', industrial: 'none', agro: 'none', wealth: 'none', producao: 'none', assessoria: 'addon' },
  'bpo-rotinas':        { erp_cs: 'none', bpo: 'full', industrial: 'none', agro: 'none', wealth: 'none', producao: 'none', assessoria: 'none' },
  'bpo-conciliacao':    { erp_cs: 'none', bpo: 'full', industrial: 'none', agro: 'none', wealth: 'none', producao: 'none', assessoria: 'none' },
  'bpo-supervisor':     { erp_cs: 'none', bpo: 'full', industrial: 'none', agro: 'none', wealth: 'none', producao: 'none', assessoria: 'none' },

  // ═══ INDUSTRIAL ═══
  'custo':              { erp_cs: 'none', bpo: 'none', industrial: 'full', agro: 'none', wealth: 'none', producao: 'none', assessoria: 'addon' },
  'ficha-tecnica':      { erp_cs: 'none', bpo: 'none', industrial: 'full', agro: 'none', wealth: 'none', producao: 'none', assessoria: 'none' },
  'industrial':         { erp_cs: 'none', bpo: 'none', industrial: 'full', agro: 'none', wealth: 'none', producao: 'none', assessoria: 'none' },
  'industrial-ceo':     { erp_cs: 'none', bpo: 'none', industrial: 'full', agro: 'none', wealth: 'none', producao: 'none', assessoria: 'none' },

  // ═══ AGRO ═══
  'agro-rebanho':       { erp_cs: 'none', bpo: 'none', industrial: 'none', agro: 'full', wealth: 'none', producao: 'none', assessoria: 'none' },
  'agro-manejo':        { erp_cs: 'none', bpo: 'none', industrial: 'none', agro: 'full', wealth: 'none', producao: 'none', assessoria: 'none' },
  'agro-novilho':       { erp_cs: 'none', bpo: 'none', industrial: 'none', agro: 'full', wealth: 'none', producao: 'none', assessoria: 'none' },

  // ═══ WEALTH ═══
  'wealth':             { erp_cs: 'none', bpo: 'none', industrial: 'none', agro: 'none', wealth: 'full', producao: 'none', assessoria: 'addon' },
  'assessor-ceo':       { erp_cs: 'none', bpo: 'none', industrial: 'none', agro: 'none', wealth: 'addon', producao: 'none', assessoria: 'full' },

  // ═══ PRODUÇÃO MARKETING ═══
  'producao':           { erp_cs: 'none', bpo: 'none', industrial: 'none', agro: 'none', wealth: 'none', producao: 'full', assessoria: 'none' },
  'producao-jobs':      { erp_cs: 'none', bpo: 'none', industrial: 'none', agro: 'none', wealth: 'none', producao: 'full', assessoria: 'none' },
  'producao-timesheet': { erp_cs: 'none', bpo: 'none', industrial: 'none', agro: 'none', wealth: 'none', producao: 'full', assessoria: 'none' },
  'producao-briefing':  { erp_cs: 'none', bpo: 'none', industrial: 'none', agro: 'none', wealth: 'none', producao: 'full', assessoria: 'none' },
  'producao-propostas': { erp_cs: 'none', bpo: 'none', industrial: 'none', agro: 'none', wealth: 'none', producao: 'full', assessoria: 'none' },

  // ═══ ADMIN / NOC ═══
  'noc':                { erp_cs: 'none', bpo: 'full', industrial: 'none', agro: 'none', wealth: 'none', producao: 'none', assessoria: 'none' },
  'admin':              { erp_cs: 'full', bpo: 'full', industrial: 'full', agro: 'full', wealth: 'addon', producao: 'full', assessoria: 'full' },
};

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
  atendimento:       ['geral','visao_diaria','negocios'],
  designer:          ['geral'],
  visualizador:      ['geral'],
};

export const ROLE_MODULOS: Record<string, string[]> = {
  adm_investimentos: ['*'],
  adm:               ['*'],
  acesso_total:      ['*'],
  socio:             ['dashboard','dados','conectores','importar','anti-fraude','rateio','orcamento','viabilidade','relatorio','consultor-ia','producao','produtos','ajuda'],
  diretor_industrial:['dashboard','industrial','custo','ficha-tecnica','operacional','rateio','orcamento','produtos','ajuda'],
  gerente_planta:    ['dashboard','industrial','custo','operacional','produtos','ajuda'],
  financeiro:        ['dashboard','dados','conectores','importar','anti-fraude','rateio','orcamento','contador','ajuda'],
  comercial:         ['dashboard','produtos','ajuda'],
  supervisor:        ['dashboard','industrial','operacional','produtos','ajuda'],
  coordenador:       ['dashboard','operacional','produtos','ajuda'],
  operacional:       ['dashboard','operacional','produtos','ajuda'],
  consultor:         ['dashboard','dados','anti-fraude','consultor-ia','assessor','relatorio','ajuda'],
  conselheiro:       ['dashboard','relatorio','ajuda'],
  operador_bpo:      ['dashboard','bpo','anti-fraude','dados','conectores','importar','ajuda'],
  supervisor_bpo:    ['dashboard','bpo','anti-fraude','dados','conectores','noc','ajuda'],
  gestor_mfo:        ['dashboard','wealth','dados','anti-fraude','relatorio','ajuda'],
  analista:          ['dashboard','wealth','ajuda'],
  contador:          ['dashboard','contador','ajuda'],
  atendimento:       ['dashboard','producao','produtos','ajuda'],
  designer:          ['dashboard','producao','ajuda'],
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
  atendimento: 'Atendimento',
  designer: 'Designer',
  cliente_pf: 'Cliente PF/PJ',
  compliance: 'Compliance',
  visualizador: 'Visualizador',
};

export const ROLES_POR_PLANO: Record<Plano, string[]> = {
  erp_cs:     ['adm','socio','financeiro','comercial','operacional','contador','visualizador'],
  bpo:        ['adm','operador_bpo','supervisor_bpo','socio','contador'],
  industrial: ['adm','diretor_industrial','gerente_planta','supervisor','operacional','socio'],
  agro:       ['adm','socio','operacional','financeiro','visualizador'],
  wealth:     ['adm','gestor_mfo','analista','cliente_pf','compliance'],
  producao:   ['adm','socio','atendimento','designer','operacional','visualizador'],
  assessoria: ['adm','consultor','socio','conselheiro'],
};

export function isAdminRole(role: string): boolean {
  return role === 'adm' || role === 'admin' || role === 'acesso_total' || role === 'adm_investimentos';
}

export function canAccessModule(plano: Plano | string, modulo: string): Acesso {
  const p = plano as Plano;
  return PLANO_MODULOS[modulo]?.[p] || 'none';
}

export function getMenuItems(plano: Plano | string, role: string) {
  if (isAdminRole(role)) return 'all';
  const roleModulos = ROLE_MODULOS[role];
  if (!roleModulos) return [];
  if (roleModulos.includes('*')) return 'all';
  return roleModulos.filter(mod => {
    const access = canAccessModule(plano, mod);
    return access === 'full' || access === 'addon';
  });
}

export function getRoleTabs(role: string): string[] {
  return ROLE_TABS[role] || ROLE_TABS.visualizador;
}
