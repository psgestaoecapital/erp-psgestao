// src/app/dashboard/bpo/admin/page.tsx
// Landing admin BPO: 4 cards de navegação + KPIs rápidos

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/authFetch";
import AdminGuard from "@/components/bpo/AdminGuard";

interface Kpis {
  empresas: number;
  contratos_ativos: number;
  operadores: number;
  empresas_incompletas: number;
  inbox_total: number;
  inbox_vencido: number;
}

export default function AdminBpoLanding() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const supabase = supabaseBrowser();
        const { data: painel, error } = await supabase
          .from("v_bpo_admin_painel")
          .select("*");
        if (error) throw error;

        const empresas = painel?.length || 0;
        const incompletas = painel?.filter((p: any) => !p.assignment_completo).length || 0;
        const inboxTotal = painel?.reduce((s: number, p: any) => s + (p.inbox_pendente || 0), 0) || 0;
        const inboxVencido = painel?.reduce((s: number, p: any) => s + (p.inbox_vencido || 0), 0) || 0;

        const { data: ops } = await supabase.rpc("fn_bpo_admin_listar_operadores");

        setKpis({
          empresas,
          contratos_ativos: empresas,
          operadores: ops?.length || 0,
          empresas_incompletas: incompletas,
          inbox_total: inboxTotal,
          inbox_vencido: inboxVencido,
        });
      } catch (e: any) {
        setErro(e.message || "Não foi possível carregar os indicadores");
      }
    })();
  }, []);

  const Card = ({
    href,
    titulo,
    descricao,
    icone,
    badge,
  }: {
    href: string;
    titulo: string;
    descricao: string;
    icone: string;
    badge?: { label: string; tom: "verde" | "amarelo" | "vermelho" };
  }) => {
    const tons = {
      verde: "bg-emerald-100 text-emerald-800",
      amarelo: "bg-yellow-100 text-yellow-800",
      vermelho: "bg-red-100 text-red-800",
    };
    return (
      <Link
        href={href}
        className="group block rounded-2xl bg-[#FAF7F2] p-6 transition hover:shadow-lg"
      >
        <div className="flex items-start justify-between">
          <div className="text-4xl">{icone}</div>
          {badge && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tons[badge.tom]}`}>
              {badge.label}
            </span>
          )}
        </div>
        <h3 className="mt-4 text-lg font-semibold text-[#3D2314]">{titulo}</h3>
        <p className="mt-1 text-sm text-[#3D2314]/70">{descricao}</p>
        <div className="mt-3 text-sm text-[#C8941A] group-hover:underline">
          Acessar →
        </div>
      </Link>
    );
  };

  return (
    <AdminGuard>
      <div className="min-h-screen bg-white p-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-[#3D2314]">Admin BPO</h1>
            <p className="mt-1 text-sm text-[#3D2314]/70">
              Cadastro de operadores, empresas, contratos e onboarding de clientes novos.
            </p>
          </div>

          {erro && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
              {erro}
            </div>
          )}

          {/* KPIs */}
          {kpis && (
            <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Empresas BPO" valor={kpis.empresas} />
              <Kpi label="Operadores" valor={kpis.operadores} />
              <Kpi
                label="Inbox pendente"
                valor={kpis.inbox_total}
                alerta={kpis.inbox_vencido > 0 ? `${kpis.inbox_vencido} vencidos` : undefined}
              />
              <Kpi
                label="Empresas incompletas"
                valor={kpis.empresas_incompletas}
                tom={kpis.empresas_incompletas > 0 ? "vermelho" : "verde"}
              />
            </div>
          )}

          {/* 4 cards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card
              href="/dashboard/bpo/admin/operadores"
              titulo="Operadores"
              descricao="Cadastrar, editar skills e ver carga dos operadores BPO."
              icone="👥"
              badge={kpis ? { label: `${kpis.operadores} ativos`, tom: "verde" } : undefined}
            />
            <Card
              href="/dashboard/bpo/admin/empresas"
              titulo="Empresas"
              descricao="Atribuir titular, backup e supervisor para cada empresa BPO."
              icone="🏢"
              badge={
                kpis
                  ? {
                      label:
                        kpis.empresas_incompletas > 0
                          ? `${kpis.empresas_incompletas} incompletas`
                          : "todas completas",
                      tom: kpis.empresas_incompletas > 0 ? "vermelho" : "verde",
                    }
                  : undefined
              }
            />
            <Card
              href="/dashboard/bpo/admin/contratos"
              titulo="Contratos"
              descricao="Gerenciar serviços contratados, SLA e ativação dos contratos BPO."
              icone="📋"
            />
            <Card
              href="/dashboard/bpo/admin/onboarding"
              titulo="Onboarding cliente novo"
              descricao="Wizard 5 passos: cadastrar cliente novo do zero em <2 min."
              icone="✨"
              badge={{ label: "novo", tom: "amarelo" }}
            />
          </div>
        </div>
      </div>
    </AdminGuard>
  );
}

function Kpi({
  label,
  valor,
  alerta,
  tom,
}: {
  label: string;
  valor: number;
  alerta?: string;
  tom?: "verde" | "vermelho";
}) {
  const tons = {
    verde: "text-emerald-700",
    vermelho: "text-red-700",
  };
  return (
    <div className="rounded-xl bg-[#FAF7F2] p-4">
      <div className="text-xs uppercase tracking-wide text-[#3D2314]/60">
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-bold ${
          tom ? tons[tom] : "text-[#3D2314]"
        }`}
      >
        {valor}
      </div>
      {alerta && (
        <div className="mt-1 text-xs text-red-600">⚠ {alerta}</div>
      )}
    </div>
  );
}
