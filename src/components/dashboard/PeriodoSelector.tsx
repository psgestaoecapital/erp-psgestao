// src/components/dashboard/PeriodoSelector.tsx
// Componente seletor de periodo (mes) para Dashboard
// Identidade visual PS: espresso #3D2314, dourado #C8941A, off-white #FAF7F2

'use client';

import { useEffect, useState } from 'react';

interface Periodo {
  ano: number;
  mes: number;
  label: string;
  total_lancamentos: number;
  receita_total: number;
  is_ultimo_com_dados: boolean;
}

interface Props {
  companyIds: string[];
  anoSelecionado: number | null;
  mesSelecionado: number | null;
  onChange: (ano: number, mes: number) => void;
}

export default function PeriodoSelector({ companyIds, anoSelecionado, mesSelecionado, onChange }: Props) {
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [loading, setLoading] = useState(true);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (!companyIds || companyIds.length === 0) {
      setPeriodos([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetch(`/api/dashboard/periodos?company_ids=${companyIds.join(',')}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok && Array.isArray(j.periodos)) {
          setPeriodos(j.periodos);
          // Se nao tem selecionado, selecionar o ultimo com dados automaticamente
          if (!anoSelecionado || !mesSelecionado) {
            const ultimo = j.periodos.find((p: Periodo) => p.is_ultimo_com_dados);
            if (ultimo) onChange(ultimo.ano, ultimo.mes);
          }
        }
      })
      .catch((e) => console.error('[PeriodoSelector] erro:', e))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyIds.join(',')]);

  const labelAtual = periodos.find(
    (p) => p.ano === anoSelecionado && p.mes === mesSelecionado
  )?.label ?? 'Selecione um período';

  if (loading) {
    return (
      <div
        style={{
          background: '#FAF7F2',
          border: '1px solid #C8941A',
          borderRadius: 8,
          padding: '8px 14px',
          color: '#5C3825',
          fontSize: 13,
        }}
      >
        Carregando períodos...
      </div>
    );
  }

  if (periodos.length === 0) {
    return (
      <div
        style={{
          background: '#FAF7F2',
          border: '1px solid #C8941A',
          borderRadius: 8,
          padding: '8px 14px',
          color: '#5C3825',
          fontSize: 13,
          opacity: 0.6,
        }}
      >
        Sem dados disponíveis
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setAberto(!aberto)}
        style={{
          background: '#3D2314',
          color: '#FFFFFF',
          border: 'none',
          borderRadius: 8,
          padding: '10px 16px',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 180,
          justifyContent: 'space-between',
        }}
      >
        <span>📅 {labelAtual}</span>
        <span style={{ fontSize: 10, color: '#C8941A' }}>▼</span>
      </button>

      {aberto && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            background: '#FFFFFF',
            border: '1px solid #E8E0D4',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(61,35,20,0.15)',
            maxHeight: 360,
            overflowY: 'auto',
            zIndex: 1000,
            minWidth: 280,
          }}
        >
          <div
            style={{
              padding: '10px 14px',
              borderBottom: '1px solid #F5F2ED',
              fontSize: 11,
              color: '#5C3825',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Selecione o período
          </div>
          {periodos.map((p) => {
            const ativo = p.ano === anoSelecionado && p.mes === mesSelecionado;
            return (
              <button
                key={`${p.ano}-${p.mes}`}
                onClick={() => {
                  onChange(p.ano, p.mes);
                  setAberto(false);
                }}
                style={{
                  width: '100%',
                  background: ativo ? '#FAF7F2' : 'transparent',
                  border: 'none',
                  borderLeft: ativo ? '3px solid #C8941A' : '3px solid transparent',
                  padding: '10px 14px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 13,
                  color: '#3D2314',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
                onMouseEnter={(e) => {
                  if (!ativo) e.currentTarget.style.background = '#FAF7F2';
                }}
                onMouseLeave={(e) => {
                  if (!ativo) e.currentTarget.style.background = 'transparent';
                }}
              >
                <div>
                  <div style={{ fontWeight: ativo ? 700 : 500 }}>
                    {p.label}
                    {p.is_ultimo_com_dados && (
                      <span
                        style={{
                          fontSize: 10,
                          background: '#C8941A',
                          color: '#3D2314',
                          padding: '2px 6px',
                          borderRadius: 4,
                          marginLeft: 8,
                          fontWeight: 700,
                        }}
                      >
                        ATUAL
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#5C3825', marginTop: 2 }}>
                    {p.total_lancamentos} lançamentos · R$ {Number(p.receita_total).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
