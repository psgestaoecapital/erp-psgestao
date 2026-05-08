"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Loader2, Construction, FileText } from "lucide-react";

export function WealthClienteView() {
  const [loading, setLoading] = useState(true);
  const [meuClienteId, setMeuClienteId] = useState<string | null>(null);
  const [meuNome, setMeuNome] = useState<string>("");

  useEffect(() => {
    const load = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
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
        <FileText
          className="h-12 w-12 mx-auto mb-3"
          style={{ color: "rgba(61, 35, 20, 0.3)" }}
        />
        <p style={{ color: "rgba(61, 35, 20, 0.7)" }}>
          Você ainda não está cadastrado como cliente Wealth.
        </p>
        <p className="text-sm mt-1" style={{ color: "rgba(61, 35, 20, 0.5)" }}>
          Fale com seu consultor.
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

      <div
        className="rounded-lg border-2 border-dashed p-12 text-center"
        style={{
          borderColor: "rgba(200, 148, 26, 0.3)",
          backgroundColor: "rgba(200, 148, 26, 0.05)",
        }}
      >
        <Construction
          className="h-12 w-12 mx-auto mb-3"
          style={{ color: "#C8941A" }}
        />
        <p className="font-medium" style={{ color: "#3D2314" }}>
          Detalhe da sua carteira em construção
        </p>
        <p
          className="text-sm mt-2 max-w-md mx-auto"
          style={{ color: "rgba(61, 35, 20, 0.6)" }}
        >
          Em breve você poderá conectar suas contas, fazer upload de extratos OFX e acompanhar
          a evolução do seu patrimônio.
        </p>
      </div>
    </div>
  );
}
