'use client';

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

const fmtR = (v: number) => `R$ ${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const classeCor = (c: string) => c === 'A' ? CORES.alta : c === 'B' ? CORES.media : CORES.baixa;

export default function RaioXABCProfundo({ data }: { data: any }) {
  const clientes = data?.abc?.clientes || [];
  const fornecedores = data?.abc?.fornecedores || [];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 20 }}>
      <ABCSection titulo="Top 10 Clientes" itens={clientes} cor={CORES.baixa} legenda="Por receita gerada" />
      <ABCSection titulo="Top 10 Fornecedores" itens={fornecedores} cor={CORES.alta} legenda="Por valor pago" />
    </div>
  );
}

function ABCSection({ titulo, itens, cor, legenda }: any) {
  if (!itens || itens.length === 0) {
    return (
      <div>
        <h3 style={{ color: CORES.espresso, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
          {titulo}
        </h3>
        <div style={{ color: CORES.espressoLight, fontSize: 12, fontStyle: 'italic', padding: 16 }}>
          Sem dados neste período.
        </div>
      </div>
    );
  }

  const totalParticipacao = itens.reduce((acc: number, i: any) => acc + (i.participacao_pct || 0), 0);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ color: CORES.espresso, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
          {titulo}
        </h3>
        <div style={{ color: CORES.espressoLight, fontSize: 11 }}>
          {legenda} · Top 10 representam {totalParticipacao.toFixed(1)}% do total
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {itens.map((item: any, i: number) => {
          const pct = item.participacao_pct || 0;
          const corClasse = classeCor(item.classe);
          return (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '24px 1fr 90px 70px',
                gap: 10,
                alignItems: 'center',
                padding: '10px 14px',
                background: CORES.offWhite,
                borderRadius: 8,
                border: `1px solid ${CORES.offWhiteDark}`,
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${Math.min(pct * 4, 100)}%`,
                background: `${cor}10`,
                zIndex: 0,
              }} />
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                color: CORES.offWhite,
                background: corClasse,
                padding: '3px 7px',
                borderRadius: 4,
                textAlign: 'center',
                zIndex: 1,
              }}>
                {item.classe}
              </span>
              <span style={{ color: CORES.espresso, fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', zIndex: 1 }}>
                {item.nome}
              </span>
              <span style={{ color: CORES.espresso, fontSize: 12, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums', zIndex: 1 }}>
                {fmtR(item.valor)}
              </span>
              <span style={{ color: cor, fontSize: 12, fontWeight: 700, textAlign: 'right', zIndex: 1 }}>
                {pct.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
