"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG2="#1C1B18",BG3="#2A2822",G="#22C55E",R="#EF4444",
    BD="#3D3A30",TX="#E8E5DC",TXM="#A8A498",TXD="#6B6960";

export default function AdminPage() {
  const [empresas, setEmpresas] = useState<any[]>([]);
  const [convites, setConvites] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<string>("");
  const [inviteRole, setInviteRole] = useState("geral");
  const [inviteEmail, setInviteEmail] = useState("");
  const [generatedLink, setGeneratedLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [newEmpresa, setNewEmpresa] = useState({ razao_social: "", nome_fantasia: "", cnpj: "", cidade_estado: "" });
  const [msg, setMsg] = useState("");

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    const { data: emp } = await supabase.from("companies").select("*").order("created_at", { ascending: false });
    if (emp) setEmpresas(emp);
    const { data: inv } = await supabase.from("invites").select("*, companies(nome_fantasia, razao_social)").order("created_at", { ascending: false }).limit(20);
    if (inv) setConvites(inv);
  };

  const criarEmpresa = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Get or create org
    let { data: userProfile } = await supabase.from("users").select("org_id").eq("id", user.id).single();
    let orgId = userProfile?.org_id;

    if (!orgId) {
      const { data: org } = await supabase.from("organizations").insert({
        name: "PS Gestão e Capital",
        slug: "psgestao-" + Date.now(),
      }).select().single();
      if (org) {
        orgId = org.id;
        await supabase.from("users").upsert({
          id: user.id, org_id: orgId, full_name: "Administrador", email: user.email!, role: "adm"
        });
      }
    }

    const { error } = await supabase.from("companies").insert({
      ...newEmpresa,
      org_id: orgId,
    });

    if (error) { setMsg("Erro: " + error.message); return; }
    setMsg("Empresa cadastrada!");
    setNewEmpresa({ razao_social: "", nome_fantasia: "", cnpj: "", cidade_estado: "" });
    setShowForm(false);
    loadData();
  };

  const gerarConvite = async () => {
    if (!selectedCompany) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    let { data: userProfile } = await supabase.from("users").select("org_id").eq("id", user.id).single();
    const code = "conv_" + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);

    const { error } = await supabase.from("invites").insert({
      org_id: userProfile?.org_id,
      company_id: selectedCompany,
      email: inviteEmail || null,
      role: inviteRole,
      invite_code: code,
      created_by: user.id,
    });

    if (error) { setMsg("Erro: " + error.message); return; }

    const link = window.location.origin + "/convite?code=" + code;
    setGeneratedLink(link);
    setCopied(false);
    loadData();
  };

  const copyLink = () => {
    navigator.clipboard.writeText(generatedLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      
      {/* Title */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 3, height: 16, background: GO, borderRadius: 2 }} />
            <span style={{ fontSize: 18, fontWeight: 700, color: TX }}>Painel do Administrador</span>
          </div>
          <div style={{ fontSize: 11, color: TXD, marginTop: 4, marginLeft: 11 }}>Gerenciar empresas e convites de acesso</div>
        </div>
        <a href="/dashboard" style={{ fontSize: 11, color: GO, textDecoration: "none" }}>← Voltar ao Dashboard</a>
      </div>

      {msg && (
        <div style={{ background: msg.includes("Erro") ? R+"20" : G+"20", border: `1px solid ${msg.includes("Erro") ? R : G}40`, borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: msg.includes("Erro") ? R : G }}>
          {msg}
          <button onClick={() => setMsg("")} style={{ float: "right", background: "none", border: "none", color: TXM, cursor: "pointer" }}>✕</button>
        </div>
      )}

      {/* Empresas */}
      <div style={{ background: BG2, borderRadius: 12, padding: 16, marginBottom: 16, border: `0.5px solid ${BD}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: GOL }}>Empresas Cadastradas ({empresas.length})</div>
          <button onClick={() => setShowForm(!showForm)} style={{
            padding: "8px 16px", borderRadius: 8, border: "none",
            background: `linear-gradient(135deg, ${GO} 0%, ${GOL} 100%)`,
            color: "#0F0F0D", fontSize: 12, fontWeight: 600
          }}>+ Nova Empresa</button>
        </div>

        {showForm && (
          <form onSubmit={criarEmpresa} style={{ background: BG3, borderRadius: 8, padding: 16, marginBottom: 12, border: `0.5px solid ${BD}` }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: TXM, display: "block", marginBottom: 4 }}>Razão Social *</label>
                <input value={newEmpresa.razao_social} onChange={e => setNewEmpresa({...newEmpresa, razao_social: e.target.value})} required
                  style={{ background: BG2, border: `1px solid ${BD}`, color: TX, borderRadius: 6, padding: "8px 10px", fontSize: 12, width: "100%" }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: TXM, display: "block", marginBottom: 4 }}>Nome Fantasia</label>
                <input value={newEmpresa.nome_fantasia} onChange={e => setNewEmpresa({...newEmpresa, nome_fantasia: e.target.value})}
                  style={{ background: BG2, border: `1px solid ${BD}`, color: TX, borderRadius: 6, padding: "8px 10px", fontSize: 12, width: "100%" }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: TXM, display: "block", marginBottom: 4 }}>CNPJ</label>
                <input value={newEmpresa.cnpj} onChange={e => setNewEmpresa({...newEmpresa, cnpj: e.target.value})}
                  style={{ background: BG2, border: `1px solid ${BD}`, color: TX, borderRadius: 6, padding: "8px 10px", fontSize: 12, width: "100%" }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: TXM, display: "block", marginBottom: 4 }}>Cidade/Estado</label>
                <input value={newEmpresa.cidade_estado} onChange={e => setNewEmpresa({...newEmpresa, cidade_estado: e.target.value})}
                  style={{ background: BG2, border: `1px solid ${BD}`, color: TX, borderRadius: 6, padding: "8px 10px", fontSize: 12, width: "100%" }} />
              </div>
            </div>
            <button type="submit" style={{ marginTop: 12, padding: "10px 24px", border: "none", borderRadius: 8, background: GO, color: "#0F0F0D", fontSize: 12, fontWeight: 600 }}>
              Cadastrar Empresa
            </button>
          </form>
        )}

        {empresas.length === 0 ? (
          <div style={{ textAlign: "center", padding: 20, color: TXD, fontSize: 12 }}>Nenhuma empresa cadastrada ainda. Clique em "+ Nova Empresa" para começar.</div>
        ) : (
          empresas.map((emp, i) => (
            <div key={i} style={{ background: BG3, borderRadius: 8, padding: "10px 14px", marginBottom: 6, border: `0.5px solid ${BD}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: TX }}>{emp.nome_fantasia || emp.razao_social}</div>
                <div style={{ fontSize: 10, color: TXD }}>{emp.cnpj || "Sem CNPJ"} | {emp.cidade_estado || "—"}</div>
              </div>
              <button onClick={() => { setSelectedCompany(emp.id); setShowInvite(true); setGeneratedLink(""); }}
                style={{ padding: "6px 12px", borderRadius: 6, border: `0.5px solid ${GO}`, background: "transparent", color: GO, fontSize: 11, fontWeight: 500 }}>
                Gerar Convite
              </button>
            </div>
          ))
        )}
      </div>

      {/* Gerar Convite */}
      {showInvite && (
        <div style={{ background: BG2, borderRadius: 12, padding: 16, marginBottom: 16, border: `1px solid ${GO}40` }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: GOL, marginBottom: 12 }}>Gerar Link de Convite</div>
          
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: TXM, display: "block", marginBottom: 4 }}>Perfil de acesso</label>
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                style={{ background: BG3, border: `1px solid ${BD}`, color: TX, borderRadius: 6, padding: "8px 10px", fontSize: 12, width: "100%" }}>
                <option value="adm">Administrador (acesso total)</option>
                <option value="financeiro">Financeiro (dados financeiros)</option>
                <option value="conselheiro">Conselheiro (visualização + relatórios)</option>
                <option value="geral">Visualização (somente leitura)</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: TXM, display: "block", marginBottom: 4 }}>E-mail do convidado (opcional)</label>
              <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="email@empresa.com"
                style={{ background: BG3, border: `1px solid ${BD}`, color: TX, borderRadius: 6, padding: "8px 10px", fontSize: 12, width: "100%" }} />
            </div>
          </div>

          <button onClick={gerarConvite} style={{
            padding: "10px 24px", border: "none", borderRadius: 8,
            background: `linear-gradient(135deg, ${GO} 0%, ${GOL} 100%)`,
            color: "#0F0F0D", fontSize: 13, fontWeight: 600
          }}>◆ Gerar Link de Convite</button>

          {generatedLink && (
            <div style={{ marginTop: 16, background: BG3, borderRadius: 8, padding: 14, border: `0.5px solid ${G}40` }}>
              <div style={{ fontSize: 11, color: G, fontWeight: 600, marginBottom: 8 }}>✓ Link gerado! Envie para o cliente:</div>
              <div style={{ background: BG2, borderRadius: 6, padding: "10px 12px", fontSize: 11, color: TX, wordBreak: "break-all", marginBottom: 10, border: `0.5px solid ${BD}` }}>
                {generatedLink}
              </div>
              <button onClick={copyLink} style={{
                padding: "8px 20px", border: "none", borderRadius: 6,
                background: copied ? G : GO, color: "#0F0F0D", fontSize: 12, fontWeight: 600
              }}>
                {copied ? "✓ Copiado!" : "Copiar Link"}
              </button>
              <span style={{ fontSize: 10, color: TXD, marginLeft: 12 }}>Válido por 30 dias</span>
            </div>
          )}
        </div>
      )}

      {/* Convites recentes */}
      <div style={{ background: BG2, borderRadius: 12, padding: 16, border: `0.5px solid ${BD}` }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: GOL, marginBottom: 12 }}>Convites Recentes</div>
        {convites.length === 0 ? (
          <div style={{ textAlign: "center", padding: 20, color: TXD, fontSize: 12 }}>Nenhum convite gerado ainda.</div>
        ) : (
          convites.map((inv, i) => (
            <div key={i} style={{ background: BG3, borderRadius: 8, padding: "8px 12px", marginBottom: 4, border: `0.5px solid ${BD}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 11, color: TX }}>{inv.companies?.nome_fantasia || inv.companies?.razao_social || "—"}</div>
                <div style={{ fontSize: 9, color: TXD }}>{inv.email || "Sem e-mail"} | {inv.role} | {new Date(inv.created_at).toLocaleDateString("pt-BR")}</div>
              </div>
              <span style={{
                fontSize: 9, padding: "2px 8px", borderRadius: 10, fontWeight: 600,
                background: inv.is_used ? G + "20" : GO + "20",
                color: inv.is_used ? G : GO
              }}>{inv.is_used ? "Usado" : "Pendente"}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
