// src/app/dashboard/bpo/supervisao/page.tsx
// ONDA 4.5 - Painel Supervisao com ACOES (rebalancear carga + ativar backup)

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { rpc, supabaseBrowser } from "@/lib/authFetch";

interface Operador {
  user_id: string;
  email: string;
  nome: string;
  empresas_titular: number;
  empresas_backup: number;
  pendentes: number;
  vencidos: number;
  urgentes_4h: number;
  resolvidos_hoje: number;
  tempo_medio_min: number | null;
  status_carga: "sobrecarregado" | "alta" | "normal" | "leve" | "livre";
}

interface Cliente {
  company_id: string;
  nome: string;
  score: number;
  pendentes: number;
  vencidos: number;
  titular_email: string | null;
  dia_fechamento: number;
  sem_atividade_dias: number;
  status: "critico" | "atencao" | "ok";
}

interface Alerta {
  item_id: string;
  titulo: string;
  empresa: string;
  company_id: string;
  assigned_to_email: string | null;
  assigned_to_nome: string;
  sla_vence_em: string;
  horas_para_vencer: number;
  tipo_alerta: "vencido" | "sem_operador" | "estourando_2h";
}

interface Tendencias {
  resolvidos_semana_atual: number;
  resolvidos_semana_passada: number;
  novos_semana_atual: number;
  novos_semana_passada: number;
  sla_compliance_pct_7d: number;
}

interface Painel {
  kpis: {
    total_empresas: number;
    total_pendentes: number;
    total_vencidos: number;
    total_operadores: number;
    clientes_criticos: number;
  };
  operadores: Operador[];
  clientes: Cliente[];
  alertas_criticos: Alerta[];
  tendencias: Tendencias;
}

interface SugestaoRebal {
  origem: { user_id: string; carga_atual: number };
  destino: { user_id: string; email: string; carga_atual: number };
  itens_sugeridos: Array<{
    item_id: string;
    titulo: string;
    empresa: string;
    sla_vence_em: string;
    prioridade: string;
  }>;
  qtd_sugerida: number;
}

