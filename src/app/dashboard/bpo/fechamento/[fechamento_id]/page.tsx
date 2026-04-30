// src/app/dashboard/bpo/fechamento/[fechamento_id]/page.tsx
// ONDA 5 - Detalhe do fechamento + acoes (enviar email/whatsapp/portal)

"use client";

import { useEffect, useState, use } from "react";
import { rpc, supabaseBrowser } from "@/lib/authFetch";

interface Dados {
  empresa: { id: string; nome: string; cnpj: string; regime: string | null };
  mes_referencia: string;
  mes_referencia_label: string;
  resumo: { receita_total: number; ebitda: number; lucro_liquido: number; margem_ebitda_pct: number };
  comparativo: {
    mes_anterior_label: string;
    receita_anterior: number | null;
    ebitda_anterior: number | null;
    variacao_receita_pct: number | null;
    variacao_ebitda_pct: number | null;
  };
  dre_detalhado: Array<{ ordem: number; linha: string; tipo: string; valor: number }>;
  top_clientes: Array<{ nome: string; valor: number; participacao_pct: number; classe: string }>;
  top_fornecedores: Array<{ nome: string; valor: number; participacao_pct: number; classe: string }>;
  alertas: Array<{ severidade: string; titulo: string; descricao: string }>;
  insights: Array<{ titulo: string; descricao: string; tipo: string }>;
}

interface Fechamento {
  id: string;
  company_id: string;
  mes_referencia: string;
  status: string;
  pronto_para_fechar: boolean;
  gaps_atuais: Array<{ check: string; descricao: string; severidade: string; acao: string }>;
  dados_consolidados: Dados | null;
  enviado_email: boolean;
  enviado_email_em: string | null;
  enviado_email_para: string | null;
  enviado_whatsapp: boolean;
  enviado_whatsapp_em: string | null;
  enviado_whatsapp_para: string | null;
  link_portal: string;
}

