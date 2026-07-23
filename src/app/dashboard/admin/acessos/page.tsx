"use client";
// Usuários & Acessos · Fase 1 — tela em cascata (Empresa → Áreas contratadas (teto) → Master → Pessoas).
// Backend (RPCs SECURITY DEFINER com travas): fn_acessos_empresa_contexto / fn_acessos_salvar_pessoa.
// Horário = SÓ configuração nesta fase (trava de login é Fase 2). Coexiste com as 9 abas antigas.
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Users, Building2, Shield, Factory, Clock, Save, ChevronDown, ChevronRight, Crown, Lock, UserPlus, Link2 } from "lucide-react";

const GO = "var(--ps-gold,#C8941A)", BG = "var(--ps-bg,#FAF7F2)", BG2 = "var(--ps-bg2,#FFFFFF)", BG3 = "var(--ps-bg3,#F0ECE3)",
  BD = "var(--ps-border,#E0D8CC)", TX = "var(--ps-text,#3D2314)", TXM = "var(--ps-text-m,#6B5D4F)", TXD = "var(--ps-text-d,#9C8E80)",
  G = "#22C55E", R = "#EF4444", BL = "#3B82F6";

// Papéis liberáveis pelo Master (NUNCA admin/acesso_total/PS_ADMIN — travado também no backend).
const PAPEIS: { role: string; nome: string }[] = [
  { role: "socio", nome: "Sócio / CEO" }, { role: "diretor", nome: "Diretor" }, { role: "diretor_area", nome: "Diretor de Área" },
  { role: "gerente", nome: "Gerente" }, { role: "gerente_planta", nome: "Gerente de Planta" }, { role: "gerente_processo", nome: "Gerente de Processo" },
  { role: "supervisor", nome: "Supervisor" }, { role: "supervisor_turno", nome: "Supervisor de Turno" }, { role: "coordenador", nome: "Coordenador" },
  { role: "operacional", nome: "Operacional" }, { role: "operador", nome: "Operador" }, { role: "comercial", nome: "Comercial" },
  { role: "financeiro", nome: "Financeiro" }, { role: "contador", nome: "Contador" }, { role: "consultor", nome: "Consultor" },
  { role: "rh_industrial", nome: "RH Industrial" }, { role: "sst", nome: "SST" }, { role: "viewer", nome: "Visualizador" },
];
const DIAS = [{ n: 1, l: "Seg" }, { n: 2, l: "Ter" }, { n: 3, l: "Qua" }, { n: 4, l: "Qui" }, { n: 5, l: "Sex" }, { n: 6, l: "Sáb" }, { n: 7, l: "Dom" }];
const SIT_LBL: Record<string, string> = { ATIVO: "Ativo", INATIVO_7DIAS: "Inativo 7d+", INATIVO_30DIAS: "Inativo 30d+", NUNCA_LOGOU: "Nunca logou" };
const SIT_COR: Record<string, string> = { ATIVO: G, INATIVO_7DIAS: "#F59E0B", INATIVO_30DIAS: R, NUNCA_LOGOU: TXD };

type Empresa = { id: string; nome_fantasia: string | null; razao_social: string | null };
type Area = { slug: string; nome: string };
type Planta = { id: string; nome: string };
type Master = { user_id: string; email: string; nome: string | null };
type Horario = { dias_semana: number[] | null; hora_inicio: string | null; hora_fim: string | null; timezone: string | null; ativo: boolean | null };
type Pessoa = {
  user_id: string; email: string; nome: string | null; role: string; nivel: string; is_master: boolean;
  restricted: boolean; areas: string[] | null; plantas: string[] | null; horario: Horario | null;
  ultimo_login: string | null; situacao: string;
};
type Contexto = { empresa: Empresa; areas_contratadas: Area[]; plantas: Planta[]; master: Master[]; pessoas: Pessoa[] };