export default function SupervisaoPage() {
  const router = useRouter();
  const [data, setData] = useState<Painel | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Modais
  const [modalRebal, setModalRebal] = useState<Operador | null>(null);
  const [modalBackup, setModalBackup] = useState<Cliente | null>(null);
  const [sugestao, setSugestao] = useState<SugestaoRebal | null>(null);
  const [itensSelecionados, setItensSelecionados] = useState<Set<string>>(new Set());
  const [executando, setExecutando] = useState(false);

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

      const { data: sup } = await supabase
        .from("bpo_companies_assignment")
        .select("id")
        .eq("user_id", user.id)
        .eq("papel", "supervisor")
        .eq("ativo", true)
        .limit(1);

      if (!sup || sup.length === 0) {
        setAutorizado(false);
        return;
      }
      setAutorizado(true);

      const r = await rpc<Painel>("fn_bpo_supervisao_painel", { p_supervisor_id: user.id });
      if ((r as any).erro) throw new Error((r as any).erro);
      setData(r);
    } catch (e: any) {
      setErro(e.message || "Não foi possível carregar painel");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
    const interval = setInterval(carregar, 60000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============ AÇÕES ============

  async function abrirSugestaoRebal(op: Operador) {
    if (!userId) return;
    setModalRebal(op);
    setSugestao(null);
    setItensSelecionados(new Set());
    try {
      const sug = await rpc<SugestaoRebal>("fn_bpo_supervisor_sugerir_rebalanceamento", {
        p_supervisor_id: userId,
        p_user_origem_id: op.user_id,
        p_qtd: 10,
      });
      if ((sug as any).erro) {
        setErro((sug as any).erro);
        setModalRebal(null);
        return;
      }
      setSugestao(sug);
      // Pré-marca todos
      setItensSelecionados(new Set(sug.itens_sugeridos.map((i) => i.item_id)));
    } catch (e: any) {
      setErro(e.message || "Não foi possível calcular sugestão");
      setModalRebal(null);
    }
  }

  async function executarRebal() {
    if (!userId || !sugestao || itensSelecionados.size === 0) return;
    setExecutando(true);
    try {
      const r = await rpc<any>("fn_bpo_supervisor_executar_rebalanceamento", {
        p_supervisor_id: userId,
        p_item_ids: Array.from(itensSelecionados),
        p_destino_user_id: sugestao.destino.user_id,
        p_motivo: "Rebalanceamento de carga via painel supervisão",
      });
      setAviso(r.message || "Rebalanceamento concluído");
      setTimeout(() => setAviso(null), 5000);
      setModalRebal(null);
      setSugestao(null);
      await carregar();
    } catch (e: any) {
      setErro(e.message || "Não foi possível rebalancear");
    } finally {
      setExecutando(false);
    }
  }

  async function executarAtivarBackup() {
    if (!userId || !modalBackup) return;
    setExecutando(true);
    try {
      const r = await rpc<any>("fn_bpo_supervisor_ativar_backup", {
        p_company_id: modalBackup.company_id,
        p_supervisor_id: userId,
        p_motivo: "Ativação manual via painel supervisão",
      });
      setAviso(r.message || "Backup ativado");
      setTimeout(() => setAviso(null), 5000);
      setModalBackup(null);
      await carregar();
    } catch (e: any) {
      setErro(e.message || "Não foi possível ativar backup");
    } finally {
      setExecutando(false);
    }
  }

  function toggleItem(itemId: string) {
    const novo = new Set(itensSelecionados);
    if (novo.has(itemId)) novo.delete(itemId);
    else novo.add(itemId);
    setItensSelecionados(novo);
  }

  // ============ RENDER ============

  if (autorizado === false) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#FAF7F2]">
        <div className="max-w-md text-center">
          <div className="mb-4 text-5xl">🔒</div>
          <h2 className="text-xl font-semibold text-[#3D2314]">Acesso restrito</h2>
          <p className="mt-2 text-sm text-[#3D2314]/70">
            Apenas supervisores podem acessar o painel de supervisão.
          </p>
        </div>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#FAF7F2]">
        <div className="text-[#3D2314]">Carregando painel…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* HEADER */}
      <header className="border-b border-[#3D2314]/10 bg-[#FAF7F2] px-6 py-4">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-[#3D2314]">Supervisão BPO</h1>
              <p className="text-xs text-[#3D2314]/60">
                {data.kpis.total_empresas} empresas · {data.kpis.total_operadores} operadores ·
                atualiza a cada 1min
              </p>
            </div>
            <div className="flex gap-3">
              <KpiHeader label="Pendentes" valor={data.kpis.total_pendentes} />
              <KpiHeader
                label="Vencidos"
                valor={data.kpis.total_vencidos}
                tom={data.kpis.total_vencidos > 0 ? "vermelho" : undefined}
              />
              <KpiHeader
                label="SLA 7d"
                valor={data.tendencias.sla_compliance_pct_7d}
                sufixo="%"
                tom={data.tendencias.sla_compliance_pct_7d < 80 ? "vermelho" : "verde"}
              />
              <KpiHeader
                label="Críticos"
                valor={data.kpis.clientes_criticos}
                tom={data.kpis.clientes_criticos > 0 ? "vermelho" : undefined}
              />
            </div>
          </div>
        </div>
      </header>

      {(erro || aviso) && (
        <div className="mx-auto max-w-7xl px-6 pt-4">
          {erro && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>
          )}
          {aviso && (
            <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
              ✓ {aviso}
            </div>
          )}
        </div>
      )}

      <main className="mx-auto max-w-7xl px-6 py-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* OPERADORES */}
          <Quadrante titulo="👥 Operadores" cor="#3D2314">
            <div className="space-y-2">
              {data.operadores.map((op) => (
                <div key={op.user_id} className={`rounded-lg p-3 ${corCarga(op.status_carga).bg}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-[#3D2314]">{op.nome}</div>
                      <div className="text-xs text-[#3D2314]/60">
                        {op.empresas_titular} titular · {op.empresas_backup} backup ·{" "}
                        {op.resolvidos_hoje} hoje
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-[#3D2314]">{op.pendentes}</div>
                      {op.vencidos > 0 && (
                        <div className="text-xs text-red-600">{op.vencidos} venc.</div>
                      )}
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${corCarga(op.status_carga).pill}`}
                    >
                      {op.status_carga}
                    </span>
                  </div>
                  {/* AÇÃO: Rebalancear se sobrecarregado/alta */}
                  {(op.status_carga === "sobrecarregado" || op.status_carga === "alta") && (
                    <div className="mt-2 flex justify-end">
                      <button
                        onClick={() => abrirSugestaoRebal(op)}
                        className="rounded-lg bg-[#C8941A] px-3 py-1 text-xs font-medium text-white hover:bg-[#A87810]"
                      >
                        ⚖ Rebalancear carga
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Quadrante>

          {/* CLIENTES */}
          <Quadrante titulo="🏢 Clientes" cor="#C8941A">
            <div className="space-y-2">
              {data.clientes.map((cli) => (
                <div
                  key={cli.company_id}
                  className={`rounded-lg p-3 ${corStatusCliente(cli.status).bg}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <a
                      href={`/dashboard/bpo/foco/${cli.company_id}`}
                      className="flex-1 hover:underline"
                    >
                      <div className="text-sm font-semibold text-[#3D2314]">{cli.nome}</div>
                      <div className="text-xs text-[#3D2314]/60">
                        Titular: {cli.titular_email?.split("@")[0] || "—"}
                        {cli.pendentes > 0 && ` · ${cli.pendentes} pend.`}
                        {cli.vencidos > 0 && ` · ${cli.vencidos} venc.`}
                      </div>
                    </a>
                    <div className={`rounded-lg px-3 py-1 text-center ${corStatusCliente(cli.status).score}`}>
                      <div className="text-lg font-bold leading-none">{cli.score}</div>
                      <div className="text-[10px]">/100</div>
                    </div>
                  </div>
                  {/* AÇÃO: Ativar backup se crítico */}
                  {cli.status === "critico" && (
                    <div className="mt-2 flex justify-end gap-1">
                      <button
                        onClick={() => setModalBackup(cli)}
                        className="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
                      >
                        🆘 Ativar backup
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Quadrante>

          {/* ALERTAS CRÍTICOS */}
          <Quadrante titulo="🚨 Alertas críticos" cor="#dc2626">
            <div className="max-h-[500px] space-y-2 overflow-y-auto">
              {data.alertas_criticos.length === 0 ? (
                <div className="rounded-lg bg-emerald-50 p-4 text-center text-sm text-emerald-800">
                  ✅ Nenhum alerta crítico no momento
                </div>
              ) : (
                data.alertas_criticos.slice(0, 15).map((al) => (
                  <div key={al.item_id} className="rounded-lg bg-red-50 p-3">
                    <div className="text-xs font-semibold text-red-900">{al.empresa}</div>
                    <div className="mt-0.5 text-sm text-[#3D2314]">{al.titulo}</div>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-[#3D2314]/60">→ {al.assigned_to_nome}</span>
                      <span className="rounded bg-red-600 px-2 py-0.5 text-white">
                        {al.tipo_alerta === "vencido"
                          ? `vencido há ${Math.abs(al.horas_para_vencer)}h`
                          : al.tipo_alerta === "sem_operador"
                          ? "sem operador"
                          : `vence em ${al.horas_para_vencer}h`}
                      </span>
                    </div>
                  </div>
                ))
              )}
              {data.alertas_criticos.length > 15 && (
                <div className="rounded-lg bg-[#FAF7F2] p-2 text-center text-xs text-[#3D2314]/60">
                  + {data.alertas_criticos.length - 15} alertas adicionais
                </div>
              )}
            </div>
          </Quadrante>

          {/* TENDÊNCIAS */}
          <Quadrante titulo="📈 Tendências (7 dias)" cor="#10b981">
            <div className="grid grid-cols-2 gap-3">
              <CardTendencia
                label="Resolvidos esta semana"
                valor={data.tendencias.resolvidos_semana_atual}
                comp={data.tendencias.resolvidos_semana_passada}
                compLabel="vs semana passada"
              />
              <CardTendencia
                label="Novos esta semana"
                valor={data.tendencias.novos_semana_atual}
                comp={data.tendencias.novos_semana_passada}
                compLabel="vs semana passada"
                inverso
              />
              <div className="col-span-2 rounded-lg bg-[#FAF7F2] p-4">
                <div className="text-xs uppercase text-[#3D2314]/60">SLA compliance 7d</div>
                <div className="mt-1 flex items-center gap-3">
                  <div
                    className={`text-3xl font-bold ${
                      data.tendencias.sla_compliance_pct_7d >= 80 ? "text-emerald-700" : "text-red-700"
                    }`}
                  >
                    {data.tendencias.sla_compliance_pct_7d}%
                  </div>
                  <div className="flex-1">
                    <div className="h-2 overflow-hidden rounded-full bg-white">
                      <div
                        className={`h-full ${
                          data.tendencias.sla_compliance_pct_7d >= 80 ? "bg-emerald-500" : "bg-red-500"
                        }`}
                        style={{ width: `${Math.min(100, data.tendencias.sla_compliance_pct_7d)}%` }}
                      />
                    </div>
                    <div className="mt-1 text-xs text-[#3D2314]/60">Meta: ≥85%</div>
                  </div>
                </div>
              </div>
            </div>
          </Quadrante>
        </div>
      </main>

      {/* MODAL REBALANCEAR */}
      {modalRebal && (
        <Modal
          onClose={() => {
            setModalRebal(null);
            setSugestao(null);
          }}
          titulo="Rebalancear carga"
        >
          {!sugestao ? (
            <div className="text-sm text-[#3D2314]/60">Calculando sugestão…</div>
          ) : (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-red-50 p-3">
                  <div className="text-xs uppercase text-red-800">Origem</div>
                  <div className="mt-1 font-semibold text-[#3D2314]">{modalRebal.nome}</div>
                  <div className="text-xs text-[#3D2314]/60">
                    {sugestao.origem.carga_atual} pendentes
                  </div>
                </div>
                <div className="rounded-lg bg-emerald-50 p-3">
                  <div className="text-xs uppercase text-emerald-800">Destino sugerido</div>
                  <div className="mt-1 font-semibold text-[#3D2314]">
                    {sugestao.destino.email.split("@")[0]}
                  </div>
                  <div className="text-xs text-[#3D2314]/60">
                    {sugestao.destino.carga_atual} pendentes
                  </div>
                </div>
              </div>
              <div className="mb-3 text-xs text-[#3D2314]/70">
                Selecionados: <strong>{itensSelecionados.size}</strong> de{" "}
                {sugestao.itens_sugeridos.length} itens não-urgentes
              </div>
              <div className="mb-4 max-h-[300px] space-y-1 overflow-y-auto">
                {sugestao.itens_sugeridos.map((it) => (
                  <label
                    key={it.item_id}
                    className="flex cursor-pointer items-center gap-2 rounded bg-[#FAF7F2] p-2 text-sm hover:bg-white"
                  >
                    <input
                      type="checkbox"
                      checked={itensSelecionados.has(it.item_id)}
                      onChange={() => toggleItem(it.item_id)}
                      className="h-4 w-4 rounded accent-[#C8941A]"
                    />
                    <div className="flex-1">
                      <div className="text-[#3D2314]">{it.titulo}</div>
                      <div className="text-xs text-[#3D2314]/60">{it.empresa}</div>
                    </div>
                    <span className="text-xs text-[#3D2314]/50">{it.prioridade}</span>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setModalRebal(null);
                    setSugestao(null);
                  }}
                  className="flex-1 rounded-lg bg-[#FAF7F2] py-2 text-sm text-[#3D2314] hover:bg-[#FAF7F2]/70"
                >
                  Cancelar
                </button>
                <button
                  onClick={executarRebal}
                  disabled={itensSelecionados.size === 0 || executando}
                  className="flex-1 rounded-lg bg-[#3D2314] py-2 text-sm text-[#FAF7F2] hover:bg-[#5C3A24] disabled:opacity-50"
                >
                  {executando ? "Movendo…" : `Mover ${itensSelecionados.size} itens`}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* MODAL ATIVAR BACKUP */}
      {modalBackup && (
        <Modal onClose={() => setModalBackup(null)} titulo="🆘 Ativar backup">
          <div className="rounded-lg bg-yellow-50 p-3 text-sm text-yellow-900">
            <strong>Atenção:</strong> ativar o backup significa que o operador <strong>backup</strong>{" "}
            assumirá <strong>todos</strong> os itens pendentes do <strong>titular atual</strong>{" "}
            desta empresa. Os papéis serão invertidos automaticamente.
          </div>
          <div className="mt-3 rounded-lg bg-[#FAF7F2] p-3">
            <div className="text-xs uppercase text-[#3D2314]/60">Empresa</div>
            <div className="font-semibold text-[#3D2314]">{modalBackup.nome}</div>
            <div className="mt-2 text-xs text-[#3D2314]/60">Titular atual</div>
            <div className="text-sm text-[#3D2314]">{modalBackup.titular_email || "—"}</div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setModalBackup(null)}
              className="flex-1 rounded-lg bg-[#FAF7F2] py-2 text-sm text-[#3D2314] hover:bg-[#FAF7F2]/70"
            >
              Cancelar
            </button>
            <button
              onClick={executarAtivarBackup}
              disabled={executando}
              className="flex-1 rounded-lg bg-red-600 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
            >
              {executando ? "Ativando…" : "Confirmar ativação"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============ AUX ============

function Modal({
  onClose,
  titulo,
  children,
}: {
  onClose: () => void;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#3D2314]/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-w-2xl w-full rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#3D2314]">{titulo}</h2>
          <button onClick={onClose} className="text-[#3D2314]/60 hover:text-[#3D2314]">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function KpiHeader({
  label,
  valor,
  sufixo,
  tom,
}: {
  label: string;
  valor: number;
  sufixo?: string;
  tom?: "vermelho" | "verde";
}) {
  const cor =
    tom === "vermelho" ? "text-red-700" : tom === "verde" ? "text-emerald-700" : "text-[#3D2314]";
  return (
    <div className="text-right">
      <div className="text-xs text-[#3D2314]/60">{label}</div>
      <div className={`text-xl font-bold ${cor}`}>
        {valor}
        {sufixo}
      </div>
    </div>
  );
}

function Quadrante({
  titulo,
  cor,
  children,
}: {
  titulo: string;
  cor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-[#FAF7F2] p-4">
      <h2 className="mb-3 text-sm font-semibold" style={{ color: cor }}>
        {titulo}
      </h2>
      {children}
    </div>
  );
}

function CardTendencia({
  label,
  valor,
  comp,
  compLabel,
  inverso,
}: {
  label: string;
  valor: number;
  comp: number;
  compLabel: string;
  inverso?: boolean;
}) {
  const diff = comp === 0 ? 0 : ((valor - comp) / comp) * 100;
  const positivo = inverso ? diff <= 0 : diff >= 0;
  return (
    <div className="rounded-lg bg-white p-3">
      <div className="text-xs uppercase text-[#3D2314]/60">{label}</div>
      <div className="mt-1 text-2xl font-bold text-[#3D2314]">{valor}</div>
      {comp !== 0 && (
        <div className={`text-xs ${positivo ? "text-emerald-700" : "text-red-700"}`}>
          {diff > 0 ? "↑" : "↓"} {Math.abs(Math.round(diff))}% {compLabel}
        </div>
      )}
    </div>
  );
}

function corCarga(s: string) {
  const map: Record<string, { bg: string; pill: string }> = {
    sobrecarregado: { bg: "bg-red-50", pill: "bg-red-200 text-red-900" },
    alta: { bg: "bg-yellow-50", pill: "bg-yellow-200 text-yellow-900" },
    normal: { bg: "bg-white", pill: "bg-blue-200 text-blue-900" },
    leve: { bg: "bg-white", pill: "bg-emerald-200 text-emerald-900" },
    livre: { bg: "bg-white", pill: "bg-[#FAF7F2] text-[#3D2314]/60" },
  };
  return map[s] || map.normal;
}

function corStatusCliente(s: string) {
  const map: Record<string, { bg: string; score: string }> = {
    critico: { bg: "bg-red-50", score: "bg-red-200 text-red-900" },
    atencao: { bg: "bg-yellow-50", score: "bg-yellow-200 text-yellow-900" },
    ok: { bg: "bg-white", score: "bg-emerald-200 text-emerald-900" },
  };
  return map[s] || map.ok;
}
