"use client";
// Lista rica de clientes Wealth (porta de entrada premium). Substitui o dropdown: cards com foto, AUM,
// perfil (chip), consultor, filtros e KPIs (AUM total, nº clientes, distribuição por perfil). Clicar → ficha 360°.
// Backend: fn_wealth_clientes_lista (uma RPC, sem N+1 client-side).
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { Loader2, Search } from "lucide-react";
import { ESP, GOLD, LINE, MUT, fmtBRL, fmtBRLcompact, Avatar, PerfilChip, PERFIL_COR } from "./wealth-ui";

type Cliente = {
  id: string; nome: string; foto_url: string | null; perfil_risco: string | null; status: string | null;
  consultor_id: string | null; consultor_nome: string | null; aum: number; num_posicoes: number;
  valido_ate: string | null; perfil_vencido: boolean;
};

const PERFIS = ["conservador", "moderado", "arrojado", "agressivo"];

export function WealthConsultorView() {
  const { companyIds } = useCompanyIds();
  const empresa = companyIds[0] ?? null;

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [fPerfil, setFPerfil] = useState("");
  const [fConsultor, setFConsultor] = useState("");
  const [fStatus, setFStatus] = useState("");

  const carregar = useCallback(async () => {
    if (!empresa) { setClientes([]); setLoading(false); return; }
    setLoading(true); setError(null);
    const { data, error: err } = await supabase.rpc("fn_wealth_clientes_lista", { p_company_id: empresa });
    const j = (data ?? null) as { ok?: boolean; erro?: string; clientes?: Cliente[] } | null;
    if (err || !j?.ok) { setError(err?.message ?? j?.erro ?? "falhou"); setClientes([]); }
    else setClientes(j.clientes ?? []);
    setLoading(false);
  }, [empresa]);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const consultores = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clientes) if (c.consultor_id) m.set(c.consultor_id, c.consultor_nome ?? "—");
    return Array.from(m.entries());
  }, [clientes]);

  const filtrados = useMemo(() => clientes.filter((c) =>
    (!busca || c.nome.toLowerCase().includes(busca.toLowerCase())) &&
    (!fPerfil || (c.perfil_risco ?? "") === fPerfil) &&
    (!fConsultor || c.consultor_id === fConsultor) &&
    (!fStatus || (c.status ?? "") === fStatus)
  ), [clientes, busca, fPerfil, fConsultor, fStatus]);

  const totalAUM = useMemo(() => clientes.reduce((s, c) => s + (Number(c.aum) || 0), 0), [clientes]);
  const distrib = useMemo(() => {
    const d: Record<string, number> = {};
    for (const c of clientes) { const p = (c.perfil_risco ?? "sem").toLowerCase(); d[p] = (d[p] ?? 0) + 1; }
    return d;
  }, [clientes]);

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin" style={{ color: GOLD }} /></div>;
  if (error) return <div className="rounded-lg border p-6" style={{ borderColor: "#FECACA", backgroundColor: "#FEF2F2", color: "#991B1B" }}>Erro ao carregar carteira: {error}</div>;

  const statusList = Array.from(new Set(clientes.map((c) => c.status).filter(Boolean))) as string[];

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border p-5" style={{ borderColor: LINE, background: "#fff" }}>
          <div className="text-xs uppercase tracking-wide font-semibold" style={{ color: MUT }}>AUM total sob gestão</div>
          <div className="text-2xl font-bold mt-1" style={{ color: ESP }}>{fmtBRL(totalAUM)}</div>
        </div>
        <div className="rounded-xl border p-5" style={{ borderColor: LINE, background: "#fff" }}>
          <div className="text-xs uppercase tracking-wide font-semibold" style={{ color: MUT }}>Clientes</div>
          <div className="text-2xl font-bold mt-1" style={{ color: ESP }}>{clientes.length}</div>
        </div>
        <div className="rounded-xl border p-5" style={{ borderColor: LINE, background: "#fff" }}>
          <div className="text-xs uppercase tracking-wide font-semibold mb-2" style={{ color: MUT }}>Distribuição por perfil</div>
          <div className="flex h-3 rounded-full overflow-hidden" style={{ background: "rgba(61,35,20,0.06)" }}>
            {PERFIS.map((p) => { const n = distrib[p] ?? 0; if (!n) return null; return <div key={p} title={`${p}: ${n}`} style={{ width: `${(n / Math.max(clientes.length, 1)) * 100}%`, background: PERFIL_COR[p] }} />; })}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px]" style={{ color: MUT }}>
            {PERFIS.map((p) => (distrib[p] ? <span key={p} className="flex items-center gap-1"><i style={{ width: 8, height: 8, borderRadius: 2, background: PERFIL_COR[p], display: "inline-block" }} />{p} {distrib[p]}</span> : null))}
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUT }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome…" className="w-full rounded-lg border pl-9 pr-3 py-2.5 text-sm" style={{ borderColor: LINE, background: "#fff", color: ESP }} />
        </div>
        <select value={fPerfil} onChange={(e) => setFPerfil(e.target.value)} className="rounded-lg border px-3 py-2.5 text-sm" style={{ borderColor: LINE, background: "#fff", color: ESP }}>
          <option value="">Perfil: todos</option>{PERFIS.map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
        </select>
        {consultores.length > 0 && (
          <select value={fConsultor} onChange={(e) => setFConsultor(e.target.value)} className="rounded-lg border px-3 py-2.5 text-sm" style={{ borderColor: LINE, background: "#fff", color: ESP }}>
            <option value="">Consultor: todos</option>{consultores.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </select>
        )}
        {statusList.length > 0 && (
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="rounded-lg border px-3 py-2.5 text-sm" style={{ borderColor: LINE, background: "#fff", color: ESP }}>
            <option value="">Status: todos</option>{statusList.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>

      {/* Lista */}
      {filtrados.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed p-12 text-center" style={{ borderColor: "rgba(61,35,20,0.2)", backgroundColor: "#FAF7F2" }}>
          <p style={{ color: MUT }}>{clientes.length === 0 ? "Nenhum cliente Wealth cadastrado." : "Nenhum cliente para os filtros selecionados."}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtrados.map((c) => (
            <Link key={c.id} href={`/dashboard/wealth/clientes/${c.id}`} className="rounded-xl border p-4 transition hover:shadow-md" style={{ borderColor: LINE, background: "#fff" }}>
              <div className="flex items-center gap-3">
                <Avatar nome={c.nome} foto={c.foto_url} size={46} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate" style={{ color: ESP }}>{c.nome}</div>
                  <div className="mt-0.5"><PerfilChip perfil={c.perfil_risco} /></div>
                </div>
              </div>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-wide" style={{ color: MUT }}>AUM</div>
                  <div className="text-lg font-bold" style={{ color: ESP }}>{fmtBRLcompact(c.aum)}</div>
                </div>
                <div className="text-right text-[11px]" style={{ color: MUT }}>
                  {c.num_posicoes} posição(ões)
                  {c.consultor_nome && <div className="truncate max-w-[120px]">{c.consultor_nome}</div>}
                </div>
              </div>
              {c.perfil_vencido && <div className="mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: "#F4D6D6", color: "#7A1F1F" }}>perfil vencido</div>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
