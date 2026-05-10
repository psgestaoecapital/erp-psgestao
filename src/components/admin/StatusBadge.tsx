import { COR } from './colors';

export type BadgeTone =
  | 'default'
  | 'gold'
  | 'green'
  | 'amber'
  | 'red'
  | 'blue'
  | 'muted';

const TONE_STYLES: Record<BadgeTone, { bg: string; color: string; border: string }> = {
  default: { bg: COR.cream, color: COR.espresso, border: COR.border },
  gold: { bg: COR.goldBg, color: COR.goldD, border: COR.gold },
  green: { bg: COR.greenBg, color: COR.green, border: COR.green },
  amber: { bg: COR.amberBg, color: COR.amber, border: COR.amber },
  red: { bg: COR.redBg, color: COR.red, border: COR.red },
  blue: { bg: COR.blueBg, color: COR.blue, border: COR.blue },
  muted: { bg: COR.creamD, color: COR.espressoM, border: COR.border },
};

export default function StatusBadge({
  children,
  tone = 'default',
  size = 'sm',
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  size?: 'xs' | 'sm';
}) {
  const style = TONE_STYLES[tone];
  const padding = size === 'xs' ? '2px 8px' : '4px 10px';
  const fontSize = size === 'xs' ? 10 : 11;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding,
        borderRadius: 999,
        background: style.bg,
        color: style.color,
        border: `1px solid ${style.border}`,
        fontSize,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

// Helper para mapear status feature -> tone
export function toneByStatus(status: string): BadgeTone {
  switch (status) {
    case 'pronto':
      return 'green';
    case 'parcial':
    case 'em_construcao':
      return 'amber';
    case 'previsto':
      return 'muted';
    case 'descontinuada':
      return 'red';
    default:
      return 'default';
  }
}

export function toneByPrioridade(prio: string): BadgeTone {
  switch (prio) {
    case 'critica':
      return 'red';
    case 'alta':
      return 'amber';
    case 'media':
      return 'blue';
    case 'baixa':
      return 'muted';
    default:
      return 'default';
  }
}
