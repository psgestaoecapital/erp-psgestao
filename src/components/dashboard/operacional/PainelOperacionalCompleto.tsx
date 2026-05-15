'use client';

import { useDashboardOperacional } from '@/hooks/useDashboardOperacional';
import { CardsHeroOperacional } from './CardsHeroOperacional';
import { SaldosBancarios } from './SaldosBancarios';
import { AlertasCriticos } from './AlertasCriticos';
import { Loader2 } from 'lucide-react';

interface Props {
  companyIds: string[];
}

export function PainelOperacionalCompleto({ companyIds }: Props) {
  const { data, loading, error } = useDashboardOperacional(companyIds);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#C8941A' }} />
        <span className="ml-2 text-sm text-gray-500">Carregando operação...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg p-4 mb-6" style={{ background: '#FEF2F2', border: '1px solid #FCA5A5' }}>
        <p className="text-sm" style={{ color: '#991B1B' }}>Erro ao carregar painel operacional.</p>
        <p className="text-xs mt-1" style={{ color: '#B91C1C' }}>{error}</p>
      </div>
    );
  }

  if (!data || !data.cards_hero) return null;

  return (
    <div className="space-y-4 mb-6">
      <CardsHeroOperacional
        receber_vencidos={data.cards_hero.receber_vencidos}
        receber_hoje={data.cards_hero.receber_hoje}
        receber_30d={data.cards_hero.receber_30d}
        pagar_vencidos={data.cards_hero.pagar_vencidos}
        pagar_hoje={data.cards_hero.pagar_hoje}
        pagar_30d={data.cards_hero.pagar_30d}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SaldosBancarios
          total={data.saldos_bancarios?.total ?? 0}
          qtd_contas={data.saldos_bancarios?.qtd_contas ?? 0}
          contas={data.saldos_bancarios?.contas ?? []}
          conciliacoes_qtd={data.conciliacoes_pendentes?.qtd ?? 0}
          conciliacoes_valor={data.conciliacoes_pendentes?.valor_estimado ?? 0}
        />

        <AlertasCriticos alertas={data.alertas_imediatos ?? []} />
      </div>
    </div>
  );
}
