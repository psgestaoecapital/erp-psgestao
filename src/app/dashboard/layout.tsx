"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data?.user) { router.push("/"); return; }
      setUser(data.user);
      setLoading(false);
    }).catch(() => {
      router.push("/");
    });
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0F0F0D" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, margin: "0 auto 12px",
          background: "linear-gradient(135deg, #C6973F 0%, #E8C872 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20, fontWeight: 800, color: "#0F0F0D" }}>PS</div>
        <div style={{ color: "#A8A498", fontSize: 13 }}>Carregando...</div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0F0F0D" }}>
      <header style={{
        background: "linear-gradient(135deg, #0F0F0D 0%, #2A2822 100%)",
        padding: "12px 20px", borderBottom: "1px solid #3D3A30",
        display: "flex", justifyContent: "space-between", alignItems: "center"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: "linear-gradient(135deg, #C6973F 0%, #E8C872 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, fontWeight: 800, color: "#0F0F0D"
          }}>PS</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#E8C872" }}>PS Gestão e Capital</div>
            <div style={{ fontSize: 9, color: "#6B6960", letterSpacing: 1, textTransform: "uppercase" }}>ERP Inteligente</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a href="/dashboard/admin" style={{ fontSize: 11, color: "#C6973F", textDecoration: "none", padding: "6px 12px", borderRadius: 6, border: "0.5px solid #C6973F40" }}>Administrador</a>
          <span style={{ fontSize: 11, color: "#A8A498" }}>{user?.email}</span>
          <button onClick={handleLogout} style={{
            padding: "6px 14px", borderRadius: 6, border: "0.5px solid #3D3A30",
            background: "transparent", color: "#A8A498", fontSize: 11
          }}>Sair</button>
        </div>
      </header>
      {children}
    </div>
  );
}
