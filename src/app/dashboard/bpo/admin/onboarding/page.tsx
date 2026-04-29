// src/app/dashboard/bpo/admin/onboarding/page.tsx
// Wizard 5 passos: Empresa → Contrato → Atribuição → Serviços → Confirmar

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { rpc } from "@/lib/authFetch";
import AdminGuard from "@/components/bpo/AdminGuard";

const SERVICOS = [
  { key: "contas_pagar", label: "Contas a Pagar", default: true },
  { key: "contas_receber", label: "Contas a Receber", default: true },
  { key: "conciliacao_bancaria", label: "Conciliação Bancária", default: true },
  { key: "conciliacao_cartao", label: "Conciliação Cartão", default: false },
  { key: "classificacao_ia", label: "Classificação IA", default: true },
  { key: "cobranca", label: "Cobrança", default: false },
  { key: "emissao_boleto", label: "Emissão Boleto", default: false },
  { key: "emissao_nfe", label: "Emissão NFe", default: false },
  { key: "dre_mensal", label: "DRE Mensal", default: true },
  { key: "relatorio_ia", label: "Relatório IA", default: true },
  { key: "fechamento_mensal", label: "Fechamento Mensal", default: false },
  { key: "obrigacoes_fiscais", label: "Obrigações Fiscais", default: false },
] as const;

interface Usuario {
  user_id: string;
  email: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  // form state
  const [razaoSocial, setRazaoSocial] = useState("");
  const [nomeFantasia, setNomeFantasia] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [regime, setRegime] = useState<"simples" | "presumido" | "real">("simples");
  const [titularId, setTitularId] = useState("");
  const [backupId, setBackupId] = useState("");
  const [supervisorId, setSupervisorId] = useState("");
  const [servicos, setServicos] = useState<Record<string, boolean>>(
    SERVICOS.reduce((acc, s) => ({ ...acc, [s.key]: s.default }), {})
  );
  const [slaHoras, setSlaHoras] = useState(24);
  const [diaFechamento, setDiaFechamento] = useState(5);

  useEffect(() => {
    (async () => {
      try {
        const data = await rpc<Usuario[]>("fn_bpo_admin_listar_usuarios_disponiveis");
        setUsuarios(data || []);
      } catch (e: any) {
        setErro(e.message || "Não foi possível carregar usuários");
      }
    })();
  }, []);

  async function finalizar() {
    setSalvando(true);
    setErro(null);
    try {
      const res = await rpc<any>("fn_bpo_admin_onboarding_cliente", {
        p_razao_social: razaoSocial,
        p_nome_fantasia: nomeFantasia || razaoSocial,
        p_cnpj: cnpj,
        p_regime_tributario: regime,
        p_titular_user_id: titularId,
        p_backup_user_id: backupId,
        p_supervisor_user_id: supervisorId,
        p_servicos: servicos,
        p_sla_horas: slaHoras,
        p_dia_fechamento: diaFechamento,
      });
      if (res?.success) {
        setSucesso(`✅ Cliente cadastrado com sucesso! Redirecionando…`);
        setTimeout(() => router.push("/dashboard/bpo/admin/empresas"), 1500);
      } else {
        throw new Error(res?.message || "Resposta inesperada do servidor");
      }
    } catch (e: any) {
      setErro(e.message || "Não foi possível finalizar o cadastro");
    } finally {
      setSalvando(false);
    }
  }

  const podeAvancar1 = razaoSocial.length > 3 && cnpj.length >= 14;
  const podeAvancar2 = titularId && backupId && supervisorId &&
    titularId !== backupId && titularId !== supervisorId && backupId !== supervisorId;
  const podeAvancar3 = Object.values(servicos).some((v) => v);

