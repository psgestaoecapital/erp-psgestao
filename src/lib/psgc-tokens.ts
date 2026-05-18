import type React from 'react';

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

  // Dourado alerta (urgencia temporal - "hoje!", "agora!")
  douradoAlerta: '#FBBF24',

  // Laranja alerta (gradacao entre atencao e critico - score anti-fraude 30-60)
  laranjaAlerta: '#F97316',

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

// Toggle switch dimensions (caso reusavel - documentado, nao componente)
export const PSGC_TOGGLE_DIMS = {
  width: 40,
  height: 22,
  handleSize: 18,
  handleOffsetActive: 20,
  handleOffsetInactive: 2,
  borderRadius: 11,
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

// Parseia YYYY-MM-DD como data LOCAL (evita drift UTC do new Date('2025-04-17')
// que vira 16/04 em fuso BR). Outras strings (ISO com hora) caem no parser nativo.
const parseDataLocal = (v: string | Date): Date => {
  if (v instanceof Date) return v;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(v);
};

export const fmtData = (v: string | Date | null | undefined): string => {
  if (!v) return '—';
  const d = parseDataLocal(v);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export const fmtDataHora = (v: string | Date | null | undefined): string => {
  if (!v) return '—';
  const d = parseDataLocal(v);
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

// Helper de cor de score (anti-fraude, classificacao IA, qualquer score 0-100)
// Reusavel em multiplas paginas: automacao, anti-fraude, etc
export const corScore = (score: number): string => {
  if (score >= 80) return PSGC_COLORS.baixa;
  if (score >= 60) return PSGC_COLORS.media;
  if (score >= 30) return PSGC_COLORS.laranjaAlerta;
  return PSGC_COLORS.alta;
};

// Helper de variant para PSGCCard baseado em nivel saudavel/moderado/critico
export const variantPorNivel = (nivel: 'saudavel' | 'moderado' | 'critico'): 'success' | 'attention' | 'critical' => {
  if (nivel === 'saudavel') return 'success';
  if (nivel === 'moderado') return 'attention';
  return 'critical';
};

// ═══════════════════════════════════════════════════════════════
// DESIGN SYSTEM PREMIUM V1 — adicionado 16/05/2026
// Foundational para eliminar "padrão de IA" em telas premium
// Convenção: ADD-only, mesma estrutura de objeto que PSGC_TYPO/PSGC_COLORS
// Compatível com paleta espresso/off-white/dourado existente
// ═══════════════════════════════════════════════════════════════

// Tipografia premium — escala completa com tabular-nums para números
// Convenção: objeto com size/weight/letterSpacing (igual PSGC_TYPO existente)
// + fontVariantNumeric quando aplicável (alinhamento de dígitos em tabelas/dashboards)
export const PSGC_TYPO_PREMIUM = {
  // Números — hero, KPIs, displays grandes
  // fontVariantNumeric: 'tabular-nums' garante largura fixa por dígito
  numberHero:    { size: 48, weight: 700, letterSpacing: -1.5, fontVariantNumeric: 'tabular-nums' as const },
  numberLarge:   { size: 32, weight: 700, letterSpacing: -1,   fontVariantNumeric: 'tabular-nums' as const },
  numberMedium:  { size: 24, weight: 600, letterSpacing: -0.5, fontVariantNumeric: 'tabular-nums' as const },
  numberSmall:   { size: 16, weight: 600, letterSpacing: 0,    fontVariantNumeric: 'tabular-nums' as const },

  // Labels — sempre uppercase + tracking + peso médio
  label:         { size: 11, weight: 500, letterSpacing: 0.8, textTransform: 'uppercase' as const },
  labelLarge:    { size: 13, weight: 500, letterSpacing: 0.6, textTransform: 'uppercase' as const },

  // Texto comum
  bodyPremium:   { size: 14, weight: 400, lineHeight: 1.5 },
  bodyMuted:     { size: 14, weight: 400, lineHeight: 1.5 },
  caption:       { size: 12, weight: 400, lineHeight: 1.4 },

  // Section title — uppercase pequeno (estilo ContaAzul)
  sectionTitle:  { size: 11, weight: 600, letterSpacing: 1.2, textTransform: 'uppercase' as const },
} as const;

// Espaçamento assimétrico premium
// Princípio: muito espaço entre seções (deixa respirar), denso dentro (info junto)
export const PSGC_SPACING_PREMIUM = {
  betweenSections: 64,    // px — entre blocos grandes (mb-16)
  betweenSectionsLg: 80,  // px — em telas wide (sm:mb-20)
  withinSection: 24,      // px — dentro de uma seção (space-y-6)
  cardPadding: 24,        // px — padding interno do card premium
  cardGap: 8,             // px — entre linhas dentro do card (denso)
  heroGap: 12,            // px — no hero (label → número → contexto)
} as const;

// KPI Variants — alinha com semântica existente (variantPorNivel)
// Usa cores PSGC_COLORS, não cores Tailwind genéricas
export const PSGC_KPI_VARIANTS = {
  neutral: {
    text: PSGC_COLORS.espresso,
    accent: PSGC_COLORS.espressoDarker,
    border: PSGC_COLORS.offWhiteDark,
  },
  success: {
    text: PSGC_COLORS.baixa,
    accent: PSGC_COLORS.baixa,
    border: PSGC_COLORS.verdeSoft,
  },
  attention: {
    text: PSGC_COLORS.media,
    accent: PSGC_COLORS.media,
    border: PSGC_COLORS.amareloSoft,
  },
  critical: {
    text: PSGC_COLORS.alta,
    accent: PSGC_COLORS.alta,
    border: PSGC_COLORS.vermelhoSoft,
  },
} as const;

// Bordas premium — finíssimas, quase invisíveis (estilo ContaAzul)
// Hex com alpha simulada via cor mais clara do espresso
export const PSGC_BORDER_PREMIUM = {
  hairline: `1px solid ${PSGC_COLORS.offWhiteDark}`,     // borda quase invisível
  subtle:   `1px solid ${PSGC_COLORS.offWhiteDarker}`,   // borda sutil
  emphasis: `2px solid ${PSGC_COLORS.espresso}`,         // borda destacada (raríssima)
} as const;

// Sombras premium — usar com avareza, profundidade mínima
export const PSGC_SHADOW_PREMIUM = {
  none: 'none',
  card: '0 1px 2px rgba(61, 35, 20, 0.04), 0 1px 1px rgba(61, 35, 20, 0.02)',
  cardHover: '0 4px 12px rgba(61, 35, 20, 0.08), 0 2px 4px rgba(61, 35, 20, 0.04)',
  elevated: '0 8px 24px rgba(61, 35, 20, 0.12), 0 2px 6px rgba(61, 35, 20, 0.06)',
} as const;

// TypeScript types — para autocomplete e validação
export type PsgcTypoPremiumKey = keyof typeof PSGC_TYPO_PREMIUM;
export type PsgcSpacingPremiumKey = keyof typeof PSGC_SPACING_PREMIUM;
export type PsgcKpiVariant = keyof typeof PSGC_KPI_VARIANTS;
export type PsgcBorderPremiumKey = keyof typeof PSGC_BORDER_PREMIUM;
export type PsgcShadowPremiumKey = keyof typeof PSGC_SHADOW_PREMIUM;

// Helper — converte token PSGC_TYPO_PREMIUM em React.CSSProperties
// Útil para aplicar inline (padrão do projeto)
export const typoToStyle = (key: PsgcTypoPremiumKey): React.CSSProperties => {
  const t = PSGC_TYPO_PREMIUM[key] as Record<string, unknown>;
  return {
    fontSize: t.size as number,
    fontWeight: t.weight as number,
    ...(t.letterSpacing !== undefined && { letterSpacing: t.letterSpacing as number }),
    ...(t.lineHeight !== undefined && { lineHeight: t.lineHeight as number }),
    ...(t.textTransform !== undefined && { textTransform: t.textTransform as 'uppercase' }),
    ...(t.fontVariantNumeric !== undefined && { fontVariantNumeric: t.fontVariantNumeric as 'tabular-nums' }),
  };
};
