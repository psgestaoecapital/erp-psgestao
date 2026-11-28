"use client";
// Orçamento (CEO 24/11) — painel de FINALIZAÇÃO: depois de salvar, o usuário escolhe como entregar
// a proposta. Salvar funciona sozinho; o envio é sempre por ação do usuário, nunca automático.
// Reusa a proposta pública (hash_publico) e o link que já existem — NÃO recria PDF nem página pública.
// Lista de ações EXTENSÍVEL (o CEO pediu "várias opções"). RD-95/96/98/100, mobile.

import { useState } from "react";
import { X, Printer, Download, Mail, MessageCircle, Link2, Check } from "lucide-react";
import { supabaseBrowser } from "@/lib/authFetch";
import { APP_URL } from "@/lib/appUrl";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";

export interface OrcParaFinalizar {
  id: string;
  numero: string;
  hash_publico: string | null;
  cliente_nome?: string | null;
  cliente_email?: string | null;
  cliente_telefone?: string | null;
  pdf_url?: string | null;
}

function soDigitos(t: string | null | undefined): string {
  const d = (t || "").replace(/\D/g, "");
  if (!d) return "";
  // Brasil: se vier sem DDI (10–11 dígitos), prefixa 55.
  return d.length <= 11 ? "55" + d : d;
}

export function FinalizarOrcamentoModal({ orc, onClose }: { orc: OrcParaFinalizar; onClose: () => void }) {
  const [hash, setHash] = useState<string | null>(orc.hash_publico);
  const [msg, setMsg] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [busy, setBusy] = useState(false);

  // Garante o link público (gera o hash se ainda não existe) — mesma regra do "enviar" da lista.
  async function garantirHash(): Promise<string | null> {
    if (hash) return hash;
    setBusy(true);
    try {
      const novo = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "").slice(0, 40);
      const supabase = supabaseBrowser();
      const { error } = await supabase.from("erp_orcamentos").update({ hash_publico: novo }).eq("id", orc.id);
      if (error) { setMsg("❌ Não foi possível gerar o link da proposta."); return null; }
      setHash(novo);
      return novo;
    } finally { setBusy(false); }
  }

  async function registrarEnvio(canal: string) {
    try {
      const supabase = supabaseBrowser();
      await supabase.from("erp_orcamentos").update({ enviado_em: new Date().toISOString(), enviado_canal: canal }).eq("id", orc.id);
    } catch { /* registro é best-effort; não bloqueia o envio */ }
  }

  const link = (h: string) => `${APP_URL}/orcamento/${h}`;

  async function imprimir() {
    const h = await garantirHash(); if (!h) return;
    window.open(`${link(h)}?imprimir=1`, "_blank");
  }
  async function baixarPdf() {
    const h = await garantirHash(); if (!h) return;
    // PDF REAL (arquivo .pdf): rota /api/orcamento/<hash>/pdf (pdf-lib, cabeçalho dos 3 logos + itens + totais).
    window.open(`${APP_URL}/api/orcamento/${h}/pdf`, "_blank");
  }
  async function email() {
    const h = await garantirHash(); if (!h) return;
    const assunto = encodeURIComponent(`Proposta ${orc.numero}`);
    const corpo = encodeURIComponent(`Olá${orc.cliente_nome ? " " + orc.cliente_nome : ""}!\n\nSegue a proposta ${orc.numero}:\n${link(h)}\n\nQualquer dúvida, estou à disposição.`);
    window.open(`mailto:${orc.cliente_email || ""}?subject=${assunto}&body=${corpo}`, "_blank");
    registrarEnvio("email");
  }
  async function whatsapp() {
    const h = await garantirHash(); if (!h) return;
    const tel = soDigitos(orc.cliente_telefone);
    const texto = encodeURIComponent(`Olá${orc.cliente_nome ? " " + orc.cliente_nome : ""}! Segue a proposta ${orc.numero}: ${link(h)}`);
    window.open(tel ? `https://wa.me/${tel}?text=${texto}` : `https://wa.me/?text=${texto}`, "_blank");
    registrarEnvio("whatsapp");
  }
  async function copiarLink() {
    const h = await garantirHash(); if (!h) return;
    try { await navigator.clipboard.writeText(link(h)); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }
    catch { setMsg("Link: " + link(h)); }
  }

  // Lista EXTENSÍVEL de canais — acrescentar um novo canal = uma linha aqui.
  const acoes: Array<{ id: string; label: string; descricao: string; icon: typeof Printer; cor: string; onClick: () => void }> = [
    { id: "imprimir", label: "Imprimir", descricao: "Abre a proposta e manda para a impressora", icon: Printer, cor: "#3D2314", onClick: imprimir },
    { id: "pdf", label: "Baixar PDF", descricao: "Salva a proposta em PDF", icon: Download, cor: "#2563EB", onClick: baixarPdf },
    { id: "email", label: "Enviar por e-mail", descricao: orc.cliente_email ? `Para ${orc.cliente_email}` : "Abre o e-mail com o link da proposta", icon: Mail, cor: "#B45309", onClick: email },
    { id: "whatsapp", label: "Enviar por WhatsApp", descricao: orc.cliente_telefone ? `Para ${orc.cliente_telefone}` : "Abre o WhatsApp com o link", icon: MessageCircle, cor: "#059669", onClick: whatsapp },
    { id: "copiar", label: copiado ? "Link copiado!" : "Copiar link da proposta", descricao: "Cola onde quiser", icon: copiado ? Check : Link2, cor: "#7C3AED", onClick: copiarLink },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-[#FAF7F2] p-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-base font-semibold text-[#3D2314]">
            Proposta {orc.numero} salva
            <AjudaCampo chave="orcamentos.finalizar" rota="/dashboard/orcamentos" />
          </h3>
          <button onClick={onClose} aria-label="Fechar" className="rounded-lg p-1.5 text-[#3D2314]/60 hover:bg-[#3D2314]/5"><X size={18} /></button>
        </div>
        <p className="mb-4 text-xs text-[#3D2314]/60">Como você quer entregar a proposta? Enviar é opcional — você pode só fechar.</p>

        {msg && <div className="mb-3 break-all rounded-lg bg-amber-50 p-2 text-xs text-amber-800">{msg}</div>}

        <div className="space-y-2">
          {acoes.map((a) => {
            const Icon = a.icon;
            return (
              <button key={a.id} onClick={a.onClick} disabled={busy}
                className="flex w-full items-center gap-3 rounded-xl border border-[#3D2314]/10 bg-white px-4 py-3 text-left transition hover:border-[#C8941A] hover:bg-[#C8941A]/5 disabled:opacity-50">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: a.cor + "15", color: a.cor }}>
                  <Icon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-[#3D2314]">{a.label}</span>
                  <span className="block truncate text-xs text-[#3D2314]/55">{a.descricao}</span>
                </span>
              </button>
            );
          })}
        </div>

        <button onClick={onClose} className="mt-4 w-full rounded-lg border border-[#3D2314]/15 bg-white px-4 py-2 text-sm font-medium text-[#3D2314]/80 hover:bg-[#3D2314]/5">
          Fechar (só salvar)
        </button>
      </div>
    </div>
  );
}