function fmtMoney(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function FechamentoDetalhePage({
  params,
}: {
  params: Promise<{ fechamento_id: string }>;
}) {
  const { fechamento_id } = use(params);
  const [f, setF] = useState<Fechamento | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Modais
  const [modalEmail, setModalEmail] = useState(false);
  const [modalWpp, setModalWpp] = useState(false);
  const [destEmail, setDestEmail] = useState("");
  const [destWpp, setDestWpp] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function carregar() {
    setLoading(true);
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase
        .from("bpo_fechamento_mensal")
        .select("*")
        .eq("id", fechamento_id)
        .single();
      if (error) throw error;
      setF(data as Fechamento);
    } catch (e: any) {
      setErro(e.message || "Não foi possível carregar fechamento");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [fechamento_id]);

  async function marcarEnviado(canal: "email" | "whatsapp", destinatario: string) {
    if (!f) return;
    setEnviando(true);
    try {
      const supabase = supabaseBrowser();
      const { data: { user } } = await supabase.auth.getUser();
      await rpc("fn_bpo_fechamento_marcar_enviado", {
        p_fechamento_id: f.id,
        p_canal: canal,
        p_destinatario: destinatario,
        p_user_id: user?.id,
      });
      setAviso(`Marcado como enviado via ${canal}.`);
      setTimeout(() => setAviso(null), 5000);
      setModalEmail(false);
      setModalWpp(false);
      await carregar();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setEnviando(false);
    }
  }

  function abrirWhatsAppWeb() {
    if (!f || !f.dados_consolidados) return;
    const empresa = f.dados_consolidados.empresa.nome;
    const mes = f.dados_consolidados.mes_referencia_label;
    const portal = `${window.location.origin}/cliente/${f.company_id}/${f.link_portal}`;
    const msg = encodeURIComponent(
      `Olá! Segue o fechamento mensal de ${mes} da ${empresa}.\n\nReceita: ${fmtMoney(f.dados_consolidados.resumo.receita_total)}\nEBITDA: ${fmtMoney(f.dados_consolidados.resumo.ebitda)} (${f.dados_consolidados.resumo.margem_ebitda_pct}%)\n\nVeja o relatório completo no portal:\n${portal}\n\n— PS Gestão & Capital`
    );
    const numero = destWpp.replace(/\D/g, "");
    const url = `https://wa.me/${numero}?text=${msg}`;
    window.open(url, "_blank");
    marcarEnviado("whatsapp", destWpp);
  }

  function copiarLinkPortal() {
    if (!f) return;
    const portal = `${window.location.origin}/cliente/${f.company_id}/${f.link_portal}`;
    navigator.clipboard.writeText(portal);
    setAviso("Link do portal copiado!");
    setTimeout(() => setAviso(null), 3000);
  }

  if (loading) return <Loading />;
  if (erro && !f) return <ErroFatal msg={erro} />;
  if (!f) return null;

  const dados = f.dados_consolidados;
  const bloqueado = f.status === "bloqueado";

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-[#3D2314]/10 bg-[#FAF7F2] px-6 py-4">
        <div className="mx-auto max-w-5xl">
          <a href="/dashboard/bpo/fechamento" className="text-sm text-[#C8941A] hover:underline">
            ← Voltar à lista
          </a>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-[#3D2314]">
                {dados?.empresa.nome || "—"}
              </h1>
              <p className="text-xs text-[#3D2314]/60">
                Fechamento {dados?.mes_referencia_label || f.mes_referencia} ·{" "}
                CNPJ {dados?.empresa.cnpj || "—"}
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                bloqueado ? "bg-red-200 text-red-900"
                : f.status === "enviado" ? "bg-[#C8941A] text-white"
                : "bg-emerald-200 text-emerald-900"
              }`}
            >
              {f.status}
            </span>
          </div>
        </div>
      </header>

      {(erro || aviso) && (
        <div className="mx-auto max-w-5xl px-6 pt-4">
          {erro && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>}
          {aviso && <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">✓ {aviso}</div>}
        </div>
      )}

      <main className="mx-auto max-w-5xl px-6 py-6">
        {/* GAPS - se bloqueado */}
        {bloqueado && f.gaps_atuais && f.gaps_atuais.length > 0 && (
          <div className="mb-6 rounded-2xl bg-red-50 p-4">
            <h2 className="mb-3 text-base font-semibold text-red-900">
              ⚠️ Pendências para liberar fechamento
            </h2>
            <div className="space-y-2">
              {f.gaps_atuais.map((gap, i) => (
                <div key={i} className="rounded-lg bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-[#3D2314]">
                        {gap.severidade === "bloqueante" ? "🔴" : "🟡"} {gap.descricao}
                      </div>
                      <div className="mt-1 text-xs text-[#3D2314]/70">→ {gap.acao}</div>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        gap.severidade === "bloqueante"
                          ? "bg-red-200 text-red-900"
                          : "bg-yellow-200 text-yellow-900"
                      }`}
                    >
                      {gap.severidade}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* RESUMO */}
        {dados && (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <KpiCard label="Receita" valor={fmtMoney(dados.resumo.receita_total)} />
              <KpiCard
                label="EBITDA"
                valor={fmtMoney(dados.resumo.ebitda)}
                tom={dados.resumo.ebitda >= 0 ? "verde" : "vermelho"}
              />
              <KpiCard
                label="Margem"
                valor={`${dados.resumo.margem_ebitda_pct}%`}
                tom={dados.resumo.margem_ebitda_pct >= 10 ? "verde" : "vermelho"}
              />
              <KpiCard
                label="Lucro Líquido"
                valor={fmtMoney(dados.resumo.lucro_liquido)}
                tom={dados.resumo.lucro_liquido >= 0 ? "verde" : "vermelho"}
              />
            </div>

            {/* COMPARATIVO */}
            {dados.comparativo.variacao_receita_pct !== null && (
              <div className="mb-6 rounded-2xl bg-[#FAF7F2] p-4">
                <h3 className="mb-3 text-sm font-semibold text-[#3D2314]">
                  Comparativo com {dados.comparativo.mes_anterior_label}
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <ComparativoBox
                    label="Receita"
                    atual={dados.resumo.receita_total}
                    anterior={dados.comparativo.receita_anterior}
                    variacao={dados.comparativo.variacao_receita_pct}
                  />
                  <ComparativoBox
                    label="EBITDA"
                    atual={dados.resumo.ebitda}
                    anterior={dados.comparativo.ebitda_anterior}
                    variacao={dados.comparativo.variacao_ebitda_pct}
                  />
                </div>
              </div>
            )}

            {/* INSIGHTS */}
            <div className="mb-6">
              <h3 className="mb-3 text-sm font-semibold text-[#3D2314]">💡 Insights do mês</h3>
              <div className="space-y-2">
                {dados.insights.map((ins, i) => (
                  <div
                    key={i}
                    className={`rounded-xl p-4 ${
                      ins.tipo === "alerta" ? "bg-red-50"
                      : ins.tipo === "destaque" ? "bg-[#C8941A]/10"
                      : "bg-[#FAF7F2]"
                    }`}
                  >
                    <div className="font-semibold text-[#3D2314]">{ins.titulo}</div>
                    <div className="mt-1 text-sm text-[#3D2314]/70">{ins.descricao}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* DRE */}
            <div className="mb-6 rounded-2xl bg-[#FAF7F2] p-4">
              <h3 className="mb-3 text-sm font-semibold text-[#3D2314]">DRE detalhado</h3>
              <table className="w-full text-sm">
                <tbody>
                  {dados.dre_detalhado.map((l) => (
                    <tr
                      key={l.ordem}
                      className={`border-b border-[#3D2314]/5 ${
                        l.tipo === "total" || l.tipo === "resultado_final"
                          ? "font-bold bg-white"
                          : l.tipo === "calculado" ? "font-semibold"
                          : ""
                      }`}
                    >
                      <td className="py-2">{l.linha}</td>
                      <td
                        className={`py-2 text-right ${
                          l.valor < 0 ? "text-red-700" : "text-[#3D2314]"
                        }`}
                      >
                        {fmtMoney(l.valor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* TOP CLIENTES E FORNECEDORES */}
            {dados.top_clientes.length > 0 && (
              <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2">
                <TopList titulo="Top 5 Clientes" items={dados.top_clientes} />
                <TopList titulo="Top 5 Fornecedores" items={dados.top_fornecedores} />
              </div>
            )}

            {/* AÇÕES DE ENVIO */}
            <div className="rounded-2xl bg-[#3D2314] p-5 text-[#FAF7F2]">
              <h3 className="mb-3 text-base font-semibold">Enviar ao cliente</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setModalEmail(true)}
                  className="rounded-lg bg-[#C8941A] px-4 py-2 text-sm font-semibold hover:bg-[#A87810]"
                >
                  ✉ Enviar email {f.enviado_email && "(reenviar)"}
                </button>
                <button
                  onClick={() => setModalWpp(true)}
                  className="rounded-lg bg-[#C8941A] px-4 py-2 text-sm font-semibold hover:bg-[#A87810]"
                >
                  📱 Enviar WhatsApp {f.enviado_whatsapp && "(reenviar)"}
                </button>
                <button
                  onClick={copiarLinkPortal}
                  className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20"
                >
                  🔗 Copiar link do portal
                </button>
              </div>
              {(f.enviado_email || f.enviado_whatsapp) && (
                <div className="mt-3 text-xs text-[#FAF7F2]/70">
                  {f.enviado_email && f.enviado_email_em && (
                    <div>✉ Email enviado em {new Date(f.enviado_email_em).toLocaleString("pt-BR")} para {f.enviado_email_para}</div>
                  )}
                  {f.enviado_whatsapp && f.enviado_whatsapp_em && (
                    <div>📱 WhatsApp enviado em {new Date(f.enviado_whatsapp_em).toLocaleString("pt-BR")} para {f.enviado_whatsapp_para}</div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* MODAL EMAIL */}
      {modalEmail && (
        <Modal onClose={() => setModalEmail(false)} titulo="Enviar pacote por email">
          <p className="mb-4 text-sm text-[#3D2314]/70">
            O envio automático de email exige integração com Resend ou SendGrid (não configurada ainda).
            Por enquanto, você pode marcar como enviado após enviar manualmente pelo seu cliente de email.
          </p>
          <input
            type="email"
            value={destEmail}
            onChange={(e) => setDestEmail(e.target.value)}
            placeholder="email@cliente.com"
            className="w-full rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
          />
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setModalEmail(false)}
              className="flex-1 rounded-lg bg-[#FAF7F2] py-2 text-sm text-[#3D2314]"
            >
              Cancelar
            </button>
            <button
              onClick={() => marcarEnviado("email", destEmail)}
              disabled={!destEmail || enviando}
              className="flex-1 rounded-lg bg-[#3D2314] py-2 text-sm text-[#FAF7F2] disabled:opacity-50"
            >
              {enviando ? "Marcando..." : "Marcar como enviado"}
            </button>
          </div>
        </Modal>
      )}

      {/* MODAL WHATSAPP */}
      {modalWpp && (
        <Modal onClose={() => setModalWpp(false)} titulo="Enviar via WhatsApp Web">
          <p className="mb-4 text-sm text-[#3D2314]/70">
            Vai abrir o WhatsApp Web em uma nova aba com a mensagem pré-preenchida e o link do portal.
            Você só precisa clicar em <strong>Enviar</strong> lá.
          </p>
          <input
            type="tel"
            value={destWpp}
            onChange={(e) => setDestWpp(e.target.value)}
            placeholder="55 49 9XXXX-XXXX"
            className="w-full rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
          />
          <p className="mt-2 text-xs text-[#3D2314]/60">
            Use formato com DDI+DDD+número (ex: 5549991234567)
          </p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setModalWpp(false)}
              className="flex-1 rounded-lg bg-[#FAF7F2] py-2 text-sm text-[#3D2314]"
            >
              Cancelar
            </button>
            <button
              onClick={abrirWhatsAppWeb}
              disabled={!destWpp || enviando}
              className="flex-1 rounded-lg bg-emerald-600 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              📱 Abrir WhatsApp Web
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex h-screen items-center justify-center bg-[#FAF7F2]">
      <div className="text-[#3D2314]">Carregando fechamento...</div>
    </div>
  );
}

function ErroFatal({ msg }: { msg: string }) {
  return (
    <div className="flex h-screen items-center justify-center bg-[#FAF7F2]">
      <div className="rounded-lg bg-red-50 p-4 text-red-800">{msg}</div>
    </div>
  );
}

function KpiCard({ label, valor, tom }: { label: string; valor: string; tom?: "verde" | "vermelho" }) {
  const cor = tom === "verde" ? "text-emerald-700" : tom === "vermelho" ? "text-red-700" : "text-[#3D2314]";
  return (
    <div className="rounded-xl bg-[#FAF7F2] p-4">
      <div className="text-xs uppercase text-[#3D2314]/60">{label}</div>
      <div className={`mt-1 text-xl font-bold ${cor}`}>{valor}</div>
    </div>
  );
}

function ComparativoBox({
  label, atual, anterior, variacao,
}: {
  label: string; atual: number; anterior: number | null; variacao: number | null;
}) {
  const positiva = (variacao || 0) >= 0;
  return (
    <div className="rounded-lg bg-white p-3">
      <div className="text-xs uppercase text-[#3D2314]/60">{label}</div>
      <div className="mt-1 text-lg font-bold text-[#3D2314]">{fmtMoney(atual)}</div>
      <div className="text-xs text-[#3D2314]/50">vs {fmtMoney(anterior)}</div>
      {variacao !== null && (
        <div className={`mt-1 text-sm font-semibold ${positiva ? "text-emerald-700" : "text-red-700"}`}>
          {positiva ? "↑" : "↓"} {Math.abs(variacao).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

function TopList({ titulo, items }: { titulo: string; items: any[] }) {
  return (
    <div className="rounded-2xl bg-[#FAF7F2] p-4">
      <h4 className="mb-3 text-sm font-semibold text-[#3D2314]">{titulo}</h4>
      <div className="space-y-1">
        {items.map((it, i) => (
          <div key={i} className="flex items-center justify-between rounded bg-white px-3 py-2 text-sm">
            <div className="flex-1 truncate">
              <span className="font-semibold text-[#3D2314]">{it.nome}</span>
              <span className="ml-2 text-xs text-[#C8941A]">classe {it.classe}</span>
            </div>
            <div className="text-right">
              <div className="font-semibold text-[#3D2314]">{fmtMoney(it.valor)}</div>
              <div className="text-xs text-[#3D2314]/60">{it.participacao_pct}%</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Modal({
  onClose, titulo, children,
}: {
  onClose: () => void; titulo: string; children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#3D2314]/60 p-4"
      onClick={onClose}
    >
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#3D2314]">{titulo}</h2>
          <button onClick={onClose} className="text-[#3D2314]/60">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
