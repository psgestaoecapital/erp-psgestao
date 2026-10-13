"use client";
// Redefinição de senha (retorno do link de recovery do Supabase).
// O link type=recovery AUTENTICA e cria sessão (comportamento padrão do Supabase). Sem esta tela,
// o usuário caía logado no dashboard com a senha ANTIGA ainda válida — o reset não resetava nada.
// Aqui: detecta o retorno (evento PASSWORD_RECOVERY / sessão de recovery), EXIGE a nova senha antes
// de liberar, encerra as OUTRAS sessões e registra a troca na trilha do ERP.
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

const FLAG = "pw_recovery_pending";
const STARTED = "pw_recovery_started";
const TTL_MS = 15 * 60 * 1000; // sessão de recovery tem vida curta: 15 min sem concluir → expira

export default function NovaSenhaPage() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);   // há sessão para trocar a senha
  const [semLink, setSemLink] = useState(false);  // chegou aqui sem sessão/recovery válido, ou expirou
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(FLAG, "1");
      if (!sessionStorage.getItem(STARTED)) sessionStorage.setItem(STARTED, String(Date.now()));
    } catch { /* private mode */ }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setPronto(true);
    });
    // fallback: se em ~2.5s não houver sessão nem token de recovery na URL, o link é inválido/expirado
    const t = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) setPronto(true);
      else if (!/type=recovery|access_token=/.test(window.location.hash)) setSemLink(true);
    }, 2500);
    // vida curta: se largar a aba, a porta não fica aberta — expira e derruba a sessão de recovery
    let started = Date.now();
    try { started = Number(sessionStorage.getItem(STARTED)) || started; } catch { /* */ }
    const restante = Math.max(0, TTL_MS - (Date.now() - started));
    const exp = setTimeout(async () => {
      try { await supabase.auth.signOut(); } catch { /* */ }
      try { sessionStorage.removeItem(FLAG); sessionStorage.removeItem(STARTED); } catch { /* */ }
      setSemLink(true);
    }, restante);
    return () => { subscription.unsubscribe(); clearTimeout(t); clearTimeout(exp); };
  }, []);

  const submeter = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (senha.length < 8) { setError("A nova senha deve ter no mínimo 8 caracteres."); return; }
    if (senha !== senha2) { setError("As senhas não coincidem."); return; }
    setLoading(true);
    const { error: upErr } = await supabase.auth.updateUser({ password: senha });
    if (upErr) { setError(upErr.message || "Não foi possível trocar a senha. Peça um novo link."); setLoading(false); return; }
    // encerra as OUTRAS sessões (se alguém entrou pelo e-mail, cai fora); a atual segue com a nova senha
    try { await supabase.auth.signOut({ scope: "others" }); } catch { /* best-effort */ }
    // trilha no ERP (Pilar 2/LGPD)
    try { await supabase.rpc("fn_audit_senha_trocada", { p_via: "recovery", p_user_agent: navigator.userAgent }); } catch { /* best-effort */ }
    try { sessionStorage.removeItem(FLAG); sessionStorage.removeItem(STARTED); } catch { /* */ }
    setOk(true); setLoading(false);
    setTimeout(() => router.replace("/dashboard"), 1200);
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "12px 14px", borderRadius: 10, marginTop: 6,
    background: "rgba(12,12,10,0.6)", border: "1px solid rgba(42,40,34,0.9)", color: "#F0ECE3", fontSize: 14,
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "radial-gradient(ellipse at 50% 0%, #1a1510 0%, #0C0C0A 60%)", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <img src="/images/logo-login.png" alt="PS Gestão e Capital" style={{ display: "block", margin: "0 auto 16px", maxWidth: 180, height: "auto" }} />
          <p style={{ fontSize: 11, color: "#918C82", letterSpacing: 3, textTransform: "uppercase", fontWeight: 500 }}>Redefinir senha</p>
        </div>
        <div style={{ background: "rgba(22,22,20,0.9)", borderRadius: 20, padding: "32px 28px", border: "1px solid rgba(42,40,34,0.8)", boxShadow: "0 16px 48px rgba(0,0,0,0.5)" }}>
          {ok ? (
            <div style={{ textAlign: "center", color: "#22C55E", fontSize: 14 }}>
              ✓ Senha redefinida. As outras sessões foram encerradas. Redirecionando…
            </div>
          ) : semLink ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ background: "#EF444420", border: "1px solid #EF444440", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#EF4444" }}>
                Link inválido ou expirado. Volte ao login e peça um novo link de recuperação.
              </div>
              <button onClick={() => router.replace("/")} style={{ background: "none", border: "none", color: "#C6973F", fontSize: 13, cursor: "pointer" }}>Voltar para o login</button>
            </div>
          ) : (
            <form onSubmit={submeter}>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: "#F0ECE3", marginBottom: 8, textAlign: "center" }}>Defina sua nova senha para continuar</h2>
              <p style={{ fontSize: 12, color: "#A8A498", marginBottom: 20, textAlign: "center", lineHeight: 1.5 }}>Você clicou num link de redefinição de senha. Defina a nova senha para continuar — ao salvar, você será desconectado dos outros dispositivos.</p>
              <label style={{ fontSize: 12, color: "#A8A498" }}>Nova senha
                <input type="password" value={senha} onChange={e => setSenha(e.target.value)} placeholder="mínimo 8 caracteres" required minLength={8} style={inputStyle} disabled={!pronto} />
              </label>
              <label style={{ fontSize: 12, color: "#A8A498", display: "block", marginTop: 14 }}>Confirme a nova senha
                <input type="password" value={senha2} onChange={e => setSenha2(e.target.value)} placeholder="••••••••" required minLength={8}
                  style={{ ...inputStyle, borderColor: senha2 && senha !== senha2 ? "#EF4444" : "rgba(42,40,34,0.9)" }} disabled={!pronto} />
              </label>
              {senha2 && senha !== senha2 && <div style={{ fontSize: 10, color: "#EF4444", marginTop: 4 }}>As senhas não coincidem</div>}
              {error && <div style={{ background: "#EF444420", border: "1px solid #EF444440", borderRadius: 8, padding: "8px 12px", margin: "16px 0", fontSize: 12, color: "#EF4444" }}>{error}</div>}
              <button type="submit" disabled={loading || !pronto} style={{
                width: "100%", marginTop: 20, padding: 14, border: "none", borderRadius: 12,
                background: (loading || !pronto) ? "#3D3A30" : "linear-gradient(135deg, #8B6914 0%, #C6973F 40%, #E8C872 100%)",
                color: "#0C0C0A", fontSize: 13, fontWeight: 700, letterSpacing: 1, cursor: (loading || !pronto) ? "default" : "pointer",
              }}>
                {!pronto ? "Validando link…" : loading ? "Salvando…" : "Trocar senha e entrar"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
