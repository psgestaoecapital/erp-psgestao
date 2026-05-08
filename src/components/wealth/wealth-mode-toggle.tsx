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
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setLoading(false);
          return;
        }

        const [{ data: cons }, { data: cli }] = await Promise.all([
          supabase
            .from("wealth_consultores")
            .select("id")
            .eq("user_id", user.id)
            .eq("ativo", true),
          supabase
            .from("wealth_clients")
            .select("id")
            .eq("email", user.email)
            .limit(1),
        ]);

        const hasCons = (cons?.length ?? 0) > 0;
        const hasCli = (cli?.length ?? 0) > 0;
        setIsConsultor(hasCons);
        setIsCliente(hasCli);

        if (hasCons && !hasCli) setMode("consultor");
        else if (!hasCons && hasCli) setMode("cliente");
      } catch (e) {
        console.error("checkRoles error:", e);
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
