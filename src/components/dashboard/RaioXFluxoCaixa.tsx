'use client';

const CORES = {
  espresso: '#3D2314',
  espressoLight: '#5A3A2A',
  offWhite: '#FAF7F2',
  offWhiteDark: '#F0EAE0',
  dourado: '#C8941A',
  baixa: '#5C8D3F',
  alta: '#C44536',
};

const fmtR = (v: number) => `R$ ${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtData = (s: string) => {
  const [, m, d] = s.split('-');
  return `${d}/${m}`;
};

export default function RaioXFluxoCaixa({ data }: { data: any }) {
  const semanal = data?.fluxo?.semanal_12w || [];
  const diario = data?.fluxo?.diario_30d || [];

  const maxAbsSemanal = Math.max(...semanal.map((s: any) => Math.max(s.entradas || 0, s.saidas || 0)), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div>
        <h3 style={{ color: CORES.espresso, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
          Fluxo Semanal — Últimas 12 semanas
        </h3>
        <p style={{ color: CORES.espressoLight, fontSize: 11, marginBottom: 12 }}>
          Entradas (verde) e Saídas (vermelho) por semana
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {semanal.length === 0 && (
            <div style={{ color: CORES.espressoLight, fontSize: 12, fontStyle: 'italic', padding: 16 }}>
              Sem dados de fluxo.
            </div>
          )}
          {semanal.map((s: any, i: number) => {
            const pctEnt = (s.entradas / maxAbsSemanal) * 100;
            const pctSai = (s.saidas / maxAbsSemanal) * 100;
            return (
              <div key={i} style={{
                display: 'grid',
                gridTemplateColumns: '70px 1fr 110px',
                gap: 12,
                alignItems: 'center',
                padding: '6px 12px',
                background: CORES.offWhite,
                borderRadius: 6,
                border: `1px solid ${CORES.offWhiteDark}`,
                fontSize: 11,
              }}>
                <span style={{ color: CORES.espressoLight, fontWeight: 500 }}>{fmtData(s.semana)}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ background: `${CORES.baixa}20`, borderRadius: 3, height: 8, position: 'relative' }}>
                    <div style={{ background: CORES.baixa, height: '100%', width: `${pctEnt}%`, borderRadius: 3 }} />
                  </div>
                  <div style={{ background: `${CORES.alta}20`, borderRadius: 3, height: 8, position: 'relative' }}>
                    <div style={{ background: CORES.alta, height: '100%', width: `${pctSai}%`, borderRadius: 3 }} />
                  </div>
                </div>
                <span style={{
                  color: s.resultado >= 0 ? CORES.baixa : CORES.alta,
                  fontWeight: 700,
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {fmtR(s.resultado)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3 style={{ color: CORES.espresso, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
          Movimento Diário — Últimos 30 dias
        </h3>
        <p style={{ color: CORES.espressoLight, fontSize: 11, marginBottom: 12 }}>
          Apenas dias com movimento real ({diario.length} dias)
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {diario.length === 0 && (
            <div style={{ color: CORES.espressoLight, fontSize: 12, fontStyle: 'italic', padding: 16 }}>
              Nenhum movimento registrado nos últimos 30 dias.
            </div>
          )}
          {diario.map((d: any, i: number) => (
            <div key={i} style={{
              display: 'grid',
              gridTemplateColumns: '60px 110px 110px 110px',
              gap: 12,
              padding: '6px 12px',
              background: CORES.offWhite,
              borderRadius: 6,
              border: `1px solid ${CORES.offWhiteDark}`,
              fontSize: 11,
              fontVariantNumeric: 'tabular-nums',
            }}>
              <span style={{ color: CORES.espressoLight, fontWeight: 500 }}>{fmtData(d.data)}</span>
              <span style={{ color: d.entradas > 0 ? CORES.baixa : CORES.espressoLight, textAlign: 'right' }}>
                {d.entradas > 0 ? `+${fmtR(d.entradas)}` : '—'}
              </span>
              <span style={{ color: d.saidas > 0 ? CORES.alta : CORES.espressoLight, textAlign: 'right' }}>
                {d.saidas > 0 ? `−${fmtR(d.saidas)}` : '—'}
              </span>
              <span style={{ color: d.movimento >= 0 ? CORES.baixa : CORES.alta, fontWeight: 700, textAlign: 'right' }}>
                {fmtR(d.movimento)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
