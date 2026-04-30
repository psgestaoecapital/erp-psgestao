// src/app/dashboard/bpo/conversas/page.tsx
// ONDA 6 - Inbox de conversas do operador BPO
// Não-respondidas no topo, semáforo SLA

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { rpc, supabaseBrowser } from "@/lib/authFetch";

interface Conversa {
  id: string;
  company_id: string;
  empresa: string;
  assunto: string;
  contexto_tipo: string;
  status: string;
  prioridade: string;
  cliente_nome: string;
  ultima_mensagem_de: string;
  ultima_mensagem_em: string;
  ultima_mensagem_texto: string;
  total_mensagens: number;
  nao_lidas: number;
  sla_resposta_em: string | null;
  horas_para_sla: number | null;
  sla_status: string;
  operador_responsavel_id: string;
  operador_email: string;
}

export default function ConversasLandingPage() {
  const router = useRouter();
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"minhas" | "todas" | "urgentes">("minhas");
  const [busca, setBusca] = useState("");
  const [userId, setUserId] = useState<string | null>(null);

  async function carregar() {
    setLoading(true);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      setUserId(user.id);

      const data = await rpc<Conversa[]>("fn_bpo_listar_conversas_operador", {
        p_user_id: user.id,
        p_filtro: filtro,
      });
      setConversas(data || []);
    } catch (e: any) {
      setErro(e.message || "Não foi possível carregar conversas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [filtro]);

  // Atalho Ctrl+K busca
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        const input = document.getElementById("busca-conversas");
        input?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const conversasFiltradas = busca
    ? conversas.filter((c) =>
        c.empresa.toLowerCase().includes(busca.toLowerCase()) ||
        c.assunto.toLowerCase().includes(busca.toLowerCase()) ||
        c.cliente_nome?.toLowerCase().includes(busca.toLowerCase()) ||
        c.ultima_mensagem_texto?.toLowerCase().includes(busca.toLowerCase())
      )
    : conversas;

  const stats = {
    aguardando: conversas.filter((c) => c.status === "aguardando_operador").length,
    nao_lidas: conversas.reduce((acc, c) => acc + (c.nao_lidas || 0), 0),
    vencidas: conversas.filter((c) => c.sla_status === "vencido").length,
    urgentes: conversas.filter((c) => c.sla_status === "urgente").length,
  };

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-[#3D2314]/10 bg-[#FAF7F2] px-6 py-4">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-[#3D2314]">Conversas</h1>
              <p className="text-xs text-[#3D2314]/60">
                Inbox unificado de comunicação com clientes
              </p>
            </div>
            <button
              onClick={() => router.push("/dashboard/bpo/conversas/nova")}
              className="rounded-lg bg-[#C8941A] px-4 py-2 text-sm font-semibold text-white hover:bg-[#A87810]"
            >
              + Nova conversa
            </button>
          </div>
        </div>
      </header>

      {erro && (
        <div className="mx-auto max-w-7xl px-6 pt-4">
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-6 py-6">
        {/* KPIs */}
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="Aguardando você" valor={stats.aguardando} tom={stats.aguardando > 0 ? "vermelho" : undefined} />
          <KpiCard label="Não lidas" valor={stats.nao_lidas} tom={stats.nao_lidas > 0 ? "destaque" : undefined} />
          <KpiCard label="SLA vencido" valor={stats.vencidas} tom={stats.vencidas > 0 ? "vermelho" : "verde"} />
          <KpiCard label="SLA urgente" valor={stats.urgentes} tom={stats.urgentes > 0 ? "amarelo" : "verde"} />
        </div>

        {/* Filtros */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {[
            { v: "minhas", label: "Minhas conversas" },
            { v: "urgentes", label: "Urgentes" },
            { v: "todas", label: "Todas" },
          ].map((f) => (
            <button
              key={f.v}
              onClick={() => setFiltro(f.v as any)}
              className={`rounded-full px-4 py-1.5 text-sm transition ${
                filtro === f.v
                  ? "bg-[#3D2314] text-[#FAF7F2]"
                  : "bg-[#FAF7F2] text-[#3D2314] hover:bg-[#3D2314]/10"
              }`}
            >
              {f.label}
            </button>
          ))}
          <div className="flex-1" />
          <input
            id="busca-conversas"
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar... (Ctrl+K)"
            className="rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
          />
        </div>

        {/* Lista */}
        {loading ? (
          <div className="text-[#3D2314]/60">Carregando conversas...</div>
        ) : conversasFiltradas.length === 0 ? (
          <div className="rounded-2xl bg-[#FAF7F2] p-12 text-center">
            <div className="mb-4 text-5xl">💬</div>
            <h3 className="text-lg font-semibold text-[#3D2314]">
              {busca ? "Nenhuma conversa encontrada" : "Nenhuma conversa ativa"}
            </h3>
            <p className="mt-2 text-sm text-[#3D2314]/70">
              {busca
                ? "Tente outros termos de busca"
                : 'Clique em "Nova conversa" para iniciar uma comunicação com cliente.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {conversasFiltradas.map((c) => (
              <ConversaCard key={c.id} c={c} userId={userId} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ConversaCard({ c, userId }: { c: Conversa; userId: string | null }) {
  const minha = c.operador_responsavel_id === userId;
  const aguardandoVoce = c.status === "aguardando_operador" && minha;

  const corBg = aguardandoVoce
    ? "bg-yellow-50"
    : c.sla_status === "vencido"
    ? "bg-red-50"
    : c.status === "resolvida"
    ? "bg-emerald-50"
    : "bg-[#FAF7F2]";

  const slaPill = (() => {
    if (c.sla_status === "vencido") return { txt: `vencido há ${Math.abs(c.horas_para_sla || 0)}h`, cls: "bg-red-200 text-red-900" };
    if (c.sla_status === "urgente") return { txt: `${c.horas_para_sla}h restantes`, cls: "bg-yellow-200 text-yellow-900" };
    if (c.sla_status === "ok" && c.status !== "resolvida" && c.horas_para_sla !== null) return { txt: `${c.horas_para_sla}h`, cls: "bg-emerald-100 text-emerald-800" };
    return null;
  })();

  return (
    <a
      href={`/dashboard/bpo/conversas/${c.id}`}
      className={`block rounded-2xl p-4 transition hover:shadow-md ${corBg}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[#3D2314]">{c.empresa}</span>
            <span className="text-xs text-[#3D2314]/50">·</span>
            <span className="text-sm text-[#3D2314]/80 truncate">{c.assunto}</span>
            {c.nao_lidas > 0 && (
              <span className="rounded-full bg-[#C8941A] px-2 py-0.5 text-xs font-bold text-white">
                {c.nao_lidas}
              </span>
            )}
          </div>
          <div className="mt-1 truncate text-sm text-[#3D2314]/70">
            <strong>{c.ultima_mensagem_de === "operador" ? "Você: " : `${c.cliente_nome || "Cliente"}: `}</strong>
            {c.ultima_mensagem_texto || "(sem mensagens)"}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded-full px-2 py-0.5 font-medium ${corStatus(c.status)}`}>
              {labelStatus(c.status)}
            </span>
            {c.prioridade !== "normal" && (
              <span className={`rounded-full px-2 py-0.5 font-medium ${
                c.prioridade === "urgente" ? "bg-red-200 text-red-900" : "bg-orange-200 text-orange-900"
              }`}>
                {c.prioridade}
              </span>
            )}
            {slaPill && (
              <span className={`rounded-full px-2 py-0.5 ${slaPill.cls}`}>
                ⏱ {slaPill.txt}
              </span>
            )}
            {!minha && c.operador_email && (
              <span className="text-[#3D2314]/50">
                → {c.operador_email.split("@")[0]}
              </span>
            )}
          </div>
        </div>
        <div className="text-right text-xs text-[#3D2314]/50">
          {formatTime(c.ultima_mensagem_em)}
        </div>
      </div>
    </a>
  );
}

function KpiCard({ label, valor, tom }: { label: string; valor: number; tom?: "verde" | "vermelho" | "amarelo" | "destaque" }) {
  const cor = tom === "verde" ? "text-emerald-700"
    : tom === "vermelho" ? "text-red-700"
    : tom === "amarelo" ? "text-yellow-700"
    : tom === "destaque" ? "text-[#C8941A]"
    : "text-[#3D2314]";
  return (
    <div className="rounded-xl bg-[#FAF7F2] p-4">
      <div className="text-xs uppercase text-[#3D2314]/60">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${cor}`}>{valor}</div>
    </div>
  );
}

function corStatus(s: string) {
  const m: Record<string, string> = {
    aberta: "bg-blue-100 text-blue-900",
    aguardando_cliente: "bg-purple-100 text-purple-900",
    aguardando_operador: "bg-yellow-200 text-yellow-900",
    resolvida: "bg-emerald-100 text-emerald-800",
    arquivada: "bg-gray-100 text-gray-700",
  };
  return m[s] || m.aberta;
}

function labelStatus(s: string) {
  return ({
    aberta: "Aberta",
    aguardando_cliente: "Aguardando cliente",
    aguardando_operador: "🔥 Aguarda você",
    resolvida: "✓ Resolvida",
    arquivada: "Arquivada",
  } as Record<string, string>)[s] || s;
}

function formatTime(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const agora = new Date();
  const diffMs = agora.getTime() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const dias = Math.floor(h / 24);
  if (dias < 7) return `${dias}d`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
