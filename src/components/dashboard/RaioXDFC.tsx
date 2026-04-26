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
  const n = Number(v) || 0;
  const sinal = n < 0 ? '(' : '';
  const fechaSinal = n < 0 ? ')' : '';
  return `${sinal}R$ ${Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}${fechaSinal}`;
};

export default function RaioXDFC({ apiFetch, companyIds, ano, mes, grupoId, ativo }: Props) {
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

    apiFetch(`/api/dashboard/dfc?${params.toString()}`)
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
        Calculando Demonstração de Fluxo de Caixa...
      </div>
    );
  }

  if (erro) {
    return (
      <div style={{ color: CORES.alta, padding: 20, fontSize: 13 }}>
        Erro ao carregar DFC: {erro}
      </div>
    );
  }

  if (!data) return null;

  const op = data.atividades_operacionais || {};
  const inv = data.atividades_investimento || {};
  const fin = data.atividades_financiamento || {};
  const analise = data.analise_qualitativa || {};
  const ajustes = op.ajustes || {};
  const varCG = op.variacoes_capital_giro || {};

  const corAnalise = analise.descricao?.startsWith('CRÍTICO') ? CORES.alta
    : analise.descricao?.startsWith('ALERTA') ? CORES.media
    : analise.descricao?.includes('excelente') ? CORES.baixa
    : CORES.azul;

  const corBgAnalise = analise.descricao?.startsWith('CRÍTICO') ? CORES.vermelhoSoft
    : analise.descricao?.startsWith('ALERTA') ? CORES.amareloSoft
    : analise.descricao?.includes('excelente') ? CORES.verdeSoft
    : CORES.azulSoft;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* HEADER */}
      <div style={{
        background: `linear-gradient(135deg, ${CORES.espresso} 0%, ${CORES.espressoLight} 100%)`,
        color: CORES.offWhite,
        padding: '20px 24px',
        borderRadius: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}>
        <div style={{ fontSize: 28 }}>💧</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 0.5, marginBottom: 4 }}>
            DFC — Demonstração de Fluxo de Caixa
          </div>
          <div style={{ fontSize: 12, opacity: 0.9, lineHeight: 1.5 }}>
            Método Indireto · Reconcilia Lucro Líquido com Caixa Operacional via 3 atividades
            (Operacional, Investimento, Financiamento). Padrão CFC e CPC 03.
          </div>
        </div>
      </div>

      {/* ANÁLISE QUALITATIVA */}
      <div style={{
        background: corBgAnalise,
        borderLeft: `4px solid ${corAnalise}`,
        borderRadius: 10,
        padding: '14px 22px',
      }}>
        <div style={{ color: corAnalise, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>
          Análise Qualitativa
        </div>
        <div style={{ color: CORES.espresso, fontSize: 14, fontWeight: 600, lineHeight: 1.5 }}>
          {analise.descricao}
        </div>
        {analise.lucro_vira_caixa_pct !== null && (
          <div style={{ color: CORES.espressoLight, fontSize: 11, marginTop: 6 }}>
            Conversão Lucro → Caixa: {analise.lucro_vira_caixa_pct}%
          </div>
        )}
      </div>

      {/* DEMONSTRATIVO COMPLETO */}
      <div style={{ background: CORES.offWhite, borderRadius: 12, border: `1px solid ${CORES.offWhiteDark}`, overflow: 'hidden' }}>
        {/* Atividades Operacionais */}
        <div style={{ padding: '14px 18px', background: CORES.espresso, color: CORES.offWhite }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
            ▾ Atividades Operacionais
          </div>
        </div>
        <DFCLinha label="Lucro Líquido do Período" valor={op.lucro_liquido} classe="titulo" />
        <DFCLinha label="(+) Depreciação e Amortização" valor={ajustes.depreciacao_amortizacao} classe="ajuste" />
        <DFCLinha label="(+) Provisões" valor={ajustes.provisoes} classe="ajuste" />
        <DFCSubtotal label="Subtotal Ajustes" valor={ajustes.subtotal} />
        <DFCLinha label="(+/-) Variação Contas a Receber" valor={varCG.aumento_contas_receber} classe="ajuste" />
        <DFCLinha label="(+/-) Variação Estoques" valor={varCG.aumento_estoque} classe="ajuste" />
        <DFCLinha label="(+/-) Variação Contas a Pagar" valor={varCG.aumento_contas_pagar} classe="ajuste" />
        <DFCSubtotal label="Subtotal Variações de Capital de Giro" valor={varCG.subtotal} />
        <DFCTotal label="(=) Caixa das Atividades OPERACIONAIS" valor={op.caixa_operacional} cor={op.caixa_operacional >= 0 ? CORES.baixa : CORES.alta} />

        {/* Atividades Investimento */}
        <div style={{ padding: '14px 18px', background: CORES.espresso, color: CORES.offWhite, marginTop: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
            ▾ Atividades de Investimento
          </div>
        </div>
        <DFCLinha label="Aquisição de Imobilizado" valor={inv.aquisicao_imobilizado} classe="ajuste" />
        <DFCLinha label="Venda de Imobilizado" valor={inv.venda_imobilizado} classe="ajuste" />
        <DFCTotal label="(=) Caixa das Atividades de INVESTIMENTO" valor={inv.caixa_investimento} cor={inv.caixa_investimento >= 0 ? CORES.baixa : CORES.alta} />
        <div style={{ padding: '8px 18px', background: CORES.amareloSoft, fontSize: 10, color: CORES.espressoLight, fontStyle: 'italic' }}>
          ℹ️ {inv.observacao}
        </div>

        {/* Atividades Financiamento */}
        <div style={{ padding: '14px 18px', background: CORES.espresso, color: CORES.offWhite, marginTop: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
            ▾ Atividades de Financiamento
          </div>
        </div>
        <DFCLinha label="(-) Pagamento de Empréstimos/Financiamentos" valor={fin.pagamento_emprestimos} classe="ajuste" />
        <DFCLinha label="(-) Pró-Labore e Distribuição de Lucros" valor={fin.pagamento_pro_labore_distribuicao} classe="ajuste" />
        <DFCTotal label="(=) Caixa das Atividades de FINANCIAMENTO" valor={fin.caixa_financiamento} cor={fin.caixa_financiamento >= 0 ? CORES.baixa : CORES.alta} />

        {/* Variação Líquida e Saldos */}
        <div style={{ padding: '14px 18px', background: `${CORES.dourado}15`, marginTop: 4 }}>
          <DFCTotal label="VARIAÇÃO LÍQUIDA NO CAIXA" valor={data.variacao_liquida_caixa} cor={data.variacao_liquida_caixa >= 0 ? CORES.baixa : CORES.alta} grande />
        </div>
      </div>

      {/* CARDS RESUMO 3 ATIVIDADES */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 12,
      }}>
        <ResumoCard
          titulo="🔄 Operacional"
          valor={op.caixa_operacional}
          descricao="Caixa gerado pela operação principal"
        />
        <ResumoCard
          titulo="🏗 Investimento"
          valor={inv.caixa_investimento}
          descricao="Compra/venda de ativos de longo prazo"
        />
        <ResumoCard
          titulo="💼 Financiamento"
          valor={fin.caixa_financiamento}
          descricao="Empréstimos, sócios, dividendos"
        />
      </div>

      <div style={{
        padding: '10px 16px',
        background: CORES.amareloSoft,
        borderLeft: `3px solid ${CORES.media}`,
        borderRadius: 8,
        fontSize: 11,
        color: CORES.espresso,
        lineHeight: 1.5,
      }}>
        ⚠️ <strong>Nota técnica:</strong> DFC método indireto reconcilia o lucro com o caixa.
        Depreciação e investimento em imobilizado dependem de cadastro contábil completo
        (será refinado conforme imobilizado for cadastrado).
      </div>
    </div>
  );
}

function DFCLinha({ label, valor, classe }: any) {
  const isTitulo = classe === 'titulo';
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: 16,
      padding: '8px 22px',
      borderBottom: `1px solid ${CORES.offWhiteDark}`,
      alignItems: 'center',
    }}>
      <span style={{
        color: isTitulo ? CORES.espresso : CORES.espressoLight,
        fontSize: 12,
        fontWeight: isTitulo ? 700 : 500,
        paddingLeft: isTitulo ? 0 : 12,
      }}>
        {label}
      </span>
      <span style={{
        color: valor < 0 ? CORES.alta : (valor > 0 ? CORES.espresso : CORES.espressoLight),
        fontSize: 12,
        fontWeight: isTitulo ? 700 : 500,
        fontVariantNumeric: 'tabular-nums',
        minWidth: 130,
        textAlign: 'right'
      }}>
        {fmtR(valor)}
      </span>
    </div>
  );
}

function DFCSubtotal({ label, valor }: any) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: 16,
      padding: '10px 22px',
      borderBottom: `1px solid ${CORES.offWhiteDark}`,
      background: CORES.offWhiteDark,
    }}>
      <span style={{ color: CORES.espresso, fontSize: 12, fontWeight: 700, fontStyle: 'italic' }}>
        {label}
      </span>
      <span style={{
        color: valor < 0 ? CORES.alta : CORES.espresso,
        fontSize: 12, fontWeight: 700,
        fontVariantNumeric: 'tabular-nums', minWidth: 130, textAlign: 'right'
      }}>
        {fmtR(valor)}
      </span>
    </div>
  );
}

