// src/app/dashboard/commerce/page.tsx
//
// HUB Comércio — Pagina raiz do plano comercial.
//
// Existencia: criada em 12/05/2026 como fix de regressao detectada pelo
// Insight Auditor IA: /dashboard/commerce respondia 404 (score 0) enquanto
// as 4 sub-rotas funcionavam (otc 85, estoque 82, fichas 65, compras 35).
// Quando o menu lateral dos 12 planos foi ativado, o link "Comércio"
// passou a apontar para esta raiz que nunca havia sido construida.
//
// Padrão: Server Component (sem state, listagem estatica de modulos).
// Identidade: Estrela Polar V1.2 — espresso #3D2314, off-white #FAF7F2,
// dourado #C8941A. Verde/amarelo/vermelho APENAS para semaforos de % pronto.

import Link from 'next/link';
import {
  ShoppingBag,
  Receipt,
  PackageOpen,
  ClipboardList,
  ShoppingCart,
  ArrowUpRight,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

type Modulo = {
  titulo: string;
  subtitulo: string;
  descricao: string;
  href: string;
  Icon: typeof Receipt;
  scorePronto: number;
};

const MODULOS: Modulo[] = [
  {
    titulo: 'OTC',
    subtitulo: 'Orçamento → Pedido → Faturamento',
    descricao:
      'Ciclo comercial completo. Cotação ao cliente, conversão em pedido, faturamento integrado a NF-e.',
    href: '/dashboard/commerce/otc',
    Icon: Receipt,
    scorePronto: 85,
  },
  {
    titulo: 'Estoque',
    subtitulo: 'Multi-Depósito',
    descricao:
      'Saldo por SKU em múltiplos depósitos, movimentações de entrada e saída, transferências e ajustes.',
    href: '/dashboard/commerce/estoque',
    Icon: PackageOpen,
    scorePronto: 82,
  },
  {
    titulo: 'Fichas Técnicas',
    subtitulo: 'Estrutura de Produtos',
    descricao:
      'BOM de produtos compostos. Insumos, receitas, custo unitário calculado, integração com Estoque.',
    href: '/dashboard/commerce/fichas',
    Icon: ClipboardList,
    scorePronto: 65,
  },
  {
    titulo: 'Compras',
    subtitulo: 'Cotação Multi-Fornecedor',
    descricao:
      'Requisição, cotação simultânea com vários fornecedores, ordem de compra, recebimento físico.',
    href: '/dashboard/commerce/compras',
    Icon: ShoppingCart,
    scorePronto: 35,
  },
];

function semaforo(pct: number): { cor: string; label: string } {
  if (pct >= 70) return { cor: 'text-emerald-600 bg-emerald-50', label: 'pronto' };
  if (pct >= 40) return { cor: 'text-amber-600 bg-amber-50', label: 'parcial' };
  return { cor: 'text-rose-600 bg-rose-50', label: 'em obra' };
}

export default function CommerceHubPage() {
  const totalPronto = Math.round(
    MODULOS.reduce((a, m) => a + m.scorePronto, 0) / MODULOS.length,
  );

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-12">
        {/* Header */}
        <header className="mb-10">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#3D2314] shadow-sm">
              <ShoppingBag className="h-7 w-7 text-[#C8941A]" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium uppercase tracking-wider text-[#3D2314]/50">
                Plano Comercial · V1.5
              </p>
              <h1 className="mt-1 text-3xl font-semibold leading-tight text-[#3D2314] md:text-4xl">
                Comércio
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#3D2314]/70">
                Núcleo operacional para negócios comerciais: ciclo OTC, gestão de
                estoque multi-depósito, fichas técnicas de produtos compostos e
                cotações multi-fornecedor.
              </p>
            </div>
            <div className="hidden shrink-0 rounded-xl border border-[#3D2314]/10 bg-white px-4 py-3 text-right md:block">
              <p className="text-xs font-medium uppercase tracking-wider text-[#3D2314]/50">
                Evolução média
              </p>
              <p className="mt-1 text-2xl font-semibold text-[#3D2314]">
                {totalPronto}<span className="text-base text-[#3D2314]/40">%</span>
              </p>
            </div>
          </div>
        </header>

        {/* Cards */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {MODULOS.map(({ titulo, subtitulo, descricao, href, Icon, scorePronto }) => {
            const sem = semaforo(scorePronto);
            return (
              <Link
                key={href}
                href={href}
                className="group relative flex flex-col rounded-2xl border border-[#3D2314]/10 bg-white p-6 transition-all hover:border-[#C8941A] hover:shadow-[0_8px_24px_-12px_rgba(61,35,20,0.25)]"
              >
                {/* topo: ícone + semáforo */}
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#3D2314]/5 transition-colors group-hover:bg-[#C8941A]/10">
                    <Icon className="h-5 w-5 text-[#C8941A]" />
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${sem.cor}`}
                  >
                    {scorePronto}% {sem.label}
                  </span>
                </div>

                {/* título + subtítulo */}
                <h3 className="text-lg font-semibold text-[#3D2314]">{titulo}</h3>
                <p className="mt-0.5 text-sm font-medium text-[#3D2314]/60">
                  {subtitulo}
                </p>

                {/* descrição */}
                <p className="mt-3 text-sm leading-relaxed text-[#3D2314]/70">
                  {descricao}
                </p>

                {/* CTA */}
                <div className="mt-5 flex items-center gap-1.5 text-sm font-medium text-[#C8941A] transition-all group-hover:gap-2.5">
                  Acessar módulo
                  <ArrowUpRight className="h-4 w-4" />
                </div>
              </Link>
            );
          })}
        </section>

        {/* Footer */}
        <footer className="mt-10 flex items-center justify-between border-t border-[#3D2314]/10 pt-5 text-xs text-[#3D2314]/40">
          <span>PS Gestão · Comércio · {MODULOS.length} módulos</span>
          <span>Estrela Polar V1.2</span>
        </footer>
      </div>
    </div>
  );
}