  return (
    <AdminGuard>
      <div className="min-h-screen bg-white p-6">
        <div className="mx-auto max-w-3xl">
          <a href="/dashboard/bpo/admin" className="text-sm text-[#C8941A] hover:underline">
            ← Voltar ao Admin BPO
          </a>
          <h1 className="mt-2 text-2xl font-bold text-[#3D2314]">
            Onboarding cliente novo
          </h1>
          <p className="mt-1 text-sm text-[#3D2314]/70">
            5 passos para cadastrar empresa nova com contrato BPO ativo.
          </p>

          {/* Stepper */}
          <div className="my-6 flex items-center gap-2">
            {[1, 2, 3, 4, 5].map((s) => (
              <div key={s} className="flex flex-1 items-center gap-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                    s === step
                      ? "bg-[#3D2314] text-[#FAF7F2]"
                      : s < step
                      ? "bg-emerald-500 text-white"
                      : "bg-[#FAF7F2] text-[#3D2314]/40"
                  }`}
                >
                  {s < step ? "✓" : s}
                </div>
                {s < 5 && (
                  <div
                    className={`h-0.5 flex-1 ${
                      s < step ? "bg-emerald-500" : "bg-[#FAF7F2]"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>

          {erro && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
              {erro}
            </div>
          )}
          {sucesso && (
            <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
              {sucesso}
            </div>
          )}

          <div className="rounded-2xl bg-[#FAF7F2] p-6">
            {step === 1 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-[#3D2314]">
                  Passo 1 — Dados da empresa
                </h2>
                <Field label="Razão Social *">
                  <input
                    value={razaoSocial}
                    onChange={(e) => setRazaoSocial(e.target.value)}
                    className="w-full rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2"
                    placeholder="Ex: Empresa LTDA"
                  />
                </Field>
                <Field label="Nome Fantasia">
                  <input
                    value={nomeFantasia}
                    onChange={(e) => setNomeFantasia(e.target.value)}
                    className="w-full rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2"
                    placeholder="Ex: Empresa"
                  />
                </Field>
                <Field label="CNPJ *">
                  <input
                    value={cnpj}
                    onChange={(e) => setCnpj(e.target.value.replace(/\D/g, ""))}
                    className="w-full rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2"
                    placeholder="00000000000000"
                    maxLength={14}
                  />
                </Field>
                <Field label="Regime Tributário *">
                  <select
                    value={regime}
                    onChange={(e) => setRegime(e.target.value as any)}
                    className="w-full rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2"
                  >
                    <option value="simples">Simples Nacional</option>
                    <option value="presumido">Lucro Presumido</option>
                    <option value="real">Lucro Real</option>
                  </select>
                </Field>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-[#3D2314]">
                  Passo 2 — Atribuição de papéis
                </h2>
                <p className="text-sm text-[#3D2314]/70">
                  Os 3 papéis são obrigatórios. Devem ser pessoas diferentes.
                </p>
                <UsuarioSelect
                  label="Titular (operador principal) *"
                  value={titularId}
                  onChange={setTitularId}
                  usuarios={usuarios}
                  excluir={[backupId, supervisorId]}
                />
                <UsuarioSelect
                  label="Backup (substituto) *"
                  value={backupId}
                  onChange={setBackupId}
                  usuarios={usuarios}
                  excluir={[titularId, supervisorId]}
                />
                <UsuarioSelect
                  label="Supervisor *"
                  value={supervisorId}
                  onChange={setSupervisorId}
                  usuarios={usuarios}
                  excluir={[titularId, backupId]}
                />
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-[#3D2314]">
                  Passo 3 — Serviços contratados
                </h2>
                <p className="text-sm text-[#3D2314]/70">
                  Marque o que esse cliente contratou. Pode editar depois em /admin/contratos.
                </p>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  {SERVICOS.map((s) => (
                    <label
                      key={s.key}
                      className="flex cursor-pointer items-center gap-2 rounded-lg bg-white p-3 text-sm hover:bg-white/80"
                    >
                      <input
                        type="checkbox"
                        checked={servicos[s.key]}
                        onChange={(e) =>
                          setServicos({ ...servicos, [s.key]: e.target.checked })
                        }
                        className="h-4 w-4 rounded accent-[#C8941A]"
                      />
                      <span className="text-[#3D2314]">{s.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-[#3D2314]">
                  Passo 4 — Parâmetros do contrato
                </h2>
                <Field label="SLA (horas)">
                  <input
                    type="number"
                    value={slaHoras}
                    onChange={(e) => setSlaHoras(parseInt(e.target.value) || 24)}
                    className="w-full rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2"
                  />
                  <p className="mt-1 text-xs text-[#3D2314]/60">
                    Tempo máximo para resolver itens do inbox. Padrão 24h.
                  </p>
                </Field>
                <Field label="Dia de fechamento (1–28)">
                  <input
                    type="number"
                    min={1}
                    max={28}
                    value={diaFechamento}
                    onChange={(e) => setDiaFechamento(parseInt(e.target.value) || 5)}
                    className="w-full rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2"
                  />
                  <p className="mt-1 text-xs text-[#3D2314]/60">
                    Dia do mês para cliente receber DRE. Padrão dia 5.
                  </p>
                </Field>
              </div>
            )}

            {step === 5 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-[#3D2314]">
                  Passo 5 — Confirmar e ativar
                </h2>
                <div className="rounded-lg bg-white p-4 text-sm">
                  <Linha label="Razão Social" valor={razaoSocial} />
                  <Linha label="Nome Fantasia" valor={nomeFantasia || "—"} />
                  <Linha label="CNPJ" valor={cnpj} />
                  <Linha label="Regime" valor={regime} />
                  <Linha
                    label="Titular"
                    valor={usuarios.find((u) => u.user_id === titularId)?.email || "—"}
                  />
                  <Linha
                    label="Backup"
                    valor={usuarios.find((u) => u.user_id === backupId)?.email || "—"}
                  />
                  <Linha
                    label="Supervisor"
                    valor={usuarios.find((u) => u.user_id === supervisorId)?.email || "—"}
                  />
                  <Linha
                    label="Serviços"
                    valor={`${Object.values(servicos).filter(Boolean).length} selecionados`}
                  />
                  <Linha label="SLA" valor={`${slaHoras}h`} />
                  <Linha label="Fechamento" valor={`dia ${diaFechamento}`} />
                </div>
                <button
                  disabled={salvando}
                  onClick={finalizar}
                  className="w-full rounded-lg bg-[#3D2314] py-3 text-sm font-semibold text-[#FAF7F2] hover:bg-[#5C3A24] disabled:opacity-50"
                >
                  {salvando ? "Cadastrando…" : "Cadastrar e ativar contrato"}
                </button>
              </div>
            )}

            {/* Navegação */}
            <div className="mt-6 flex items-center justify-between border-t border-[#3D2314]/10 pt-4">
              <button
                disabled={step === 1 || salvando}
                onClick={() => setStep(step - 1)}
                className="rounded-lg px-4 py-2 text-sm text-[#3D2314] disabled:opacity-30"
              >
                ← Voltar
              </button>
              {step < 5 ? (
                <button
                  disabled={
                    (step === 1 && !podeAvancar1) ||
                    (step === 2 && !podeAvancar2) ||
                    (step === 3 && !podeAvancar3)
                  }
                  onClick={() => setStep(step + 1)}
                  className="rounded-lg bg-[#C8941A] px-6 py-2 text-sm font-medium text-white hover:bg-[#A87810] disabled:opacity-30"
                >
                  Avançar →
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </AdminGuard>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-[#3D2314]">{label}</label>
      {children}
    </div>
  );
}

function Linha({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex justify-between border-b border-[#3D2314]/5 py-1.5 last:border-0">
      <span className="text-[#3D2314]/60">{label}</span>
      <span className="font-medium text-[#3D2314]">{valor}</span>
    </div>
  );
}

function UsuarioSelect({
  label,
  value,
  onChange,
  usuarios,
  excluir,
}: {
  label: string;
  value: string;
  onChange: (uid: string) => void;
  usuarios: Usuario[];
  excluir: string[];
}) {
  return (
    <Field label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2"
      >
        <option value="">Selecione…</option>
        {usuarios
          .filter((u) => !excluir.includes(u.user_id))
          .map((u) => (
            <option key={u.user_id} value={u.user_id}>
              {u.email}
            </option>
          ))}
      </select>
    </Field>
  );
}
