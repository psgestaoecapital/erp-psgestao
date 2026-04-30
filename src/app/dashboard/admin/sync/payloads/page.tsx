// src/app/dashboard/admin/sync/payloads/page.tsx
// Lista de payloads em shadow_mode para revisão

"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { supabaseBrowser } from "@/lib/authFetch";
import {
  H1,
  Breadcrumb,
  StatusBadge,
  fmtDateTime,
  shortNome,
} from "../_components";

interface Payload {
  id: string;
  company_id: string;
  operacao: string;
  payload_request: any;
  payload_response: any;
  status: string;
  created_at: string;
  companies: {
    razao_social: string | null;
    nome_fantasia: string | null;
  } | null;
}

export default function PayloadsShadowPage() {
  const [payloads, setPayloads] = useState<Payload[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [filtroOp, setFiltroOp] = useState("");
  const [expandido, setExpandido] = useState<Set<string>>(new Set());

  async function carregar() {
    setLoading(true);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase
        .from("erp_outbox_sync")
        .select(
          "id, company_id, operacao, payload_request, payload_response, status, created_at, companies!inner(razao_social, nome_fantasia)"
        )
        .eq("shadow_run", true)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setPayloads((data as any[]) || []);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  function toggle(id: string) {
    setExpandido((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const empresasUnicas = Array.from(
    new Set(payloads.map((p) => p.company_id))
  )
    .map((cid) => {
      const p = payloads.find((x) => x.company_id === cid);
      return p ? { id: cid, nome: shortNome(p.companies || {}) } : null;
    })
    .filter(Boolean) as Array<{ id: string; nome: string }>;

  const operacoesUnicas = Array.from(new Set(payloads.map((p) => p.operacao)));

  const filtrados = payloads.filter((p) => {
    if (filtroEmpresa && p.company_id !== filtroEmpresa) return false;
    if (filtroOp && p.operacao !== filtroOp) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="px-6 pt-4 pb-2">
        <Breadcrumb
          items={[
            { label: "Início", href: "/dashboard" },
            { label: "Sync Multi-ERP", href: "/dashboard/admin/sync" },
            { label: "Payloads Shadow" },
          ]}
        />
      </div>

      <main className="mx-auto max-w-6xl px-6 py-6">
        <header className="mb-6">
          <H1>Payloads em Shadow Mode</H1>
          <p className="mt-1 text-sm text-[#3D2314]/60">
            Operações capturadas mas não enviadas ao provider. Revise antes de promover empresa para Write-back.
          </p>
        </header>

        {erro && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>
        )}

        {/* Filtros */}
        <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Empresa">
            <select
              value={filtroEmpresa}
              onChange={(e) => setFiltroEmpresa(e.target.value)}
              className="w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
            >
              <option value="">Todas</option>
              {empresasUnicas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Operação">
            <select
              value={filtroOp}
              onChange={(e) => setFiltroOp(e.target.value)}
              className="w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
            >
              <option value="">Todas</option>
              {operacoesUnicas.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </Field>
        </section>

        {/* Lista */}
        {loading ? (
          <div className="text-[#3D2314]/60">Carregando…</div>
        ) : filtrados.length === 0 ? (
          <div className="rounded-2xl border border-[#3D2314]/8 bg-white p-12 text-center">
            <h3 className="text-lg font-medium text-[#3D2314]">Nenhum payload em shadow</h3>
            <p className="mt-2 text-sm text-[#3D2314]/60">
              {payloads.length === 0
                ? "Nenhuma operação em shadow_mode ainda. Aguarde a primeira execução."
                : "Filtros não retornam resultados. Ajuste empresa ou operação."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtrados.map((p) => {
              const isOpen = expandido.has(p.id);
              return (
                <div
                  key={p.id}
                  className="overflow-hidden rounded-xl border border-[#3D2314]/8 bg-white shadow-sm"
                >
                  <button
                    onClick={() => toggle(p.id)}
                    className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-[#3D2314]/3"
                  >
                    <div className="flex items-center gap-3">
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      <div>
                        <div className="text-sm font-semibold text-[#3D2314]">
                          {shortNome(p.companies || {})}
                        </div>
                        <div className="text-xs text-[#3D2314]/60">
                          {p.operacao} · {fmtDateTime(p.created_at)}
                        </div>
                      </div>
                    </div>
                    <StatusBadge status={p.status} />
                  </button>

                  {isOpen && (
                    <div className="grid grid-cols-1 gap-3 border-t border-[#3D2314]/8 bg-[#FAF7F2] p-4 md:grid-cols-2">
                      <JsonBlock titulo="payload_request" data={p.payload_request} />
                      <JsonBlock titulo="payload_response" data={p.payload_response} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

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

function JsonBlock({ titulo, data }: { titulo: string; data: any }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#3D2314]/60">
        {titulo}
      </div>
      <pre className="max-h-80 overflow-auto rounded-lg border border-[#3D2314]/8 bg-white p-3 text-[11px] leading-relaxed text-[#3D2314]">
        {data ? JSON.stringify(data, null, 2) : "—"}
      </pre>
    </div>
  );
}
