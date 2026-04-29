// src/components/bpo/AdminGuard.tsx
// Bloqueia acesso a telas /dashboard/bpo/admin/* para não-supervisores

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/authFetch";

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [autorizado, setAutorizado] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = supabaseBrowser();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      const { data, error } = await supabase
        .from("bpo_companies_assignment")
        .select("id")
        .eq("user_id", user.id)
        .eq("papel", "supervisor")
        .eq("ativo", true)
        .limit(1);

      if (error || !data || data.length === 0) {
        setAutorizado(false);
      } else {
        setAutorizado(true);
      }
    })();
  }, [router]);

  if (autorizado === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#FAF7F2]">
        <div className="text-[#3D2314]">Verificando permissões…</div>
      </div>
    );
  }

  if (!autorizado) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#FAF7F2]">
        <div className="max-w-md text-center">
          <div className="mb-4 text-5xl">🔒</div>
          <h2 className="mb-2 text-xl font-semibold text-[#3D2314]">
            Acesso restrito
          </h2>
          <p className="text-sm text-[#3D2314]/70">
            Esta área é exclusiva para supervisores BPO. Se você precisa de
            acesso, fale com o seu gestor.
          </p>
          <button
            onClick={() => router.push("/dashboard")}
            className="mt-6 rounded-lg bg-[#3D2314] px-6 py-2 text-sm text-[#FAF7F2] transition hover:bg-[#5C3A24]"
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
