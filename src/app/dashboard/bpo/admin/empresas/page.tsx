// src/app/dashboard/bpo/admin/empresas/page.tsx
// Lista empresas BPO + edição inline dos 3 papéis (titular/backup/supervisor)

"use client";

import { useEffect, useState } from "react";
import { rpc, supabaseBrowser } from "@/lib/authFetch";
import AdminGuard from "@/components/bpo/AdminGuard";
import AssignmentBadge from "@/components/bpo/AssignmentBadge";

interface Empresa {
  company_id: string;
  empresa: string;
  cnpj: string;
  regime_tributario: string;
  contrato_id: string;
  contrato_ativo: boolean;
  qtd_servicos: number;
  sla_horas: number;
  titular_email: string | null;
  titular_id: string | null;
  backup_email: string | null;
  backup_id: string | null;
  supervisor_email: string | null;
  supervisor_id: string | null;
  assignment_completo: boolean;
  assignment_motivos: string[];
  inbox_pendente: number;
  inbox_vencido: number;
  rotinas_ativas: number;
}

interface Usuario {
  user_id: string;
  email: string;
}

export default function EmpresasPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todas" | "incompletas">("todas");

  async function carregar() {
    setLoading(true);
    try {
      const supabase = supabaseBrowser();
      const [{ data: emp, error: e1 }, users] = await Promise.all([
        supabase.from("v_bpo_admin_painel").select("*").order("empresa"),
        rpc<Usuario[]>("fn_bpo_admin_listar_usuarios_disponiveis"),
      ]);
      if (e1) throw e1;
      setEmpresas((emp as Empresa[]) || []);
      setUsuarios(users || []);
    } catch (e: any) {
      setErro(e.message || "Não foi possível carregar empresas");
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

  async function reatribuir(company_id: string, papel: string, novo_user_id: string) {
    try {
      await rpc("fn_bpo_admin_reatribuir_papel", {
        p_company_id: company_id,
        p_papel: papel,
        p_novo_user_id: novo_user_id,
      });
      await carregar();
    } catch (e: any) {
      setErro(e.message || "Não foi possível reatribuir");
    }
  }

  const visiveis = empresas.filter((e) =>
    filtro === "incompletas" ? !e.assignment_completo : true
  );

  return (
    <AdminGuard>
      <div className="min-h-screen bg-white p-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6">
            <a href="/dashboard/bpo/admin" className="text-sm text-[#C8941A] hover:underline">
              ← Voltar ao Admin BPO
            </a>
            <h1 className="mt-2 text-2xl font-bold text-[#3D2314]">Empresas BPO</h1>
            <p className="mt-1 text-sm text-[#3D2314]/70">
              Atribuir titular, backup e supervisor para cada empresa.
            </p>
          </div>

          <div className="mb-4 flex gap-2">
            <button
              onClick={() => setFiltro("todas")}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                filtro === "todas"
                  ? "bg-[#3D2314] text-[#FAF7F2]"
                  : "bg-[#FAF7F2] text-[#3D2314]"
              }`}
            >
              Todas ({empresas.length})
            </button>
            <button
              onClick={() => setFiltro("incompletas")}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                filtro === "incompletas"
                  ? "bg-red-600 text-white"
                  : "bg-[#FAF7F2] text-[#3D2314]"
              }`}
            >
              Incompletas ({empresas.filter((e) => !e.assignment_completo).length})
            </button>
          </div>

          {erro && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
              {erro}
            </div>
          )}

          {loading ? (
            <div className="text-[#3D2314]/60">Carregando empresas…</div>
          ) : (
            <div className="space-y-3">
              {visiveis.map((emp) => (
                <div
                  key={emp.company_id}
                  className={`rounded-2xl p-4 ${
                    emp.assignment_completo ? "bg-[#FAF7F2]" : "bg-red-50"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="font-semibold text-[#3D2314]">{emp.empresa}</div>
                      <div className="text-xs text-[#3D2314]/60">
                        CNPJ: {emp.cnpj || "—"} · Regime: {emp.regime_tributario || "—"} ·{" "}
                        {emp.qtd_servicos} serviços · SLA {emp.sla_horas}h
                      </div>
                      <div className="mt-3">
                        <AssignmentBadge
                          titular={emp.titular_email}
                          backup={emp.backup_email}
                          supervisor={emp.supervisor_email}
                          completo={emp.assignment_completo}
                          motivos={emp.assignment_motivos}
                        />
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-[#3D2314]/60">Inbox</div>
                      <div
                        className={`text-2xl font-bold ${
                          emp.inbox_vencido > 0
                            ? "text-red-700"
                            : emp.inbox_pendente > 20
                            ? "text-yellow-700"
                            : "text-emerald-700"
                        }`}
                      >
                        {emp.inbox_pendente}
                      </div>
                      <div className="text-xs text-[#3D2314]/60">
                        {emp.rotinas_ativas} rotinas
                      </div>
                      <button
                        onClick={() =>
                          setEditando(editando === emp.company_id ? null : emp.company_id)
                        }
                        className="mt-2 rounded-lg bg-[#3D2314] px-3 py-1.5 text-xs text-[#FAF7F2] hover:bg-[#5C3A24]"
                      >
                        {editando === emp.company_id ? "Fechar" : "Editar papéis"}
                      </button>
                    </div>
                  </div>

                  {editando === emp.company_id && (
                    <div className="mt-4 grid grid-cols-1 gap-3 border-t border-[#3D2314]/10 pt-4 md:grid-cols-3">
                      <PapelSelect
                        label="Titular"
                        atual={emp.titular_id}
                        usuarios={usuarios}
                        onChange={(uid) => reatribuir(emp.company_id, "titular", uid)}
                      />
                      <PapelSelect
                        label="Backup"
                        atual={emp.backup_id}
                        usuarios={usuarios}
                        onChange={(uid) => reatribuir(emp.company_id, "backup", uid)}
                      />
                      <PapelSelect
                        label="Supervisor"
                        atual={emp.supervisor_id}
                        usuarios={usuarios}
                        onChange={(uid) => reatribuir(emp.company_id, "supervisor", uid)}
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

function PapelSelect({
  label,
  atual,
  usuarios,
  onChange,
}: {
  label: string;
  atual: string | null;
  usuarios: Usuario[];
  onChange: (uid: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[#3D2314]">{label}</label>
      <select
        value={atual || ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
      >
        <option value="" disabled>
          Selecionar…
        </option>
        {usuarios.map((u) => (
          <option key={u.user_id} value={u.user_id}>
            {u.email}
          </option>
        ))}
      </select>
    </div>
  );
}
