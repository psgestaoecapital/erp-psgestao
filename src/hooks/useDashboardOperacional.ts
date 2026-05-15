'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export interface PainelOperacionalData {
  gerado_em: string;
  data_referencia: string;
  empresas_consideradas: number;
  cards_hero: {
    receber_vencidos: CardHeroData;
    receber_hoje: CardHeroData;
    receber_30d: CardSimples;
    receber_resto_mes: CardSimples;
    pagar_vencidos: CardHeroData;
    pagar_hoje: CardHeroData;
    pagar_30d: CardSimples;
    pagar_resto_mes: CardSimples;
  };
  saldos_bancarios: {
    total: number;
    qtd_contas: number;
    contas: ContaBancaria[];
  };
  conciliacoes_pendentes: {
    qtd: number;
    valor_estimado: number;
  };
  alertas_imediatos: AlertaCritico[];
}

export interface CardHeroData {
  valor: number;
  qtd: number;
  top5: Array<{
    cliente?: string;
    fornecedor?: string;
    valor: number;
    vencimento?: string;
    dias_atraso?: number;
  }>;
}

export interface CardSimples {
  valor: number;
  qtd: number;
}

export interface ContaBancaria {
  conta: string;
  saldo: number;
  entradas_acum: number;
  saidas_acum: number;
  ultima_movimentacao: string;
}

export interface AlertaCritico {
  tipo: 'pagar' | 'receber';
  severidade: 'critico' | 'atencao';
  pessoa: string;
  valor: number;
  vencimento: string;
  dias_atraso: number;
  mensagem: string;
}

export function useDashboardOperacional(companyIds: string[]) {
  const [data, setData] = useState<PainelOperacionalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Chave estavel: companyIds e re-criado a cada render do hook pai.
  const key = [...(companyIds ?? [])].sort().join(',');

  useEffect(() => {
    if (!key) {
      setLoading(false);
      setData(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const ids = key.split(',').filter(Boolean);
        // RPC retorna jsonb unico (nao TABLE) — sem .single().
        const { data: result, error: rpcError } = await supabase.rpc(
          'fn_psgc_painel_operacional',
          { p_company_ids: ids },
        );
        if (rpcError) throw rpcError;
        if (alive) setData((result ?? null) as PainelOperacionalData | null);
      } catch (err) {
        console.error('Erro ao carregar painel operacional:', err);
        if (alive) setError(err instanceof Error ? err.message : 'Erro desconhecido');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [key]);

  return { data, loading, error };
}
