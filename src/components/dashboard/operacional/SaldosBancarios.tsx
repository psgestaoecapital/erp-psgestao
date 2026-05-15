'use client';

import { ContaBancaria } from '@/hooks/useDashboardOperacional';
import { Banknote, Link2 } from 'lucide-react';
import Link from 'next/link';

interface Props {
  total: number;
  qtd_contas: number;
  contas: ContaBancaria[];
  conciliacoes_qtd: number;
  conciliacoes_valor: number;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(value || 0);
}

function formatRelativeDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '—';
  const hoje = new Date();
  const diff = Math.floor((hoje.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'ontem';
  if (diff < 7) return `${diff} dias atrás`;
  return date.toLocaleDateString('pt-BR');
}

export function SaldosBancarios({ total, qtd_contas, contas, conciliacoes_qtd, conciliacoes_valor }: Props) {
  if (qtd_contas === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Banknote className="w-4 h-4" style={{ color: '#C8941A' }} />
          <h3 className="text-sm font-semibold" style={{ color: '#3D2314' }}>Saldos Bancários</h3>
        </div>
        <div className="text-center py-6">
          <p className="text-sm text-gray-500">Nenhuma conta bancária cadastrada nesta empresa.</p>
          <p className="text-xs text-gray-400 mt-1">
            Vincule contas aos lançamentos para ver saldos consolidados.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Banknote className="w-4 h-4" style={{ color: '#C8941A' }} />
          <h3 className="text-sm font-semibold" style={{ color: '#3D2314' }}>Saldos Bancários</h3>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Total consolidado</p>
          <p
            className="text-lg font-bold tabular-nums"
            style={{ color: total >= 0 ? '#5C8D3F' : '#C44536' }}
          >
            {formatCurrency(total)}
          </p>
        </div>
      </div>

      <ul className="space-y-2 mb-3">
        {contas.map((conta) => (
          <li
            key={conta.conta}
            className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0"
          >
            <div className="flex-1">
              <p className="text-sm font-medium" style={{ color: '#3D2314' }}>{conta.conta}</p>
              <p className="text-[10px] text-gray-500">
                Última movimentação: {formatRelativeDate(conta.ultima_movimentacao)}
              </p>
            </div>
            <div
              className="text-sm font-semibold tabular-nums"
              style={{ color: conta.saldo >= 0 ? '#5C8D3F' : '#C44536' }}
            >
              {formatCurrency(conta.saldo)}
            </div>
          </li>
        ))}
      </ul>

      {conciliacoes_qtd > 0 && (
        <Link
          href="/dashboard/conciliacao"
          className="inline-flex items-center gap-1 text-xs hover:underline font-medium"
          style={{ color: '#C8941A' }}
        >
          <Link2 className="w-3 h-3" />
          {conciliacoes_qtd} conciliações pendentes
          {conciliacoes_valor > 0 && (
            <span className="text-gray-500"> · {formatCurrency(conciliacoes_valor)}</span>
          )}
        </Link>
      )}
    </div>
  );
}
