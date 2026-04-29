// src/components/bpo/BpoLandingRedirect.tsx
// Hook+componente que redireciona operador BPO para /dashboard/bpo/meu-dia ao logar
// Como funciona: na rota /dashboard, esse componente verifica se usuario eh operador
// (titular OU backup de alguma empresa BPO) e redireciona automaticamente.
// Supervisor NAO eh redirecionado - ele continua vendo o dashboard CEO/admin.

"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/authFetch";

const ROTAS_BPO_PROTEGIDAS = ["/dashboard", "/dashboard/"];

export default function BpoLandingRedirect() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!ROTAS_BPO_PROTEGIDAS.includes(pathname)) return;

    (async () => {
      try {
        const supabase = supabaseBrowser();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // E supervisor de alguma empresa? (entao NAO redireciona)
        const { data: sup } = await supabase
          .from("bpo_companies_assignment")
          .select("id")
          .eq("user_id", user.id)
          .eq("papel", "supervisor")
          .eq("ativo", true)
          .limit(1);

        if (sup && sup.length > 0) return; // supervisor mantem dashboard

        // E operador (titular OU backup)? Redirecionar
        const { data: op } = await supabase
          .from("bpo_companies_assignment")
          .select("id")
          .eq("user_id", user.id)
          .in("papel", ["titular", "backup"])
          .eq("ativo", true)
          .limit(1);

        if (op && op.length > 0) {
          router.replace("/dashboard/bpo/meu-dia");
        }
      } catch {
        // silencioso - se algo falhar, fica no dashboard padrao
      }
    })();
  }, [pathname, router]);

  return null;
}
