// src/app/dashboard/bpo/meu-dia/page.tsx
// Landing do operador BPO: 4 caixas (Urgentes, Planejadas, IA, Cliente)
// Atalhos: J/K navegar, A aprovar/resolver, R rejeitar, T transferir, ? ajuda, Esc voltar

"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { rpc, supabaseBrowser } from "@/lib/authFetch";

interface Item {
  id: string;
  titulo: string;
  descricao?: string;
  categoria?: string;
  prioridade?: string;
  company_id: string;
  empresa: string;
  sla_vence_em?: string;
  sla_status?: "vencido" | "vencendo_4h" | "ok";
  ia_acao_sugerida?: string;
  ia_confianca?: number;
  ia_sugestao?: any;
  tipo_origem?: string;
  created_at?: string;
}

interface MeuDiaData {
  kpis: {
    eh_supervisor: boolean;
    minhas_empresas: number;
    total_pendente: number;
    urgentes: number;
    vencidos: number;
    resolvidos_hoje: number;
    tempo_medio_min_30d?: number;
  };
  caixas: {
    urgentes: Item[];
    planejadas: Item[];
    ia_precisa: Item[];
    cliente_solicitou: Item[];
  };
}

type CaixaKey = "urgentes" | "planejadas" | "ia_precisa" | "cliente_solicitou";

