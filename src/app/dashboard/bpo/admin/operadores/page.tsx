// src/app/dashboard/bpo/admin/operadores/page.tsx
// Lista operadores BPO + editor de skills + indicadores de carga

"use client";

import { useEffect, useState } from "react";
import { rpc } from "@/lib/authFetch";
import AdminGuard from "@/components/bpo/AdminGuard";
import SkillsEditor from "@/components/bpo/SkillsEditor";

interface Operador {
  user_id: string;
  email: string;
  empresas_titular: number;
  empresas_backup: number;
  empresas_supervisor: number;
  skills: Record<string, string>;
  inbox_pendente: number;
  inbox_vencido: number;
}

export default function OperadoresPage() {
  const [operadores, setOperadores] = useState<Operador[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  async function carregar() {
    setLoading(true);
    setErro(null);
    try {
      const data = await rpc<Operador[]>("fn_bpo_admin_listar_operadores");
      setOperadores(data || []);
    } catch (e: any) {
      setErro(e.message || "Não foi possível listar operadores");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditando(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const filtrados = operadores.filter((o) =>
    o.email.toLowerCase().includes(busca.toLowerCase())
  );

  return (
    <AdminGuard>
      <div className="min-h-screen bg-white p-6">
        <div className="mx-auto max-w-6xl">
          {/* Header */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <a href="/dashboard/bpo/admin" className="text-sm text-[#C8941A] hover:underline">
                ← Voltar ao Admin BPO
              </a>
              <h1 className="mt-2 text-2xl font-bold text-[#3D2314]">Operadores</h1>
              <p className="mt-1 text-sm text-[#3D2314]/70">
                Skills e carga atual da equipe BPO. Pressione <kbd className="rounded bg-[#FAF7F2] px-1.5 py-0.5 text-xs">Esc</kbd> para fechar editor.
              </p>
            </div>
            <input
              type="text"
              placeholder="Buscar por e-mail…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="rounded-lg border border-[#3D2314]/10 bg-[#FAF7F2] px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
            />
          </div>

          {erro && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
              {erro}
            </div>
          )}

          {loading ? (
            <div className="text-[#3D2314]/60">Carregando operadores…</div>
          ) : operadores.length === 0 ? (
            <div className="rounded-2xl bg-[#FAF7F2] p-12 text-center">
              <div className="mb-4 text-5xl">👥</div>
              <h3 className="text-lg font-semibold text-[#3D2314]">
                Nenhum operador cadastrado ainda
              </h3>
              <p className="mt-2 text-sm text-[#3D2314]/70">
                Operadores aparecem aqui automaticamente quando recebem skills ou são atribuídos a empresas.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtrados.map((op) => (
                <div
                  key={op.user_id}
                  className="rounded-2xl bg-[#FAF7F2] p-4 transition hover:shadow-md"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-[#3D2314]">
                        {op.email.split("@")[0]}
                      </div>
                      <div className="text-xs text-[#3D2314]/60">{op.email}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <Pill cor="dourado">{op.empresas_titular} titular</Pill>
                        <Pill cor="azul">{op.empresas_backup} backup</Pill>
                        <Pill cor="espresso">{op.empresas_supervisor} supervisor</Pill>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {Object.entries(op.skills).map(([cat, niv]) => (
                          <SkillChip key={cat} categoria={cat} nivel={niv} />
                        ))}
                        {Object.keys(op.skills).length === 0 && (
                          <span className="text-xs italic text-[#3D2314]/40">
                            sem skills cadastradas
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-[#3D2314]/60">Inbox</div>
                      <div
                        className={`text-2xl font-bold ${
                          op.inbox_vencido > 0
                            ? "text-red-700"
                            : op.inbox_pendente > 20
                            ? "text-yellow-700"
                            : "text-emerald-700"
                        }`}
                      >
                        {op.inbox_pendente}
                      </div>
                      {op.inbox_vencido > 0 && (
                        <div className="text-xs text-red-600">
                          {op.inbox_vencido} vencidos
                        </div>
                      )}
                      <button
                        onClick={() =>
                          setEditando(editando === op.user_id ? null : op.user_id)
                        }
                        className="mt-2 rounded-lg bg-[#3D2314] px-3 py-1.5 text-xs text-[#FAF7F2] hover:bg-[#5C3A24]"
                      >
                        {editando === op.user_id ? "Fechar" : "Editar skills"}
                      </button>
                    </div>
                  </div>

                  {editando === op.user_id && (
                    <div className="mt-4 border-t border-[#3D2314]/10 pt-4">
                      <SkillsEditor
                        userId={op.user_id}
                        skills={op.skills}
                        onChange={(novas) => {
                          setOperadores((prev) =>
                            prev.map((o) =>
                              o.user_id === op.user_id ? { ...o, skills: novas } : o
                            )
                          );
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminGuard>
  );
}

function Pill({ cor, children }: { cor: "dourado" | "azul" | "espresso"; children: React.ReactNode }) {
  const cores = {
    dourado: "bg-[#C8941A]/20 text-[#3D2314]",
    azul: "bg-blue-100 text-blue-800",
    espresso: "bg-[#3D2314] text-[#FAF7F2]",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 ${cores[cor]}`}>{children}</span>
  );
}

function SkillChip({ categoria, nivel }: { categoria: string; nivel: string }) {
  const cores: Record<string, string> = {
    expert: "bg-[#C8941A]/30 text-[#3D2314]",
    avancado: "bg-emerald-100 text-emerald-800",
    intermediario: "bg-blue-100 text-blue-800",
    iniciante: "bg-yellow-100 text-yellow-800",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs ${cores[nivel] || "bg-gray-100"}`}>
      {categoria}: {nivel}
    </span>
  );
}
