"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const router = useRouter();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setError("E-mail ou senha incorretos"); setLoading(false); return; }
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) { setError(error.message); setLoading(false); return; }
    }

    router.push("/dashboard");
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0F0F0D", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16, margin: "0 auto 16px",
            background: "linear-gradient(135deg, #C6973F 0%, #E8C872 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 28, fontWeight: 800, color: "#0F0F0D"
          }}>PS</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#E8C872", letterSpacing: 0.5 }}>
            PS Gestão e Capital
          </h1>
          <p style={{ fontSize: 12, color: "#6B6960", marginTop: 4, letterSpacing: 1, textTransform: "uppercase" }}>
            ERP Inteligente com IA
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: "#1C1B18", borderRadius: 16, padding: 32,
          border: "0.5px solid #3D3A30", boxShadow: "0 8px 32px rgba(0,0,0,0.3)"
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "#E8E5DC", marginBottom: 24, textAlign: "center" }}>
            {mode === "login" ? "Acessar o Sistema" : "Criar Conta"}
          </h2>

          <form onSubmit={handleAuth}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "#A8A498", marginBottom: 6, display: "block" }}>E-mail</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com" required />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 12, color: "#A8A498", marginBottom: 6, display: "block" }}>Senha</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required minLength={6} />
            </div>

            {error && (
              <div style={{ background: "#EF444420", border: "1px solid #EF444440", borderRadius: 8,
                padding: "8px 12px", marginBottom: 16, fontSize: 12, color: "#EF4444" }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} style={{
              width: "100%", padding: 14, border: "none", borderRadius: 10,
              background: loading ? "#3D3A30" : "linear-gradient(135deg, #C6973F 0%, #E8C872 100%)",
              color: "#0F0F0D", fontSize: 15, fontWeight: 700, letterSpacing: 0.5
            }}>
              {loading ? "Aguarde..." : mode === "login" ? "◆ Entrar" : "◆ Criar Conta"}
            </button>
          </form>

          <div style={{ textAlign: "center", marginTop: 20 }}>
            <button onClick={() => setMode(mode === "login" ? "signup" : "login")}
              style={{ background: "none", border: "none", color: "#C6973F", fontSize: 13 }}>
              {mode === "login" ? "Não tem conta? Criar agora" : "Já tem conta? Fazer login"}
            </button>
          </div>
        </div>

        <p style={{ textAlign: "center", fontSize: 10, color: "#6B6960", marginTop: 24 }}>
          PS Gestão e Capital — Assessoria Empresarial e BPO Financeiro
        </p>
      </div>
    </div>
  );
}
