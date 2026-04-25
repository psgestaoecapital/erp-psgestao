'use client';

import { useState } from 'react';

interface Insight {
  tipo: string;
  severidade: 'alta' | 'media' | 'baixa';
  titulo: string;
  mensagem: string;
  metricas: Record<string, any>;
  empresa?: string;
  company_id?: string;
}

interface ConsultorIAData {
  qtd_empresas?: number;
  ano?: number;
  mes?: number;
  empresas?: Array<{ empresa: string; insights: Insight[]; company_id: string; qtd_insights: number }>;
  qtd_insights_total?: number;
  qtd_criticos?: number;
  insights_criticos?: Insight[];
}

interface Props {
  data: ConsultorIAData | null | undefined;
}

const CORES = {
  espresso: '#3D2314',
  espressoLight: '#5A3A2A',
  offWhite: '#FAF7F2',
  offWhiteDark: '#F0EAE0',
  dourado: '#C8941A',
  alta: '#C44536',
  media: '#D89627',
  baixa: '#5C8D3F',
};

const sevColor = (s: string) => s === 'alta' ? CORES.alta : s === 'media' ? CORES.media : CORES.baixa;
const sevLabel = (s: string) => s === 'alta' ? 'CRÍTICO' : s === 'media' ? 'ATENÇÃO' : 'OK';

export default function ConsultorInsights({ data }: Props) {
  const [expandido, setExpandido] = useState(false);

  if (!data) return null;

  // Normaliza: se for empresa única (formato fn_consultor_insights), trata como grupo de 1
  const isGrupo = !!data.empresas;
  const empresas = data.empresas || [];

  // Agrega TODOS os insights do grupo, marcando empresa de origem
  const todosInsights: Insight[] = empresas.flatMap(emp =>
    (emp.insights || []).map(i => ({ ...i, empresa: emp.empresa, company_id: emp.company_id }))
  );

  // Se for empresa única (sem .empresas), usa direto data.insights
  const insightsArr: Insight[] = todosInsights.length > 0
    ? todosInsights
    : ((data as any).insights || []);

  if (insightsArr.length === 0) {
    return (
      <section style={{ background: CORES.offWhite, borderRadius: 16, padding: '20px 28px', marginBottom: 24, border: `1px solid ${CORES.offWhiteDark}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: CORES.dourado, display: 'flex', alignItems: 'center', justifyContent: 'center', color: CORES.offWhite, fontWeight: 700, fontSize: 14 }}>IA</div>
          <div>
            <div style={{ color: CORES.espresso, fontSize: 14, fontWeight: 600 }}>Consultor IA</div>
            <div style={{ color: CORES.espressoLight, fontSize: 13, marginTop: 2 }}>Sem dados suficientes pra análise neste período.</div>
          </div>
        </div>
      </section>
    );
  }

  const criticos = insightsArr.filter(i => i.severidade === 'alta');
  const ordenados = [...insightsArr].sort((a, b) => {
    const ordem: Record<string, number> = { alta: 0, media: 1, baixa: 2 };
    return ordem[a.severidade] - ordem[b.severidade];
  });

  const insightsExibidos = expandido ? ordenados : ordenados.slice(0, 4);

  return (
    <section style={{ background: CORES.offWhite, borderRadius: 16, padding: '24px 28px', marginBottom: 24, border: `1px solid ${CORES.offWhiteDark}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, paddingBottom: 14, borderBottom: `1px solid ${CORES.offWhiteDark}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: CORES.dourado, display: 'flex', alignItems: 'center', justifyContent: 'center', color: CORES.offWhite, fontWeight: 700, fontSize: 14 }}>IA</div>
          <div>
            <div style={{ color: CORES.espresso, fontSize: 15, fontWeight: 700, letterSpacing: 0.3 }}>Consultor IA</div>
            <div style={{ color: CORES.espressoLight, fontSize: 12, marginTop: 1 }}>
              {insightsArr.length} {insightsArr.length === 1 ? 'insight' : 'insights'}
              {criticos.length > 0 ? (
                <> · <span style={{ color: CORES.alta, fontWeight: 600 }}>{criticos.length} {criticos.length === 1 ? 'crítico' : 'críticos'}</span></>
              ) : (
                <> · <span style={{ color: CORES.baixa }}>tudo sob controle</span></>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {insightsExibidos.map((insight, idx) => (
          <InsightCard key={`${insight.tipo}-${idx}-${insight.company_id || ''}`} insight={insight} mostrarEmpresa={isGrupo && empresas.length > 1} />
        ))}
      </div>

      {ordenados.length > 4 && (
        <button
          onClick={() => setExpandido(!expandido)}
          style={{ marginTop: 14, background: 'transparent', border: 'none', color: CORES.dourado, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px 0' }}
        >
          {expandido ? '↑ Recolher' : `↓ Ver mais ${ordenados.length - 4} ${ordenados.length - 4 === 1 ? 'insight' : 'insights'}`}
        </button>
      )}
    </section>
  );
}

function InsightCard({ insight, mostrarEmpresa }: { insight: Insight; mostrarEmpresa?: boolean }) {
  const cor = sevColor(insight.severidade);
  return (
    <div style={{ background: CORES.offWhite, borderRadius: 10, padding: '14px 16px', borderLeft: `4px solid ${cor}`, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: cor, background: `${cor}15`, padding: '3px 8px', borderRadius: 4, letterSpacing: 0.5 }}>
          {sevLabel(insight.severidade)}
        </span>
        {mostrarEmpresa && insight.empresa && (
          <span style={{ fontSize: 11, color: CORES.espressoLight, fontWeight: 500 }}>· {insight.empresa}</span>
        )}
      </div>
      <div style={{ color: CORES.espresso, fontSize: 14, fontWeight: 600, marginBottom: 4, lineHeight: 1.35 }}>
        {insight.titulo}
      </div>
      <div style={{ color: CORES.espressoLight, fontSize: 13, lineHeight: 1.5 }}>
        {insight.mensagem}
      </div>
    </div>
  );
}
