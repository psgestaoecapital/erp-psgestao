import Link from 'next/link';
import StatusBadge from './StatusBadge';
import { COR, corSemaforo, formatBRL, formatRangePreco } from './colors';

export type PlanoRow = {
  plan_id: string;
  plano_nome: string;
  tier_internal: string | null;
  vertical: string | null;
  plan_group: string | null;
  preco_min: number | null;
  preco_max: number | null;
  total_modulos: number;
  total_features: number;
  features_prontas: number;
  percentual_pronto_para_vender: number;
  clientes_ativos: number;
  mrr_real: number;
  ativo: boolean;
  legacy: boolean;
};

export default function PlanoCard({ plano }: { plano: PlanoRow }) {
  const semaforo = corSemaforo(plano.percentual_pronto_para_vender);
  const preco = formatRangePreco(plano.preco_min, plano.preco_max);

  return (
    <Link
      href={`/admin/planos/${plano.plan_id}`}
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <article
        style={{
          background: COR.offWhite,
          border: `2px solid ${semaforo.border}`,
          borderRadius: 12,
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          transition: 'transform 0.15s, box-shadow 0.15s',
          cursor: 'pointer',
          height: '100%',
          position: 'relative',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = '0 6px 16px rgba(61,35,20,0.08)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        {/* Header */}
        <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h3
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: COR.espresso,
              lineHeight: 1.3,
              margin: 0,
            }}
          >
            {plano.plano_nome}
          </h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {plano.vertical && (
              <StatusBadge tone="gold" size="xs">
                {plano.vertical}
              </StatusBadge>
            )}
            {plano.tier_internal && (
              <StatusBadge tone="default" size="xs">
                {plano.tier_internal}
              </StatusBadge>
            )}
            {plano.legacy && (
              <StatusBadge tone="muted" size="xs">
                legado
              </StatusBadge>
            )}
            {!plano.ativo && (
              <StatusBadge tone="red" size="xs">
                inativo
              </StatusBadge>
            )}
          </div>
        </header>

        {/* Preco */}
        <div
          style={{
            fontSize: 13,
            color: COR.espressoM,
            fontWeight: 500,
          }}
        >
          {preco}
        </div>

        {/* Stats */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 10,
            paddingTop: 10,
            borderTop: `1px solid ${COR.borderL}`,
          }}
        >
          <Stat label="Modulos" value={String(plano.total_modulos)} />
          <Stat
            label="Features"
            value={String(plano.total_features)}
            subtitle={`${plano.features_prontas} prontas`}
          />
          <Stat
            label="Pronto"
            value={`${plano.percentual_pronto_para_vender}%`}
            valueColor={semaforo.text}
          />
        </div>

        {/* Barra de progresso */}
        <div
          style={{
            height: 6,
            background: COR.cream,
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${plano.percentual_pronto_para_vender}%`,
              background: semaforo.text,
              transition: 'width 0.3s',
            }}
          />
        </div>

        {/* Footer */}
        <footer
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 10,
            borderTop: `1px solid ${COR.borderL}`,
            fontSize: 11,
            color: COR.espressoM,
          }}
        >
          <span>
            <strong style={{ color: COR.espresso }}>{plano.clientes_ativos}</strong> clientes
          </span>
          <span>
            MRR: <strong style={{ color: COR.gold }}>{formatBRL(plano.mrr_real)}</strong>
          </span>
        </footer>
      </article>
    </Link>
  );
}

function Stat({
  label,
  value,
  subtitle,
  valueColor,
}: {
  label: string;
  value: string;
  subtitle?: string;
  valueColor?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span
        style={{
          fontSize: 9,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: COR.espressoL,
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: valueColor ?? COR.espresso,
          lineHeight: 1.1,
        }}
      >
        {value}
      </span>
      {subtitle && (
        <span style={{ fontSize: 10, color: COR.espressoM }}>{subtitle}</span>
      )}
    </div>
  );
}