export default function AcessosCascataPage() {
  const [empresasGeriveis, setEmpresasGeriveis] = useState<Empresa[]>([]);
  const [companyId, setCompanyId] = useState<string>("");
  const [ctx, setCtx] = useState<Contexto | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // Empresas que o usuário pode gerir: PS_ADMIN → todas; senão as que ele é CLIENT_OWNER ativo.
  useEffect(() => {
    (async () => {
      setLoading(true); setErro(null);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setErro("Sessão expirada. Entre novamente."); setLoading(false); return; }
      const { data: me } = await supabase.from("users").select("system_role").eq("id", user.id).maybeSingle();
      let empresas: Empresa[] = [];
      if (me?.system_role === "PS_ADMIN") {
        const { data } = await supabase.from("companies").select("id,nome_fantasia,razao_social").order("nome_fantasia");
        empresas = (data as Empresa[]) || [];
      } else {
        const { data } = await supabase.from("tenant_user_roles")
          .select("company_id, companies(id,nome_fantasia,razao_social)")
          .eq("user_id", user.id).eq("role", "CLIENT_OWNER").eq("is_active", true);
        empresas = ((data as any[]) || []).map((r) => r.companies).filter(Boolean);
      }
      setEmpresasGeriveis(empresas);
      if (empresas.length > 0) setCompanyId((prev) => prev || empresas[0].id);
      setLoading(false);
    })();
  }, []);

  const carregar = useCallback(async (cid: string) => {
    if (!cid) return;
    setLoading(true); setErro(null); setEditId(null);
    const { data, error } = await supabase.rpc("fn_acessos_empresa_contexto", { p_company_id: cid });
    if (error) { setErro(error.message); setCtx(null); }
    else setCtx(data as Contexto);
    setLoading(false);
  }, []);
  useEffect(() => { if (companyId) void carregar(companyId); }, [companyId, carregar]);

  if (loading && !ctx) return <Shell><div style={{ color: TXM }}>Carregando…</div></Shell>;
  if (empresasGeriveis.length === 0) return <Shell><div style={{ color: TXM }}>Você não administra nenhuma empresa. Fale com a PS Gestão.</div></Shell>;

  return (
    <Shell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: TX, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Users size={22} color={GO} /> Usuários &amp; Acessos
        </h1>
        {empresasGeriveis.length > 1 && (
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${BD}`, background: BG2, color: TX, fontWeight: 600 }}>
            {empresasGeriveis.map((e) => <option key={e.id} value={e.id}>{e.nome_fantasia || e.razao_social}</option>)}
          </select>
        )}
      </div>

      {erro && <div style={{ background: "#FEF2F2", border: `1px solid ${R}`, color: R, padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{erro}</div>}

      {ctx && (
        <>
          {/* 1 · Empresa */}
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Building2 size={20} color={GO} />
              <div>
                <div style={{ fontWeight: 800, color: TX, fontSize: 16 }}>{ctx.empresa.nome_fantasia || ctx.empresa.razao_social}</div>
                {ctx.empresa.razao_social && ctx.empresa.nome_fantasia && <div style={{ fontSize: 12, color: TXD }}>{ctx.empresa.razao_social}</div>}
              </div>
            </div>
          </Card>

          {/* 2 · Áreas contratadas (teto) */}
          <Secao icon={<Shield size={15} color={GO} />} titulo={`Áreas contratadas (teto) · ${ctx.areas_contratadas.length}`} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {ctx.areas_contratadas.length === 0 && <span style={{ color: TXD, fontSize: 13 }}>Nenhuma área contratada.</span>}
            {ctx.areas_contratadas.map((a) => (
              <span key={a.slug} style={{ padding: "6px 12px", borderRadius: 999, background: BG3, border: `1px solid ${BD}`, color: TX, fontSize: 13, fontWeight: 700 }}>{a.nome}</span>
            ))}
          </div>

          {/* 3 · Master(s) */}
          <Secao icon={<Crown size={15} color={GO} />} titulo="Master da empresa" />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {ctx.master.length === 0 && <span style={{ color: TXD, fontSize: 13 }}>Sem master definido.</span>}
            {ctx.master.map((m) => (
              <div key={m.user_id} style={{ padding: "8px 14px", borderRadius: 10, background: BG2, border: `1px solid ${GO}`, display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Crown size={14} color={GO} /><span style={{ fontWeight: 700, color: TX, fontSize: 13 }}>{m.nome || m.email}</span>
                <span style={{ fontSize: 11, color: TXD }}>{m.email}</span>
              </div>
            ))}
          </div>

          {/* 4 · Pessoas */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <Secao icon={<Users size={15} color={GO} />} titulo={`Pessoas · ${ctx.pessoas.length}`} />
            <button onClick={() => setAddOpen((v) => !v)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: addOpen ? BG3 : GO, color: addOpen ? TX : "#fff", border: `1px solid ${addOpen ? BD : GO}`, borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
              <UserPlus size={15} /> {addOpen ? "Fechar" : "+ Adicionar pessoa"}
            </button>
          </div>
          {addOpen && (
            <AdicionarPessoa areasContratadas={ctx.areas_contratadas} plantas={ctx.plantas} companyId={companyId}
              onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); void carregar(companyId); }} />
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {ctx.pessoas.map((p) => (
              <PessoaRow key={p.user_id} p={p} aberto={editId === p.user_id}
                onToggle={() => setEditId(editId === p.user_id ? null : p.user_id)}
                areasContratadas={ctx.areas_contratadas} plantas={ctx.plantas}
                companyId={companyId} onSaved={() => carregar(companyId)} />
            ))}
          </div>
        </>
      )}
    </Shell>
  );
}

function PessoaRow({ p, aberto, onToggle, areasContratadas, plantas, companyId, onSaved }: {
  p: Pessoa; aberto: boolean; onToggle: () => void; areasContratadas: Area[]; plantas: Planta[]; companyId: string; onSaved: () => void;
}) {
  const [role, setRole] = useState(p.role);
  const [areas, setAreas] = useState<Set<string>>(new Set(p.restricted && p.areas ? p.areas : areasContratadas.map((a) => a.slug)));
  const [plantasSel, setPlantasSel] = useState<Set<string>>(new Set(p.plantas || []));
  const [dias, setDias] = useState<Set<number>>(new Set(p.horario?.dias_semana || []));
  const [ini, setIni] = useState((p.horario?.hora_inicio || "").slice(0, 5));
  const [fim, setFim] = useState((p.horario?.hora_fim || "").slice(0, 5));
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  async function salvar() {
    setSalvando(true); setMsg(null);
    const horario = { dias_semana: Array.from(dias).sort(), hora_inicio: ini || null, hora_fim: fim || null, timezone: "America/Sao_Paulo", ativo: true };
    const { data, error } = await supabase.rpc("fn_acessos_salvar_pessoa", {
      p_company_id: companyId, p_user_id: p.user_id, p_areas: Array.from(areas),
      p_role: role, p_plantas: Array.from(plantasSel), p_horario: horario,
    });
    setSalvando(false);
    const res = data as { ok?: boolean; erro?: string } | null;
    if (error || !res?.ok) { setMsg({ ok: false, t: error?.message || res?.erro || "Falha ao salvar" }); return; }
    setMsg({ ok: true, t: "Salvo." });
    onSaved();
  }
  const toggle = <T,>(set: React.Dispatch<React.SetStateAction<Set<T>>>, v: T) =>
    set((prev) => { const n = new Set(prev); n.has(v) ? n.delete(v) : n.add(v); return n; });

  return (
    <div style={{ border: `1px solid ${BD}`, borderRadius: 10, background: BG2, overflow: "hidden" }}>
      <button onClick={onToggle} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
        {aberto ? <ChevronDown size={16} color={TXM} /> : <ChevronRight size={16} color={TXM} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: TX, fontSize: 14, display: "inline-flex", alignItems: "center", gap: 6 }}>
            {p.nome || p.email}{p.is_master && <Crown size={13} color={GO} />}
          </div>
          <div style={{ fontSize: 12, color: TXD }}>{p.email}</div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: BL }}>{PAPEIS.find((x) => x.role === p.role)?.nome || p.role}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: SIT_COR[p.situacao] ?? TXD }}>{SIT_LBL[p.situacao] ?? p.situacao}</span>
      </button>

      {aberto && (
        <div style={{ padding: "4px 16px 16px", borderTop: `1px solid ${BD}`, display: "flex", flexDirection: "column", gap: 14 }}>
          {p.is_master && (
            <div style={{ fontSize: 12, color: TXM, display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8 }}>
              <Lock size={13} color={GO} /> Este é o Master da empresa.
            </div>
          )}
          {/* Áreas (limitado ao teto) */}
          <Field icon={<Shield size={14} color={GO} />} label="Áreas liberadas (dentro do que a empresa contratou)">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {areasContratadas.map((a) => {
                const on = areas.has(a.slug);
                return <Chip key={a.slug} on={on} onClick={() => toggle(setAreas, a.slug)}>{a.nome}</Chip>;
              })}
            </div>
          </Field>
          {/* Papel */}
          <Field icon={<Users size={14} color={GO} />} label="Papel (nível de acesso)">
            <select value={role} onChange={(e) => setRole(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${BD}`, background: BG, color: TX, fontWeight: 600, maxWidth: 320 }}>
              {PAPEIS.map((r) => <option key={r.role} value={r.role}>{r.nome}</option>)}
              {!PAPEIS.some((r) => r.role === role) && <option value={role}>{role} (atual)</option>}
            </select>
          </Field>
          {/* Plantas */}
          {plantas.length > 0 && (
            <Field icon={<Factory size={14} color={GO} />} label="Plantas / unidades">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {plantas.map((pl) => <Chip key={pl.id} on={plantasSel.has(pl.id)} onClick={() => toggle(setPlantasSel, pl.id)}>{pl.nome}</Chip>)}
              </div>
            </Field>
          )}
          {/* Horário (só configuração — Fase 1) */}
          <Field icon={<Clock size={14} color={GO} />} label="Horário de acesso">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {DIAS.map((d) => <Chip key={d.n} on={dias.has(d.n)} onClick={() => toggle(setDias, d.n)}>{d.l}</Chip>)}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <input type="time" value={ini} onChange={(e) => setIni(e.target.value)} style={inp} />
              <span style={{ color: TXD }}>até</span>
              <input type="time" value={fim} onChange={(e) => setFim(e.target.value)} style={inp} />
              <span style={{ fontSize: 11, color: TXD, fontStyle: "italic" }}>trava de login: em breve (Fase 2)</span>
            </div>
          </Field>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button disabled={salvando} onClick={() => void salvar()}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: GO, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontWeight: 700, cursor: salvando ? "default" : "pointer", opacity: salvando ? 0.6 : 1 }}>
              <Save size={15} /> {salvando ? "Salvando…" : "Salvar"}
            </button>
            {msg && <span style={{ fontSize: 13, fontWeight: 600, color: msg.ok ? G : R }}>{msg.t}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// Papel de gestão (o que a pessoa PODE GERIR) — os 4 valores, sem esconder OPERATOR (decisão CEO).
const PAPEIS_GESTAO: { v: string; l: string }[] = [
  { v: "CLIENT_VIEWER", l: "Visualizador (só lê)" },
  { v: "CLIENT_OPERATOR", l: "Operador" },
  { v: "CLIENT_MANAGER", l: "Gestor" },
  { v: "CLIENT_OWNER", l: "Master (gere a empresa)" },
];

// GAP 1 · incluir pessoa nova (genérico p/ qualquer empresa/áreas). Vincula direto se o e-mail já
// existe; senão gera convite por link. Backend: fn_acessos_convidar_pessoa (guards no servidor).
function AdicionarPessoa({ areasContratadas, plantas, companyId, onClose, onSaved }: {
  areasContratadas: Area[]; plantas: Planta[]; companyId: string; onClose: () => void; onSaved: () => void;
}) {
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [role, setRole] = useState("viewer");
  const [papel, setPapel] = useState("CLIENT_VIEWER");
  const [areas, setAreas] = useState<Set<string>>(new Set(areasContratadas.map((a) => a.slug)));
  const [plantasSel, setPlantasSel] = useState<Set<string>>(new Set());
  const [dias, setDias] = useState<Set<number>>(new Set());
  const [ini, setIni] = useState("");
  const [fim, setFim] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const toggle = <T,>(set: React.Dispatch<React.SetStateAction<Set<T>>>, v: T) =>
    set((prev) => { const n = new Set(prev); n.has(v) ? n.delete(v) : n.add(v); return n; });

  async function enviar() {
    setSalvando(true); setMsg(null); setLink(null);
    const horario = (dias.size || ini || fim)
      ? { dias_semana: Array.from(dias).sort(), hora_inicio: ini || null, hora_fim: fim || null, timezone: "America/Sao_Paulo", ativo: true }
      : null;
    const { data, error } = await supabase.rpc("fn_acessos_convidar_pessoa", {
      p_company_id: companyId, p_email: email, p_nome: nome || null,
      p_areas: Array.from(areas), p_role: role, p_plantas: Array.from(plantasSel),
      p_horario: horario, p_papel_gestao: papel,
    });
    setSalvando(false);
    const res = data as { ok?: boolean; erro?: string; acao?: string; link?: string } | null;
    if (error || !res?.ok) { setMsg({ ok: false, t: error?.message || res?.erro || "Falha ao adicionar." }); return; }
    if (res.acao === "vinculado") {
      setMsg({ ok: true, t: "Pessoa vinculada — já tem login e agora acessa esta empresa." });
      onSaved();
    } else {
      const full = (typeof window !== "undefined" ? window.location.origin : "") + (res.link || "");
      setMsg({ ok: true, t: "Convite criado. Envie o link para a pessoa concluir o cadastro." });
      setLink(full);
    }
  }

  return (
    <div style={{ border: `1px solid ${GO}`, borderRadius: 10, background: BG2, padding: 16, marginBottom: 8, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontWeight: 800, color: TX, fontSize: 14, display: "inline-flex", alignItems: "center", gap: 8 }}>
        <UserPlus size={16} color={GO} /> Adicionar pessoa
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Field icon={<Users size={14} color={GO} />} label="E-mail *">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="pessoa@empresa.com" style={{ ...inp, minWidth: 240 }} />
        </Field>
        <Field icon={<Users size={14} color={GO} />} label="Nome">
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome da pessoa" style={{ ...inp, minWidth: 200 }} />
        </Field>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Field icon={<Users size={14} color={GO} />} label="Nível de acesso (o que VÊ)">
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ ...inp, fontWeight: 600, minWidth: 220 }}>
            {PAPEIS.map((r) => <option key={r.role} value={r.role}>{r.nome}</option>)}
          </select>
        </Field>
        <Field icon={<Crown size={14} color={GO} />} label="Papel na empresa (o que PODE GERIR)">
          <select value={papel} onChange={(e) => setPapel(e.target.value)} style={{ ...inp, fontWeight: 600, minWidth: 220 }}>
            {PAPEIS_GESTAO.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
          </select>
        </Field>
      </div>
      <Field icon={<Shield size={14} color={GO} />} label="Áreas liberadas (dentro do que a empresa contratou)">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {areasContratadas.length === 0 && <span style={{ color: TXD, fontSize: 13 }}>Nenhuma área contratada.</span>}
          {areasContratadas.map((a) => <Chip key={a.slug} on={areas.has(a.slug)} onClick={() => toggle(setAreas, a.slug)}>{a.nome}</Chip>)}
        </div>
      </Field>
      {plantas.length > 0 && (
        <Field icon={<Factory size={14} color={GO} />} label="Plantas / unidades">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {plantas.map((pl) => <Chip key={pl.id} on={plantasSel.has(pl.id)} onClick={() => toggle(setPlantasSel, pl.id)}>{pl.nome}</Chip>)}
          </div>
        </Field>
      )}
      <Field icon={<Clock size={14} color={GO} />} label="Horário de acesso (opcional)">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {DIAS.map((d) => <Chip key={d.n} on={dias.has(d.n)} onClick={() => toggle(setDias, d.n)}>{d.l}</Chip>)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input type="time" value={ini} onChange={(e) => setIni(e.target.value)} style={inp} />
          <span style={{ color: TXD }}>até</span>
          <input type="time" value={fim} onChange={(e) => setFim(e.target.value)} style={inp} />
        </div>
      </Field>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button disabled={salvando} onClick={() => void enviar()}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: GO, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontWeight: 700, cursor: salvando ? "default" : "pointer", opacity: salvando ? 0.6 : 1 }}>
          <UserPlus size={15} /> {salvando ? "Enviando…" : "Adicionar"}
        </button>
        <button onClick={onClose} style={{ background: "none", border: `1px solid ${BD}`, borderRadius: 8, padding: "9px 16px", color: TXM, cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
        {msg && <span style={{ fontSize: 13, fontWeight: 600, color: msg.ok ? G : R }}>{msg.t}</span>}
      </div>
      {link && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: BG3, border: `1px solid ${BD}`, borderRadius: 8, padding: "10px 12px", flexWrap: "wrap" }}>
          <Link2 size={15} color={GO} />
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} style={{ ...inp, flex: 1, minWidth: 220, fontSize: 12 }} />
          <button onClick={() => { if (typeof navigator !== "undefined" && navigator.clipboard) void navigator.clipboard.writeText(link); }}
            style={{ background: GO, color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Copiar</button>
        </div>
      )}
    </div>
  );
}

const inp: React.CSSProperties = { padding: "7px 10px", borderRadius: 8, border: `1px solid ${BD}`, background: BG, color: TX };
function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ background: BG, minHeight: "100vh", padding: "18px 14px 48px", maxWidth: 860, margin: "0 auto" }}>{children}</div>;
}
function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ background: BG2, border: `1px solid ${BD}`, borderRadius: 12, padding: 14, marginBottom: 16 }}>{children}</div>;
}
function Secao({ icon, titulo }: { icon: React.ReactNode; titulo: string }) {
  return <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: TXM, fontWeight: 800, margin: "2px 0 8px" }}>{icon}{titulo}</div>;
}
function Field({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return <div><div style={{ fontSize: 12, fontWeight: 700, color: TXM, marginBottom: 6, display: "inline-flex", alignItems: "center", gap: 6 }}>{icon}{label}</div>{children}</div>;
}
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} style={{ padding: "6px 12px", borderRadius: 999, cursor: "pointer", fontSize: 12, fontWeight: 700, border: `1px solid ${on ? GO : BD}`, background: on ? GO : BG2, color: on ? "#fff" : TXM }}>{children}</button>;
}
