// src/components/bpo/FiltroEmpresas.tsx
// Barra horizontal de filtros por empresa (chips com contadores).
// Uso: filtrar pendencias na tela /bpo/meu-dia por company_id (client-side).

'use client';

interface Empresa {
  id: string;
  nome: string;
  total: number;
}

interface Props {
  empresas: Empresa[];
  selecionada: string | null;
  onChange: (id: string | null) => void;
}

export default function FiltroEmpresas({ empresas, selecionada, onChange }: Props) {
  const C_ESPRESSO = '#3D2314';
  const C_DOURADO = '#C8941A';
  const C_OFFWHITE = '#FAF7F2';
  const C_TEXTO = '#5C3825';
  const C_BORDA = '#E8E0D4';

  const total = empresas.reduce((sum, e) => sum + e.total, 0);

  if (empresas.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        padding: '12px 16px',
        background: '#FFFFFF',
        borderRadius: 12,
        border: `1px solid ${C_BORDA}`,
        overflowX: 'auto',
        marginBottom: 16,
        scrollbarWidth: 'thin',
      }}
    >
      {/* Botao "Todas" */}
      <button
        onClick={() => onChange(null)}
        style={{
          flexShrink: 0,
          padding: '8px 14px',
          borderRadius: 8,
          border: `1.5px solid ${selecionada === null ? C_ESPRESSO : C_BORDA}`,
          background: selecionada === null ? C_ESPRESSO : '#FFFFFF',
          color: selecionada === null ? '#FFFFFF' : C_TEXTO,
          fontSize: 13,
          fontWeight: selecionada === null ? 700 : 500,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          transition: 'all 0.15s ease',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span>📊 Todas</span>
        <span
          style={{
            background: selecionada === null ? C_DOURADO : '#F5F2ED',
            color: selecionada === null ? C_ESPRESSO : C_TEXTO,
            padding: '2px 8px',
            borderRadius: 10,
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {total}
        </span>
      </button>

      {/* Botoes por empresa */}
      {empresas.map((emp) => {
        const ativa = selecionada === emp.id;
        return (
          <button
            key={emp.id}
            onClick={() => onChange(ativa ? null : emp.id)}
            style={{
              flexShrink: 0,
              padding: '8px 14px',
              borderRadius: 8,
              border: `1.5px solid ${ativa ? C_DOURADO : C_BORDA}`,
              background: ativa ? C_OFFWHITE : '#FFFFFF',
              color: C_TEXTO,
              fontSize: 13,
              fontWeight: ativa ? 700 : 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
            onMouseEnter={(e) => {
              if (!ativa) e.currentTarget.style.background = C_OFFWHITE;
            }}
            onMouseLeave={(e) => {
              if (!ativa) e.currentTarget.style.background = '#FFFFFF';
            }}
          >
            <span>{emp.nome.length > 25 ? emp.nome.slice(0, 25) + '…' : emp.nome}</span>
            <span
              style={{
                background: ativa ? C_DOURADO : '#F5F2ED',
                color: ativa ? C_ESPRESSO : C_TEXTO,
                padding: '2px 8px',
                borderRadius: 10,
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {emp.total}
            </span>
          </button>
        );
      })}
    </div>
  );
}
