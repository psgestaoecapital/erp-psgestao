// PS Gestao e Capital - Design Tokens v1.0
// Lei: Espresso #3D2314 (estrutura) + Off-white #FAF7F2 (background) + Dourado #C8941A (highlight)
// Sem cinza em borders. Sem dark theme. Verde/Amarelo/Vermelho exclusivos para semaforo de performance.

export const PSGC_COLORS = {
  // Estrutura
  espresso: '#3D2314',
  espressoLight: '#5A3A2A',
  espressoDarker: '#2A1A0E',

  // Backgrounds
  offWhite: '#FAF7F2',
  offWhiteDark: '#F0EAE0',
  offWhiteDarker: '#E5DDC8',

  // Destaque
  dourado: '#C8941A',
  douradoSoft: '#E8B848',
  douradoDark: '#A77614',

  // Semaforo (uso EXCLUSIVO em performance)
  alta: '#C44536',           // Critico
  media: '#D89627',          // Atencao
  baixa: '#5C8D3F',          // Saudavel

  // Suporte semantico
  azul: '#3D6FA8',           // Informacao / Em andamento
  azulSoft: '#E5EEF8',

  // Backgrounds soft (para caixas de diagnostico)
  verdeSoft: '#E8F5DD',
  amareloSoft: '#FCF3DA',
  vermelhoSoft: '#F8DDDA',
} as const;

export const PSGC_TYPO = {
  // Hierarquia tipografica
  hero: { size: 28, weight: 800, letterSpacing: -1 },
  h1: { size: 22, weight: 700, letterSpacing: -0.5 },
  h2: { size: 18, weight: 700, letterSpacing: -0.3 },
  h3: { size: 14, weight: 700, letterSpacing: 1.2, textTransform: 'uppercase' as const },
  body: { size: 13, weight: 400, lineHeight: 1.5 },
  bodyBold: { size: 13, weight: 600, lineHeight: 1.5 },
  small: { size: 11, weight: 500, letterSpacing: 0.3 },
  micro: { size: 9, weight: 700, letterSpacing: 0.8, textTransform: 'uppercase' as const },
} as const;

export const PSGC_SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const PSGC_RADIUS = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  xxl: 14,
} as const;

// Helpers semanticos
export const corStatus = (status: string) => {
  const map: Record<string, string> = {
    critico: PSGC_COLORS.alta,
    atencao: PSGC_COLORS.media,
    saudavel: PSGC_COLORS.baixa,
    pendente: PSGC_COLORS.azul,
    em_andamento: PSGC_COLORS.azul,
    aguardando_cliente: PSGC_COLORS.media,
    resolvido: PSGC_COLORS.baixa,
    cancelado: PSGC_COLORS.espressoLight,
  };
  return map[status?.toLowerCase()] || PSGC_COLORS.espressoLight;
};

export const corStatusBg = (status: string) => {
  const map: Record<string, string> = {
    critico: PSGC_COLORS.vermelhoSoft,
    atencao: PSGC_COLORS.amareloSoft,
    saudavel: PSGC_COLORS.verdeSoft,
    pendente: PSGC_COLORS.azulSoft,
    em_andamento: PSGC_COLORS.azulSoft,
    aguardando_cliente: PSGC_COLORS.amareloSoft,
    resolvido: PSGC_COLORS.verdeSoft,
  };
  return map[status?.toLowerCase()] || PSGC_COLORS.offWhiteDark;
};

export const corVariacao = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return PSGC_COLORS.espressoLight;
  if (v > 5) return PSGC_COLORS.baixa;
  if (v < -5) return PSGC_COLORS.alta;
  return PSGC_COLORS.espressoLight;
};

export const fmtR = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return 'R$ —';
  const n = Number(v) || 0;
  const negativo = n < 0;
  const formatted = `R$ ${Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  return negativo ? `(${formatted})` : formatted;
};

export const fmtPct = (v: number | null | undefined, casas = 1): string => {
  if (v === null || v === undefined) return '—';
  const sinal = v > 0 ? '+' : '';
  return `${sinal}${v.toFixed(casas)}%`;
};

export const fmtData = (v: string | Date | null | undefined): string => {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : v;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export const fmtDataHora = (v: string | Date | null | undefined): string => {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : v;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const fmtTempoSLA = (segundos: number | null | undefined): string => {
  if (segundos === null || segundos === undefined) return '—';
  const abs = Math.abs(segundos);
  const dias = Math.floor(abs / 86400);
  const horas = Math.floor((abs % 86400) / 3600);
  const min = Math.floor((abs % 3600) / 60);
  const sinal = segundos < 0 ? '−' : '';
  if (dias > 0) return `${sinal}${dias}d ${horas}h`;
  if (horas > 0) return `${sinal}${horas}h ${min}m`;
  return `${sinal}${min}m`;
};
