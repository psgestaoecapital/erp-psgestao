"use client";

import { useEffect, useState } from "react";
import { useWealthMode } from "@/lib/stores/wealth-mode-store";
import { supabase } from "@/lib/supabase";
import { Briefcase, User, Loader2 } from "lucide-react";

export function WealthModeToggle() {
  const { mode, setMode } = useWealthMode();
  const [isConsultor, setIsConsultor] = useState(false);
  const [isCliente, setIsCliente] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkRoles = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          console.warn("[WealthModeToggle] no auth user");
          setLoading(false);
          return;
        }

        console.log("[WealthModeToggle] auth user:", {
          id: user.id,
          email: user.email,
        });

        const [consResp, cliResp] = await Promise.all([
          supabase
            .from("wealth_consultores")
            .select("id")
            .eq("user_id", user.id)
            .eq("ativo", true),
          // ilike = case-insensitive; sem .single()/.maybeSingle() para tolerar 0 rows sem 406
          user.email
            ? supabase
                .from("wealth_clients")
                .select("id")
                .ilike("email", user.email)
                .limit(1)
            : Promise.resolve({ data: [] as { id: string }[], error: null }),
        ]);

        if (consResp.error) {
          console.error("[WealthModeToggle] consultor query error:", consResp.error);
        }
        if ("error" in cliResp && cliResp.error) {
          console.error("[WealthModeToggle] cliente query error:", cliResp.error);
        }

        const consData = consResp.data ?? [];
        const cliData = (cliResp.data ?? []) as { id: string }[];
        const hasCons = consData.length > 0;
        const hasCli = cliData.length > 0;

        console.log("[WealthModeToggle] roles:", {
          hasCons,
          hasCli,
          consRows: consData.length,
          cliRows: cliData.length,
        });

        // Sempre setar (defensivo - garante render mesmo se query retornou null)
        setIsConsultor(hasCons);
        setIsCliente(hasCli);

        // Auto-set mode somente quando o estado persistido nao corresponde a um papel valido
        if (hasCons && !hasCli) setMode("consultor");
        else if (!hasCons && hasCli) setMode("cliente");
        // Se ambos: mantem o modo persistido (zustand) ou default 'consultor'
      } catch (e) {
        console.error("[WealthModeToggle] checkRoles exception:", e);
      } finally {
        setLoading(false);
      }
    };
    checkRoles();
  }, [setMode]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm" style={{ color: "rgba(61, 35, 20, 0.55)" }}>
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando perfil...
      </div>
    );
  }

  if (!isConsultor && !isCliente) return null;
  if ((isConsultor && !isCliente) || (!isConsultor && isCliente)) return null;

  const baseBtn =
    "inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition";

  return (
    <div
      className="inline-flex items-center rounded-lg border p-1 shadow-sm"
      style={{ borderColor: "rgba(61, 35, 20, 0.2)", backgroundColor: "#FAF7F2" }}
    >
      <button
        onClick={() => setMode("consultor")}
        className={baseBtn}
        style={
          mode === "consultor"
            ? { backgroundColor: "#3D2314", color: "#FAF7F2" }
            : { color: "#3D2314", backgroundColor: "transparent" }
        }
      >
        <Briefcase className="h-4 w-4" />
        Modo Consultor
      </button>
      <button
        onClick={() => setMode("cliente")}
        className={baseBtn}
        style={
          mode === "cliente"
            ? { backgroundColor: "#3D2314", color: "#FAF7F2" }
            : { color: "#3D2314", backgroundColor: "transparent" }
        }
      >
        <User className="h-4 w-4" />
        Modo Cliente
      </button>
    </div>
  );
}
