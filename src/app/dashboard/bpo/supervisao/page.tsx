// src/app/dashboard/bpo/supervisao/page.tsx
// Painel Supervisao - 4 quadrantes em 1 tela
// Acesso: apenas supervisores (verificacao via bpo_companies_assignment)

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

export default function SupervisaoPage() {
  const router = useRouter();
  const [data, setData] = useState<Painel | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [autorizado, setAutorizado] = useState<boolean | null>(null);

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

      // Verificar se eh supervisor
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
    const interval = setInterval(carregar, 60000); // refresh 1min
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
                {data.kpis.total_empresas} empresas · {data.kpis.total_operadores} operadores · atualiza a cada 1min
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

      {erro && (
        <div className="mx-auto max-w-7xl px-6 pt-4">
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-6 py-6">
        {/* QUADRANTES */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* OPERADORES */}
          <Quadrante titulo="👥 Operadores" cor="#3D2314">
            <div className="space-y-2">
              {data.operadores.map((op) => (
                <div
                  key={op.user_id}
                  className={`rounded-lg p-3 ${corCarga(op.status_carga).bg}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-[#3D2314]">{op.nome}</div>
                      <div className="text-xs text-[#3D2314]/60">
                        {op.empresas_titular} titular · {op.empresas_backup} backup · {op.resolvidos_hoje} hoje
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-[#3D2314]">{op.pendentes}</div>
                      {op.vencidos > 0 && (
                        <div className="text-xs text-red-600">{op.vencidos} venc.</div>
                      )}
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${corCarga(op.status_carga).pill}`}>
                      {op.status_carga}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Quadrante>

          {/* CLIENTES */}
          <Quadrante titulo="🏢 Clientes" cor="#C8941A">
            <div className="space-y-2">
              {data.clientes.map((cli) => (
                <a
                  key={cli.company_id}
                  href={`/dashboard/bpo/foco/${cli.company_id}`}
                  className={`block rounded-lg p-3 transition hover:shadow-md ${corStatusCliente(cli.status).bg}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-[#3D2314]">{cli.nome}</div>
                      <div className="text-xs text-[#3D2314]/60">
                        Titular: {cli.titular_email?.split("@")[0] || "—"}
                        {cli.pendentes > 0 && ` · ${cli.pendentes} pend.`}
                        {cli.vencidos > 0 && ` · ${cli.vencidos} venc.`}
                      </div>
                    </div>
                    <div className={`rounded-lg px-3 py-1 text-center ${corStatusCliente(cli.status).score}`}>
                      <div className="text-lg font-bold leading-none">{cli.score}</div>
                      <div className="text-[10px]">/100</div>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </Quadrante>

          {/* ALERTAS CRÍTICOS */}
          <Quadrante titulo="🚨 Alertas críticos" cor="#dc2626">
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
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
                  <div className={`text-3xl font-bold ${data.tendencias.sla_compliance_pct_7d >= 80 ? "text-emerald-700" : "text-red-700"}`}>
                    {data.tendencias.sla_compliance_pct_7d}%
                  </div>
                  <div className="flex-1">
                    <div className="h-2 overflow-hidden rounded-full bg-white">
                      <div
                        className={`h-full ${data.tendencias.sla_compliance_pct_7d >= 80 ? "bg-emerald-500" : "bg-red-500"}`}
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
  const cor = tom === "vermelho" ? "text-red-700" : tom === "verde" ? "text-emerald-700" : "text-[#3D2314]";
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
