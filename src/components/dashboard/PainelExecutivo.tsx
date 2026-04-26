'use client';

interface KpiPainel {
  faturamento: { valor: number; variacao_pct: number | null; tendencia: string };
  despesas: { valor: number; variacao_pct: number | null };
  resultado: { valor: number; pct: number; status: string };
  caixa: { movimento_mes: number; movimento_anterior: number; dias_ate_zerar: number | null };
}

interface Termometro {
  score_consolidado: number;
  classificacao: string;
  por_empresa: Array<{ empresa: string; score: number; cor: string; classificacao: string }>;
}

interface FocoDoDia {
  empresa: string;
  titulo: string;
  mensagem: string;
  severidade: string;
}

interface PainelData {
  periodo?: { ano: number; mes: number };
  regime?: 'competencia' | 'caixa';
  qtd_empresas?: number;
  kpis?: KpiPainel;
  termometro?: Termometro;
  foco_do_dia?: FocoDoDia | null;
}

interface Props {
  data: PainelData | null | undefined;
  regime: 'competencia' | 'caixa';
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
};

const fmtR = (v: number) => `R$ ${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtPct = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '—';
  const sinal = v > 0 ? '+' : '';
  return `${sinal}${v.toFixed(1)}%`;
};

const classCor = (s: string) => {
  const map: Record<string, string> = {
    EXCELENTE: CORES.baixa,
    SAUDAVEL: CORES.baixa,
    ATENCAO: CORES.media,
    CRITICO: CORES.alta,
    GRAVE: CORES.alta,
  };
  return map[s] || CORES.espressoLight;
};

const resultadoCor = (status: string) => {
  if (status === 'excelente' || status === 'saudavel') return CORES.baixa;
  if (status === 'apertado') return CORES.media;
  return CORES.alta;
};

export default function PainelExecutivo({ data, regime }: Props) {
  if (!data || !data.kpis) return null;

  const { kpis, termometro, foco_do_dia } = data;
  const regimeLabel = regime === 'caixa' ? 'CAIXA' : 'COMPETÊNCIA';

  return (
    <section style={{ marginBottom: 24 }}>
      {/* HEADER */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 14
      }}>
        <div style={{ color: CORES.espresso, fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase' }}>
          O Pulso · Visão {regimeLabel}
        </div>
      </div>

      {/* GRID DE 4 KPIs */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 12,
        marginBottom: 14,
      }}>
        <KpiCard
          label="Faturamento"
          valor={fmtR(kpis.faturamento.valor)}
          variacao={fmtPct(kpis.faturamento.variacao_pct)}
          variacaoCor={kpis.faturamento.tendencia === 'subindo' ? CORES.baixa : kpis.faturamento.tendencia === 'caindo' ? CORES.alta : CORES.espressoLight}
          tendencia={kpis.faturamento.tendencia}
        />
        <KpiCard
          label="Despesas"
          valor={fmtR(kpis.despesas.valor)}
          variacao={fmtPct(kpis.despesas.variacao_pct)}
          variacaoCor={(kpis.despesas.variacao_pct ?? 0) > 0 ? CORES.alta : CORES.baixa}
        />
        <KpiCard
          label="Resultado"
          valor={fmtR(kpis.resultado.valor)}
          valorCor={resultadoCor(kpis.resultado.status)}
          variacao={`${kpis.resultado.pct > 0 ? '+' : ''}${kpis.resultado.pct.toFixed(1)}%`}
          variacaoCor={resultadoCor(kpis.resultado.status)}
          destaque={kpis.resultado.status}
        />
        <KpiCard
          label="Caixa do Mês"
          valor={fmtR(kpis.caixa.movimento_mes)}
          valorCor={kpis.caixa.movimento_mes >= 0 ? CORES.baixa : CORES.alta}
          variacao={kpis.caixa.dias_ate_zerar ? `~${kpis.caixa.dias_ate_zerar} dias até zerar` : 'Sustentável'}
          variacaoCor={kpis.caixa.dias_ate_zerar ? CORES.alta : CORES.baixa}
        />
      </div>

      {/* TERMÔMETRO + FOCO DO DIA */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: termometro && foco_do_dia ? '1fr 1.5fr' : '1fr',
        gap: 12,
      }}>
        {termometro && <TermometroCard termometro={termometro} />}
        {foco_do_dia && <FocoDoDiaCard foco={foco_do_dia} />}
      </div>
    </section>
  );
}

function KpiCard({ label, valor, valorCor, variacao, variacaoCor, tendencia, destaque }: any) {
  return (
    <div style={{
      background: CORES.offWhite,
      borderRadius: 12,
      padding: '16px 18px',
      border: `1px solid ${CORES.offWhiteDark}`,
    }}>
      <div style={{ color: CORES.espressoLight, fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ color: valorCor || CORES.espresso, fontSize: 22, fontWeight: 800, marginBottom: 6, letterSpacing: -0.5 }}>
        {valor}
      </div>
      <div style={{ color: variacaoCor || CORES.espressoLight, fontSize: 12, fontWeight: 600 }}>
        {variacao}
        {tendencia === 'subindo' && ' ↗'}
        {tendencia === 'caindo' && ' ↘'}
      </div>
    </div>
  );
}

function TermometroCard({ termometro }: { termometro: Termometro }) {
  const score = termometro.score_consolidado;
  const cor = classCor(termometro.classificacao);
  const stroke = 12;
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div style={{
      background: CORES.offWhite,
      borderRadius: 12,
      padding: '16px 18px',
      border: `1px solid ${CORES.offWhiteDark}`,
      display: 'flex',
      alignItems: 'center',
      gap: 16,
    }}>
      {/* Círculo SVG do termômetro */}
      <div style={{ position: 'relative', width: 120, height: 120, flexShrink: 0 }}>
        <svg width="120" height="120" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="60" cy="60" r={radius} fill="none" stroke={CORES.offWhiteDark} strokeWidth={stroke} />
          <circle
            cx="60" cy="60" r={radius} fill="none"
            stroke={cor} strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.6s ease' }}
          />
        </svg>
        <div style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ color: cor, fontSize: 28, fontWeight: 800, letterSpacing: -1 }}>
            {score}
          </div>
          <div style={{ color: CORES.espressoLight, fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
            de 100
          </div>
        </div>
      </div>

      {/* Texto explicativo */}
      <div style={{ flex: 1 }}>
        <div style={{ color: CORES.espressoLight, fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 }}>
          Termômetro de Saúde
        </div>
        <div style={{ color: cor, fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
          {termometro.classificacao}
        </div>
        <div style={{ color: CORES.espressoLight, fontSize: 12, lineHeight: 1.4 }}>
          {termometro.por_empresa && termometro.por_empresa.length > 1
            ? `Consolidado de ${termometro.por_empresa.length} empresas`
            : termometro.por_empresa?.[0]?.empresa || ''}
        </div>
      </div>
    </div>
  );
}

function FocoDoDiaCard({ foco }: { foco: FocoDoDia }) {
  const cor = foco.severidade === 'alta' ? CORES.alta : foco.severidade === 'media' ? CORES.media : CORES.baixa;
  return (
    <div style={{
      background: CORES.offWhite,
      borderRadius: 12,
      padding: '16px 18px',
      border: `1px solid ${CORES.offWhiteDark}`,
      borderLeft: `4px solid ${cor}`,
    }}>
      <div style={{ color: CORES.espressoLight, fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>
        🎯 Foco do Dia
        {foco.empresa && (
          <span style={{ marginLeft: 8, color: CORES.espresso }}>· {foco.empresa}</span>
        )}
      </div>
      <div style={{ color: CORES.espresso, fontSize: 15, fontWeight: 700, marginBottom: 6, lineHeight: 1.3 }}>
        {foco.titulo}
      </div>
      <div style={{ color: CORES.espressoLight, fontSize: 13, lineHeight: 1.5 }}>
        {foco.mensagem}
      </div>
    </div>
  );
}
