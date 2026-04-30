// src/app/dashboard/projetos/_components/PlaceholderTab.tsx
// Placeholder reutilizável para abas em construção do Hub Projetos

"use client";

import Link from "next/link";

export function PlaceholderTab({
  icone,
  titulo,
  descricao,
  fase,
  funcoesFuturas,
}: {
  icone: string;
  titulo: string;
  descricao: string;
  fase: string;
  funcoesFuturas: string[];
}) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-2xl w-full">
        <div className="bg-[#FAF7F2] rounded-3xl p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#3D2314]/10 flex items-center justify-center text-3xl">
            {icone}
          </div>
          <span className="inline-block px-3 py-1 rounded-full bg-[#C8941A]/20 text-[#C8941A] text-xs font-semibold mb-3">
            {fase} · Em construção
          </span>
          <h1 className="text-2xl font-bold text-[#3D2314] mb-3">
            {titulo}
          </h1>
          <p className="text-[#3D2314]/70 mb-6 leading-relaxed">
            {descricao}
          </p>

          <div className="bg-white rounded-2xl p-5 text-left">
            <h3 className="text-sm font-semibold text-[#3D2314] mb-3 uppercase tracking-wide">
              Funcionalidades planejadas
            </h3>
            <ul className="space-y-2">
              {funcoesFuturas.map((f, i) => (
                <li key={i} className="flex gap-2 text-sm text-[#3D2314]/80">
                  <span className="text-[#C8941A] mt-0.5">•</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>

          <Link
            href="/dashboard/projetos"
            className="inline-block mt-6 text-sm text-[#C8941A] hover:underline"
          >
            ← Voltar ao painel
          </Link>
        </div>
      </div>
    </div>
  );
}
