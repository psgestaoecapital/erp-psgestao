'use client';

interface Props {
  value: 'competencia' | 'caixa';
  onChange: (regime: 'competencia' | 'caixa') => void;
}

const CORES = {
  espresso: '#3D2314',
  espressoLight: '#5A3A2A',
  offWhite: '#FAF7F2',
  offWhiteDark: '#F0EAE0',
  dourado: '#C8941A',
};

export default function ToggleRegime({ value, onChange }: Props) {
  return (
    <div style={{
      display: 'inline-flex',
      background: CORES.offWhiteDark,
      borderRadius: 10,
      padding: 3,
      gap: 2,
      border: `1px solid ${CORES.offWhiteDark}`,
    }}>
      {(['competencia', 'caixa'] as const).map((opt) => {
        const ativo = value === opt;
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            style={{
              padding: '7px 16px',
              borderRadius: 8,
              border: 'none',
              background: ativo ? CORES.dourado : 'transparent',
              color: ativo ? CORES.offWhite : CORES.espressoLight,
              fontSize: 12,
              fontWeight: ativo ? 700 : 500,
              cursor: 'pointer',
              transition: 'all 0.18s ease',
              letterSpacing: 0.3,
              textTransform: 'uppercase',
            }}
          >
            {opt === 'competencia' ? 'Competência' : 'Caixa'}
          </button>
        );
      })}
    </div>
  );
}
