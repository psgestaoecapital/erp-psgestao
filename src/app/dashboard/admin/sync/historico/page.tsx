// src/app/dashboard/admin/sync/historico/page.tsx
// Histórico paginado de operações sync com filtros

"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { supabaseBrowser } from "@/lib/authFetch";
import { H1, Breadcrumb, StatusBadge, fmtDateTime, shortNome } from "../_components";

interface Operacao {
  id: string;
  company_id: string;
  operacao: string;
  status: string;
  shadow_run: boolean;
  payload_request: any;
  payload_response: any;
  tentativas: number;
  created_at: string;
  companies: {
    razao_social: string | null;
    nome_fantasia: string | null;
  } | null;
}

interface Empresa {
  id: string;
  razao_social: string | null;
  nome_fantasia: string | null;
}

const STATUS_OPCOES = ["pendente", "em_processamento", "sucesso", "erro", "cancelado"];
const PERIODOS = [
  { v: "24h", label: "Últimas 24h", dias: 1 },
  { v: "7d", label: "7 dias", dias: 7 },
  { v: "30d", label: "30 dias", dias: 30 },
  { v: "all", label: "Tudo", dias: null },
];

const PAGE_SIZE = 20;

export default function HistoricoSyncPage() {
  const [ops, setOps] = useState<Operacao[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<Operacao | null>(null);

  const [fEmpresa, setFEmpresa] = useState("");
  const [fOp, setFOp] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fShadow, setFShadow] = useState<"todos" | "sim" | "nao">("todos");
  const [fPeriodo, setFPeriodo] = useState("7d");

  // Carrega lista de empresas para o select de filtro
  useEffect(() => {
    (async () => {
      try {
        const supabase = supabaseBrowser();
        const { data } = await supabase
          .from("erp_provider_config")
          .select("company_id, companies!inner(razao_social, nome_fantasia)");
        const lista = ((data as any[]) || []).map((r) => ({
          id: r.company_id,
          razao_social: r.companies?.razao_social || null,
          nome_fantasia: r.companies?.nome_fantasia || null,
        }));
        setEmpresas(lista);
      } catch {
        // silencioso — filtros ainda funcionam mesmo sem lista populada
      }
    })();
  }, []);

  async function carregar() {
    setLoading(true);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      let q = supabase
        .from("erp_outbox_sync")
        .select(
          "id, company_id, operacao, status, shadow_run, payload_request, payload_response, tentativas, created_at, companies!inner(razao_social, nome_fantasia)",
          { count: "exact" }
        )
        .order("created_at", { ascending: false });

      if (fEmpresa) q = q.eq("company_id", fEmpresa);
      if (fOp) q = q.eq("operacao", fOp);
      if (fStatus) q = q.eq("status", fStatus);
      if (fShadow === "sim") q = q.eq("shadow_run", true);
      if (fShadow === "nao") q = q.eq("shadow_run", false);

      const periodo = PERIODOS.find((p) => p.v === fPeriodo);
      if (periodo?.dias) {
        const desde = new Date();
        desde.setDate(desde.getDate() - periodo.dias);
        q = q.gte("created_at", desde.toISOString());
      }

      const { data, error, count: total } = await q.range(
        page * PAGE_SIZE,
        page * PAGE_SIZE + PAGE_SIZE - 1
      );
      if (error) throw error;
      setOps((data as any[]) || []);
      setCount(total || 0);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line
  }, [page, fEmpresa, fOp, fStatus, fShadow, fPeriodo]);

  // Resetar página ao mudar filtros
  useEffect(() => {
    setPage(0);
    // eslint-disable-next-line
  }, [fEmpresa, fOp, fStatus, fShadow, fPeriodo]);

  const totalPaginas = Math.ceil(count / PAGE_SIZE);

  function valorPayload(p: any): string {
    if (!p) return "—";
    const v = p.valor ?? p.valor_pago ?? p.amount ?? null;
    if (v === null || v === undefined) return "—";
    const n = typeof v === "string" ? parseFloat(v) : v;
    if (isNaN(n)) return String(v);
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="px-6 pt-4 pb-2">
        <Breadcrumb
          items={[
            { label: "Início", href: "/dashboard" },
            { label: "Sync Multi-ERP", href: "/dashboard/admin/sync" },
            { label: "Histórico" },
          ]}
        />
      </div>

      <main className="mx-auto max-w-7xl px-6 py-6">
        <header className="mb-6">
          <H1>Histórico Sync</H1>
          <p className="mt-1 text-sm text-[#3D2314]/60">
            Todas as operações registradas no Outbox · {count} resultado{count !== 1 ? "s" : ""}
          </p>
        </header>

        {erro && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>}

        {/* Filtros */}
        <section className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-[#3D2314]/8 bg-white p-4 shadow-sm md:grid-cols-5">
          <Field label="Empresa">
            <select
              value={fEmpresa}
              onChange={(e) => setFEmpresa(e.target.value)}
              className={selectCls}
            >
              <option value="">Todas</option>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {shortNome(e)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Operação">
            <input
              value={fOp}
              onChange={(e) => setFOp(e.target.value)}
              placeholder="ex: pagar.baixar"
              className={selectCls}
            />
          </Field>
          <Field label="Status">
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={selectCls}>
              <option value="">Todos</option>
              {STATUS_OPCOES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tipo">
            <select
              value={fShadow}
              onChange={(e) => setFShadow(e.target.value as any)}
              className={selectCls}
            >
              <option value="todos">Todos</option>
              <option value="sim">Apenas shadow</option>
              <option value="nao">Apenas real</option>
            </select>
          </Field>
          <Field label="Período">
            <select value={fPeriodo} onChange={(e) => setFPeriodo(e.target.value)} className={selectCls}>
              {PERIODOS.map((p) => (
                <option key={p.v} value={p.v}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
        </section>

        {/* Tabela */}
        <section className="overflow-x-auto rounded-xl border border-[#3D2314]/8 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-[#3D2314]/5 text-xs uppercase tracking-wider text-[#3D2314]/60">
              <tr>
                <th className="px-4 py-3 text-left">Data</th>
                <th className="px-4 py-3 text-left">Empresa</th>
                <th className="px-4 py-3 text-left">Operação</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-center">Shadow</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3 text-center">Tentativas</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#3D2314]/8">
              {loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[#3D2314]/50">
                    Carregando…
                  </td>
                </tr>
              )}
              {!loading && ops.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[#3D2314]/50">
                    Nenhuma operação encontrada com esses filtros
                  </td>
                </tr>
              )}
              {ops.map((op) => (
                <tr key={op.id} className="hover:bg-[#3D2314]/3">
                  <td className="px-4 py-3 text-[#3D2314]/70">{fmtDateTime(op.created_at)}</td>
                  <td className="px-4 py-3 text-[#3D2314]">{shortNome(op.companies || {})}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[#3D2314]/80">{op.operacao}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={op.status} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    {op.shadow_run ? (
                      <span title="Shadow run" className="text-yellow-700">
                        👤
                      </span>
                    ) : (
                      <span className="text-[#3D2314]/30">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-[#3D2314]">
                    {valorPayload(op.payload_request)}
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-[#3D2314]/70">
                    {op.tentativas}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setDetalhe(op)}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#3D2314]/12 bg-white px-2 py-1 text-xs text-[#3D2314] hover:bg-[#3D2314]/5"
                    >
                      <Eye size={12} />
                      Ver
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Paginação */}
        {totalPaginas > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <div className="text-xs text-[#3D2314]/60">
              Página {page + 1} de {totalPaginas}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="inline-flex items-center gap-1 rounded-lg border border-[#3D2314]/12 bg-white px-3 py-1.5 text-sm text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-40"
              >
                <ChevronLeft size={14} />
                Anterior
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPaginas - 1, p + 1))}
                disabled={page >= totalPaginas - 1}
                className="inline-flex items-center gap-1 rounded-lg border border-[#3D2314]/12 bg-white px-3 py-1.5 text-sm text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-40"
              >
                Próxima
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Modal detalhe */}
      {detalhe && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#3D2314]/60 p-4"
          onClick={() => setDetalhe(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-[#3D2314]">
                  {shortNome(detalhe.companies || {})}
                </h3>
                <p className="text-xs text-[#3D2314]/60">
                  {detalhe.operacao} · {fmtDateTime(detalhe.created_at)}
                </p>
              </div>
              <button
                onClick={() => setDetalhe(null)}
                className="text-[#3D2314]/60 hover:text-[#3D2314]"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#3D2314]/60">
                  payload_request
                </div>
                <pre className="max-h-80 overflow-auto rounded-lg border border-[#3D2314]/8 bg-[#FAF7F2] p-3 text-[11px] text-[#3D2314]">
                  {detalhe.payload_request ? JSON.stringify(detalhe.payload_request, null, 2) : "—"}
                </pre>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#3D2314]/60">
                  payload_response
                </div>
                <pre className="max-h-80 overflow-auto rounded-lg border border-[#3D2314]/8 bg-[#FAF7F2] p-3 text-[11px] text-[#3D2314]">
                  {detalhe.payload_response
                    ? JSON.stringify(detalhe.payload_response, null, 2)
                    : "—"}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const selectCls =
  "w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs uppercase tracking-wider text-[#3D2314]/60">
        {label}
      </label>
      {children}
    </div>
  );
}
