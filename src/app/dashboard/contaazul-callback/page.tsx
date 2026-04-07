"use client";
import { useEffect, useState } from "react";

export default function ContaAzulCallback() {
  const [status, setStatus] = useState<"loading"|"success"|"error">("loading");
  const [msg, setMsg] = useState("Processando autorização...");

  useEffect(() => {
    const processCallback = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const error = params.get("error");

      if (error) {
        setStatus("error");
        setMsg(`Erro na autorização: ${error}`);
        return;
      }

      if (!code) {
        setStatus("error");
        setMsg("Código de autorização não recebido.");
        return;
      }

      // Get credentials from sessionStorage
      let creds: any = {};
      try {
        const stored = sessionStorage.getItem("ca_creds");
        if (stored) creds = JSON.parse(stored);
      } catch {}

      if (!creds.client_id || !creds.client_secret) {
        setStatus("error");
        setMsg("Credenciais não encontradas. Volte para Dados e tente novamente.");
        return;
      }

      // Exchange code for token via our API
      try {
        const res = await fetch("/api/contaazul/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            client_id: creds.client_id,
            client_secret: creds.client_secret,
            redirect_uri: `${window.location.origin}/dashboard/contaazul-callback`,
          }),
        });
        const data = await res.json();

        if (data.access_token) {
          // Clean up
          sessionStorage.removeItem("ca_creds");
          // Redirect to dados with token
          window.location.href = `/dashboard/dados?ca_token=${data.access_token}`;
        } else {
          setStatus("error");
          setMsg(`Erro ao obter token: ${data.error || "Falha desconhecida"}`);
        }
      } catch (e: any) {
        setStatus("error");
        setMsg(`Erro: ${e.message}`);
      }
    };

    processCallback();
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#0C0C0A", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", maxWidth: 400 }}>
        {status === "loading" && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16, animation: "pulse 1.5s infinite" }}>🔗</div>
            <div style={{ fontSize: 16, color: "#E8C872", fontWeight: 600 }}>{msg}</div>
            <div style={{ fontSize: 12, color: "#6B6960", marginTop: 8 }}>Conectando ao ContaAzul...</div>
          </>
        )}
        {status === "error" && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
            <div style={{ fontSize: 16, color: "#F87171", fontWeight: 600 }}>{msg}</div>
            <a href="/dashboard/dados" style={{ display: "inline-block", marginTop: 16, padding: "10px 20px", borderRadius: 8, background: "#C6973F", color: "#0C0C0A", textDecoration: "none", fontWeight: 600, fontSize: 13 }}>Voltar para Dados</a>
          </>
        )}
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );
}
