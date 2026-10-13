"use client";
// Equipe PS (acesso a todas as empresas). Contexto 9a38849b. Só PS_ADMIN (a RLS de ps_equipe_acesso
// e o gate da página garantem). Lista, adiciona (por e-mail → user_id) e desativa via RPCs
// fn_equipe_ps_adicionar / fn_equipe_ps_remover (que sincronizam os vínculos e gravam audit_log).
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { ShieldCheck, UserPlus, Trash2 } from "lucide-react";

const GO = "var(--ps-gold,#C8941A)", BG = "var(--ps-bg,#FAF7F2)", BG2 = "var(--ps-bg2,#FFFFFF)", BG3 = "var(--ps-bg3,#F0ECE3)",
  BD = "var(--ps-border,#E0D8CC)", TX = "var(--ps-text,#3D2314)", TXM = "var(--ps-text-m,#6B5D4F)", TXD = "var(--ps-text-d,#9C8E80)",
  G = "#22C55E", R = "#EF4444";
const inp: CSSProperties = { padding: "8px 10px", borderRadius: 8, border: `1px solid ${BD}`, background: BG, color: TX };

type Membro = { user_id: string; papel: string; observacao: string | null; nome: string | null; email: string | null };

export default function EquipePsSection() {
  const [membros, setMembros] = useState<Membro[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("ps_equipe_acesso").select("user_id, papel, observacao").eq("ativo", true);
    if (error) { setMsg({ ok: false, t: error.message }); setLoading(false); return; }
    const rows = (data as { user_id: string; papel: string; observacao: string | null }[]) || [];
    const ids = rows.map((r) => r.user_id);
    let usersById: Record<string, { full_name: string | null; email: string | null }> = {};
    if (ids.length) {
      const { data: us } = await supabase.from("users").select("id, full_name, email").in("id", ids);
      for (const u of (us as { id: string; full_name: string | null; email: string | null }[]) || []) usersById[u.id] = u;
    }
    setMembros(rows.map((r) => ({ ...r, nome: usersById[r.user_id]?.full_name ?? null, email: usersById[r.user_id]?.email ?? null })));
    setLoading(false);
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t); }, [msg]);

  async function adicionar() {
    const e = email.trim().toLowerCase();
    if (!e) { setMsg({ ok: false, t: "Informe o e-mail do usuário." }); return; }
    setBusy(true); setMsg(null);
    // resolve o e-mail para user_id (só quem já tem login pode entrar na equipe)
    const { data: u } = await supabase.from("users").select("id").ilike("email", e).maybeSingle();
    if (!u?.id) { setBusy(false); setMsg({ ok: false, t: "Nenhum usuário com esse e-mail tem login ainda. Convide-o primeiro em Pessoas." }); return; }
    const { data, error } = await supabase.rpc("fn_equipe_ps_adicionar", { p_user_id: u.id, p_papel: "acesso_total" });
    setBusy(false);
    const j = data as { ok?: boolean; sync?: { inseridos?: number } } | null;
    if (error || !j?.ok) { setMsg({ ok: false, t: error?.message || "Falha ao adicionar." }); return; }
    setEmail(""); setMsg({ ok: true, t: `Adicionado à equipe PS · ${j.sync?.inseridos ?? 0} vínculos criados.` });
    await carregar();
  }
  async function remover(m: Membro) {
    if (!confirm(`Desativar ${m.nome || m.email} da equipe PS?\n\nSomem só os acessos criados automaticamente (equipe_ps). Acessos manuais e de empresas que a pessoa criou continuam.`)) return;
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("fn_equipe_ps_remover", { p_user_id: m.user_id });
    setBusy(false);
    const j = data as { ok?: boolean; sync?: { removidos?: number } } | null;
    if (error || !j?.ok) { setMsg({ ok: false, t: error?.message || "Falha ao desativar." }); return; }
    setMsg({ ok: true, t: `Desativado · ${j.sync?.removidos ?? 0} vínculos automáticos removidos.` });
    await carregar();
  }

  return (
    <div style={{ background: BG2, border: `1px solid ${BD}`, borderRadius: 12, padding: 14, marginBottom: 16 }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: TXM, fontWeight: 800, marginBottom: 8 }}>
        <ShieldCheck size={15} color={GO} /> Equipe PS (acesso a todas as empresas)
      </div>
      <div style={{ background: BG3, border: `1px solid ${BD}`, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: TX, marginBottom: 12 }}>
        Quem está aqui vê <b>todas as empresas</b>, exceto as de <b>Wealth</b> (consultoria de investimentos) e as de teste [BOT]. Empresas novas entram automaticamente.
      </div>

      {msg && <div style={{ background: msg.ok ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${msg.ok ? G : R}`, color: msg.ok ? "#166534" : R, padding: "7px 10px", borderRadius: 8, marginBottom: 10, fontSize: 12.5 }}>{msg.t}</div>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e-mail do usuário (já com login)" style={{ ...inp, minWidth: 260 }} />
        <button disabled={busy} onClick={() => void adicionar()}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: GO, color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
          <UserPlus size={15} /> Adicionar à equipe
        </button>
      </div>

      {loading ? <div style={{ color: TXD, fontSize: 12 }}>Carregando…</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {membros.length === 0 && <span style={{ color: TXD, fontSize: 13 }}>Nenhum membro na equipe PS.</span>}
          {membros.map((m) => (
            <div key={m.user_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, border: `1px solid ${BD}`, borderRadius: 10, background: BG2, padding: "10px 12px" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: TX, fontSize: 13.5 }}>{m.nome || m.email || m.user_id}</div>
                <div style={{ fontSize: 12, color: TXD }}>{m.email}{m.observacao ? ` · ${m.observacao}` : ""}</div>
              </div>
              <button disabled={busy} onClick={() => void remover(m)} title="Desativar da equipe PS"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", color: R, border: `1px solid #E5C2C2`, borderRadius: 8, padding: "7px 12px", fontWeight: 700, cursor: busy ? "default" : "pointer", fontSize: 12.5 }}>
                <Trash2 size={14} /> Desativar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
