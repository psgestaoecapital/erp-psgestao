// src/app/dashboard/bpo/conversas/[id]/page.tsx
// ONDA 6 - Chat estilo WhatsApp

"use client";

import { useEffect, useState, useRef, use } from "react";
import { useRouter } from "next/navigation";
import { rpc, supabaseBrowser } from "@/lib/authFetch";

interface Mensagem {
  id: string;
  autor: "operador" | "cliente" | "sistema";
  autor_user_id: string | null;
  autor_nome: string | null;
  texto: string;
  canal_origem: string;
  canais_envio: string[] | null;
  enviado_em: string | null;
  lido_por_cliente_em: string | null;
  lido_por_operador_em: string | null;
  created_at: string;
}

interface Conversa {
  id: string;
  company_id: string;
  assunto: string;
  contexto_tipo: string;
  status: string;
  prioridade: string;
  cliente_nome: string;
  cliente_email: string | null;
  cliente_whatsapp: string | null;
  operador_responsavel_id: string;
  sla_resposta_em: string | null;
}

interface Empresa {
  nome_fantasia: string | null;
  razao_social: string;
  cnpj: string;
}

export default function ConversaDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [conversa, setConversa] = useState<Conversa | null>(null);
  const [empresa, setEmpresa] = useState<Empresa | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [textoNovo, setTextoNovo] = useState("");
  const [canaisSelecionados, setCanaisSelecionados] = useState<string[]>(["portal"]);
  const [enviando, setEnviando] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // Modal cola resposta externa
  const [modalCola, setModalCola] = useState(false);
  const [canalCola, setCanalCola] = useState<"whatsapp_manual" | "email_manual">("whatsapp_manual");
  const [textoCola, setTextoCola] = useState("");

  const fimDoChatRef = useRef<HTMLDivElement>(null);

  async function carregar() {
    setLoading(true);
    try {
      const supabase = supabaseBrowser();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/login"); return; }
      setUserId(user.id);

      const { data: conv, error: errConv } = await supabase
        .from("bpo_conversas")
        .select("*")
        .eq("id", id)
        .single();
      if (errConv) throw errConv;
      setConversa(conv as Conversa);

      const { data: emp } = await supabase
        .from("companies")
        .select("nome_fantasia, razao_social, cnpj")
        .eq("id", (conv as any).company_id)
        .single();
      setEmpresa(emp as Empresa);

      const { data: msgs, error: errMsgs } = await supabase
        .from("bpo_mensagens")
        .select("*")
        .eq("conversa_id", id)
        .order("created_at", { ascending: true });
      if (errMsgs) throw errMsgs;
      setMensagens((msgs || []) as Mensagem[]);

      // Marcar como lida
      await rpc("fn_bpo_conversa_marcar_lida", { p_conversa_id: id, p_user_id: user.id });
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [id]);

  useEffect(() => {
    fimDoChatRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);

  async function enviarMensagem() {
    if (!textoNovo.trim() || !userId || canaisSelecionados.length === 0) return;
    setEnviando(true);
    try {
      await rpc("fn_bpo_mensagem_enviar", {
        p_conversa_id: id,
        p_texto: textoNovo,
        p_canais_envio: canaisSelecionados,
        p_user_id: userId,
      });

      // Se canal WhatsApp manual selecionado, abre WhatsApp Web
      if (canaisSelecionados.includes("whatsapp_manual") && conversa?.cliente_whatsapp) {
        const numero = conversa.cliente_whatsapp.replace(/\D/g, "");
        const msg = encodeURIComponent(textoNovo);
        window.open(`https://wa.me/${numero}?text=${msg}`, "_blank");
      }

      // Se email manual selecionado, abre mailto
      if (canaisSelecionados.includes("email_manual") && conversa?.cliente_email) {
        const subject = encodeURIComponent(conversa.assunto);
        const body = encodeURIComponent(textoNovo);
        window.open(`mailto:${conversa.cliente_email}?subject=${subject}&body=${body}`, "_blank");
      }

      setTextoNovo("");
      setAviso("Mensagem registrada");
      setTimeout(() => setAviso(null), 3000);
      await carregar();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setEnviando(false);
    }
  }

  async function colarRespostaExterna() {
    if (!textoCola.trim() || !userId || !conversa) return;
    setEnviando(true);
    try {
      await rpc("fn_bpo_mensagem_receber_externa", {
        p_conversa_id: id,
        p_canal: canalCola,
        p_texto: textoCola,
        p_autor_nome: conversa.cliente_nome || "Cliente",
        p_user_id: userId,
      });
      setTextoCola("");
      setModalCola(false);
      setAviso("Resposta do cliente registrada");
      setTimeout(() => setAviso(null), 3000);
      await carregar();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setEnviando(false);
    }
  }

  async function resolver() {
    if (!confirm("Marcar essa conversa como resolvida?")) return;
    try {
      await rpc("fn_bpo_conversa_resolver", { p_conversa_id: id, p_user_id: userId });
      router.push("/dashboard/bpo/conversas");
    } catch (e: any) {
      setErro(e.message);
    }
  }

  function toggleCanal(c: string) {
    setCanaisSelecionados((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  }

  if (loading || !conversa || !empresa) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#FAF7F2]">
        <div className="text-[#3D2314]">Carregando conversa...</div>
      </div>
    );
  }

  const empresaNome = empresa.nome_fantasia || empresa.razao_social;

  return (
    <div className="flex h-screen flex-col bg-white">
      {/* HEADER */}
      <header className="border-b border-[#3D2314]/10 bg-[#FAF7F2] px-6 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <a
              href="/dashboard/bpo/conversas"
              className="rounded-full bg-white p-2 text-[#3D2314] hover:bg-[#3D2314]/10"
              aria-label="Voltar"
            >
              ←
            </a>
            <div>
              <div className="font-semibold text-[#3D2314]">{empresaNome}</div>
              <div className="text-xs text-[#3D2314]/60">
                {conversa.cliente_nome} · {conversa.assunto}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setModalCola(true)}
              className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-[#3D2314] hover:bg-[#FAF7F2]"
              title="Colar resposta vinda de WhatsApp ou email"
            >
              📋 Colar resposta
            </button>
            {conversa.status !== "resolvida" && (
              <button
                onClick={resolver}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                ✓ Resolver
              </button>
            )}
          </div>
        </div>
      </header>

      {(erro || aviso) && (
        <div className="px-6 pt-2">
          {erro && <div className="rounded bg-red-50 p-2 text-xs text-red-800">{erro}</div>}
          {aviso && <div className="rounded bg-emerald-50 p-2 text-xs text-emerald-800">✓ {aviso}</div>}
        </div>
      )}

      {/* CHAT */}
      <main className="flex-1 overflow-y-auto bg-[#FAF7F2] px-4 py-4">
        <div className="mx-auto max-w-3xl space-y-3">
          {mensagens.map((m) => (
            <MensagemBubble key={m.id} m={m} />
          ))}
          <div ref={fimDoChatRef} />
        </div>
      </main>

      {/* COMPOSITOR */}
      {conversa.status !== "resolvida" && conversa.status !== "arquivada" && (
        <div className="border-t border-[#3D2314]/10 bg-white p-4">
          <div className="mx-auto max-w-3xl">
            {/* Canais */}
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[#3D2314]/60">Enviar via:</span>
              <CanalChip
                label="📱 Portal"
                ativo={canaisSelecionados.includes("portal")}
                onClick={() => toggleCanal("portal")}
              />
              {conversa.cliente_whatsapp && (
                <CanalChip
                  label="💬 WhatsApp"
                  ativo={canaisSelecionados.includes("whatsapp_manual")}
                  onClick={() => toggleCanal("whatsapp_manual")}
                  hint="Vai abrir WhatsApp Web pré-preenchido"
                />
              )}
              {conversa.cliente_email && (
                <CanalChip
                  label="✉ Email"
                  ativo={canaisSelecionados.includes("email_manual")}
                  onClick={() => toggleCanal("email_manual")}
                  hint="Vai abrir seu cliente de email"
                />
              )}
            </div>

            {/* Textarea */}
            <div className="flex items-end gap-2">
              <textarea
                value={textoNovo}
                onChange={(e) => setTextoNovo(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault();
                    enviarMensagem();
                  }
                }}
                placeholder="Digite sua mensagem... (Ctrl+Enter para enviar)"
                rows={2}
                className="flex-1 resize-none rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
              />
              <button
                onClick={enviarMensagem}
                disabled={!textoNovo.trim() || canaisSelecionados.length === 0 || enviando}
                className="rounded-lg bg-[#3D2314] px-4 py-3 text-sm font-semibold text-[#FAF7F2] hover:bg-[#5C3A24] disabled:opacity-50"
              >
                {enviando ? "..." : "Enviar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL COLA RESPOSTA */}
      {modalCola && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#3D2314]/60 p-4"
          onClick={() => setModalCola(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#3D2314]">Colar resposta do cliente</h2>
              <button onClick={() => setModalCola(false)} className="text-[#3D2314]/60">✕</button>
            </div>
            <p className="mb-3 text-sm text-[#3D2314]/70">
              Cole aqui a resposta que o cliente enviou por WhatsApp ou email externo. Ela será registrada na conversa.
            </p>
            <div className="mb-3 flex gap-2">
              <button
                onClick={() => setCanalCola("whatsapp_manual")}
                className={`flex-1 rounded-lg py-2 text-sm font-medium ${
                  canalCola === "whatsapp_manual"
                    ? "bg-emerald-600 text-white"
                    : "bg-[#FAF7F2] text-[#3D2314]"
                }`}
              >
                💬 WhatsApp
              </button>
              <button
                onClick={() => setCanalCola("email_manual")}
                className={`flex-1 rounded-lg py-2 text-sm font-medium ${
                  canalCola === "email_manual"
                    ? "bg-blue-600 text-white"
                    : "bg-[#FAF7F2] text-[#3D2314]"
                }`}
              >
                ✉ Email
              </button>
            </div>
            <textarea
              value={textoCola}
              onChange={(e) => setTextoCola(e.target.value)}
              placeholder="Cole o texto da resposta do cliente aqui..."
              rows={5}
              className="w-full rounded-lg border border-[#3D2314]/10 bg-white p-3 text-sm focus:border-[#C8941A] focus:outline-none"
            />
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setModalCola(false)}
                className="flex-1 rounded-lg bg-[#FAF7F2] py-2 text-sm text-[#3D2314]"
              >
                Cancelar
              </button>
              <button
                onClick={colarRespostaExterna}
                disabled={!textoCola.trim() || enviando}
                className="flex-1 rounded-lg bg-[#3D2314] py-2 text-sm text-[#FAF7F2] disabled:opacity-50"
              >
                {enviando ? "Registrando..." : "Registrar resposta"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MensagemBubble({ m }: { m: Mensagem }) {
  const eOperador = m.autor === "operador";
  const eSistema = m.autor === "sistema";

  if (eSistema) {
    return (
      <div className="flex justify-center">
        <div className="rounded-full bg-white px-3 py-1 text-xs text-[#3D2314]/60">
          {m.texto}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${eOperador ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2 shadow-sm ${
          eOperador
            ? "bg-[#3D2314] text-[#FAF7F2]"
            : "bg-white text-[#3D2314]"
        }`}
      >
        {!eOperador && m.autor_nome && (
          <div className="mb-1 text-xs font-semibold text-[#C8941A]">{m.autor_nome}</div>
        )}
        <div className="whitespace-pre-wrap text-sm">{m.texto}</div>
        <div className={`mt-1 flex items-center gap-2 text-[10px] ${
          eOperador ? "text-[#FAF7F2]/60" : "text-[#3D2314]/50"
        }`}>
          <span>{new Date(m.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          <CanalIcon canal={m.canal_origem} />
          {eOperador && m.canais_envio && m.canais_envio.length > 0 && (
            <span>→ {m.canais_envio.join(", ")}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function CanalIcon({ canal }: { canal: string }) {
  const m: Record<string, string> = {
    portal: "📱",
    whatsapp_manual: "💬",
    whatsapp_api: "💬",
    email_manual: "✉",
    email_api: "✉",
    sistema: "⚙",
  };
  return <span title={canal}>{m[canal] || "•"}</span>;
}

function CanalChip({ label, ativo, onClick, hint }: { label: string; ativo: boolean; onClick: () => void; hint?: string }) {
  return (
    <button
      onClick={onClick}
      title={hint}
      className={`rounded-full px-3 py-1 text-xs transition ${
        ativo
          ? "bg-[#C8941A] text-white"
          : "bg-[#FAF7F2] text-[#3D2314] hover:bg-[#3D2314]/10"
      }`}
    >
      {label}
    </button>
  );
}
