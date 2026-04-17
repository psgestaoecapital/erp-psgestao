"use client";
import React, { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ImportadorUniversal from "@/components/ImportadorUniversal";

const BG = "#0C0C0A", GOL = "#E8C872", BD = "#2A2822", BG3 = "#1E1E1B", TX = "#F0ECE3", TXD = "#918C82";

function ImportarPageInner() {
  const searchParams = useSearchParams();
  const empresaParam = searchParams.get("empresa");
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCompanies();
  }, []);

  const loadCompanies = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: up } = await supabase.from("users").select("role").eq("id", user.id).single();
    let d: any[] = [];
    if (up?.role === "adm" || up?.role === "acesso_total") {
      const r = await supabase.from("companies").select("*").order("nome_fantasia");
      d = r.data || [];
    } else {
      const r = await supabase.from("user_companies").select("companies(*)").eq("user_id", user.id);
      d = (r.data || []).map((u: any) => u.companies).filter(Boolean);
    }
    setCompanies(d);
    const saved = empresaParam || (typeof window !== "undefined" ? localStorage.getItem("ps_empresa_sel") : "") || "";
    const match = d.find((c: any) => c.id === saved);
    setSelectedId(match ? match.id : d[0]?.id || "");
    setLoading(false);
  };

  if (loading) return <div style={{ minHeight: "100vh", background: BG, display: "flex", alignItems: "center", justifyContent: "center", color: GOL }}>⏳ Carregando...</div>;

  if (!selectedId) return <div style={{ minHeight: "100vh", background: BG, display: "flex", alignItems: "center", justifyContent: "center", color: TXD }}>Nenhuma empresa encontrada</div>;

  const ss: React.CSSProperties = { background: BG3, border: `1px solid ${BD}`, color: GOL, borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 600 };

  return (
    <div>
      {companies.length > 1 && (
        <div style={{ background: BG, padding: "12px 20px 0", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: TXD }}>Empresa:</span>
          <select value={selectedId} onChange={e => { setSelectedId(e.target.value); if (typeof window !== "undefined") localStorage.setItem("ps_empresa_sel", e.target.value); }} style={ss}>
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.nome_fantasia || c.razao_social}</option>
            ))}
          </select>
        </div>
      )}
      <ImportadorUniversal
        companyId={selectedId}
        onImportComplete={(count) => console.log(`${count} registros importados`)}
      />
    </div>
  );
}

export default function ImportarPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#918C82" }}>Carregando...</div>}>
      <ImportarPageInner />
    </Suspense>
  );
}
