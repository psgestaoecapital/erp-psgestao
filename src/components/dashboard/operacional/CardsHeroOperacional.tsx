'use client';

import { CardHeroData, CardSimples } from '@/hooks/useDashboardOperacional';
import { AlertCircle, TrendingDown, TrendingUp, Calendar } from 'lucide-react';

interface Props {
  receber_vencidos: CardHeroData;
  receber_hoje: CardHeroData;
  receber_30d: CardSimples;
  pagar_vencidos: CardHeroData;
  pagar_hoje: CardHeroData;
  pagar_30d: CardSimples;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(value || 0);
}

interface CardProps {
  titulo: string;
  subtitulo: string;
  valor: number;
  qtd: number;
  cor: 'verde' | 'amarelo' | 'vermelho' | 'neutro';
  icon: React.ReactNode;
  detalheRestante?: { valor: number; qtd: number };
}

function CardHero({ titulo, subtitulo, valor, qtd, cor, icon, detalheRestante }: CardProps) {
  // Cores semanticas (sinalizam status, nao decorativas)
  const corBorda: Record<string, string> = {
    verde: '#5C8D3F',
    amarelo: '#D89627',
    vermelho: '#C44536',
    neutro: '#3D2314',
  };
  const corFinal = (valor === 0 ? 'neutro' : cor) as keyof typeof corBorda;
  const hex = corBorda[corFinal];

  return (
    <div
      className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow"
      style={{ borderLeft: `4px solid ${hex}` }}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-600 font-medium">{titulo}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">{subtitulo}</p>
        </div>
        <div style={{ color: hex }}>{icon}</div>
      </div>

      <div className="text-2xl font-bold tabular-nums" style={{ color: hex }}>
        {formatCurrency(valor)}
      </div>

      <div className="text-xs text-gray-600 mt-1">
        {qtd === 0 ? 'Nenhum título' : `${qtd} ${qtd === 1 ? 'título' : 'títulos'}`}
      </div>

      {detalheRestante && detalheRestante.valor > 0 && (
        <div className="text-[11px] text-gray-500 mt-2 pt-2 border-t border-gray-100">
          + {formatCurrency(detalheRestante.valor)} restante mês ({detalheRestante.qtd})
        </div>
      )}
    </div>
  );
}

export function CardsHeroOperacional({
  receber_vencidos,
  receber_hoje,
  receber_30d,
  pagar_vencidos,
  pagar_hoje,
  pagar_30d,
}: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <Calendar className="w-4 h-4" style={{ color: '#C8941A' }} />
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: '#3D2314' }}>
          Operação de hoje
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <CardHero
          titulo="A receber"
          subtitulo="Vencidos"
          valor={receber_vencidos?.valor ?? 0}
          qtd={receber_vencidos?.qtd ?? 0}
          cor="vermelho"
          icon={<AlertCircle className="w-5 h-5" />}
        />
        <CardHero
          titulo="A receber"
          subtitulo="Vencem hoje"
          valor={receber_hoje?.valor ?? 0}
          qtd={receber_hoje?.qtd ?? 0}
          cor="verde"
          icon={<TrendingUp className="w-5 h-5" />}
          detalheRestante={receber_30d}
        />
        <CardHero
          titulo="A pagar"
          subtitulo="Vencidos"
          valor={pagar_vencidos?.valor ?? 0}
          qtd={pagar_vencidos?.qtd ?? 0}
          cor="vermelho"
          icon={<AlertCircle className="w-5 h-5" />}
        />
        <CardHero
          titulo="A pagar"
          subtitulo="Vencem hoje"
          valor={pagar_hoje?.valor ?? 0}
          qtd={pagar_hoje?.qtd ?? 0}
          cor="amarelo"
          icon={<TrendingDown className="w-5 h-5" />}
          detalheRestante={pagar_30d}
        />
      </div>
    </div>
  );
}
