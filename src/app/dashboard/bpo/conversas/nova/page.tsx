// src/app/dashboard/bpo/conversas/nova/page.tsx
// ONDA 6 - Iniciar nova conversa com cliente

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { rpc, supabaseBrowser } from "@/lib/authFetch";

interface Empresa {
  id: string;
  nome_fantasia: string | null;
  razao_social: string;
}

const CONTEXTOS = [
  { v: "duvida_geral", label: "Dúvida geral" },
  { v: "fechamento_mensal", label: "Sobre fechamento mensal" },
  { v: "cobranca_documento", label: "Cobrança de documento" },
  { v: "urgencia", label: "Urgência" },
  { v: "outro", label: "Outro" },
];

export default function NovaConversaPage() {
  const router = useRouter();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [assunto, setAssunto] = useState("");
  const [contexto, setContexto] = useState("duvida_geral");
  const [prioridade, setPrioridade] = useState("normal");
  const [clienteNome, setClienteNome] = useState("");
  const [clienteEmail, setClienteEmail] = useState("");
  const [clienteWhatsapp, setClienteWhatsapp] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [canais, setCanais] = useState<string[]>(["portal"]);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const supabase = supabaseBrowser();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { router.replace("/login"); return; }

        // Carregar empresas BPO ativas que o operador pode acessar
        const { data, error } = await supabase
          .from("companies")
          .select("id, nome_fantasia, razao_social")
          .eq("is_active", true)
          .order("nome_fantasia");
        if (error) throw error;
        setEmpresas((data || []) as Empresa[]);
      } catch (e: any) {
        setErro(e.message);
      }
    })();
    // eslint-disable-next-line
  }, []);

  function toggleCanal(c: string) {
    setCanais((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  }

  async function iniciar() {
    if (!companyId || !assunto.trim() || !mensagem.trim() || canais.length === 0) {
      setErro("Preencha empresa, assunto, mensagem e ao menos 1 canal");
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      const { data: { user } } = await supabase.auth.getUser();

      const r = await rpc<any>("fn_bpo_conversa_iniciar", {
        p_company_id: companyId,
        p_assunto: assunto,
        p_contexto_tipo: contexto,
        p_contexto_id: null,
        p_mensagem_inicial: mensagem,
        p_canais_envio: canais,
        p_cliente_nome: clienteNome || null,
        p_cliente_email: clienteEmail || null,
        p_cliente_whatsapp: clienteWhatsapp || null,
        p_prioridade: prioridade,
        p_user_id: user?.id,
      });

      if (!r.success) throw new Error("Falha ao criar conversa");

      // Disparar canais externos
      if (canais.includes("whatsapp_manual") && clienteWhatsapp) {
        const numero = clienteWhatsapp.replace(/\D/g, "");
        const msg = encodeURIComponent(mensagem);
        window.open(`https://wa.me/${numero}?text=${msg}`, "_blank");
      }
      if (canais.includes("email_manual") && clienteEmail) {
        const sub = encodeURIComponent(assunto);
        const body = encodeURIComponent(mensagem);
        window.open(`mailto:${clienteEmail}?subject=${sub}&body=${body}`, "_blank");
      }

      router.push(`/dashboard/bpo/conversas/${r.conversa_id}`);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-[#3D2314]/10 bg-[#FAF7F2] px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <a href="/dashboard/bpo/conversas" className="text-sm text-[#C8941A] hover:underline">
            ← Voltar
          </a>
          <h1 className="mt-2 text-2xl font-bold text-[#3D2314]">Nova conversa</h1>
          <p className="text-xs text-[#3D2314]/60">
            Inicie uma comunicação com cliente. Tudo fica registrado no sistema.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-6 py-6">
        {erro && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>
        )}

        <Campo label="Empresa">
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="w-full rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
          >
            <option value="">Selecione...</option>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome_fantasia || e.razao_social}
              </option>
            ))}
          </select>
        </Campo>

        <Campo label="Assunto">
          <input
            type="text"
            value={assunto}
            onChange={(e) => setAssunto(e.target.value)}
            placeholder="Ex: Conciliação de fevereiro"
            className="w-full rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
          />
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Contexto">
            <select
              value={contexto}
              onChange={(e) => setContexto(e.target.value)}
              className="w-full rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2 text-sm"
            >
              {CONTEXTOS.map((c) => (
                <option key={c.v} value={c.v}>{c.label}</option>
              ))}
            </select>
          </Campo>
          <Campo label="Prioridade">
            <select
              value={prioridade}
              onChange={(e) => setPrioridade(e.target.value)}
              className="w-full rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2 text-sm"
            >
              <option value="baixa">Baixa</option>
              <option value="normal">Normal</option>
              <option value="alta">Alta</option>
              <option value="urgente">Urgente</option>
            </select>
          </Campo>
        </div>

        <div className="rounded-2xl bg-[#FAF7F2] p-4">
          <div className="text-sm font-semibold text-[#3D2314]">Contato no cliente</div>
          <p className="mb-3 mt-1 text-xs text-[#3D2314]/60">
            Preencha pelo menos um meio de contato.
          </p>
          <div className="space-y-3">
            <Campo label="Nome">
              <input
                type="text"
                value={clienteNome}
                onChange={(e) => setClienteNome(e.target.value)}
                placeholder="Ex: Maria Silva"
                className="w-full rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2 text-sm"
              />
            </Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Email">
                <input
                  type="email"
                  value={clienteEmail}
                  onChange={(e) => setClienteEmail(e.target.value)}
                  placeholder="cliente@empresa.com"
                  className="w-full rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2 text-sm"
                />
              </Campo>
              <Campo label="WhatsApp (com DDI/DDD)">
                <input
                  type="tel"
                  value={clienteWhatsapp}
                  onChange={(e) => setClienteWhatsapp(e.target.value)}
                  placeholder="5549991234567"
                  className="w-full rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2 text-sm"
                />
              </Campo>
            </div>
          </div>
        </div>

        <Campo label="Mensagem inicial">
          <textarea
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            placeholder="Olá! Estou entrando em contato sobre..."
            rows={5}
            className="w-full rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
          />
        </Campo>

        <Campo label="Enviar via">
          <div className="flex flex-wrap gap-2">
            <CanalChip label="📱 Portal" ativo={canais.includes("portal")} onClick={() => toggleCanal("portal")} />
            <CanalChip label="💬 WhatsApp" ativo={canais.includes("whatsapp_manual")} onClick={() => toggleCanal("whatsapp_manual")} hint={clienteWhatsapp ? "" : "Preencha WhatsApp acima"} disabled={!clienteWhatsapp} />
            <CanalChip label="✉ Email" ativo={canais.includes("email_manual")} onClick={() => toggleCanal("email_manual")} hint={clienteEmail ? "" : "Preencha email acima"} disabled={!clienteEmail} />
          </div>
          <p className="mt-2 text-xs text-[#3D2314]/60">
            WhatsApp abre WhatsApp Web pré-preenchido. Email abre seu cliente de email. Portal fica acessível pelo cliente via link.
          </p>
        </Campo>

        <div className="flex gap-2 pt-3">
          <button
            onClick={() => router.back()}
            className="flex-1 rounded-lg bg-[#FAF7F2] py-3 text-sm text-[#3D2314] hover:bg-[#3D2314]/10"
          >
            Cancelar
          </button>
          <button
            onClick={iniciar}
            disabled={enviando}
            className="flex-1 rounded-lg bg-[#3D2314] py-3 text-sm font-semibold text-[#FAF7F2] hover:bg-[#5C3A24] disabled:opacity-50"
          >
            {enviando ? "Iniciando..." : "Iniciar conversa"}
          </button>
        </div>
      </main>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs uppercase text-[#3D2314]/70">{label}</label>
      {children}
    </div>
  );
}

function CanalChip({
  label, ativo, onClick, hint, disabled,
}: {
  label: string; ativo: boolean; onClick: () => void; hint?: string; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={`rounded-full px-3 py-1.5 text-sm transition ${
        disabled
          ? "cursor-not-allowed bg-[#FAF7F2] text-[#3D2314]/30"
          : ativo
          ? "bg-[#C8941A] text-white"
          : "bg-[#FAF7F2] text-[#3D2314] hover:bg-[#3D2314]/10"
      }`}
    >
      {label}
    </button>
  );
}
