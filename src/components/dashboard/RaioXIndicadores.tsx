'use client';

const CORES = {
  espresso: '#3D2314',
  espressoLight: '#5A3A2A',
  offWhite: '#FAF7F2',
  offWhiteDark: '#F0EAE0',
  dourado: '#C8941A',
  baixa: '#5C8D3F',
  media: '#D89627',
  alta: '#C44536',
};

const fmtR = (v: number) => `R$ ${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export default function RaioXIndicadores({ data }: { data: any }) {
  const ind = data?.indicadores_operacionais || {};

  const cards = [
    {
      label: 'Ponto de Equilíbrio',
      valor: fmtR(ind.ponto_equilibrio_rs),
      contexto: ind.distancia_pe_pct !== null && ind.distancia_pe_pct !== undefined
        ? `${ind.distancia_pe_pct >= 0 ? '+' : ''}${ind.distancia_pe_pct}% acima do PE`
        : 'PE não calculável (margem negativa)',
      contextoCor: ind.distancia_pe_pct >= 0 ? CORES.baixa : CORES.alta,
      explicacao: 'Receita mínima necessária para cobrir custos fixos e operar no zero a zero.',
    },
    {
      label: 'Alavancagem Operacional',
      valor: ind.alavancagem_operacional ? `${ind.alavancagem_operacional}x` : '—',
      contexto: 'Sensibilidade do EBITDA à variação da receita',
      contextoCor: CORES.espressoLight,
      explicacao: 'Quanto maior, mais o resultado oscila com mudanças no faturamento.',
    },
    {
      label: 'DSO — Prazo de Recebimento',
      valor: ind.dso_dias !== null && ind.dso_dias !== undefined ? `${ind.dso_dias} dias` : '—',
      contexto: ind.dso_dias > 60 ? 'Prazo elevado' : ind.dso_dias > 30 ? 'Prazo moderado' : 'Prazo saudável',
      contextoCor: ind.dso_dias > 60 ? CORES.alta : ind.dso_dias > 30 ? CORES.media : CORES.baixa,
      explicacao: 'Tempo médio que clientes levam para pagar suas vendas a prazo.',
    },
    {
      label: 'DPO — Prazo de Pagamento',
      valor: ind.dpo_dias !== null && ind.dpo_dias !== undefined ? `${ind.dpo_dias} dias` : '—',
      contexto: ind.dpo_dias > 90 ? 'Prazo longo (atenção)' : 'Prazo controlado',
      contextoCor: ind.dpo_dias > 90 ? CORES.media : CORES.baixa,
      explicacao: 'Tempo médio que a empresa leva para quitar fornecedores.',
    },
    {
      label: 'Ciclo de Caixa',
      valor: ind.ciclo_caixa_dias !== null && ind.ciclo_caixa_dias !== undefined ? `${ind.ciclo_caixa_dias} dias` : '—',
      contexto: ind.ciclo_caixa_dias < 0 ? 'Negativo (financia operação via fornecedor)' : 'Positivo',
      contextoCor: ind.ciclo_caixa_dias < 0 ? CORES.media : CORES.baixa,
      explicacao: 'DSO − DPO. Negativo significa que fornecedor financia a operação.',
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ color: CORES.espresso, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
          Indicadores Operacionais
        </h3>
        <p style={{ color: CORES.espressoLight, fontSize: 11 }}>
          Métricas-chave de operação, eficiência e capital de giro
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        {cards.map((c, i) => (
          <div key={i} style={{
            background: CORES.offWhite,
            borderRadius: 12,
            padding: '16px 18px',
            border: `1px solid ${CORES.offWhiteDark}`,
          }}>
            <div style={{ color: CORES.espressoLight, fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>
              {c.label}
            </div>
            <div style={{ color: CORES.espresso, fontSize: 22, fontWeight: 800, letterSpacing: -0.5, marginBottom: 6 }}>
              {c.valor}
            </div>
            <div style={{ color: c.contextoCor, fontSize: 11, fontWeight: 600, marginBottom: 8 }}>
              {c.contexto}
            </div>
            <div style={{ color: CORES.espressoLight, fontSize: 10, lineHeight: 1.4, fontStyle: 'italic' }}>
              {c.explicacao}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
