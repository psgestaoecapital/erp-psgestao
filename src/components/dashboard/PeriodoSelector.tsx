// src/components/dashboard/PeriodoSelector.tsx
// v2 — Suporta seletor de Mes + Periodo Custom (datepicker)
// Identidade visual PS: espresso #3D2314, dourado #C8941A, off-white #FAF7F2

'use client';

import { useEffect, useState } from 'react';

export interface Periodo {
  ano: number;
  mes: number;
  label: string;
  total_lancamentos: number;
  receita_total: number;
  despesa_total: number;
  is_ultimo_com_dados: boolean;
}

export type SelecaoPeriodo =
  | { modo: 'mes'; ano: number; mes: number }
  | { modo: 'custom'; data_inicio: string; data_fim: string };

interface Props {
  companyIds: string[];
  selecao: SelecaoPeriodo | null;
  onChange: (sel: SelecaoPeriodo) => void;
  /**
   * Notifica o pai quando a lista de periodos chega do backend.
   * O PAI deve usar isso para fazer auto-select com setState callback
   * (evita closure stale do filho).
   */
  onPeriodosCarregados?: (periodos: Periodo[]) => void;
}

export default function PeriodoSelector({
  companyIds,
  selecao,
  onChange,
  onPeriodosCarregados,
}: Props) {
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [loading, setLoading] = useState(true);
  const [aberto, setAberto] = useState(false);
  const [aba, setAba] = useState<'mes' | 'custom'>('mes');

  // Estados temporarios do datepicker custom
  const [tmpInicio, setTmpInicio] = useState('');
  const [tmpFim, setTmpFim] = useState('');

  // Buscar periodos quando companyIds muda + notificar o pai com a lista.
  // Auto-select foi MOVIDO para o pai (evita closure stale + race condition).
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
          // Notifica pai com lista carregada (pai decide auto-select via setState callback)
          if (onPeriodosCarregados) {
            onPeriodosCarregados(j.periodos);
          }
        } else {
          setPeriodos([]);
        }
      })
      .catch((e) => {
        console.error('[PeriodoSelector] erro fetch periodos:', e);
        setPeriodos([]);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyIds.join(',')]);

  // Inicializar datepicker custom com valores razoaveis
  useEffect(() => {
    if (!tmpInicio && !tmpFim && selecao?.modo === 'custom') {
      setTmpInicio(selecao.data_inicio);
      setTmpFim(selecao.data_fim);
    } else if (!tmpInicio && periodos.length > 0) {
      const ultimo = periodos.find((p) => p.is_ultimo_com_dados);
      if (ultimo) {
        const dataFim = new Date(ultimo.ano, ultimo.mes, 0);
        const dataInicio = new Date(ultimo.ano, ultimo.mes - 1, 1);
        setTmpInicio(dataInicio.toISOString().slice(0, 10));
        setTmpFim(dataFim.toISOString().slice(0, 10));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodos.length, selecao]);

  // Tabela de nomes de mes para fallback elegante (Bug 2: nao mostrar "11/2026")
  const NOMES_MES: Record<number, string> = {
    1: 'Janeiro', 2: 'Fevereiro', 3: 'Março', 4: 'Abril',
    5: 'Maio', 6: 'Junho', 7: 'Julho', 8: 'Agosto',
    9: 'Setembro', 10: 'Outubro', 11: 'Novembro', 12: 'Dezembro',
  };

  // Label exibida no botao
  const labelAtual = (() => {
    if (!selecao) return 'Selecione um período';
    if (selecao.modo === 'mes') {
      const p = periodos.find((p) => p.ano === selecao.ano && p.mes === selecao.mes);
      if (p?.label) return p.label;
      // Fallback elegante: usa nome do mes mesmo se nao estiver na lista atual
      return `${NOMES_MES[selecao.mes] ?? selecao.mes}/${selecao.ano}`;
    }
    const fmt = (s: string) => {
      const [y, m, d] = s.split('-');
      return `${d}/${m}/${y}`;
    };
    return `${fmt(selecao.data_inicio)} a ${fmt(selecao.data_fim)}`;
  })();

  // Estilos compartilhados
  const C_ESPRESSO = '#3D2314';
  const C_DOURADO = '#C8941A';
  const C_OFFWHITE = '#FAF7F2';
  const C_BORDA = '#E8E0D4';
  const C_TEXTO = '#5C3825';

  if (loading) {
    return (
      <div
        style={{
          background: C_OFFWHITE,
          border: `1px solid ${C_DOURADO}`,
          borderRadius: 8,
          padding: '8px 14px',
          color: C_TEXTO,
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
          background: C_OFFWHITE,
          border: `1px solid ${C_DOURADO}`,
          borderRadius: 8,
          padding: '8px 14px',
          color: C_TEXTO,
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
          background: C_ESPRESSO,
          color: '#FFF',
          border: 'none',
          borderRadius: 8,
          padding: '10px 16px',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 220,
          justifyContent: 'space-between',
        }}
      >
        <span>📅 {labelAtual}</span>
        <span style={{ fontSize: 10, color: C_DOURADO }}>▼</span>
      </button>

      {aberto && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            background: '#FFF',
            border: `1px solid ${C_BORDA}`,
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(61,35,20,0.15)',
            zIndex: 1000,
            minWidth: 320,
            overflow: 'hidden',
          }}
        >
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${C_BORDA}` }}>
            <button
              onClick={() => setAba('mes')}
              style={{
                flex: 1,
                padding: '12px 16px',
                fontSize: 13,
                fontWeight: 600,
                background: aba === 'mes' ? C_OFFWHITE : 'transparent',
                color: aba === 'mes' ? C_ESPRESSO : C_TEXTO,
                border: 'none',
                cursor: 'pointer',
                borderBottom: aba === 'mes' ? `3px solid ${C_DOURADO}` : '3px solid transparent',
              }}
            >
              📅 Mês
            </button>
            <button
              onClick={() => setAba('custom')}
              style={{
                flex: 1,
                padding: '12px 16px',
                fontSize: 13,
                fontWeight: 600,
                background: aba === 'custom' ? C_OFFWHITE : 'transparent',
                color: aba === 'custom' ? C_ESPRESSO : C_TEXTO,
                border: 'none',
                cursor: 'pointer',
                borderBottom: aba === 'custom' ? `3px solid ${C_DOURADO}` : '3px solid transparent',
              }}
            >
              📊 Período custom
            </button>
          </div>

          {aba === 'mes' && (
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {periodos.map((p) => {
                const ativo = selecao?.modo === 'mes' && selecao.ano === p.ano && selecao.mes === p.mes;
                return (
                  <button
                    key={`${p.ano}-${p.mes}`}
                    onClick={() => {
                      onChange({ modo: 'mes', ano: p.ano, mes: p.mes });
                      setAberto(false);
                    }}
                    style={{
                      width: '100%',
                      background: ativo ? C_OFFWHITE : 'transparent',
                      border: 'none',
                      borderLeft: ativo ? `3px solid ${C_DOURADO}` : '3px solid transparent',
                      padding: '10px 14px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontSize: 13,
                      color: C_ESPRESSO,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                    onMouseEnter={(e) => {
                      if (!ativo) e.currentTarget.style.background = C_OFFWHITE;
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
                              background: C_DOURADO,
                              color: C_ESPRESSO,
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
                      <div style={{ fontSize: 11, color: C_TEXTO, marginTop: 2 }}>
                        {p.total_lancamentos} lançamentos · R$ {Number(p.receita_total).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {aba === 'custom' && (
            <div style={{ padding: 16 }}>
              <div style={{ marginBottom: 12 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 11,
                    fontWeight: 600,
                    color: C_TEXTO,
                    marginBottom: 4,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Data inicial
                </label>
                <input
                  type="date"
                  value={tmpInicio}
                  onChange={(e) => setTmpInicio(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: 14,
                    border: `1px solid ${C_BORDA}`,
                    borderRadius: 6,
                    color: C_ESPRESSO,
                    background: '#FFF',
                  }}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 11,
                    fontWeight: 600,
                    color: C_TEXTO,
                    marginBottom: 4,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Data final
                </label>
                <input
                  type="date"
                  value={tmpFim}
                  onChange={(e) => setTmpFim(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: 14,
                    border: `1px solid ${C_BORDA}`,
                    borderRadius: 6,
                    color: C_ESPRESSO,
                    background: '#FFF',
                  }}
                />
              </div>
              <button
                onClick={() => {
                  if (!tmpInicio || !tmpFim) {
                    alert('Selecione data inicial e final');
                    return;
                  }
                  if (tmpInicio > tmpFim) {
                    alert('Data inicial deve ser anterior à data final');
                    return;
                  }
                  onChange({ modo: 'custom', data_inicio: tmpInicio, data_fim: tmpFim });
                  setAberto(false);
                }}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  background: C_ESPRESSO,
                  color: '#FFF',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Aplicar período
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