function DFCTotal({ label, valor, cor, grande }: any) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: 16,
      padding: grande ? '14px 22px' : '12px 22px',
      borderBottom: `2px solid ${CORES.offWhiteDark}`,
      background: grande ? 'transparent' : CORES.offWhite,
    }}>
      <span style={{
        color: cor,
        fontSize: grande ? 14 : 13,
        fontWeight: 700,
        letterSpacing: 0.3,
      }}>
        {label}
      </span>
      <span style={{
        color: cor,
        fontSize: grande ? 16 : 13,
        fontWeight: 800,
        fontVariantNumeric: 'tabular-nums', minWidth: 130, textAlign: 'right'
      }}>
        {fmtR(valor)}
      </span>
    </div>
  );
}

function ResumoCard({ titulo, valor, descricao }: any) {
  const cor = valor > 0 ? CORES.baixa : valor < 0 ? CORES.alta : CORES.espressoLight;
  return (
    <div style={{
      background: CORES.offWhite,
      border: `1px solid ${CORES.offWhiteDark}`,
      borderRadius: 10,
      padding: '14px 16px',
      borderTop: `3px solid ${cor}`,
    }}>
      <div style={{ color: CORES.espressoLight, fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>
        {titulo}
      </div>
      <div style={{ color: cor, fontSize: 18, fontWeight: 800, marginBottom: 4 }}>
        {fmtR(valor)}
      </div>
      <div style={{ color: CORES.espressoLight, fontSize: 10, lineHeight: 1.4 }}>
        {descricao}
      </div>
    </div>
  );
}
