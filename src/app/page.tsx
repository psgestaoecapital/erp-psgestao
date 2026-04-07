"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [resetSent, setResetSent] = useState(false);
  const router = useRouter();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (mode === "reset") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + "/dashboard",
      });
      if (error) { setError(error.message); setLoading(false); return; }
      setResetSent(true);
      setLoading(false);
      return;
    }

    if (mode === "signup") {
      if (password !== password2) { setError("As senhas não coincidem. Digite novamente."); setLoading(false); return; }
      if (password.length < 6) { setError("A senha deve ter no mínimo 6 caracteres."); setLoading(false); return; }
    }

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
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "radial-gradient(ellipse at 50% 0%, #1a1510 0%, #0C0C0A 60%)", padding: 20, position: "relative", overflow: "hidden" }}>
      {/* Background glow */}
      <div style={{ position: "absolute", top: "-20%", left: "50%", transform: "translateX(-50%)", width: "600px", height: "400px", background: "radial-gradient(ellipse, rgba(198,151,63,0.06) 0%, transparent 70%)", pointerEvents: "none" }}/>
      
      <div style={{ width: "100%", maxWidth: 400, position: "relative", zIndex: 1 }}>
        
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <img src="/images/logo-login.png" alt="PS Gestão e Capital" style={{
            display: "block", margin: "0 auto 20px", maxWidth: 200, height: "auto",
            filter: "drop-shadow(0 8px 24px rgba(197,165,90,0.25))"
          }}/>
          <p style={{ fontSize: 11, color: "#918C82", letterSpacing: 3, textTransform: "uppercase", fontWeight: 500 }}>
            Consultor Digital
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: "rgba(22,22,20,0.9)", borderRadius: 20, padding: "36px 32px",
          border: "1px solid rgba(42,40,34,0.8)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(198,151,63,0.05)",
          backdropFilter: "blur(20px)"
        }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: "#F0ECE3", marginBottom: 28, textAlign: "center", letterSpacing: 0.3 }}>
            {mode === "login" ? "Acessar o Sistema" : mode === "signup" ? "Criar Conta" : "Recuperar Senha"}
          </h2>

          {mode === "reset" && resetSent ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ background: "#22C55E20", border: "1px solid #22C55E40", borderRadius: 8,
                padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#22C55E" }}>
                Enviamos um link de recuperação para <strong>{email}</strong>. Verifique sua caixa de entrada e spam.
              </div>
              <button onClick={() => { setMode("login"); setResetSent(false); setError(""); }}
                style={{ background: "none", border: "none", color: "#C6973F", fontSize: 13 }}>
                Voltar para o login
              </button>
            </div>
          ) : (
            <form onSubmit={handleAuth}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: "#A8A498", marginBottom: 6, display: "block" }}>E-mail</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="seu@email.com" required />
              </div>

              {mode !== "reset" && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, color: "#A8A498", marginBottom: 6, display: "block" }}>Senha</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••" required minLength={6} />
                </div>
              )}

              {mode === "signup" && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, color: "#A8A498", marginBottom: 6, display: "block" }}>Confirme sua senha</label>
                  <input type="password" value={password2} onChange={e => setPassword2(e.target.value)}
                    placeholder="••••••••" required minLength={6}
                    style={{ borderColor: password2 && password !== password2 ? "#EF4444" : undefined }} />
                  {password2 && password !== password2 && (
                    <div style={{ fontSize: 10, color: "#EF4444", marginTop: 4 }}>As senhas não coincidem</div>
                  )}
                  {password2 && password === password2 && password.length >= 6 && (
                    <div style={{ fontSize: 10, color: "#22C55E", marginTop: 4 }}>✓ Senhas coincidem</div>
                  )}
                </div>
              )}

              {mode === "login" && (
                <div style={{ textAlign: "right", marginBottom: 16 }}>
                  <button type="button" onClick={() => { setMode("reset"); setError(""); }}
                    style={{ background: "none", border: "none", color: "#A8A498", fontSize: 11 }}>
                    Esqueci minha senha
                  </button>
                </div>
              )}

              {mode !== "login" && mode !== "reset" && <div style={{ marginBottom: 12 }} />}

              {error && (
                <div style={{ background: "#EF444420", border: "1px solid #EF444440", borderRadius: 8,
                  padding: "8px 12px", marginBottom: 16, fontSize: 12, color: "#EF4444" }}>
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} style={{
                width: "100%", padding: 14, border: "none", borderRadius: 12,
                background: loading ? "#3D3A30" : "linear-gradient(135deg, #8B6914 0%, #C6973F 40%, #E8C872 100%)",
                color: "#0C0C0A", fontSize: 13, fontWeight: 700, letterSpacing: 1,
                boxShadow: loading ? "none" : "0 4px 16px rgba(198,151,63,0.3)",
                transition: "all 0.2s"
              }}>
                {loading ? "Aguarde..." : mode === "login" ? "Entrar" : mode === "signup" ? "Criar Conta" : "Enviar Link"}
              </button>
            </form>
          )}

          <div style={{ textAlign: "center", marginTop: 20 }}>
            {mode === "reset" && !resetSent ? (
              <button onClick={() => { setMode("login"); setError(""); }}
                style={{ background: "none", border: "none", color: "#C6973F", fontSize: 13 }}>
                Voltar para o login
              </button>
            ) : mode !== "reset" && (
              <div style={{ fontSize: 10, color: "#918C82", marginTop: 8, letterSpacing: 0.5 }}>
                Acesso por convite · PS Gestão e Capital
              </div>
            )}
          </div>
        </div>

        <p style={{ textAlign: "center", fontSize: 10, color: "#4A483F", marginTop: 28, letterSpacing: 0.5 }}>
          Assessoria Empresarial · BPO Financeiro · ERP com IA
        </p>
      </div>
    </div>
  );
}
