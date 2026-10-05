"use client";
// Abas do Social (Planejamento · Calendário) — mesma família visual da P&M (Espresso + dourado).
import Link from "next/link";
import { CalendarDays, CalendarRange } from "lucide-react";

export function SocialNav({ ativo }: { ativo: "planejamento" | "calendario" }) {
  const item = (id: "planejamento" | "calendario", href: string, rotulo: string, Icone: typeof CalendarDays) => (
    <Link href={href} data-testid={`social-nav-${id}`} aria-current={ativo === id ? "page" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition ${ativo === id ? "bg-[#3D2314] text-[#F5E6C8] shadow-sm" : "text-[#3D2314]/70 hover:bg-[#3D2314]/6"}`}>
      <Icone size={14} /> {rotulo}
    </Link>
  );
  return (
    <nav className="inline-flex rounded-full border border-[#3D2314]/12 bg-white p-1" aria-label="Social">
      {item("planejamento", "/dashboard/pm/planejamento", "Planejamento", CalendarRange)}
      {item("calendario", "/dashboard/pm/calendario", "Calendário", CalendarDays)}
    </nav>
  );
}
