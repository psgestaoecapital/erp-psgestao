'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import StatusBadge, { toneByStatus, toneByPrioridade } from './StatusBadge';
import { COR } from './colors';

export type ModuloRow = {
  module_id: string;
  modulo_nome: string;
  layer: string | null;
  grupo: string | null;
  modulo_descricao: string | null;
  total_features: number;
  features_prontas: number;
  features_parciais: number;
  features_previstas: number;
};

export type FeatureRow = {
  feature_id: string;
  module_id: string;
  area: string | null;
  titulo: string;
  descricao_executiva: string | null;
  status: string;
  percentual_pronto: number;
  prioridade: string;
};

export default function ModuloAccordion({
  modulo,
  features,
  defaultOpen = false,
}: {
  modulo: ModuloRow;
  features: FeatureRow[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      style={{
        background: COR.offWhite,
        border: `1px solid ${COR.border}`,
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          padding: '14px 18px',
          background: 'transparent',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          textAlign: 'left',
          cursor: 'pointer',
          color: COR.espresso,
        }}
      >
        <ChevronDown
          size={18}
          style={{
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 0.15s',
            flexShrink: 0,
            color: COR.espressoM,
          }}
        />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{modulo.modulo_nome}</span>
            {modulo.layer && (
              <StatusBadge tone="muted" size="xs">
                {modulo.layer}
              </StatusBadge>
            )}
            {modulo.grupo && (
              <StatusBadge tone="default" size="xs">
                {modulo.grupo}
              </StatusBadge>
            )}
          </div>
          {modulo.modulo_descricao && (
            <span style={{ fontSize: 12, color: COR.espressoM, lineHeight: 1.4 }}>
              {modulo.modulo_descricao}
            </span>
          )}
        </div>
        <span
          style={{
            fontSize: 11,
            color: COR.espressoM,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          {modulo.features_prontas}/{modulo.total_features} prontas
        </span>
      </button>

      {open && (
        <div
          style={{
            padding: 0,
            borderTop: `1px solid ${COR.borderL}`,
            overflowX: 'auto',
          }}
        >
          {features.length === 0 ? (
            <div
              style={{
                padding: 18,
                fontSize: 12,
                color: COR.espressoM,
                fontStyle: 'italic',
              }}
            >
              Sem features catalogadas neste modulo.
            </div>
          ) : (
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: COR.cream }}>
                  <Th>Feature</Th>
                  <Th>Area</Th>
                  <Th>Status</Th>
                  <Th>Prioridade</Th>
                  <Th align="right">%</Th>
                </tr>
              </thead>
              <tbody>
                {features.map((f) => (
                  <tr
                    key={f.feature_id}
                    style={{ borderTop: `1px solid ${COR.borderL}` }}
                  >
                    <Td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontWeight: 600, color: COR.espresso }}>
                          {f.titulo}
                        </span>
                        {f.descricao_executiva && (
                          <span style={{ color: COR.espressoM, fontSize: 11 }}>
                            {f.descricao_executiva}
                          </span>
                        )}
                      </div>
                    </Td>
                    <Td>{f.area ?? '—'}</Td>
                    <Td>
                      <StatusBadge tone={toneByStatus(f.status)} size="xs">
                        {f.status}
                      </StatusBadge>
                    </Td>
                    <Td>
                      <StatusBadge tone={toneByPrioridade(f.prioridade)} size="xs">
                        {f.prioridade}
                      </StatusBadge>
                    </Td>
                    <Td align="right">
                      <strong style={{ color: COR.espresso }}>{f.percentual_pronto}%</strong>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      style={{
        padding: '10px 16px',
        textAlign: align,
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: COR.espressoM,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <td
      style={{
        padding: '10px 16px',
        textAlign: align,
        verticalAlign: 'top',
        color: COR.espresso,
      }}
    >
      {children}
    </td>
  );
}
