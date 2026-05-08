"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Loader2, ArrowRight } from "lucide-react";

export function WealthClienteView() {
  const [loading, setLoading] = useState(true);
  const [meuClienteId, setMeuClienteId] = useState<string | null>(null);
  const [meuNome, setMeuNome] = useState<string>("");

  useEffect(() => {
    const load = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          setLoading(false);
          return;
        }
        const { data } = await supabase
          .from("wealth_clients")
          .select("id, nome")
          .eq("email", user.email)
          .limit(1)
          .single();

        if (data) {
          setMeuClienteId(data.id);
          setMeuNome(data.nome);
        }
      } catch (e) {
        console.error("WealthClienteView error:", e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#C8941A" }} />
      </div>
    );
  }

  if (!meuClienteId) {
    return (
      <div
        className="rounded-lg border p-12 text-center"
        style={{ borderColor: "rgba(61, 35, 20, 0.1)", backgroundColor: "#FAF7F2" }}
      >
        <p style={{ color: "rgba(61, 35, 20, 0.7)" }}>
          Você ainda não está cadastrado como cliente Wealth. Fale com seu consultor.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div
        className="rounded-lg border p-6"
        style={{ borderColor: "rgba(61, 35, 20, 0.1)", backgroundColor: "#FAF7F2" }}
      >
        <h2 className="text-2xl font-bold" style={{ color: "#3D2314" }}>
          Olá, {meuNome.split(" ")[0]}
        </h2>
        <p className="mt-1" style={{ color: "rgba(61, 35, 20, 0.7)" }}>
          Acompanhe sua carteira de investimentos consolidada.
        </p>
      </div>

      <Link
        href={`/dashboard/wealth/clientes/${meuClienteId}`}
        className="block rounded-lg border-2 p-8 transition group hover:opacity-90"
        style={{
          borderColor: "rgba(200, 148, 26, 0.3)",
          backgroundColor: "rgba(200, 148, 26, 0.05)",
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-semibold" style={{ color: "#3D2314" }}>
              Acessar minha carteira
            </p>
            <p className="text-sm mt-1" style={{ color: "rgba(61, 35, 20, 0.7)" }}>
              Patrimônio, conexões Open Finance, histórico de movimentações
            </p>
          </div>
          <ArrowRight
            className="h-6 w-6 group-hover:translate-x-1 transition-transform"
            style={{ color: "#C8941A" }}
          />
        </div>
      </Link>
    </div>
  );
}
