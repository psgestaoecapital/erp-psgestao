'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import PlanoCard, { type PlanoRow } from './PlanoCard';
import { COR } from './colors';

type StatusFilter = 'ativos' | 'todos' | 'legados';

const VERTICAIS = [
  'todas',
  'bpo',
  'commerce',
  'compliance',
  'custeio',
  'hub',
  'industrial',
  'oficina',
  'pm',
  'services',
] as const;

const TIERS = [
  'todos',
  'solo',
  'equipe',
  'pro',
  'agencia',
  'enterprise',
  'basico',
  'media',
  'grande',
  'pequena',
  'T1',
  'T2',
  'T3',
  'T4',
] as const;

export default function PlanosFiltrosGrid({
  planos,
}: {
  planos: PlanoRow[];
}) {
  const [search, setSearch] = useState('');
  const [vertical, setVertical] = useState<string>('todas');
  const [tier, setTier] = useState<string>('todos');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ativos');

  const filtered = useMemo(() => {
    return planos.filter((p) => {
      if (statusFilter === 'ativos' && (!p.ativo || p.legacy)) return false;
      if (statusFilter === 'legados' && !p.legacy) return false;
      if (vertical !== 'todas' && p.vertical !== vertical) return false;
      if (tier !== 'todos' && p.tier_internal !== tier) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!p.plano_nome.toLowerCase().includes(q) && !p.plan_id.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [planos, vertical, tier, statusFilter, search]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filtros */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
          background: COR.offWhite,
          border: `1px solid ${COR.border}`,
          borderRadius: 10,
          padding: 14,
        }}
      >
        {/* Search */}
        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 180 }}>
          <Search
            size={14}
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: COR.espressoL,
            }}
          />
          <input
            type="text"
            placeholder="Buscar por nome ou id"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 10px 8px 32px',
              border: `1px solid ${COR.border}`,
              borderRadius: 8,
              fontSize: 13,
              background: COR.offWhite,
              color: COR.espresso,
              outline: 'none',
            }}
          />
        </div>

        <Select label="Vertical" value={vertical} onChange={setVertical} options={[...VERTICAIS]} />
        <Select label="Tier" value={tier} onChange={setTier} options={[...TIERS]} />

        <div style={{ display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: `1px solid ${COR.border}` }}>
          {(['ativos', 'todos', 'legados'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              style={{
                padding: '8px 14px',
                fontSize: 12,
                fontWeight: 600,
                textTransform: 'capitalize',
                background: statusFilter === s ? COR.espresso : 'transparent',
                color: statusFilter === s ? COR.offWhite : COR.espressoM,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {s}
            </button>
          ))}
        </div>

        <span style={{ marginLeft: 'auto', fontSize: 12, color: COR.espressoM }}>
          {filtered.length} de {planos.length}
        </span>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div
          style={{
            background: COR.offWhite,
            border: `1px dashed ${COR.border}`,
            borderRadius: 10,
            padding: 40,
            textAlign: 'center',
            color: COR.espressoM,
            fontSize: 13,
          }}
        >
          Nenhum plano corresponde aos filtros.
        </div>
      ) : (
        <div
          className="grid gap-4"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
          }}
        >
          {filtered.map((p) => (
            <PlanoCard key={p.plan_id} plano={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, color: COR.espressoM, fontWeight: 600 }}>{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '6px 28px 6px 10px',
          border: `1px solid ${COR.border}`,
          borderRadius: 8,
          fontSize: 12,
          background: COR.offWhite,
          color: COR.espresso,
          outline: 'none',
          cursor: 'pointer',
          width: 'auto',
          minWidth: 110,
        }}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}
