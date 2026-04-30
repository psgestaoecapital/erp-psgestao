// src/app/dashboard/projetos/layout.tsx
// Sub-navegação em tabs do Hub Projetos
// Atalho: Ctrl+1..0 troca de aba

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const TABS: Array<{ slug: string; label: string; icone: string; tecla: string }> = [
  { slug: "clientes",        label: "Clientes",         icone: "👥",  tecla: "1" },
  { slug: "visitas",         label: "Visitas",          icone: "🗺️",  tecla: "2" },
  { slug: "propostas",       label: "Propostas",        icone: "📄",  tecla: "3" },
  { slug: "engenharia",      label: "Engenharia",       icone: "📐",  tecla: "4" },
  { slug: "catalogo",        label: "Catálogo",         icone: "📚",  tecla: "5" },
  { slug: "insumos",         label: "Insumos",          icone: "📦",  tecla: "6" },
  { slug: "mao-obra",        label: "Mão de Obra",      icone: "🦺",  tecla: "7" },
  { slug: "obras",           label: "Obras",            icone: "🏗️",  tecla: "8" },
  { slug: "acompanhamento",  label: "Acompanhamento",   icone: "📈",  tecla: "9" },
  { slug: "configuracoes",   label: "Configurações",    icone: "⚙️",  tecla: "0" },
];

export default function ProjetosLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const slugAtivo = pathname?.split("/dashboard/projetos/")[1]?.split("/")[0] || "";

  // Atalhos Ctrl+1..0
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const tab = TABS.find((t) => t.tecla === e.key);
      if (tab) {
        e.preventDefault();
        router.push(`/dashboard/projetos/${tab.slug}`);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router]);

  return (
    <div className="min-h-screen bg-white">
      {/* Sub-nav sticky */}
      <nav className="sticky top-0 z-10 border-b border-[#3D2314]/10 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-2">
          <div className="mb-1 flex items-center gap-2">
            <Link
              href="/dashboard/projetos"
              className={`text-xs font-medium uppercase tracking-wide ${
                slugAtivo === "" ? "text-[#3D2314]" : "text-[#C8941A] hover:underline"
              }`}
            >
              ← Painel Projetos
            </Link>
          </div>
          <div className="flex gap-1 overflow-x-auto pb-1">
            {TABS.map((t) => {
              const ativo = slugAtivo === t.slug;
              return (
                <Link
                  key={t.slug}
                  href={`/dashboard/projetos/${t.slug}`}
                  title={`Ctrl+${t.tecla}`}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    ativo
                      ? "bg-[#3D2314] text-[#FAF7F2]"
                      : "bg-[#FAF7F2] text-[#3D2314] hover:bg-[#3D2314]/10"
                  }`}
                >
                  <span>{t.icone}</span>
                  <span className="hidden sm:inline">{t.label}</span>
                  <span
                    className={`hidden md:inline rounded border px-1 text-[10px] ${
                      ativo
                        ? "border-[#FAF7F2]/30 text-[#FAF7F2]/70"
                        : "border-[#3D2314]/20 text-[#3D2314]/50"
                    }`}
                  >
                    Ctrl+{t.tecla}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      {children}
    </div>
  );
}
