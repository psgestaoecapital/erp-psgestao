// Estrela Polar — paleta admin PS Gestao
// Reutilizada de src/app/admin/projeto/page.tsx para consistencia visual.
// Verde/amarelo/vermelho APENAS como semaforo de performance, nunca decorativo.

export const COR = {
  espresso: '#3D2314',
  espressoM: '#6B5D4F',
  espressoL: '#9C8E80',
  offWhite: '#FAF7F2',
  cream: '#F0ECE3',
  creamD: '#E8E1D3',
  border: '#E0D8CC',
  borderL: '#EDE7DA',
  gold: '#C8941A',
  goldD: '#A57A15',
  goldBg: '#FDF7E8',
  // Semaforos (uso restrito a performance)
  green: '#2D7A3E',
  greenBg: '#EBF3ED',
  red: '#B83B3B',
  redBg: '#F6E8E8',
  amber: '#C88A1A',
  amberBg: '#FAF0DF',
  blue: '#2C5282',
  blueBg: '#E7EDF5',
} as const;

export type CorKey = keyof typeof COR;

// Helpers de formatacao reutilizaveis nas paginas admin
export function formatBRL(value: number | null | undefined): string {
  if (value == null) return 'R$ 0,00';
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });
}

export function formatRangePreco(min: number | null, max: number | null): string {
  if (min == null && max == null) return 'Sob consulta';
  if (min != null && max != null && min !== max) {
    return `${formatBRL(min)} – ${formatBRL(max)}`;
  }
  return formatBRL(min ?? max);
}

// Cores semaforo para % pronto para vender
export function corSemaforo(percentual: number): {
  bg: string;
  border: string;
  text: string;
} {
  if (percentual >= 80) {
    return { bg: COR.greenBg, border: COR.green, text: COR.green };
  }
  if (percentual >= 50) {
    return { bg: COR.amberBg, border: COR.amber, text: COR.amber };
  }
  return { bg: COR.redBg, border: COR.red, text: COR.red };
}
