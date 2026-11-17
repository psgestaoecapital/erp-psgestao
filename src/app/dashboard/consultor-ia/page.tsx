"use client";
// Consultor · Raio-X dos seus dados (SPEC Eng. Chefe RD-41, caminho A / 🅰️) — DETERMINÍSTICO, CUSTO ZERO de IA.
// A tela NÃO chama LLM/API: clica "Analisar meus dados" e roda fn_consultor_raiox(empresa) — só SQL. O texto/sintoma
// filtra os achados por palavra-chave (saldo/boleto/conciliação/cliente-fornecedor/saúde), sem token. Camada 2 (chat
// aberto + imagem, com LLM) fica para decisão futura do CEO e NÃO entra aqui.
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import AjudaCampo from "@/components/ajuda/AjudaCampo";

const ESP = "#3D2314", GO = "#C8941A", GOL = "#E8C872", OW = "#FAF7F2", BG2 = "#161614", BG3 = "#1E1E1B",
  BD = "#2A2822", TX = "#E8E5DC", TXM = "#A8A498", TXD = "#918C82", GRN = "#22C55E", RED = "#EF4444", Y = "#FBBF24";

type Achado = {
  codigo: string; categoria: string; severidade: "alta" | "media" | "baixa";
  titulo: string; mensagem: string; como_corrigir: string; rota_link: string; metricas?: any;
};
type Raiox = { ok: boolean; erro?: string; resumo?: { alta: number; media: number; baixa: number; total: number }; achados?: Achado[]; saldo_gerencial?: number };

// casamento por palavra-chave → categoria (determinístico, SEM IA)
const KW: Record<string, string[]> = {
  saldo: ["saldo", "nao bate", "não bate", "nao fecha", "não fecha", "caixa", "banco", "conta negativa", "negativo"],
  conciliacao: ["boleto", "conciliar", "conciliacao", "conciliação", "extrato", "movimento", "baixa", "sumiu", "sumiram", "desapareceu", "vinculo", "vínculo"],
  qualidade_dados: ["cliente", "fornecedor", "sem nome", "cadastro", "dado", "duplicado", "em branco"],
  saude: ["margem", "lucro", "prejuizo", "prejuízo", "inadimpl", "vencid", "atras", "receita", "despesa", "concentra"],
};
function categoriasDoTexto(txt: string): string[] {
  const t = txt.toLowerCase();
  const cats = Object.entries(KW).filter(([, ws]) => ws.some((w) => t.includes(w))).map(([c]) => c);
  return cats;
}

const CHIPS = [
  { rotulo: "Saldo não fecha", cats: ["saldo", "conciliacao"] },
  { rotulo: "Boleto errado / sem baixa", cats: ["conciliacao"] },
  { rotulo: "Conta sumiu", cats: ["conciliacao", "saldo"] },
  { rotulo: "Revisar meus dados", cats: [] as string[] }, // vazio = todos
];

const ORDEM: Record<string, number> = { alta: 0, media: 1, baixa: 2 };
const COR: Record<string, string> = { alta: RED, media: Y, baixa: GRN };
const DOT: Record<string, string> = { alta: "🔴", media: "🟡", baixa: "🟢" };

