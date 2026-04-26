'use client';

import { useState, useEffect } from 'react';
import RaioXDREExpandida from './RaioXDREExpandida';
import RaioXABCProfundo from './RaioXABCProfundo';
import RaioXFluxoCaixa from './RaioXFluxoCaixa';
import RaioXIndicadores from './RaioXIndicadores';
import RaioXAssessor from './RaioXAssessor';

interface Props {
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  companyIds: string[];
  ano: number | null;
  mes: number | null;
  regime: 'competencia' | 'caixa';
  grupoId?: string | null;
}

const CORES = {
  espresso: '#3D2314',
  espressoLight: '#5A3A2A',
  offWhite: '#FAF7F2',
  offWhiteDark: '#F0EAE0',
  dourado: '#C8941A',
};

type Aba = 'dre' | 'abc' | 'fluxo' | 'indicadores' | 'assessor';

export default function RaioXProfundo({ apiFetch, companyIds, ano, mes, regime, grupoId }: Props) {
  const [aberto, setAberto] = useState(false);
  const [abaAtiva, setAbaAtiva] = useState<Aba>('dre');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Lazy load: so busca quando usuario abrir
  useEffect(() => {
    if (!aberto || !companyIds || companyIds.length === 0) return;

    let cancelado = false;
    setLoading(true);
    setErro(null);

    const params = new URLSearchParams();
    if (grupoId) {
      params.set('grupo_id', grupoId);
    } else if (companyIds.length > 0) {
      params.set('company_ids', companyIds.join(','));
    }
    if (ano) params.set('ano', String(ano));
    if (mes) params.set('mes', String(mes));
    params.set('regime', regime);

    apiFetch(`/api/dashboard/raiox?${params.toString()}`)
      .then(r => r.json())
      .then(d => {
        if (cancelado) return;
        if (d.erro) {
          setErro(d.erro);
        } else {
          setData(d);
        }
      })
      .catch(e => {
        if (!cancelado) setErro(String(e));
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });

    return () => { cancelado = true; };
  }, [aberto, companyIds.join(','), ano, mes, regime, grupoId]);

  if (!aberto) {
    return (
      <section style={{ marginBottom: 24 }}>
        <button
          onClick={() => setAberto(true)}
          style={{
            width: '100%',
            padding: '20px 28px',
            background: CORES.offWhite,
            border: `2px dashed ${CORES.dourado}`,
            borderRadius: 14,
            color: CORES.espresso,
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: 0.8,
            textTransform: 'uppercase',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = CORES.offWhiteDark;
            e.currentTarget.style.borderStyle = 'solid';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = CORES.offWhite;
            e.currentTarget.style.borderStyle = 'dashed';
          }}
        >
          <span style={{ fontSize: 18 }}>🔬</span>
          <span>Abrir Raio-X Profundo</span>
          <span style={{ color: CORES.espressoLight, fontSize: 12, fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
            DRE expandida · ABC profundo · Fluxo de caixa · Indicadores operacionais
          </span>
        </button>
      </section>
    );
  }

  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{
        background: CORES.offWhite,
        borderRadius: 14,
        border: `1px solid ${CORES.offWhiteDark}`,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '16px 24px',
          borderBottom: `1px solid ${CORES.offWhiteDark}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: CORES.dourado,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18
            }}>
              🔬
            </div>
            <div>
              <div style={{ color: CORES.espresso, fontSize: 15, fontWeight: 700, letterSpacing: 0.5 }}>
                Raio-X Profundo
              </div>
              <div style={{ color: CORES.espressoLight, fontSize: 11, marginTop: 2 }}>
                Análise nível CFO sênior · Visão {regime === 'caixa' ? 'CAIXA' : 'COMPETÊNCIA'}
              </div>
            </div>
          </div>
          <button
            onClick={() => setAberto(false)}
            style={{
              background: 'transparent',
              border: `1px solid ${CORES.offWhiteDark}`,
              color: CORES.espressoLight,
              fontSize: 12,
              padding: '6px 14px',
              borderRadius: 8,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Fechar ✕
          </button>
        </div>

        <div style={{ display: 'flex', gap: 0, padding: '0 24px', borderBottom: `1px solid ${CORES.offWhiteDark}`, overflowX: 'auto' }}>
          {([
            { id: 'dre', label: 'DRE Expandida' },
            { id: 'abc', label: 'ABC Profundo' },
            { id: 'fluxo', label: 'Fluxo de Caixa' },
            { id: 'indicadores', label: 'Indicadores Operacionais' },
            { id: 'assessor', label: '👔 Raio-X Assessor' },
          ] as const).map(aba => (
            <button
              key={aba.id}
              onClick={() => setAbaAtiva(aba.id)}
              style={{
                padding: '14px 20px',
                background: 'transparent',
                border: 'none',
                borderBottom: abaAtiva === aba.id ? `3px solid ${CORES.dourado}` : '3px solid transparent',
                color: abaAtiva === aba.id ? CORES.espresso : CORES.espressoLight,
                fontSize: 13,
                fontWeight: abaAtiva === aba.id ? 700 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                marginBottom: -1,
                transition: 'all 0.15s ease',
              }}
            >
              {aba.label}
            </button>
          ))}
        </div>

        <div style={{ padding: 24, minHeight: 300 }}>
          {loading && (
            <div style={{ textAlign: 'center', color: CORES.espressoLight, padding: 40, fontSize: 13 }}>
              Calculando análise profunda...
            </div>
          )}
          {erro && (
            <div style={{ color: '#C44536', padding: 20, fontSize: 13 }}>
              Erro ao carregar Raio-X: {erro}
            </div>
          )}
          {!loading && !erro && data && (
            <>
              {abaAtiva === 'dre' && <RaioXDREExpandida data={data} />}
              {abaAtiva === 'abc' && <RaioXABCProfundo data={data} />}
              {abaAtiva === 'fluxo' && <RaioXFluxoCaixa data={data} />}
              {abaAtiva === 'indicadores' && <RaioXIndicadores data={data} />}
              {abaAtiva === 'assessor' && (
                <RaioXAssessor
                  apiFetch={apiFetch}
                  companyIds={companyIds}
                  ano={ano}
                  mes={mes}
                  grupoId={grupoId}
                  ativo={abaAtiva === 'assessor'}
                />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
