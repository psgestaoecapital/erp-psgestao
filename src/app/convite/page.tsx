"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function ConviteForm() {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [invite, setInvite] = useState<any>(null);
  const [invalid, setInvalid] = useState(false);
  const router = useRouter();
  const params = useSearchParams();
  const code = params.get("code");

  useEffect(() => {
    if (!code) { setInvalid(true); setLoading(false); return; }
    
    supabase.from("invites")
      .select("*, companies(razao_social, nome_fantasia), organizations(name)")
      .eq("invite_code", code)
      .eq("is_used", false)
      .single()
      .then(({ data, error }) => {
        if (error || !data) { setInvalid(true); setLoading(false); return; }
        if (data.expires_at && new Date(data.expires_at) < new Date()) { setInvalid(true); setLoading(false); return; }
        setInvite(data);
        if (data.email) setEmail(data.email);
        setLoading(false);
      });
  }, [code]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
    if (authError) { setError(authError.message); setLoading(false); return; }

    if (authData.user) {
      // Mark invite as used
      await supabase.from("invites").update({ 
        is_used: true, 
        used_by: authData.user.id, 
        used_at: new Date().toISOString() 
      }).eq("invite_code", code);

      // Create user profile
      await supabase.from("users").insert({
        id: authData.user.id,
        org_id: invite.org_id,
        full_name: nome,
        email: email,
        role: invite.role || "geral",
      });
    }

    setSuccess(true);
    setLoading(false);
    setTimeout(() => router.push("/"), 3000);
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0F0F0D" }}>
      <div style={{ color: "#A8A498", fontSize: 13 }}>Verificando convite...</div>
    </div>
  );

  if (invalid) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0F0F0D", padding: 20 }}>
      <div style={{ textAlign: "center", maxWidth: 400 }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, margin: "0 auto 16px",
          background: "linear-gradient(135deg, #C6973F 0%, #E8C872 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 28, fontWeight: 800, color: "#0F0F0D" }}>PS</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#E8C872" }}>Convite Inválido</h1>
        <p style={{ fontSize: 13, color: "#A8A498", marginTop: 12, lineHeight: 1.6 }}>
          Este link de convite não é válido, já foi utilizado ou expirou.
          Entre em contato com a PS Gestão e Capital para solicitar um novo convite.
        </p>
        <button onClick={() => router.push("/")} style={{
          marginTop: 20, padding: "10px 24px", border: "none", borderRadius: 8,
          background: "linear-gradient(135deg, #C6973F 0%, #E8C872 100%)",
          color: "#0F0F0D", fontSize: 13, fontWeight: 600, cursor: "pointer"
        }}>Ir para o Login</button>
      </div>
    </div>
  );

  if (success) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0F0F0D", padding: 20 }}>
      <div style={{ textAlign: "center", maxWidth: 400 }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, margin: "0 auto 16px",
          background: "linear-gradient(135deg, #22C55E 0%, #10B981 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 28, color: "white" }}>✓</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#22C55E" }}>Conta Criada!</h1>
        <p style={{ fontSize: 13, color: "#A8A498", marginTop: 12 }}>
          Sua conta foi criada com sucesso. Redirecionando para o login...
        </p>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0F0F0D", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, margin: "0 auto 16px",
            background: "linear-gradient(135deg, #C6973F 0%, #E8C872 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 28, fontWeight: 800, color: "#0F0F0D" }}>PS</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#E8C872" }}>PS Gestão e Capital</h1>
          <p style={{ fontSize: 12, color: "#6B6960", marginTop: 4, letterSpacing: 1, textTransform: "uppercase" }}>Convite para acessar o sistema</p>
        </div>

        <div style={{ background: "#1C1B18", borderRadius: 16, padding: 32, border: "0.5px solid #3D3A30" }}>
          {invite?.companies && (
            <div style={{ background: "#2A2822", borderRadius: 8, padding: 12, marginBottom: 20, textAlign: "center", border: "0.5px solid #3D3A30" }}>
              <div style={{ fontSize: 10, color: "#6B6960", textTransform: "uppercase", letterSpacing: 0.5 }}>Empresa</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#E8C872", marginTop: 4 }}>
                {invite.companies.nome_fantasia || invite.companies.razao_social}
              </div>
              <div style={{ fontSize: 10, color: "#A8A498", marginTop: 2 }}>
                Perfil: {invite.role === "adm" ? "Administrador" : invite.role === "financeiro" ? "Financeiro" : invite.role === "conselheiro" ? "Conselheiro" : "Visualização"}
              </div>
            </div>
          )}

          <h2 style={{ fontSize: 16, fontWeight: 600, color: "#E8E5DC", marginBottom: 20, textAlign: "center" }}>Criar sua Conta</h2>

          <form onSubmit={handleRegister}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "#A8A498", marginBottom: 6, display: "block" }}>Seu nome completo</label>
              <input type="text" value={nome} onChange={e => setNome(e.target.value)} placeholder="João da Silva" required
                style={{ background: "#2A2822", border: "1px solid #3D3A30", color: "#E8E5DC", borderRadius: 8, padding: "10px 14px", fontSize: 14, width: "100%" }} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "#A8A498", marginBottom: 6, display: "block" }}>E-mail</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" required
                readOnly={!!invite?.email}
                style={{ background: invite?.email ? "#1C1B18" : "#2A2822", border: "1px solid #3D3A30", color: "#E8E5DC", borderRadius: 8, padding: "10px 14px", fontSize: 14, width: "100%" }} />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 12, color: "#A8A498", marginBottom: 6, display: "block" }}>Crie uma senha (mínimo 6 caracteres)</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required minLength={6}
                style={{ background: "#2A2822", border: "1px solid #3D3A30", color: "#E8E5DC", borderRadius: 8, padding: "10px 14px", fontSize: 14, width: "100%" }} />
            </div>

            {error && (
              <div style={{ background: "#EF444420", border: "1px solid #EF444440", borderRadius: 8, padding: "8px 12px", marginBottom: 16, fontSize: 12, color: "#EF4444" }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} style={{
              width: "100%", padding: 14, border: "none", borderRadius: 10,
              background: loading ? "#3D3A30" : "linear-gradient(135deg, #C6973F 0%, #E8C872 100%)",
              color: "#0F0F0D", fontSize: 15, fontWeight: 700
            }}>
              {loading ? "Criando conta..." : "◆ Criar Minha Conta"}
            </button>
          </form>
        </div>

        <p style={{ textAlign: "center", fontSize: 10, color: "#6B6960", marginTop: 24 }}>
          PS Gestão e Capital — Assessoria Empresarial e BPO Financeiro
        </p>
      </div>
    </div>
  );
}

export default function ConvitePage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0F0F0D" }}>
      <div style={{ color: "#A8A498" }}>Carregando...</div>
    </div>}>
      <ConviteForm />
    </Suspense>
  );
}