export default function ConsultorRaioxPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<any[]>([]);
  const [empresa, setEmpresa] = useState("");
  const [texto, setTexto] = useState("");
  const [filtro, setFiltro] = useState<string[] | null>(null); // null = ainda não filtrou; [] = todos
  const [loading, setLoading] = useState(false);
  const [loadingDb, setLoadingDb] = useState(true);
  const [raiox, setRaiox] = useState<Raiox | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => { carregarEmpresas(); }, []);

  async function carregarEmpresas() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoadingDb(false); return; }
    const { data: up } = await supabase.from("users").select("role").eq("id", user.id).single();
    let data: any[] = [];
    if (up?.role === "adm" || up?.role === "acesso_total") {
      const r = await supabase.from("companies").select("id,nome_fantasia,razao_social").order("nome_fantasia");
      data = r.data || [];
    } else {
      const r = await supabase.from("user_companies").select("companies(id,nome_fantasia,razao_social)").eq("user_id", user.id);
      data = (r.data || []).map((u: any) => u.companies).filter(Boolean);
    }
    if (data.length > 0) {
      setCompanies(data);
      const saved = typeof window !== "undefined" ? localStorage.getItem("ps_empresa_sel") : "";
      const match = data.find((c) => c.id === saved);
      setEmpresa(match ? match.id : data[0].id);
    }
    setLoadingDb(false);
  }

  async function analisar(catsIniciais?: string[]) {
    if (!empresa) return;
    setLoading(true); setErro(""); setRaiox(null);
    // filtro determinístico: chip explícito, senão casamento do texto, senão todos
    const cats = catsIniciais !== undefined ? catsIniciais : categoriasDoTexto(texto);
    setFiltro(cats);
    const { data, error } = await supabase.rpc("fn_consultor_raiox", { p_company_id: empresa });
    if (error) { setErro("Não consegui analisar agora. Tente de novo em instantes."); setLoading(false); return; }
    const r = data as Raiox;
    if (r && r.ok === false) { setErro(r.erro === "sem_acesso" ? "Você não tem acesso aos dados desta empresa." : "Não consegui analisar agora."); setLoading(false); return; }
    setRaiox(r); setLoading(false);
  }

  const achadosFiltrados = (): Achado[] => {
    const todos = (raiox?.achados || []).slice().sort((a, b) => (ORDEM[a.severidade] ?? 3) - (ORDEM[b.severidade] ?? 3));
    if (!filtro || filtro.length === 0) return todos;
    return todos.filter((a) => filtro.includes(a.categoria));
  };

  if (loadingDb) return <div style={{ padding: 40, textAlign: "center", color: TXM }}>Carregando…</div>;

  const lista = achadosFiltrados();
  const resumo = raiox?.resumo;

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 16px" }}>
      {/* CABEÇALHO */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: TX, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 24 }}>🔎</span> Consultor · Raio-X dos seus dados
          </div>
          <div style={{ fontSize: 12, color: TXD, marginTop: 3, lineHeight: 1.5, maxWidth: 560 }}>
            Eu olho suas <strong style={{ color: TXM }}>contas a pagar, a receber, boletos e saldos</strong> e te mostro onde está o problema e como corrigir — sem custo.
          </div>
        </div>
        <label data-ajuda="inteligencia.consultor.empresa" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <select value={empresa} onChange={(e) => setEmpresa(e.target.value)}
            style={{ background: BG3, border: `1px solid ${BD}`, color: GOL, borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 600, maxWidth: 220 }}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.nome_fantasia || c.razao_social}</option>)}
          </select>
          <AjudaCampo chave="inteligencia.consultor.empresa" />
        </label>
      </div>

      {/* ENTRADA */}
      <div style={{ background: BG2, borderRadius: 14, border: `1px solid ${BD}`, padding: 14, marginBottom: 14 }}>
        <label data-ajuda="inteligencia.consultor.sintoma" style={{ display: "block" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: TXM, marginBottom: 6, display: "flex", alignItems: "center" }}>
            O que está acontecendo?<AjudaCampo chave="inteligencia.consultor.sintoma" />
          </div>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); analisar(); } }}
            placeholder="Descreva em poucas palavras. Ex.: 'meu saldo não bate' — ou use um atalho abaixo."
            rows={2}
            style={{ width: "100%", background: BG3, border: `1px solid ${BD}`, color: TX, borderRadius: 10, padding: "10px 12px", fontSize: 13, outline: "none", resize: "none", fontFamily: "inherit", lineHeight: 1.5, boxSizing: "border-box" }} />
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {CHIPS.map((c) => (
            <button key={c.rotulo} type="button" onClick={() => analisar(c.cats)}
              style={{ background: BG3, border: `1px solid ${BD}`, color: TXM, borderRadius: 999, padding: "6px 12px", fontSize: 11, cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = GO + "80"; e.currentTarget.style.color = GOL; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = BD; e.currentTarget.style.color = TXM; }}>
              {c.rotulo}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => analisar()} disabled={loading || !empresa}
          style={{ marginTop: 12, width: "100%", borderRadius: 10, border: "none", padding: "12px 16px", fontSize: 14, fontWeight: 700, cursor: loading || !empresa ? "not-allowed" : "pointer", color: OW, background: loading || !empresa ? BD : `linear-gradient(135deg,${ESP},${GO})` }}>
          {loading ? "Analisando seus dados…" : "Analisar meus dados"}
        </button>
      </div>

      {/* ERRO */}
      {erro && <div style={{ background: RED + "18", border: `1px solid ${RED}55`, borderRadius: 10, padding: 12, color: "#FCA5A5", fontSize: 12.5, marginBottom: 12 }}>{erro}</div>}

      {/* RESUMO + FILTRO */}
      {raiox?.ok && resumo && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: TXM }}>
            {resumo.total === 0 ? "Nenhum problema encontrado" : `${resumo.total} achado(s):`}
          </div>
          {resumo.alta > 0 && <span style={{ fontSize: 12, color: RED }}>🔴 {resumo.alta} grave(s)</span>}
          {resumo.media > 0 && <span style={{ fontSize: 12, color: Y }}>🟡 {resumo.media} atenção</span>}
          {resumo.baixa > 0 && <span style={{ fontSize: 12, color: GRN }}>🟢 {resumo.baixa} ok/informativo</span>}
          {filtro && filtro.length > 0 && (
            <button type="button" onClick={() => setFiltro([])} style={{ marginLeft: "auto", background: "none", border: `1px solid ${BD}`, color: TXD, borderRadius: 999, padding: "4px 10px", fontSize: 10.5, cursor: "pointer" }}>
              filtrando por: {filtro.join(", ")} · ver tudo ✕
            </button>
          )}
        </div>
      )}

      {/* EMPTY STATE */}
      {raiox?.ok && resumo?.total === 0 && (
        <div style={{ background: GRN + "12", border: `1px solid ${GRN}44`, borderRadius: 14, padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 30 }}>✅</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: TX, marginTop: 6 }}>Analisei tudo e não achei problema</div>
          <div style={{ fontSize: 12, color: TXM, marginTop: 4 }}>Suas contas, boletos e saldos estão batendo. Volte quando quiser revisar de novo.</div>
        </div>
      )}

      {/* ACHADOS FILTRADOS SEM RESULTADO (mas há achados noutras categorias) */}
      {raiox?.ok && (resumo?.total ?? 0) > 0 && lista.length === 0 && (
        <div style={{ background: BG2, border: `1px solid ${BD}`, borderRadius: 14, padding: 20, textAlign: "center", color: TXM, fontSize: 12.5 }}>
          Nada nessa categoria. <button type="button" onClick={() => setFiltro([])} style={{ background: "none", border: "none", color: GOL, cursor: "pointer", textDecoration: "underline", fontSize: 12.5 }}>Ver todos os achados</button>
        </div>
      )}

      {/* CARDS DE ACHADO */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {lista.map((a) => (
          <div key={a.codigo} style={{ background: BG2, borderRadius: 14, border: `1px solid ${BD}`, borderLeft: `4px solid ${COR[a.severidade] || BD}`, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 14 }}>{DOT[a.severidade] || "•"}</span>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: TX }}>{a.titulo}</span>
            </div>
            <div style={{ fontSize: 12.5, color: TXM, lineHeight: 1.6 }}>{a.mensagem}</div>
            <div style={{ marginTop: 8, background: BG3, borderRadius: 8, padding: "8px 10px" }}>
              <span style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5, color: GOL }}>Como corrigir</span>
              <div style={{ fontSize: 12, color: TX, marginTop: 2, lineHeight: 1.5 }}>{a.como_corrigir}</div>
            </div>
            {a.rota_link && (
              <button type="button" onClick={() => router.push(a.rota_link)}
                style={{ marginTop: 10, background: "transparent", border: `1px solid ${GO}66`, color: GOL, borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                Ir pra tela →
              </button>
            )}
          </div>
        ))}
      </div>

      {/* RODAPÉ (custo zero) */}
      {raiox?.ok && (
        <div style={{ fontSize: 10, color: TXD, textAlign: "center", marginTop: 16 }}>
          Análise 100% dos seus dados, sem custo de IA. Atualiza sempre que você clica em “Analisar meus dados”.
        </div>
      )}
    </div>
  );
}
