// src/app/dashboard/projetos/error.tsx
// Rede de segurança do Hub Projetos. Sem isto, qualquer erro em runtime numa
// tela filha (ex.: ChunkLoadError após um deploy novo, um throw de render)
// cai no erro cru do framework — o "This page couldn't load" do navegador,
// sem tradução e sem recuperação. Este boundary:
//   1. mostra uma tela amigável na paleta PS e permite TENTAR DE NOVO (reset);
//   2. registra o error.digest — é ele que aparece no log da Vercel e liga o
//      sintoma à causa real (hoje, sem boundary, nem o digest víamos).
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RefreshCw, ArrowLeft } from "lucide-react";

export default function ProjetosError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    // Vai para o console do runtime (Vercel Logs) com o digest para rastreio.
    console.error("[projetos] erro de tela:", error?.digest ?? "", error);
  }, [error]);

  const ehDev = process.env.NODE_ENV !== "production";

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <div className="rounded-2xl border border-[#3D2314]/10 bg-white p-8 shadow-sm">
        <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#C8941A]/15">
          <AlertTriangle className="text-[#C8941A]" size={22} />
        </div>
        <h1 className="text-lg font-medium text-[#3D2314]">
          Não foi possível abrir esta tela
        </h1>
        <p className="mt-2 text-sm text-[#3D2314]/70">
          Tivemos um erro ao carregar. Na maioria das vezes é uma versão antiga
          aberta no navegador — clicar em <strong>Tentar de novo</strong> resolve.
          Se persistir, avise o time com o código abaixo.
        </p>

        {error?.digest && (
          <p className="mt-3 rounded-lg bg-[#3D2314]/5 px-3 py-2 font-mono text-xs text-[#3D2314]/60">
            código: {error.digest}
          </p>
        )}
        {ehDev && error?.message && (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 font-mono text-xs text-red-800">
            {error.message}
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={() => reset()}
            className="inline-flex items-center gap-2 rounded-lg bg-[#3D2314] px-4 py-2 text-sm font-medium text-[#FAF7F2] hover:bg-[#3D2314]/90"
          >
            <RefreshCw size={14} /> Tentar de novo
          </button>
          <button
            onClick={() => router.push("/dashboard/projetos/catalogo")}
            className="inline-flex items-center gap-2 rounded-lg border border-[#3D2314]/15 px-4 py-2 text-sm font-medium text-[#3D2314] hover:bg-[#3D2314]/5"
          >
            <ArrowLeft size={14} /> Voltar ao catálogo
          </button>
        </div>
      </div>
    </main>
  );
}
