"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { PSGC_COLORS } from "@/lib/psgc-tokens";
import PSGCButton from "@/components/psgc/PSGCButton";
import PSGCBadge from "@/components/psgc/PSGCBadge";
import { useSelectedCompany } from "@/contexts/SelectedCompanyContext";

// Paleta local: nomes curtos preservados, valores referenciam PSGC_COLORS.
const C = {
  GO: PSGC_COLORS.dourado,
  GOL: PSGC_COLORS.douradoSoft,
  BG: PSGC_COLORS.offWhite,
  BG2: PSGC_COLORS.offWhite,
  BG3: PSGC_COLORS.offWhiteDark,
  G: PSGC_COLORS.baixa,
  R: PSGC_COLORS.alta,
  Y: PSGC_COLORS.media,
  BL: PSGC_COLORS.azul,
  BD: PSGC_COLORS.offWhiteDarker,
  TX: PSGC_COLORS.espresso,
  TXM: PSGC_COLORS.espressoLight,
  TXD: PSGC_COLORS.espressoLight,
  PU: PSGC_COLORS.dourado,
};

const fmtBRL = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type ClientData = {
  id: string; nome: string; cnpj: string; cidade: string;
  receita: number; despesa: number; resultado: number; margem: number;
  status: "critico" | "atencao" | "saudavel" | "sem_dados";
  alertas: string[]; ultimoSync: string; diasSemSync: number;
  totalTitulos: number; vencidos: number; totalVencido: number;
};

