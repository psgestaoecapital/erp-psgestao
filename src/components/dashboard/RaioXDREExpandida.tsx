'use client';

const CORES = {
  espresso: '#3D2314',
  espressoLight: '#5A3A2A',
  offWhite: '#FAF7F2',
  offWhiteDark: '#F0EAE0',
  dourado: '#C8941A',
  alta: '#C44536',
  baixa: '#5C8D3F',
};

const fmtR = (v: number) => {
  if (v === null || v === undefined) return '—';
  const n = Number(v) || 0;
  const sinal = n < 0 ? '(' : '';
  const fechaSinal = n < 0 ? ')' : '';
  return `${sinal}R$ ${Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}${fechaSinal}`;
};

const GRUPO_LABEL: Record<string, string> = {
  ROB: 'Receita Operacional Bruta',
  IMPOSTOS_VENDA: 'Impostos sobre Vendas',
  CMV: 'Custo da Mercadoria Vendida',
  DESP_VARIAVEL: 'Despesas Variáveis',
  DESP_FIXA: 'Despesas Fixas',
  RESULT_FIN: 'Resultado Financeiro',
  NAO_OPER: 'Não Operacional',
};

export default function RaioXDREExpandida({ data }: { data: any }) {
  if (!data?.dre_executiva) return null;
  const dre = data.dre_executiva;
  const detalhe = data.dre_expandida_n3 || [];

  const linhas = [
    { label: 'Receita Operacional Bruta', valor: dre.receita_bruta, classe: 'titulo' },
    { label: '(−) Deduções e Impostos', valor: dre.deducoes, classe: 'subtracao' },
    { label: '= Receita Líquida', valor: dre.receita_liquida, classe: 'subtotal' },
    { label: '(−) CMV', valor: dre.cmv, classe: 'subtracao' },
    { label: '= Lucro Bruto', valor: dre.lucro_bruto, classe: 'subtotal', pct: dre.margem_bruta_pct },
    { label: '(−) Despesas Variáveis', valor: dre.desp_variavel, classe: 'subtracao' },
    { label: '= Margem de Contribuição', valor: dre.margem_contribuicao, classe: 'subtotal', pct: dre.margem_contribuicao_pct },
    { label: '(−) Despesas Fixas', valor: dre.desp_fixa, classe: 'subtracao' },
    { label: '= EBITDA', valor: dre.ebitda, classe: 'total', pct: dre.ebitda_pct },
  ];

  // Agrupa N3 por grupo
  const porGrupo: Record<string, any[]> = {};
  for (const item of detalhe) {
    const g = item.grupo || 'OUTROS';
    if (!porGrupo[g]) porGrupo[g] = [];
    porGrupo[g].push(item);
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ color: CORES.espresso, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
          Demonstração Executiva
        </h3>
        <div style={{ background: CORES.offWhite, borderRadius: 10, padding: '4px 0', border: `1px solid ${CORES.offWhiteDark}` }}>
          {linhas.map((l, i) => (
            <DRELinha key={i} {...l} />
          ))}
        </div>
      </div>

      <div>
        <h3 style={{ color: CORES.espresso, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
          Detalhamento por Conta (N3)
        </h3>
        {Object.keys(porGrupo).length === 0 && (
          <div style={{ color: CORES.espressoLight, fontSize: 12, fontStyle: 'italic' }}>
            Sem detalhamento neste período.
          </div>
        )}
        {Object.entries(porGrupo).map(([grupo, contas]) => (
          <div key={grupo} style={{ marginBottom: 16 }}>
            <div style={{ color: CORES.dourado, fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>
              {GRUPO_LABEL[grupo] || grupo}
            </div>
            <div style={{ background: CORES.offWhite, borderRadius: 8, border: `1px solid ${CORES.offWhiteDark}`, overflow: 'hidden' }}>
              {contas.map((c: any, idx: number) => (
                <div
                  key={c.codigo}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '60px 1fr 80px 110px 60px',
                    gap: 12,
                    padding: '8px 16px',
                    fontSize: 12,
                    borderTop: idx > 0 ? `1px solid ${CORES.offWhiteDark}` : 'none',
                    color: CORES.espresso,
                  }}
                >
                  <span style={{ color: CORES.espressoLight, fontFamily: 'monospace' }}>{c.codigo}</span>
                  <span>{c.nome}</span>
                  <span style={{ color: CORES.espressoLight, textAlign: 'right' }}>{c.qtd} lanç.</span>
                  <span style={{ fontWeight: 600, textAlign: 'right' }}>{fmtR(c.valor)}</span>
                  <span style={{ color: CORES.espressoLight, textAlign: 'right' }}>{c.pct_receita}%</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DRELinha({ label, valor, classe, pct }: any) {
  const isTotal = classe === 'total';
  const isSubtotal = classe === 'subtotal';
  const isSubtracao = classe === 'subtracao';
  const isTitulo = classe === 'titulo';

  const corLabel = isTotal ? CORES.alta : (isSubtotal ? CORES.baixa : (isSubtracao ? CORES.espressoLight : CORES.espresso));
  const fontWeight = isTotal || isSubtotal || isTitulo ? 700 : 500;
  const fontSize = isTotal ? 15 : (isSubtotal || isTitulo ? 13 : 12);
  const valorCor = valor < 0 ? CORES.alta : (isTotal || isSubtotal ? CORES.baixa : CORES.espresso);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr auto auto',
      gap: 16,
      padding: '10px 18px',
      borderBottom: `1px solid ${CORES.offWhiteDark}`,
      alignItems: 'center',
    }}>
      <span style={{ color: corLabel, fontSize, fontWeight, paddingLeft: isSubtracao ? 16 : 0 }}>
        {label}
      </span>
      <span style={{ color: pct !== undefined ? CORES.dourado : 'transparent', fontSize: 11, fontWeight: 600, minWidth: 50, textAlign: 'right' }}>
        {pct !== undefined ? `${pct}%` : '—'}
      </span>
      <span style={{ color: valorCor, fontSize, fontWeight, fontVariantNumeric: 'tabular-nums', minWidth: 130, textAlign: 'right' }}>
        {fmtR(valor)}
      </span>
    </div>
  );
}