export default function MeuDiaPage() {
  const router = useRouter();
  const [data, setData] = useState<MeuDiaData | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [caixaAtiva, setCaixaAtiva] = useState<CaixaKey>("urgentes");
  const [itemAtivoIdx, setItemAtivoIdx] = useState(0);
  const [mostrandoAjuda, setMostrandoAjuda] = useState(false);
  const [acaoAtiva, setAcaoAtiva] = useState<string | null>(null);
  const inicioRef = useRef<number>(Date.now());

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
      const r = await rpc<MeuDiaData>("fn_bpo_meu_dia_v2", { p_user_id: user.id });
      setData(r);
    } catch (e: any) {
      setErro(e.message || "Não foi possível carregar seu dia");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const itensVisiveis = data?.caixas[caixaAtiva] || [];
  const itemAtivo = itensVisiveis[itemAtivoIdx];

  // ============ AÇÕES ============
  const executarAcao = useCallback(
    async (acao: "resolver" | "rejeitar" | "transferir" | "pular") => {
      if (!itemAtivo || !userId || acaoAtiva) return;
      setAcaoAtiva(acao);
      setErro(null);
      try {
        const tempoSeg = Math.round((Date.now() - inicioRef.current) / 1000);
        const acaoMap: Record<string, string> = {
          resolver: "resolver",
          rejeitar: "rejeitar",
          transferir: "transferir",
          pular: "pular",
        };
        await rpc("fn_bpo_inbox_acao", {
          p_item_id: itemAtivo.id,
          p_user_id: userId,
          p_acao: acaoMap[acao],
          p_tempo_gasto_segundos: tempoSeg,
        });
        // remover item local sem recarregar tudo
        if (data) {
          const novasCaixas = { ...data.caixas };
          novasCaixas[caixaAtiva] = novasCaixas[caixaAtiva].filter((i) => i.id !== itemAtivo.id);
          setData({
            ...data,
            kpis: {
              ...data.kpis,
              total_pendente: data.kpis.total_pendente - 1,
              resolvidos_hoje:
                acao === "resolver" ? data.kpis.resolvidos_hoje + 1 : data.kpis.resolvidos_hoje,
            },
            caixas: novasCaixas,
          });
          setItemAtivoIdx((idx) => Math.min(idx, novasCaixas[caixaAtiva].length - 1));
        }
        inicioRef.current = Date.now();
      } catch (e: any) {
        setErro(e.message || "Não foi possível executar a ação");
      } finally {
        setAcaoAtiva(null);
      }
    },
    [itemAtivo, userId, acaoAtiva, data, caixaAtiva]
  );

  // ============ ATALHOS DE TECLADO ============
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "?") {
        e.preventDefault();
        setMostrandoAjuda((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        if (mostrandoAjuda) setMostrandoAjuda(false);
        return;
      }
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setItemAtivoIdx((i) => Math.min(i + 1, itensVisiveis.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setItemAtivoIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "1") setCaixaAtiva("urgentes");
      else if (e.key === "2") setCaixaAtiva("planejadas");
      else if (e.key === "3") setCaixaAtiva("ia_precisa");
      else if (e.key === "4") setCaixaAtiva("cliente_solicitou");
      else if (e.key === "a" || e.key === "Enter") {
        e.preventDefault();
        executarAcao("resolver");
      } else if (e.key === "r") {
        e.preventDefault();
        executarAcao("rejeitar");
      } else if (e.key === "t") {
        e.preventDefault();
        executarAcao("transferir");
      } else if (e.key === " ") {
        e.preventDefault();
        executarAcao("pular");
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [executarAcao, itensVisiveis.length, mostrandoAjuda]);

  // resetar idx ao mudar caixa
  useEffect(() => {
    setItemAtivoIdx(0);
    inicioRef.current = Date.now();
  }, [caixaAtiva]);

  // ============ RENDER ============
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#FAF7F2]">
        <div className="text-[#3D2314]">Preparando seu dia…</div>
      </div>
    );
  }

  if (erro && !data) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#FAF7F2]">
        <div className="rounded-lg bg-red-50 p-4 text-red-800">{erro}</div>
      </div>
    );
  }

  if (!data) return null;

  // Empty states amigáveis
  const semNada =
    data.kpis.total_pendente === 0 &&
    Object.values(data.caixas).every((c) => c.length === 0);

  return (
    <div className="min-h-screen bg-white">
      {/* HEADER com KPIs */}
      <header className="border-b border-[#3D2314]/10 bg-[#FAF7F2] px-6 py-4">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#3D2314]">Meu dia</h1>
            <p className="text-xs text-[#3D2314]/60">
              {data.kpis.minhas_empresas} empresa{data.kpis.minhas_empresas !== 1 ? "s" : ""} ·{" "}
              {data.kpis.resolvidos_hoje} resolvido{data.kpis.resolvidos_hoje !== 1 ? "s" : ""} hoje
              {data.kpis.tempo_medio_min_30d &&
                ` · média ${data.kpis.tempo_medio_min_30d}min/item`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <KpiBadge label="Pendentes" valor={data.kpis.total_pendente} />
            <KpiBadge label="Urgentes" valor={data.kpis.urgentes} tom={data.kpis.urgentes > 0 ? "vermelho" : "ok"} />
            <KpiBadge label="Vencidos" valor={data.kpis.vencidos} tom={data.kpis.vencidos > 0 ? "vermelho" : "ok"} />
            <button
              onClick={() => setMostrandoAjuda(true)}
              className="rounded-lg bg-white px-3 py-1.5 text-sm text-[#3D2314] hover:bg-[#FAF7F2]"
              title="Atalhos (?)"
            >
              ?
            </button>
          </div>
        </div>
      </header>

      {/* TABS DE CAIXAS */}
      <div className="border-b border-[#3D2314]/10 bg-white px-6">
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto">
          <CaixaTab
            ativo={caixaAtiva === "urgentes"}
            onClick={() => setCaixaAtiva("urgentes")}
            tecla="1"
            icone="🔥"
            nome="Urgentes"
            qtd={data.caixas.urgentes.length}
            tom="vermelho"
          />
          <CaixaTab
            ativo={caixaAtiva === "planejadas"}
            onClick={() => setCaixaAtiva("planejadas")}
            tecla="2"
            icone="📋"
            nome="Planejadas"
            qtd={data.caixas.planejadas.length}
          />
          <CaixaTab
            ativo={caixaAtiva === "ia_precisa"}
            onClick={() => setCaixaAtiva("ia_precisa")}
            tecla="3"
            icone="🤖"
            nome="IA precisa de você"
            qtd={data.caixas.ia_precisa.length}
          />
          <CaixaTab
            ativo={caixaAtiva === "cliente_solicitou"}
            onClick={() => setCaixaAtiva("cliente_solicitou")}
            tecla="4"
            icone="📨"
            nome="Cliente solicitou"
            qtd={data.caixas.cliente_solicitou.length}
          />
        </div>
      </div>

      {/* CONTEÚDO */}
      <main className="mx-auto max-w-6xl px-6 py-6">
        {erro && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>
        )}

        {semNada ? (
          <EmptyDay />
        ) : itensVisiveis.length === 0 ? (
          <EmptyCaixa caixa={caixaAtiva} />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_3fr]">
            {/* Lista */}
            <div className="space-y-2">
              {itensVisiveis.map((it, idx) => (
                <button
                  key={it.id}
                  onClick={() => setItemAtivoIdx(idx)}
                  className={`w-full rounded-xl p-3 text-left transition ${
                    idx === itemAtivoIdx
                      ? "bg-[#3D2314] text-[#FAF7F2] shadow-md"
                      : "bg-[#FAF7F2] text-[#3D2314] hover:bg-[#FAF7F2]/70"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1">
                      <div className="text-sm font-medium">{it.titulo}</div>
                      <div className={`text-xs ${idx === itemAtivoIdx ? "text-[#FAF7F2]/70" : "text-[#3D2314]/60"}`}>
                        {it.empresa}
                      </div>
                    </div>
                    {it.sla_status === "vencido" && (
                      <span className="rounded bg-red-500 px-1.5 py-0.5 text-xs text-white">venc</span>
                    )}
                    {it.sla_status === "vencendo_4h" && (
                      <span className="rounded bg-yellow-400 px-1.5 py-0.5 text-xs text-yellow-900">4h</span>
                    )}
                  </div>
                </button>
              ))}
            </div>

            {/* Detalhe */}
            {itemAtivo && (
              <div className="rounded-2xl bg-[#FAF7F2] p-5">
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-[#C8941A]">
                      {itemAtivo.empresa}
                    </div>
                    <h2 className="mt-1 text-lg font-bold text-[#3D2314]">
                      {itemAtivo.titulo}
                    </h2>
                  </div>
                  <SlaPill status={itemAtivo.sla_status} venceEm={itemAtivo.sla_vence_em} />
                </div>

                {itemAtivo.descricao && (
                  <div className="mb-4 whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-[#3D2314]">
                    {itemAtivo.descricao}
                  </div>
                )}

                {itemAtivo.ia_acao_sugerida && (
                  <div className="mb-4 rounded-lg bg-[#C8941A]/10 p-3">
                    <div className="mb-1 text-xs font-semibold text-[#C8941A]">
                      🤖 IA sugere
                      {itemAtivo.ia_confianca != null && (
                        <span className="ml-2 text-[#3D2314]/60">
                          ({itemAtivo.ia_confianca}% confiança)
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-[#3D2314]">
                      {itemAtivo.ia_acao_sugerida}
                    </div>
                  </div>
                )}

                {/* AÇÕES */}
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <BotaoAcao
                    onClick={() => executarAcao("resolver")}
                    disabled={!!acaoAtiva}
                    cor="verde"
                    tecla="A / Enter"
                    label="Resolver"
                    loading={acaoAtiva === "resolver"}
                  />
                  <BotaoAcao
                    onClick={() => executarAcao("rejeitar")}
                    disabled={!!acaoAtiva}
                    cor="vermelho"
                    tecla="R"
                    label="Rejeitar"
                    loading={acaoAtiva === "rejeitar"}
                  />
                  <BotaoAcao
                    onClick={() => executarAcao("transferir")}
                    disabled={!!acaoAtiva}
                    cor="dourado"
                    tecla="T"
                    label="Transferir"
                    loading={acaoAtiva === "transferir"}
                  />
                  <BotaoAcao
                    onClick={() => executarAcao("pular")}
                    disabled={!!acaoAtiva}
                    cor="espresso"
                    tecla="Espaço"
                    label="Pular"
                    loading={acaoAtiva === "pular"}
                  />
                </div>

                <div className="mt-4 text-xs text-[#3D2314]/60">
                  Use <Kbd>J</Kbd>/<Kbd>K</Kbd> para navegar, <Kbd>?</Kbd> para todos os atalhos.
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* MODAL DE AJUDA */}
      {mostrandoAjuda && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#3D2314]/60 p-4"
          onClick={() => setMostrandoAjuda(false)}
        >
          <div
            className="max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 text-lg font-bold text-[#3D2314]">Atalhos do teclado</h2>
            <div className="space-y-2 text-sm">
              <Atalho t="1 2 3 4" desc="Trocar entre caixas" />
              <Atalho t="J ↓" desc="Próximo item" />
              <Atalho t="K ↑" desc="Item anterior" />
              <Atalho t="A / Enter" desc="Resolver item" />
              <Atalho t="R" desc="Rejeitar item" />
              <Atalho t="T" desc="Transferir para outro operador" />
              <Atalho t="Espaço" desc="Pular sem agir" />
              <Atalho t="?" desc="Mostrar/esconder esta ajuda" />
              <Atalho t="Esc" desc="Fechar diálogos" />
            </div>
            <button
              onClick={() => setMostrandoAjuda(false)}
              className="mt-4 w-full rounded-lg bg-[#3D2314] py-2 text-sm text-[#FAF7F2] hover:bg-[#5C3A24]"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ COMPONENTES AUXILIARES ============

function KpiBadge({ label, valor, tom }: { label: string; valor: number; tom?: "vermelho" | "ok" }) {
  const cor = tom === "vermelho" && valor > 0 ? "text-red-700" : "text-[#3D2314]";
  return (
    <div className="text-right">
      <div className="text-xs text-[#3D2314]/60">{label}</div>
      <div className={`text-lg font-bold ${cor}`}>{valor}</div>
    </div>
  );
}

function CaixaTab({
  ativo,
  onClick,
  tecla,
  icone,
  nome,
  qtd,
  tom,
}: {
  ativo: boolean;
  onClick: () => void;
  tecla: string;
  icone: string;
  nome: string;
  qtd: number;
  tom?: "vermelho";
}) {
  const corBase = ativo
    ? "bg-[#3D2314] text-[#FAF7F2]"
    : "bg-transparent text-[#3D2314] hover:bg-[#FAF7F2]";
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 transition ${corBase} ${
        ativo ? "border-[#C8941A]" : "border-transparent"
      }`}
    >
      <Kbd small>{tecla}</Kbd>
      <span>{icone}</span>
      <span className="text-sm font-medium">{nome}</span>
      {qtd > 0 && (
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            tom === "vermelho"
              ? "bg-red-500 text-white"
              : ativo
              ? "bg-[#C8941A] text-white"
              : "bg-[#3D2314]/10 text-[#3D2314]"
          }`}
        >
          {qtd}
        </span>
      )}
    </button>
  );
}

function SlaPill({ status, venceEm }: { status?: string; venceEm?: string }) {
  if (!status || status === "ok") {
    return venceEm ? (
      <span className="text-xs text-[#3D2314]/60">
        SLA até {new Date(venceEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
      </span>
    ) : null;
  }
  if (status === "vencido") {
    return <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-800">⚠ SLA vencido</span>;
  }
  return <span className="rounded-full bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-800">⏰ vence em &lt;4h</span>;
}

function BotaoAcao({
  onClick,
  disabled,
  cor,
  tecla,
  label,
  loading,
}: {
  onClick: () => void;
  disabled: boolean;
  cor: "verde" | "vermelho" | "dourado" | "espresso";
  tecla: string;
  label: string;
  loading: boolean;
}) {
  const cores = {
    verde: "bg-emerald-600 hover:bg-emerald-700 text-white",
    vermelho: "bg-red-600 hover:bg-red-700 text-white",
    dourado: "bg-[#C8941A] hover:bg-[#A87810] text-white",
    espresso: "bg-[#3D2314] hover:bg-[#5C3A24] text-[#FAF7F2]",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center justify-center rounded-xl px-4 py-3 transition disabled:opacity-50 ${cores[cor]}`}
    >
      <span className="text-sm font-semibold">{loading ? "…" : label}</span>
      <span className="mt-1 text-xs opacity-75">{tecla}</span>
    </button>
  );
}

function Atalho({ t, desc }: { t: string; desc: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-[#FAF7F2] px-3 py-2">
      <Kbd>{t}</Kbd>
      <span className="text-[#3D2314]/80">{desc}</span>
    </div>
  );
}

function Kbd({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return (
    <kbd
      className={`rounded border border-[#3D2314]/20 bg-white font-mono text-[#3D2314] ${
        small ? "px-1 py-0.5 text-[10px]" : "px-2 py-1 text-xs"
      }`}
    >
      {children}
    </kbd>
  );
}

function EmptyDay() {
  return (
    <div className="rounded-2xl bg-[#FAF7F2] p-12 text-center">
      <div className="mb-4 text-6xl">☕</div>
      <h3 className="text-xl font-bold text-[#3D2314]">Tudo em dia!</h3>
      <p className="mt-2 text-sm text-[#3D2314]/70">
        Nenhuma tarefa pendente nas suas empresas. Aproveite para revisar relatórios ou tomar um café.
      </p>
    </div>
  );
}

function EmptyCaixa({ caixa }: { caixa: CaixaKey }) {
  const msgs: Record<CaixaKey, { icone: string; titulo: string; desc: string }> = {
    urgentes: { icone: "✅", titulo: "Sem urgências", desc: "Nenhum item com SLA crítico no momento." },
    planejadas: { icone: "📅", titulo: "Sem tarefas planejadas hoje", desc: "O cron noturno cria a pauta às 03h. Volte amanhã ou veja outras caixas." },
    ia_precisa: { icone: "🤖", titulo: "IA está em dia", desc: "Nenhuma classificação pendente. A IA está confiante nas decisões automáticas." },
    cliente_solicitou: { icone: "📭", titulo: "Sem solicitações de clientes", desc: "Nenhum cliente abriu solicitação ainda." },
  };
  const m = msgs[caixa];
  return (
    <div className="rounded-2xl bg-[#FAF7F2] p-12 text-center">
      <div className="mb-4 text-5xl">{m.icone}</div>
      <h3 className="text-lg font-semibold text-[#3D2314]">{m.titulo}</h3>
      <p className="mt-2 text-sm text-[#3D2314]/70">{m.desc}</p>
    </div>
  );
}
