// src/app/dashboard/admin/sync/_components/index.tsx
// Componentes compartilhados do módulo Sync Multi-ERP

"use client";

import Link from "next/link";

export const SAUDE_COLORS: Record<string, string> = {
  saudavel: "text-emerald-700 bg-emerald-50 border-emerald-200",
  atencao: "text-yellow-800 bg-yellow-50 border-yellow-200",
  critico: "text-red-700 bg-red-50 border-red-200",
};

export const MODO_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  paused: { bg: "bg-[#3D2314]/10", text: "text-[#3D2314]/60", label: "Pausado" },
  read_only: { bg: "bg-emerald-100", text: "text-emerald-800", label: "Read-only" },
  shadow_mode: { bg: "bg-yellow-100", text: "text-yellow-800", label: "Shadow Mode" },
  write_back: { bg: "bg-[#C8941A]/20", text: "text-[#3D2314]", label: "Write-back" },
};

export const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pendente: { bg: "bg-[#3D2314]/10", text: "text-[#3D2314]" },
  em_processamento: { bg: "bg-blue-100", text: "text-blue-800" },
  sucesso: { bg: "bg-emerald-100", text: "text-emerald-800" },
  erro: { bg: "bg-red-100", text: "text-red-800" },
  cancelado: { bg: "bg-[#3D2314]/15", text: "text-[#3D2314]/60" },
};

export function ModoBadge({ modo }: { modo: string }) {
  const c = MODO_COLORS[modo] || MODO_COLORS.paused;
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.pendente;
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}>
      {status}
    </span>
  );
}

export function H1({ children }: { children: React.ReactNode }) {
  return (
    <h1
      className="text-2xl font-medium text-[#3D2314]"
      style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal", letterSpacing: "-0.01em" }}
    >
      {children}
    </h1>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-sm font-semibold uppercase text-[#3D2314]/60"
      style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal", letterSpacing: "0.08em" }}
    >
      {children}
    </h2>
  );
}

export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav className="text-xs text-[#3D2314]/50">
      {items.map((it, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-2">/</span>}
          {it.href ? (
            <Link href={it.href} className="hover:text-[#3D2314]">
              {it.label}
            </Link>
          ) : (
            <span className="text-[#3D2314]/70">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function fmtBRL(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shortNome(emp: { razao_social?: string | null; nome_fantasia?: string | null }) {
  return emp.nome_fantasia || emp.razao_social || "—";
}
