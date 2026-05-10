'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import AdminGuard from '@/components/admin/AdminGuard';
import StatusBadge from '@/components/admin/StatusBadge';
import ModuloAccordion, {
  type ModuloRow,
  type FeatureRow,
} from '@/components/admin/ModuloAccordion';
import { COR, corSemaforo, formatBRL } from '@/components/admin/colors';
import PlanoDetalheLoading from './loading';
import type { PlanoRow } from '@/components/admin/PlanoCard';

type PlanoDetalheResponse = {
  plano: PlanoRow;
  modulos: ModuloRow[] | null;
  features: FeatureRow[] | null;
  gerado_em: string;
  error?: string;
};

export default function PlanoDetalhePage() {
  return (
    <AdminGuard>
      <PlanoDetalheContent />
    </AdminGuard>
  );
}

function PlanoDetalheContent() {
  const params = useParams<{ id: string }>();
  const planId = params?.id;

  const [data, setData] = useState<PlanoDetalheResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!planId) return;
    let alive = true;
    (async () => {
      const { data: payload, error: err } = await supabase.rpc('fn_admin_get_plano_detalhe', {
        p_plan_id: planId,
      });
      if (!alive) return;
      if (err) {
        setError(err.message);
        return;
      }
      if (payload?.error) {
        setError(payload.error);
        return;
      }
      setData(payload as PlanoDetalheResponse);
    })();
    return () => {
      alive = false;
    };
  }, [planId]);

  // Group modulos by layer for visual sections
  const modulosPorLayer = useMemo(() => {
    if (!data?.modulos) return new Map<string, ModuloRow[]>();
    const groups = new Map<string, ModuloRow[]>();
    for (const m of data.modulos) {
      const key = m.layer ?? 'sem_layer';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    return groups;
  }, [data]);

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Link href="/admin/planos" style={{ textDecoration: 'none', color: COR.espressoM }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <ArrowLeft size={14} /> Voltar para planos
          </span>
        </Link>
        <div
          style={{
            background: COR.redBg,
            border: `1px solid ${COR.red}`,
            borderRadius: 10,
            padding: 18,
            color: COR.red,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      </div>
    );
  }

  if (!data) return <PlanoDetalheLoading />;

  const { plano, modulos, features } = data;
  const featuresArr = features ?? [];
  const modulosArr = modulos ?? [];
  const semaforo = corSemaforo(plano.percentual_pronto_para_vender);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Voltar */}
      <Link href="/admin/planos" style={{ textDecoration: 'none', color: COR.espressoM }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <ArrowLeft size={14} /> Voltar para planos
        </span>
      </Link>

      {/* Header */}
      <header style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: COR.espresso,
              margin: 0,
              flex: '1 1 auto',
              minWidth: 200,
            }}
          >
            {plano.plano_nome}
          </h1>
          <button
            type="button"
            disabled
            title="Em breve"
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              background: COR.cream,
              color: COR.espressoL,
              border: `1px solid ${COR.border}`,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'not-allowed',
            }}
          >
            Editar plano
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {plano.vertical && (
            <StatusBadge tone="gold" size="sm">
              {plano.vertical}
            </StatusBadge>
          )}
          {plano.tier_internal && (
            <StatusBadge tone="default" size="sm">
              tier: {plano.tier_internal}
            </StatusBadge>
          )}
          {plano.plan_group && (
            <StatusBadge tone="muted" size="sm">
              {plano.plan_group}
            </StatusBadge>
          )}
          {plano.legacy && (
            <StatusBadge tone="muted" size="sm">
              legado
            </StatusBadge>
          )}
          {!plano.ativo && (
            <StatusBadge tone="red" size="sm">
              inativo
            </StatusBadge>
          )}
        </div>
      </header>

      {/* Stats grid */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
        }}
      >
        <StatCard label="Total modulos" value={String(plano.total_modulos)} />
        <StatCard
          label="Total features"
          value={String(plano.total_features)}
          subtitle={`${plano.features_prontas} prontas`}
        />
        <StatCard
          label="Pronto para vender"
          value={`${plano.percentual_pronto_para_vender}%`}
          accent={semaforo.text}
          progress={plano.percentual_pronto_para_vender}
          progressColor={semaforo.text}
        />
        <StatCard
          label="Clientes ativos"
          value={String(plano.clientes_ativos)}
          subtitle={`MRR: ${formatBRL(plano.mrr_real)}`}
        />
      </section>

      {/* Modulos por layer */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: COR.espresso, margin: 0 }}>
          Modulos do plano ({modulosArr.length})
        </h2>

        {modulosArr.length === 0 ? (
          <div
            style={{
              background: COR.redBg,
              border: `1px solid ${COR.red}`,
              borderRadius: 10,
              padding: 18,
              color: COR.red,
              fontSize: 13,
            }}
          >
            Este plano nao tem modulos vinculados — risco de venda vazia.
          </div>
        ) : (
          [...modulosPorLayer.entries()].map(([layer, list]) => (
            <div
              key={layer}
              style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              <h3
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  color: COR.espressoM,
                  margin: '4px 0',
                }}
              >
                {layer} · {list.length} modulos
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {list.map((mod) => (
                  <ModuloAccordion
                    key={mod.module_id}
                    modulo={mod}
                    features={featuresArr.filter((f) => f.module_id === mod.module_id)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  subtitle,
  accent,
  progress,
  progressColor,
}: {
  label: string;
  value: string;
  subtitle?: string;
  accent?: string;
  progress?: number;
  progressColor?: string;
}) {
  return (
    <div
      style={{
        background: COR.offWhite,
        border: `1px solid ${COR.border}`,
        borderRadius: 10,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <span
        style={{
          fontSize: 10,
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
          fontSize: 24,
          fontWeight: 700,
          color: accent ?? COR.espresso,
          lineHeight: 1.1,
        }}
      >
        {value}
      </span>
      {subtitle && (
        <span style={{ fontSize: 11, color: COR.espressoM }}>{subtitle}</span>
      )}
      {progress != null && (
        <div
          style={{
            height: 5,
            background: COR.cream,
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress}%`,
              background: progressColor ?? COR.gold,
            }}
          />
        </div>
      )}
    </div>
  );
}
