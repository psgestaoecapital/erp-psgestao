// src/app/dashboard/projetos/layout.tsx
// Sub-navegação premium do Hub Projetos com Lucide icons
// Atalhos Ctrl+1..0 + Ctrl+, (vira tooltip via title attr)

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  MapPin,
  FileSignature,
  Ruler,
  BookOpenText,
  Package,
  HardHat,
  Construction,
  TrendingUp,
  Settings,
  type LucideIcon,
} from "lucide-react";

interface Tab {
  href: string;
  label: string;
  icon: LucideIcon;
  key: string;
}

const TABS: Tab[] = [
  { href: "/dashboard/projetos",                label: "Painel",         icon: LayoutDashboard, key: "1" },
  { href: "/dashboard/projetos/clientes",       label: "Clientes",       icon: Users,           key: "2" },
  { href: "/dashboard/projetos/visitas",        label: "Visitas",        icon: MapPin,          key: "3" },
  { href: "/dashboard/projetos/propostas",      label: "Propostas",      icon: FileSignature,   key: "4" },
  { href: "/dashboard/projetos/engenharia",     label: "Engenharia",     icon: Ruler,           key: "5" },
  { href: "/dashboard/projetos/catalogo",       label: "Catálogo",       icon: BookOpenText,    key: "6" },
  { href: "/dashboard/projetos/insumos",        label: "Insumos",        icon: Package,         key: "7" },
  { href: "/dashboard/projetos/mao-obra",       label: "Mão de obra",    icon: HardHat,         key: "8" },
  { href: "/dashboard/projetos/obras",          label: "Obras",          icon: Construction,    key: "9" },
  { href: "/dashboard/projetos/acompanhamento", label: "Acompanhamento", icon: TrendingUp,      key: "0" },
  { href: "/dashboard/projetos/configuracoes",  label: "Configurações",  icon: Settings,        key: "," },
];

export default function ProjetosLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  // Atalhos Ctrl+1..0 + Ctrl+,
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const tab = TABS.find((t) => t.key === e.key);
      if (tab) {
        e.preventDefault();
        router.push(tab.href);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router]);

  return (
    <div className="min-h-screen bg-white">
      {/* Breadcrumb sutil */}
      <div className="px-6 pt-4 pb-2">
        <nav className="text-xs text-[#3D2314]/50">
          <Link href="/dashboard" className="hover:text-[#3D2314]">
            Início
          </Link>
          <span className="mx-2">/</span>
          <span className="text-[#3D2314]/70">Projetos</span>
        </nav>
      </div>

      {/* Sub-nav sticky */}
      <div className="sticky top-0 z-10 border-b border-[#3D2314]/10 bg-[#FAF7F2]">
        <div className="mx-auto flex max-w-7xl items-center overflow-x-auto px-4">
          {TABS.map((tab) => {
            const isActive =
              tab.href === "/dashboard/projetos"
                ? pathname === tab.href
                : pathname?.startsWith(tab.href);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                title={`Ctrl+${tab.key}`}
                className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "border-[#C8941A] bg-[#3D2314]/5 text-[#3D2314]"
                    : "border-transparent text-[#3D2314]/60 hover:bg-[#3D2314]/5 hover:text-[#3D2314]"
                }`}
              >
                <Icon size={16} strokeWidth={2} />
                {tab.label}
              </Link>
            );
          })}
        </div>
      </div>

      {children}
    </div>
  );
}