export default function BPOPage() {
  const [clients, setClients] = useState<ClientData[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState("todos");
  const [busca, setBusca] = useState("");
  const [running, setRunning] = useState(false);
  const [execResult, setExecResult] = useState<any>(null);
  const { selected, setSelected } = useSelectedCompany();
  const selectedCompany = selected?.id || "todas";

  useEffect(() => { loadBPOData(); }, []);

  const rodarDia = async () => {
    setRunning(true);
    setExecResult(null);
    const results: any[] = [];
    const targetClients = selectedCompany === "todas" ? clients : clients.filter(c => c.id === selectedCompany);
    for (const c of targetClients) {
      try {
        const r = await authFetch("/api/bpo/executar", { method: "POST", body: JSON.stringify({ company_id: c.id }) });
        const d = await r.json();
        results.push({ nome: c.nome, success: d.success, alertas: d.alertas_gerados || 0, resumo: d.resumo_ia || "", resultados: d.resultados || {} });
      } catch (e: any) {
        results.push({ nome: c.nome, success: false, error: e.message });
      }
    }
    setExecResult(results);
    setRunning(false);
  };

  const loadBPOData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: up } = await supabase.from("users").select("role").eq("id", user.id).single();
    let companies: any[] = [];
    if (up?.role === "adm" || up?.role === "acesso_total") {
      const { data } = await supabase.from("companies").select("*").order("created_at");
      companies = data || [];
    } else {
      const { data: uc } = await supabase.from("user_companies").select("companies(*)").eq("user_id", user.id);
      companies = (uc || []).map((u: any) => u.companies).filter(Boolean);
    }
    if (companies.length === 0) { setLoading(false); return; }

    const compIds = companies.map(c => c.id);
    const { data: allImports } = await supabase.from("omie_imports").select("company_id,import_type,import_data,record_count,imported_at").in("company_id", compIds);
    const { data: bpoClass } = await supabase.from("bpo_classificacoes").select("company_id,status").in("company_id", compIds);

    const results: ClientData[] = [];
    const now = new Date();

    for (const comp of companies) {
      const compImports = (allImports || []).filter((i: any) => i.company_id === comp.id);
      const hasData = compImports.length > 0;
      const lastSyncDate = compImports.length > 0
        ? new Date(compImports.sort((a: any, b: any) => new Date(b.imported_at).getTime() - new Date(a.imported_at).getTime())[0]?.imported_at)
        : null;
      const diasSemSync = lastSyncDate ? Math.floor((now.getTime() - lastSyncDate.getTime()) / (1000 * 60 * 60 * 24)) : 999;

      let receita = 0, despesa = 0, totalTitulos = 0, vencidos = 0, totalVencido = 0;
      const alertas: string[] = [];
      let status: "critico" | "atencao" | "saudavel" | "sem_dados" = "sem_dados";

      if (hasData) {
        for (const imp of compImports) {
          if (imp.import_type === "contas_receber") {
            const regs = imp.import_data?.conta_receber_cadastro || [];
            if (!Array.isArray(regs)) continue;
            for (const r of regs) {
              receita += Number(r.valor_documento) || 0;
              totalTitulos++;
              const st = (r.status_titulo || "").toUpperCase();
              if (st === "VENCIDO" || st === "ATRASADO") {
                vencidos++;
                totalVencido += Number(r.valor_documento) || 0;
              }
            }
          }
          if (imp.import_type === "contas_pagar") {
            const regs = imp.import_data?.conta_pagar_cadastro || [];
            if (!Array.isArray(regs)) continue;
            for (const r of regs) {
              despesa += Number(r.valor_documento) || 0;
              totalTitulos++;
            }
          }
        }
        const resultado = receita - despesa;
        const margem = receita > 0 ? Math.round((resultado / receita) * 1000) / 10 : 0;

        if (resultado < 0) alertas.push("Resultado negativo");
        if (margem < 5 && margem >= 0) alertas.push("Margem muito baixa");
        if (vencidos > 0) alertas.push(`${vencidos} título(s) vencido(s): ${fmtBRL(totalVencido)}`);
        if (diasSemSync > 30) alertas.push(`Sem sincronizar há ${diasSemSync} dias`);
        const pendentes = (bpoClass || []).filter((b: any) => b.company_id === comp.id && b.status === "pendente").length;
        if (pendentes > 0) alertas.push(`${pendentes} classificação(ões) pendente(s)`);

        if (resultado < 0 || margem < -10) status = "critico";
        else if (margem < 10 || alertas.length > 1) status = "atencao";
        else status = "saudavel";

        results.push({
          id: comp.id, nome: comp.nome_fantasia || comp.razao_social || "Sem nome",
          cnpj: comp.cnpj || "", cidade: comp.cidade_estado || "",
          receita, despesa, resultado, margem, status, alertas,
          totalTitulos, vencidos, totalVencido,
          ultimoSync: lastSyncDate ? lastSyncDate.toLocaleDateString("pt-BR") : "Nunca",
          diasSemSync,
        });
      } else {
        alertas.push("Nenhum dado importado");
        results.push({
          id: comp.id, nome: comp.nome_fantasia || comp.razao_social || "Sem nome",
          cnpj: comp.cnpj || "", cidade: comp.cidade_estado || "",
          receita: 0, despesa: 0, resultado: 0, margem: 0, status: "sem_dados", alertas,
          totalTitulos: 0, vencidos: 0, totalVencido: 0,
          ultimoSync: "Nunca", diasSemSync: 999,
        });
      }
    }
    results.sort((a, b) => {
      const o = { critico: 0, atencao: 1, saudavel: 2, sem_dados: 3 };
      return o[a.status] - o[b.status];
    });
    setClients(results);
    setLoading(false);
  };

  const statusCor = (s: string) => s === "critico" ? C.R : s === "atencao" ? C.Y : s === "saudavel" ? C.G : C.TXD;
  const statusLabel = (s: string) => s === "critico" ? "Crítico" : s === "atencao" ? "Atenção" : s === "saudavel" ? "Saudável" : "Sem dados";
  const statusIcon = (s: string) => s === "critico" ? "🔴" : s === "atencao" ? "🟡" : s === "saudavel" ? "🟢" : "⚪";
  const statusBadgeVariant = (s: string): "critical" | "attention" | "success" | "outline" =>
    s === "critico" ? "critical" : s === "atencao" ? "attention" : s === "saudavel" ? "success" : "outline";

  const activeClients = selectedCompany === "todas" ? clients : clients.filter(c => c.id === selectedCompany);
  const filtered = activeClients
    .filter(c => filtro === "todos" || c.status === filtro)
    .filter(c => !busca || c.nome.toLowerCase().includes(busca.toLowerCase()) || c.cnpj.includes(busca));

  const totalClients = activeClients.length;
  const criticos = activeClients.filter(c => c.status === "critico").length;
  const atencaoN = activeClients.filter(c => c.status === "atencao").length;
  const saudaveis = activeClients.filter(c => c.status === "saudavel").length;
  const totalAlertas = activeClients.reduce((a, c) => a + c.alertas.length, 0);
  const totalReceita = activeClients.reduce((a, c) => a + c.receita, 0);

  const modulos = [
    { icon: '📅', nome: 'Meu Dia', desc: 'KPIs do operador BPO', href: '/dashboard/bpo/meu-dia', cor: PSGC_COLORS.dourado },
    { icon: '🏢', nome: 'Minhas Empresas', desc: 'Carteira do operador', href: '/dashboard/bpo/empresas', cor: PSGC_COLORS.azul },
    { icon: '👥', nome: 'Supervisor', desc: 'Atribuir empresas a operadores', href: '/dashboard/bpo/supervisor', cor: PSGC_COLORS.dourado },
    { icon: '🤖', nome: 'Automacao IA', desc: 'Auto-classificacao + score anti-fraude', href: '/dashboard/bpo/automacao', cor: PSGC_COLORS.baixa },
    { icon: '🛡️', nome: 'Anti-Fraude', desc: '11 camadas - Score 0-100 - Patente INPI', href: '/dashboard/anti-fraude', cor: PSGC_COLORS.espresso },
    { icon: '💳', nome: 'Conciliacao', desc: 'OFX/CSV matching', href: '/dashboard/bpo/conciliacao', cor: PSGC_COLORS.azul },
    { icon: '📋', nome: 'Rotinas', desc: '14 rotinas automaticas', href: '/dashboard/bpo/rotinas', cor: PSGC_COLORS.dourado },
    { icon: '📥', nome: 'Importar', desc: 'Upload planilha de dados', href: '/dashboard/importar', cor: PSGC_COLORS.media },
    { icon: '🧠', nome: 'Consultor IA', desc: 'Analise de documentos', href: '/dashboard/consultor-ia', cor: PSGC_COLORS.douradoSoft },
  ];

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: "0 auto", background: C.BG, minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.GO }}>BPO Inteligente</div>
          <div style={{ fontSize: 11, color: C.TXM }}>9 modulos ativos • Anti-Fraude integrado • Retroalimentacao automatica</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <PSGCButton variant="ghost" size="sm" icon="←" onClick={() => { window.location.href = "/dashboard"; }}>
            Dashboard
          </PSGCButton>
          <button
            onClick={rodarDia}
            disabled={running || clients.length === 0}
            style={{
              padding: "8px 18px", borderRadius: 8,
              background: running ? C.BD : `linear-gradient(135deg, ${C.GO}, ${C.GOL})`,
              color: running ? C.TXM : C.TX,
              fontSize: 11, fontWeight: 700, border: "none",
              cursor: running ? "wait" : "pointer",
            }}
          >
            {running
              ? "⏳ Analisando..."
              : selectedCompany === "todas"
                ? "🚀 Rodar BPO — Todas Empresas"
                : `🚀 Rodar BPO — ${clients.find(c => c.id === selectedCompany)?.nome || "Empresa"}`}
          </button>
          <PSGCButton variant="primary" size="sm" icon="↻" onClick={loadBPOData}>
            Atualizar
          </PSGCButton>
        </div>
      </div>

      {/* SELETOR DE EMPRESA */}
      <div style={{ background: C.BG2, borderRadius: 12, padding: "12px 16px", border: `1px solid ${C.BD}`, marginBottom: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>🏢</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.GO }}>Empresa:</span>
        </div>
        <select
          value={selectedCompany}
          onChange={e => {
            const id = e.target.value;
            if (id === "todas") {
              setSelected(null);
              return;
            }
            const c = clients.find(x => x.id === id);
            if (c) setSelected({ id: c.id, nome_fantasia: c.nome, is_bpo_cliente: true });
          }}
          style={{ flex: 1, minWidth: 200, background: C.BG3, border: `1px solid ${C.BD}`, color: C.TX, borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none", cursor: "pointer", fontFamily: "inherit" }}
        >
          <option value="todas">📊 Todas as empresas ({clients.length})</option>
          {clients.map(c => (
            <option key={c.id} value={c.id}>
              {statusIcon(c.status)} {c.nome}{c.cnpj ? ` — ${c.cnpj}` : ""}
            </option>
          ))}
        </select>
        {selectedCompany !== "todas" && (
          <button
            onClick={() => setSelected(null)}
            style={{ padding: "6px 12px", borderRadius: 6, background: "transparent", border: `1px solid ${C.BD}`, color: C.TXM, fontSize: 10, cursor: "pointer" }}
          >
            ✕ Limpar filtro
          </button>
        )}
      </div>

      {/* GRID 7 MODULOS */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 16 }}>
        {modulos.map((m, i) => (
          <a
            key={i}
            href={m.href}
            style={{
              background: C.BG2, borderRadius: 12, padding: "12px",
              border: `1px solid ${C.BD}`, textDecoration: "none", display: "block",
              borderLeft: `4px solid ${m.cor}`, transition: "all 0.2s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = C.BG3; }}
            onMouseLeave={e => { e.currentTarget.style.background = C.BG2; }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 20 }}>{m.icon}</div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.TX }}>{m.nome}</div>
                <div style={{ fontSize: 9, color: C.TXM }}>{m.desc}</div>
              </div>
            </div>
          </a>
        ))}
      </div>

      {/* GRID 6 KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginBottom: 16 }}>
        {[
          { l: "Total clientes", v: totalClients.toString(), c: C.GOL, icon: "🏢" },
          { l: "Críticos", v: criticos.toString(), c: C.R, icon: "🔴" },
          { l: "Atenção", v: atencaoN.toString(), c: C.Y, icon: "🟡" },
          { l: "Saudáveis", v: saudaveis.toString(), c: C.G, icon: "🟢" },
          { l: "Alertas reais", v: totalAlertas.toString(), c: C.R, icon: "⚠️" },
          { l: "Receita total", v: fmtBRL(totalReceita), c: C.G, icon: "💰" },
        ].map((k, i) => (
          <div key={i} style={{ background: C.BG2, borderRadius: 10, padding: "10px 12px", borderLeft: `3px solid ${k.c}`, border: `1px solid ${C.BD}` }}>
            <div style={{ fontSize: 9, color: C.TXD, textTransform: "uppercase", letterSpacing: 0.4 }}>
              {k.icon} {k.l}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: k.c, marginTop: 2 }}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* EXECUTION RESULTS */}
      {execResult && (
        <div style={{ background: C.BG2, borderRadius: 12, border: `1px solid ${C.BD}`, padding: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.GO, marginBottom: 10 }}>
            📋 Resultado BPO do Dia — {execResult.length} empresa(s)
          </div>
          {execResult.map((r: any, i: number) => (
            <div key={i} style={{ background: C.BG3, borderRadius: 8, padding: 10, marginBottom: 6, borderLeft: `3px solid ${r.success ? C.G : C.R}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.TX }}>{r.nome}</span>
                <span style={{ fontSize: 9, color: r.alertas > 5 ? C.R : r.alertas > 0 ? C.Y : C.G, fontWeight: 600 }}>
                  {r.alertas} alertas
                </span>
              </div>
              {r.resumo && (
                <div style={{ fontSize: 10, color: C.TXM, marginTop: 4, lineHeight: 1.5 }}>{r.resumo}</div>
              )}
              {r.resultados?.fluxo_caixa && (
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  {r.resultados.fluxo_caixa.map((f: any) => (
                    <span
                      key={f.dias}
                      style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: f.saldo >= 0 ? C.G + "15" : C.R + "15", color: f.saldo >= 0 ? C.G : C.R }}
                    >
                      {f.dias}d: {f.saldo >= 0 ? "+" : ""}R${(f.saldo / 1000).toFixed(0)}K
                    </span>
                  ))}
                </div>
              )}
              {r.error && (
                <div style={{ fontSize: 10, color: C.R, marginTop: 4 }}>Erro: {r.error}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* SEARCH + FILTROS */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
        <input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Buscar cliente por nome ou CNPJ..."
          style={{ flex: 1, background: C.BG2, border: `1px solid ${C.BD}`, color: C.TX, borderRadius: 8, padding: "8px 12px", fontSize: 12, outline: "none" }}
        />
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { id: "todos", n: "Todos", c: C.GOL },
            { id: "critico", n: "Críticos", c: C.R },
            { id: "atencao", n: "Atenção", c: C.Y },
            { id: "saudavel", n: "Saudáveis", c: C.G },
            { id: "sem_dados", n: "Sem dados", c: C.TXD },
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setFiltro(f.id)}
              style={{
                padding: "6px 12px", borderRadius: 20, fontSize: 10,
                border: `1px solid ${filtro === f.id ? f.c : C.BD}`,
                background: filtro === f.id ? f.c + "18" : "transparent",
                color: filtro === f.id ? f.c : C.TXM,
                fontWeight: filtro === f.id ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {f.n}
            </button>
          ))}
        </div>
      </div>

      {/* LOADING */}
      {loading && (
        <div style={{ textAlign: "center", padding: 60 }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>⏳</div>
          <div style={{ fontSize: 14, color: C.GO, fontWeight: 600 }}>Analisando clientes...</div>
        </div>
      )}

      {/* CARDS-EMPRESA GRID */}
      {!loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 10 }}>
          {filtered.map(client => (
            <div
              key={client.id}
              style={{
                background: C.BG2, borderRadius: 12, border: `1px solid ${C.BD}`,
                overflow: "hidden", cursor: "pointer", transition: "transform 0.2s",
              }}
              onClick={() => { window.location.href = `/dashboard?empresa=${client.id}`; }}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "none"; }}
            >
              <div style={{ padding: "12px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.TX }}>{client.nome}</div>
                    <div style={{ fontSize: 10, color: C.TXD }}>
                      {client.cnpj}{client.cidade ? ` • ${client.cidade}` : ""}
                    </div>
                  </div>
                  <PSGCBadge variant={statusBadgeVariant(client.status)}>
                    {statusIcon(client.status)} {statusLabel(client.status)}
                  </PSGCBadge>
                </div>

                {client.status !== "sem_dados" ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 8 }}>
                    {[
                      { l: "Receita", v: fmtBRL(client.receita), c: C.G },
                      { l: "Despesa", v: fmtBRL(client.despesa), c: C.Y },
                      { l: "Resultado", v: fmtBRL(client.resultado), c: client.resultado >= 0 ? C.G : C.R },
                    ].map((k, i) => (
                      <div key={i} style={{ background: C.BG3, borderRadius: 6, padding: "6px 8px", textAlign: "center" }}>
                        <div style={{ fontSize: 8, color: C.TXD }}>{k.l}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: k.c }}>{k.v}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ background: C.BG3, borderRadius: 6, padding: "12px 8px", textAlign: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: C.TXD }}>Nenhum dado importado</div>
                  </div>
                )}

                {client.alertas.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    {client.alertas.slice(0, 3).map((a, i) => (
                      <div key={i} style={{ fontSize: 9, color: C.R, padding: "1px 0" }}>⚠️ {a}</div>
                    ))}
                    {client.alertas.length > 3 && (
                      <div style={{ fontSize: 9, color: C.TXD }}>+{client.alertas.length - 3} alerta(s)</div>
                    )}
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: C.TXD }}>
                  <span>
                    {client.margem !== 0 && `Margem: ${client.margem}% • `}
                    {client.totalTitulos} títulos
                  </span>
                  <span style={{ color: client.diasSemSync > 30 ? C.Y : C.TXD }}>
                    Sync: {client.ultimoSync}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, background: C.BG2, borderRadius: 12, border: `1px solid ${C.BD}` }}>
          <div style={{ fontSize: 14, color: C.TXM }}>Nenhum cliente encontrado</div>
        </div>
      )}

      {/* FOOTER */}
      <div style={{ fontSize: 10, color: C.TXD, textAlign: "center", marginTop: 20, padding: 12, background: C.BG2, borderRadius: 8, border: `1px solid ${C.BD}` }}>
        PS Gestão e Capital — BPO Inteligente v8.7.3 | {totalClients} empresa(s) | 9 módulos ativos
      </div>
    </div>
  );
}
