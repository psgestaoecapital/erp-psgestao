'use client';

import { useState, useEffect } from 'react';

interface Props {
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  companyIds: string[];
  ano: number | null;
  mes: number | null;
  grupoId?: string | null;
  ativo: boolean;
}

const CORES = {
  espresso: '#3D2314',
  espressoLight: '#5A3A2A',
  offWhite: '#FAF7F2',
  offWhiteDark: '#F0EAE0',
  dourado: '#C8941A',
  douradoSoft: '#E8B848',
  alta: '#C44536',
  media: '#D89627',
  baixa: '#5C8D3F',
  azul: '#3D6FA8',
  azulSoft: '#E5EEF8',
  verdeSoft: '#E8F5DD',
  amareloSoft: '#FCF3DA',
  vermelhoSoft: '#F8DDDA',
};

const fmtR = (v: number) => {
  if (v === null || v === undefined) return '—';
  return `R$ ${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

const fmtPct = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '—';
  const sinal = v > 0 ? '+' : '';
  return `${sinal}${v.toFixed(1)}%`;
};

const corVariacao = (v: number | null | undefined) => {
  if (v === null || v === undefined) return CORES.espressoLight;
  if (v > 5) return CORES.baixa;
  if (v < -5) return CORES.alta;
  return CORES.espressoLight;
};

const GRUPO_LABEL: Record<string, string> = {
  ROB: 'Receita',
  IMPOSTOS_VENDA: 'Impostos',
  CMV: 'CMV',
  DESP_VARIAVEL: 'Desp. Variável',
  DESP_FIXA: 'Desp. Fixa',
  RESULT_FIN: 'Result. Financeiro',
  NAO_OPER: 'Não Operacional',
};

export default function RaioXAssessor({ apiFetch, companyIds, ano, mes, grupoId, ativo }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!ativo || !companyIds || companyIds.length === 0) return;

    let cancelado = false;
    setLoading(true);
    setErro(null);

    const params = new URLSearchParams();
    if (grupoId) params.set('grupo_id', grupoId);
    else if (companyIds.length > 0) params.set('company_ids', companyIds.join(','));
    if (ano) params.set('ano', String(ano));
    if (mes) params.set('mes', String(mes));

    apiFetch(`/api/dashboard/raiox-assessor?${params.toString()}`)
      .then(r => r.json())
      .then(d => {
        if (cancelado) return;
        if (d.erro) setErro(d.erro);
        else setData(d);
      })
      .catch(e => { if (!cancelado) setErro(String(e)); })
      .finally(() => { if (!cancelado) setLoading(false); });

    return () => { cancelado = true; };
  }, [ativo, companyIds.join(','), ano, mes, grupoId]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', color: CORES.espressoLight, padding: 60, fontSize: 13 }}>
        Gerando análise nível CFO sênior...
      </div>
    );
  }

  if (erro) {
    return (
      <div style={{ color: CORES.alta, padding: 20, fontSize: 13 }}>
        Erro ao carregar Raio-X Assessor: {erro}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <BannerHeader />
      <BlocoNarrativaCFO narrativa={data.narrativa} />
      <BlocoApuracaoTributaria tributario={data.tributario} />
      <BlocoAVAH avAh={data.av_ah} />
    </div>
  );
}

function BannerHeader() {
  return (
    <div style={{
      background: `linear-gradient(135deg, ${CORES.espresso} 0%, ${CORES.espressoLight} 100%)`,
      color: CORES.offWhite,
      padding: '20px 24px',
      borderRadius: 12,
      display: 'flex',
      alignItems: 'center',
      gap: 16,
    }}>
      <div style={{ fontSize: 28 }}>👔</div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 0.5, marginBottom: 4 }}>
          Análise nível Big 4 / Consultoria Sênior
        </div>
        <div style={{ fontSize: 12, opacity: 0.9, lineHeight: 1.5 }}>
          Diagnóstico estratégico, plano de ação 30/60/90 dias, comparação tributária e análise vertical/horizontal completa.
          Equivalente a relatório de CFO terceirizado de R$ 5-15k/mês.
        </div>
      </div>
    </div>
  );
}

function BlocoNarrativaCFO({ narrativa }: { narrativa: any }) {
  if (!narrativa) return null;

  const acoes30 = narrativa.plano_acao?.imediato_30d || [];
  const acoes60 = narrativa.plano_acao?.curto_prazo_60d || [];
  const acoes90 = narrativa.plano_acao?.estrategico_90d || [];
  const fortes = narrativa.pontos_fortes || [];
  const alertas = narrativa.alertas_preditivos || [];

  return (
    <section>
      <h3 style={{ color: CORES.espresso, fontSize: 13, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 12 }}>
        💼 Diagnóstico CFO Sênior
      </h3>

      <div style={{
        background: CORES.azulSoft,
        borderLeft: `4px solid ${CORES.azul}`,
        borderRadius: 10,
        padding: '18px 22px',
        marginBottom: 16,
      }}>
        <div style={{ color: CORES.azul, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
          Diagnóstico Executivo
        </div>
        <div style={{ color: CORES.espresso, fontSize: 14, lineHeight: 1.6, fontWeight: 500 }}>
          {narrativa.diagnostico_executivo}
        </div>
      </div>

      {fortes.length > 0 && (
        <div style={{
          background: CORES.verdeSoft,
          borderLeft: `4px solid ${CORES.baixa}`,
          borderRadius: 10,
          padding: '14px 22px',
          marginBottom: 16,
        }}>
          <div style={{ color: CORES.baixa, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
            ✓ Pontos Fortes
          </div>
          <ul style={{ margin: 0, paddingLeft: 20, color: CORES.espresso, fontSize: 13, lineHeight: 1.6 }}>
            {fortes.map((p: string, i: number) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}

      {alertas.length > 0 && (
        <div style={{
          background: CORES.vermelhoSoft,
          borderLeft: `4px solid ${CORES.alta}`,
          borderRadius: 10,
          padding: '14px 22px',
          marginBottom: 16,
        }}>
          <div style={{ color: CORES.alta, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
            🚨 Alertas Preditivos
          </div>
          <ul style={{ margin: 0, paddingLeft: 20, color: CORES.espresso, fontSize: 13, lineHeight: 1.6 }}>
            {alertas.map((a: string, i: number) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}

      <div style={{
        marginTop: 8,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 12,
      }}>
        <PlanoAcaoCard titulo="🎯 Imediato — 30 dias" acoes={acoes30} cor={CORES.alta} />
        <PlanoAcaoCard titulo="⏱ Curto Prazo — 60 dias" acoes={acoes60} cor={CORES.media} />
        <PlanoAcaoCard titulo="🚀 Estratégico — 90 dias" acoes={acoes90} cor={CORES.azul} />
      </div>

      <div style={{
        marginTop: 12,
        padding: '8px 14px',
        background: CORES.offWhiteDark,
        borderRadius: 8,
        fontSize: 10,
        color: CORES.espressoLight,
        fontStyle: 'italic',
        textAlign: 'right',
      }}>
        Análise gerada por IA · {narrativa.tipo_geracao || 'heuristico_v1'} · {new Date(narrativa.gerado_em).toLocaleString('pt-BR')}
      </div>
    </section>
  );
}

function PlanoAcaoCard({ titulo, acoes, cor }: any) {
  return (
    <div style={{
      background: CORES.offWhite,
      border: `1px solid ${CORES.offWhiteDark}`,
      borderRadius: 10,
      padding: '14px 16px',
      borderTop: `3px solid ${cor}`,
    }}>
      <div style={{ color: cor, fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 }}>
        {titulo}
      </div>
      {acoes.length === 0 ? (
        <div style={{ color: CORES.espressoLight, fontSize: 12, fontStyle: 'italic' }}>
          Nenhuma ação requerida neste horizonte.
        </div>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, color: CORES.espresso, fontSize: 12, lineHeight: 1.5 }}>
          {acoes.map((a: string, i: number) => <li key={i} style={{ marginBottom: 6 }}>{a}</li>)}
        </ul>
      )}
    </div>
  );
}

function BlocoApuracaoTributaria({ tributario }: { tributario: any }) {
  if (!tributario) return null;

  const recomendado = tributario.comparacao?.recomendacao;
  const regimes = [
    {
      id: 'SIMPLES NACIONAL',
      label: 'Simples Nacional',
      icon: '🟢',
      data: tributario.simples_nacional,
      imposto: tributario.simples_nacional?.imposto_estimado,
      aliquota: tributario.simples_nacional?.aliquota_efetiva_pct,
      observacao: tributario.simples_nacional?.observacao,
      elegivel: tributario.simples_nacional?.elegivel,
    },
    {
      id: 'LUCRO PRESUMIDO',
      label: 'Lucro Presumido',
      icon: '🟡',
      data: tributario.lucro_presumido,
      imposto: tributario.lucro_presumido?.imposto_estimado,
      aliquota: tributario.lucro_presumido?.aliquota_efetiva_pct,
      observacao: tributario.lucro_presumido?.observacao,
      elegivel: true,
    },
    {
      id: 'LUCRO REAL',
      label: 'Lucro Real',
      icon: '🔵',
      data: tributario.lucro_real,
      imposto: tributario.lucro_real?.imposto_estimado,
      aliquota: tributario.lucro_real?.aliquota_efetiva_pct,
      observacao: tributario.lucro_real?.observacao,
      elegivel: true,
    },
  ];

  return (
    <section>
      <h3 style={{ color: CORES.espresso, fontSize: 13, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>
        🧾 Apuração Tributária Comparada
      </h3>
      <p style={{ color: CORES.espressoLight, fontSize: 11, marginBottom: 16 }}>
        Estimativa para o mês corrente nos 3 regimes — {fmtR(tributario.base?.receita_mes)} de receita base
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 12,
      }}>
        {regimes.map((r) => {
          const isRecomendado = r.id === recomendado;
          return (
            <div
              key={r.id}
              style={{
                background: isRecomendado ? `${CORES.dourado}10` : CORES.offWhite,
                border: isRecomendado ? `2px solid ${CORES.dourado}` : `1px solid ${CORES.offWhiteDark}`,
                borderRadius: 12,
                padding: '18px 20px',
                position: 'relative',
                opacity: r.elegivel ? 1 : 0.5,
              }}
            >
              {isRecomendado && (
                <div style={{
                  position: 'absolute',
                  top: -10,
                  right: 12,
                  background: CORES.dourado,
                  color: CORES.offWhite,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  padding: '4px 10px',
                  borderRadius: 6,
                  textTransform: 'uppercase',
                }}>
                  ⭐ Recomendado
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 18 }}>{r.icon}</span>
                <div style={{ color: CORES.espresso, fontSize: 13, fontWeight: 700, letterSpacing: 0.3 }}>
                  {r.label}
                </div>
              </div>
              {!r.elegivel ? (
                <div style={{ color: CORES.alta, fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                  Não elegível
                </div>
              ) : (
                <>
                  <div style={{ color: CORES.espresso, fontSize: 22, fontWeight: 800, letterSpacing: -0.5, marginBottom: 4 }}>
                    {fmtR(r.imposto)}
                  </div>
                  <div style={{ color: isRecomendado ? CORES.dourado : CORES.espressoLight, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
                    Alíquota efetiva: {r.aliquota}%
                  </div>
                </>
              )}
              <div style={{ color: CORES.espressoLight, fontSize: 10, lineHeight: 1.4, fontStyle: 'italic' }}>
                {r.observacao}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{
        marginTop: 12,
        padding: '10px 16px',
        background: CORES.amareloSoft,
        borderLeft: `3px solid ${CORES.media}`,
        borderRadius: 8,
        fontSize: 11,
        color: CORES.espresso,
        lineHeight: 1.5,
      }}>
        ⚠️ <strong>Aviso legal:</strong> {tributario.comparacao?.aviso_legal}
      </div>
    </section>
  );
}

function BlocoAVAH({ avAh }: { avAh: any }) {
  if (!avAh) return null;
  const comparacao = avAh.comparacao || {};
  const contas = avAh.av_ah_por_conta || [];
  const evolucao = avAh.evolucao_12m || [];

  // Group por dre_grupo pra exibir ordenado
  const ordemGrupos = ['ROB', 'IMPOSTOS_VENDA', 'CMV', 'DESP_VARIAVEL', 'DESP_FIXA', 'RESULT_FIN', 'NAO_OPER'];
  const porGrupo: Record<string, any[]> = {};
  for (const c of contas) {
    const g = c.grupo || 'OUTROS';
    if (!porGrupo[g]) porGrupo[g] = [];
    porGrupo[g].push(c);
  }

  const maxAbs = Math.max(...evolucao.map((e: any) => Math.max(Math.abs(e.receita || 0), Math.abs(e.despesas || 0))), 1);

  return (
    <section>
      <h3 style={{ color: CORES.espresso, fontSize: 13, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>
        📊 Análise Vertical e Horizontal
      </h3>
      <p style={{ color: CORES.espressoLight, fontSize: 11, marginBottom: 16 }}>
        Estrutura de custos (AV) + variações temporais (AH MoM e YoY) + evolução 12 meses
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 10,
        marginBottom: 18,
      }}>
        <CompCard label="Receita Atual" valor={fmtR(comparacao.receita_atual)} />
        <CompCard label="Mês Anterior" valor={fmtR(comparacao.receita_anterior_mes)} delta={comparacao.var_mom_pct} />
        <CompCard label="Mesmo Mês Ano Anterior" valor={fmtR(comparacao.receita_12m_atras)} delta={comparacao.var_yoy_pct} />
      </div>

      {evolucao.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ color: CORES.espresso, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
            Evolução 12 meses (Receita vs Despesas)
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 120, padding: '12px', background: CORES.offWhite, borderRadius: 10, border: `1px solid ${CORES.offWhiteDark}` }}>
            {evolucao.map((e: any, i: number) => {
              const altRec = (e.receita / maxAbs) * 90;
              const altDesp = (e.despesas / maxAbs) * 90;
              const dataLabel = new Date(e.mes).toLocaleDateString('pt-BR', { month: 'short' });
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 1, alignItems: 'flex-end', height: 95 }}>
                    <div style={{ width: 8, height: altRec, background: CORES.baixa, borderRadius: '2px 2px 0 0' }} title={`Receita: ${fmtR(e.receita)}`} />
                    <div style={{ width: 8, height: altDesp, background: CORES.alta, borderRadius: '2px 2px 0 0', opacity: 0.85 }} title={`Despesa: ${fmtR(e.despesas)}`} />
                  </div>
                  <div style={{ color: CORES.espressoLight, fontSize: 9, fontWeight: 500 }}>
                    {dataLabel}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8, fontSize: 10, color: CORES.espressoLight }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: CORES.baixa, borderRadius: 2, marginRight: 4 }} />Receita</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: CORES.alta, borderRadius: 2, marginRight: 4 }} />Despesas</span>
          </div>
        </div>
      )}

      <div>
        <div style={{ color: CORES.espresso, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
          Detalhamento por Conta
        </div>
        <div style={{ background: CORES.offWhite, border: `1px solid ${CORES.offWhiteDark}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 100px 80px 80px 80px',
            gap: 12,
            padding: '10px 16px',
            background: CORES.espresso,
            color: CORES.offWhite,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.8,
            textTransform: 'uppercase',
          }}>
            <span>Conta</span>
            <span style={{ textAlign: 'right' }}>Valor Atual</span>
            <span style={{ textAlign: 'right' }}>AV %</span>
            <span style={{ textAlign: 'right' }}>AH MoM</span>
            <span style={{ textAlign: 'right' }}>AH YoY</span>
          </div>
          {ordemGrupos.flatMap(grupo => {
            const itensGrupo = porGrupo[grupo] || [];
            if (itensGrupo.length === 0) return [];
            return itensGrupo.map((c: any, i: number) => (
              <div
                key={`${grupo}-${i}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 100px 80px 80px 80px',
                  gap: 12,
                  padding: '8px 16px',
                  borderTop: `1px solid ${CORES.offWhiteDark}`,
                  fontSize: 11,
                  color: CORES.espresso,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ color: CORES.dourado, fontFamily: 'monospace', fontSize: 10, marginRight: 6 }}>
                    {GRUPO_LABEL[grupo] || grupo}
                  </span>
                  {c.nome}
                </span>
                <span style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtR(c.valor_atual)}
                </span>
                <span style={{ textAlign: 'right', color: CORES.espressoLight }}>
                  {c.av_pct}%
                </span>
                <span style={{ textAlign: 'right', color: corVariacao(c.ah_mom_pct), fontWeight: 600 }}>
                  {c.ah_mom_pct === null ? '—' : fmtPct(c.ah_mom_pct)}
                </span>
                <span style={{ textAlign: 'right', color: corVariacao(c.ah_yoy_pct), fontWeight: 600 }}>
                  {c.ah_yoy_pct === null ? '—' : fmtPct(c.ah_yoy_pct)}
                </span>
              </div>
            ));
          })}
        </div>
      </div>
    </section>
  );
}

function CompCard({ label, valor, delta }: { label: string; valor: string; delta?: number | null }) {
  return (
    <div style={{
      background: CORES.offWhite,
      border: `1px solid ${CORES.offWhiteDark}`,
      borderRadius: 10,
      padding: '12px 14px',
    }}>
      <div style={{ color: CORES.espressoLight, fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ color: CORES.espresso, fontSize: 17, fontWeight: 800, letterSpacing: -0.3 }}>
        {valor}
      </div>
      {delta !== undefined && delta !== null && (
        <div style={{ color: corVariacao(delta), fontSize: 11, fontWeight: 700, marginTop: 4 }}>
          {fmtPct(delta)}
        </div>
      )}
    </div>
  );
}
