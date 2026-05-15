'use client';

import { AlertaCritico } from '@/hooks/useDashboardOperacional';
import { AlertTriangle } from 'lucide-react';

interface Props {
  alertas: AlertaCritico[];
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(value || 0);
}

export function AlertasCriticos({ alertas }: Props) {
  if (!alertas || alertas.length === 0) {
    return null; // sem alertas, nao renderiza nada (nao polui o painel)
  }

  return (
    <div className="rounded-lg p-4" style={{ background: '#FEF2F2', border: '1px solid #FCA5A5' }}>
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4" style={{ color: '#C44536' }} />
        <h3 className="text-sm font-semibold" style={{ color: '#C44536' }}>Alertas Imediatos</h3>
        <span
          className="text-xs text-white px-2 py-0.5 rounded-full font-medium"
          style={{ background: '#C44536' }}
        >
          {alertas.length}
        </span>
      </div>

      <ul className="space-y-2">
        {alertas.map((alerta, idx) => (
          <li key={idx} className="flex items-start justify-between gap-2 text-sm">
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate" style={{ color: '#3D2314' }}>{alerta.pessoa}</p>
              <p className="text-xs text-gray-700">{alerta.mensagem}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="font-bold tabular-nums" style={{ color: '#C44536' }}>
                {formatCurrency(alerta.valor)}
              </p>
              <p className="text-[10px] text-gray-500">{alerta.dias_atraso} dias</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
