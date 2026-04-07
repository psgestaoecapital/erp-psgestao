"use client";
import React, { useState, useCallback } from "react";

const GO="#C6973F",GOL="#E8C872",BG="#111110",BG2="#252320",BG3="#33312A",
    G="#22C55E",R="#EF4444",Y="#FACC15",B="#3B82F6",P="#A855F7",
    BD="#504D40",TX="#F0ECE3",TXM="#CCC7BB",TXD="#918C82";

type Transacao = {
  data: string;
  valorBruto: number;
  valorLiquido: number;
  taxa: number;
  taxaPct: number;
  bandeira: string;
  tipo: string;
  parcela: string;
  nsu: string;
  autorizacao: string;
  status: string;
  previsaoPgto: string;
  linha: number;
};

type ResultadoConciliacao = {
  status: "conciliado"|"divergencia"|"nao_encontrado"|"chargeback"|"cancelado";
  transacao: Transacao;
  erp?: any;
  obs: string;
};

// ══════════════════════════════════════════════════
// PARSERS DE CSV POR OPERADORA
// ══════════════════════════════════════════════════

function detectarOperadora(headers: string[]): string {
  const h = headers.map(x => x.toLowerCase().trim());
  if (h.some(x => x.includes("nsu") && h.some(y => y.includes("cielo")))) return "cielo";
  if (h.some(x => x.includes("stone"))) return "stone";
  if (h.some(x => x.includes("getnet"))) return "getnet";
  if (h.some(x => x.includes("pagseguro") || x.includes("pag seguro"))) return "pagseguro";
  if (h.some(x => x.includes("mercadopago") || x.includes("mercado pago"))) return "mercadopago";
  if (h.some(x => x.includes("safrapay") || x.includes("safra"))) return "safrapay";
  if (h.some(x => x.includes("rede") && h.some(y => y.includes("itaú") || y.includes("itau")))) return "rede";
  // Auto-detect by columns
  if (h.includes("valor bruto") && h.includes("valor líquido")) return "generico_br";
  if (h.includes("valor_bruto") || h.includes("gross_amount")) return "generico_br";
  if (h.some(x => x.includes("bandeira")) && h.some(x => x.includes("valor"))) return "generico_br";
  return "generico";
}

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  // Detect separator
  const firstLine = text.split("\n")[0] || "";
  const sep = firstLine.includes(";") ? ";" : ",";
  
  const lines = text.split("\n").filter(l => l.trim().length > 0);
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = lines[0].split(sep).map(h => h.replace(/"/g, "").trim());
  const rows = lines.slice(1).map(l => l.split(sep).map(c => c.replace(/"/g, "").trim()));
  return { headers, rows };
}

function parseValor(v: string): number {
  if (!v) return 0;
  // Handle BR format: 1.234,56 or 1234,56
  let clean = v.replace(/[R$\s]/g, "");
  if (clean.includes(",") && clean.includes(".")) {
    // 1.234,56 → 1234.56
    clean = clean.replace(/\./g, "").replace(",", ".");
  } else if (clean.includes(",")) {
    clean = clean.replace(",", ".");
  }
  return parseFloat(clean) || 0;
}

function parseData(v: string): string {
  if (!v) return "";
  // Handle: dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd
  if (v.includes("/")) {
    const parts = v.split("/");
    if (parts[0].length === 4) return v; // yyyy/mm/dd
    return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  }
  return v;
}

function findCol(headers: string[], ...options: string[]): number {
  for (const opt of options) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(opt.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseTransacoes(headers: string[], rows: string[][]): Transacao[] {
  // Find columns dynamically
  const cData = findCol(headers, "data venda", "data da venda", "data_venda", "data transação", "data_transacao", "data", "date");
  const cBruto = findCol(headers, "valor bruto", "valor_bruto", "gross", "valor total", "valor da venda", "valor");
  const cLiquido = findCol(headers, "valor líquido", "valor_liquido", "net", "valor recebido", "líquido");
  const cTaxa = findCol(headers, "taxa", "tarifa", "fee", "desconto", "mdr");
  const cBandeira = findCol(headers, "bandeira", "brand", "card_brand", "rede", "adquirente");
  const cTipo = findCol(headers, "tipo", "modalidade", "type", "crédito", "débito");
  const cParcela = findCol(headers, "parcela", "installment", "nº parcela", "parcelas");
  const cNSU = findCol(headers, "nsu", "cod_nsu", "número sequencial");
  const cAuth = findCol(headers, "autorização", "autorizacao", "authorization", "cod_autorizacao");
  const cStatus = findCol(headers, "status", "situação", "situacao", "state");
  const cPrev = findCol(headers, "previsão", "previsao", "data pagamento", "data_pagamento", "payment_date", "data crédito");

  return rows.map((row, i) => {
    const bruto = cBruto >= 0 ? parseValor(row[cBruto]) : 0;
    const liquido = cLiquido >= 0 ? parseValor(row[cLiquido]) : bruto;
    const taxaVal = cTaxa >= 0 ? parseValor(row[cTaxa]) : (bruto - liquido);
    const taxaPct = bruto > 0 ? (taxaVal / bruto * 100) : 0;

    return {
      data: cData >= 0 ? parseData(row[cData]) : "",
      valorBruto: bruto,
      valorLiquido: liquido,
      taxa: Math.abs(taxaVal),
      taxaPct: Math.abs(taxaPct),
      bandeira: cBandeira >= 0 ? row[cBandeira] : "—",
      tipo: cTipo >= 0 ? row[cTipo] : "—",
      parcela: cParcela >= 0 ? row[cParcela] : "—",
      nsu: cNSU >= 0 ? row[cNSU] : "",
      autorizacao: cAuth >= 0 ? row[cAuth] : "",
      status: cStatus >= 0 ? row[cStatus] : "—",
      previsaoPgto: cPrev >= 0 ? parseData(row[cPrev]) : "",
      linha: i + 2,
    };
  }).filter(t => t.valorBruto > 0);
}

// ══════════════════════════════════════════════════
// MOTOR DE CONCILIAÇÃO
// ══════════════════════════════════════════════════

function conciliar(transacoes: Transacao[], contasReceber: any[]): ResultadoConciliacao[] {
  const usados = new Set<number>();

  return transacoes.map(t => {
    // Check chargeback/cancelamento
    const statusLower = t.status.toLowerCase();
    if (statusLower.includes("chargeback") || statusLower.includes("contestação") || statusLower.includes("estorno")) {
      return { status: "chargeback" as const, transacao: t, obs: `Chargeback/estorno detectado. Valor: R$ ${t.valorBruto.toFixed(2)}` };
    }
    if (statusLower.includes("cancel") || statusLower.includes("desfeita")) {
      return { status: "cancelado" as const, transacao: t, obs: `Transação cancelada pela operadora.` };
    }

    // Try matching with ERP
    let bestMatch: any = null;
    let bestDiff = Infinity;
    let bestIdx = -1;

    contasReceber.forEach((cr, idx) => {
      if (usados.has(idx)) return;
      const diff = Math.abs(cr.valor - t.valorBruto);
      const tolerance = t.valorBruto * 0.02; // 2% tolerance for rounding
      if (diff <= tolerance && diff < bestDiff) {
        bestMatch = cr;
        bestDiff = diff;
        bestIdx = idx;
      }
    });

    if (bestMatch) {
      usados.add(bestIdx);
      const diff = Math.abs(bestMatch.valor - t.valorBruto);
      if (diff < 0.01) {
        return { status: "conciliado" as const, transacao: t, erp: bestMatch, obs: "Valor exato encontrado no ERP." };
      }
      return {
        status: "divergencia" as const, transacao: t, erp: bestMatch,
        obs: `Diferença de R$ ${diff.toFixed(2)} entre operadora (R$ ${t.valorBruto.toFixed(2)}) e ERP (R$ ${bestMatch.valor.toFixed(2)}).`
      };
    }

    return { status: "nao_encontrado" as const, transacao: t, obs: "Transação da operadora não encontrada no ERP. Pode ser venda não registrada." };
  });
}

// ══════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ══════════════════════════════════════════════════

const fmtBRL = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

const statusConfig = {
  conciliado: { label: "Conciliado", cor: G, bg: G + "15", icon: "✅" },
  divergencia: { label: "Divergência", cor: Y, bg: Y + "15", icon: "⚠️" },
  nao_encontrado: { label: "Não Encontrado", cor: R, bg: R + "15", icon: "❌" },
  chargeback: { label: "Chargeback", cor: P, bg: P + "15", icon: "🔄" },
  cancelado: { label: "Cancelado", cor: TXD, bg: TXD + "15", icon: "🚫" },
};

export default function ConciliacaoCartao() {
  const [step, setStep] = useState<"upload"|"resultado">("upload");
  const [operadora, setOperadora] = useState("");
  const [transacoes, setTransacoes] = useState<Transacao[]>([]);
  const [resultados, setResultados] = useState<ResultadoConciliacao[]>([]);
  const [fileName, setFileName] = useState("");
  const [processing, setProcessing] = useState(false);
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Simulated ERP contas a receber (in production: query Supabase)
  const contasReceberERP = [
    { id: 1, valor: 150.00, data: "2026-04-01", cliente: "Maria Silva", doc: "NF-1234" },
    { id: 2, valor: 89.90, data: "2026-04-01", cliente: "João Santos", doc: "NF-1235" },
    { id: 3, valor: 230.00, data: "2026-04-02", cliente: "Ana Oliveira", doc: "NF-1240" },
    { id: 4, valor: 45.50, data: "2026-04-02", cliente: "Carlos Ferreira", doc: "NF-1241" },
    { id: 5, valor: 1200.00, data: "2026-04-03", cliente: "Construtora ABC", doc: "NF-1250" },
    { id: 6, valor: 780.00, data: "2026-04-03", cliente: "Eletricista Paulo", doc: "NF-1251" },
    { id: 7, valor: 320.00, data: "2026-04-04", cliente: "Loja Central", doc: "NF-1260" },
    { id: 8, valor: 560.00, data: "2026-04-04", cliente: "Roberto Lima", doc: "NF-1261" },
    { id: 9, valor: 95.00, data: "2026-04-05", cliente: "Fernanda Costa", doc: "NF-1270" },
    { id: 10, valor: 2450.00, data: "2026-04-05", cliente: "Obra Residencial Ltda", doc: "NF-1275" },
    { id: 11, valor: 175.00, data: "2026-04-06", cliente: "Pedro Souza", doc: "NF-1280" },
    { id: 12, valor: 430.00, data: "2026-04-07", cliente: "Marcelo Dias", doc: "NF-1290" },
  ];

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    setProcessing(true);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { headers, rows } = parseCSV(text);
      
      if (headers.length === 0) {
        alert("Arquivo vazio ou formato não reconhecido.");
        setProcessing(false);
        return;
      }

      const op = detectarOperadora(headers);
      setOperadora(op);

      const parsed = parseTransacoes(headers, rows);
      setTransacoes(parsed);

      // Conciliar
      setTimeout(() => {
        const results = conciliar(parsed, contasReceberERP);
        setResultados(results);
        setStep("resultado");
        setProcessing(false);
      }, 1200);
    };
    reader.readAsText(file, "UTF-8");
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".csv") || file.name.endsWith(".txt") || file.name.endsWith(".ofx"))) {
      handleFile(file);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  // Demo CSV for testing
  const gerarCSVDemo = () => {
    const csv = `Data Venda;Bandeira;Tipo;Parcela;Valor Bruto;Taxa;Valor Líquido;NSU;Autorização;Status;Previsão Pagamento
01/04/2026;Visa;Crédito;1/1;150,00;4,50;145,50;123456;AUTH001;Aprovada;02/05/2026
01/04/2026;Mastercard;Débito;1/1;89,90;1,80;88,10;123457;AUTH002;Aprovada;03/04/2026
02/04/2026;Visa;Crédito;1/3;230,00;8,05;221,95;123458;AUTH003;Aprovada;02/05/2026
02/04/2026;Elo;Débito;1/1;45,50;0,91;44,59;123459;AUTH004;Aprovada;04/04/2026
03/04/2026;Mastercard;Crédito;1/1;1200,00;30,00;1170,00;123460;AUTH005;Aprovada;03/05/2026
03/04/2026;Visa;Crédito;1/2;780,00;23,40;756,60;123461;AUTH006;Aprovada;03/05/2026
04/04/2026;Visa;Crédito;1/1;320,00;9,60;310,40;123462;AUTH007;Aprovada;04/05/2026
04/04/2026;Mastercard;Crédito;1/4;560,00;19,60;540,40;123463;AUTH008;Aprovada;04/05/2026
05/04/2026;Elo;Débito;1/1;95,00;1,90;93,10;123464;AUTH009;Aprovada;07/04/2026
05/04/2026;Visa;Crédito;1/6;2450,00;98,00;2352,00;123465;AUTH010;Aprovada;05/05/2026
06/04/2026;Mastercard;Crédito;1/1;175,00;5,25;169,75;123466;AUTH011;Aprovada;06/05/2026
06/04/2026;Visa;Crédito;1/1;388,00;11,64;376,36;123467;AUTH012;Aprovada;06/05/2026
07/04/2026;Visa;Débito;1/1;65,00;1,30;63,70;123468;AUTH013;Aprovada;09/04/2026
07/04/2026;Mastercard;Crédito;1/1;430,00;12,90;417,10;123469;AUTH014;Aprovada;07/05/2026
07/04/2026;Visa;Crédito;1/1;199,90;5,00;194,90;123470;AUTH015;Chargeback;—`;

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "extrato_operadora_demo.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Stats
  const stats = {
    total: resultados.length,
    conciliado: resultados.filter(r => r.status === "conciliado").length,
    divergencia: resultados.filter(r => r.status === "divergencia").length,
    nao_encontrado: resultados.filter(r => r.status === "nao_encontrado").length,
    chargeback: resultados.filter(r => r.status === "chargeback").length,
    cancelado: resultados.filter(r => r.status === "cancelado").length,
    valorBrutoTotal: resultados.reduce((s, r) => s + r.transacao.valorBruto, 0),
    valorLiquidoTotal: resultados.reduce((s, r) => s + r.transacao.valorLiquido, 0),
    taxaTotal: resultados.reduce((s, r) => s + r.transacao.taxa, 0),
    taxaMedia: resultados.length > 0 ? resultados.reduce((s, r) => s + r.transacao.taxaPct, 0) / resultados.length : 0,
  };

  const filtered = filtroStatus === "todos" ? resultados : resultados.filter(r => r.status === filtroStatus);

  const inp: React.CSSProperties = { background: BG3, border: `1px solid ${BD}`, color: TX, borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none" };

  return (
    <div style={{ padding: "20px", maxWidth: 1100, margin: "0 auto", background: BG, minHeight: "100vh" }}>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: GOL }}>Conciliação de Cartão de Crédito</div>
          <div style={{ fontSize: 11, color: TXD }}>Upload do extrato da operadora → conciliação automática com ERP</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a href="/dashboard/bpo" style={{ padding: "8px 16px", border: `1px solid ${BD}`, borderRadius: 8, color: TX, fontSize: 11, textDecoration: "none" }}>← BPO</a>
          <a href="/dashboard" style={{ padding: "8px 16px", border: `1px solid ${BD}`, borderRadius: 8, color: TXM, fontSize: 11, textDecoration: "none" }}>Dashboard</a>
        </div>
      </div>

      {/* STEP 1: Upload */}
      {step === "upload" && (
        <div style={{ animation: "fadeIn 0.3s ease" }}>
          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            style={{
              background: dragOver ? GO + "15" : BG2,
              border: `2px dashed ${dragOver ? GO : BD}`,
              borderRadius: 16, padding: "48px 24px", textAlign: "center",
              marginBottom: 16, transition: "all 0.3s", cursor: "pointer",
            }}
            onClick={() => document.getElementById("fileInput")?.click()}
          >
            <div style={{ fontSize: 48, marginBottom: 12 }}>📄</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: TX, marginBottom: 6 }}>
              Arraste o arquivo CSV da operadora aqui
            </div>
            <div style={{ fontSize: 12, color: TXM, marginBottom: 16 }}>
              ou clique para selecionar • Aceita: CSV, TXT, OFX
            </div>
            <input id="fileInput" type="file" accept=".csv,.txt,.ofx" onChange={handleFileInput} style={{ display: "none" }} />
            <div style={{ display: "flex", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
              {["Cielo", "Stone", "Rede", "PagSeguro", "GetNet", "Safrapay", "Mercado Pago"].map(op => (
                <span key={op} style={{ fontSize: 9, padding: "3px 8px", borderRadius: 4, background: BG3, color: TXD, border: `1px solid ${BD}` }}>{op}</span>
              ))}
            </div>
          </div>

          {/* Demo button */}
          <div style={{ background: BG2, borderRadius: 12, padding: 16, border: `1px solid ${BD}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: TX }}>Testar com dados de demonstração</div>
                <div style={{ fontSize: 11, color: TXD }}>Baixe um CSV exemplo e faça upload para ver a conciliação funcionando</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={gerarCSVDemo} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${GO}`, background: "transparent", color: GO, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                  ⬇ Baixar CSV Demo
                </button>
              </div>
            </div>
          </div>

          {/* Processing */}
          {processing && (
            <div style={{ textAlign: "center", padding: "40px 20px", marginTop: 16, background: BG2, borderRadius: 12, border: `1px solid ${BD}` }}>
              <div style={{ fontSize: 32, animation: "pulse 1.2s infinite", marginBottom: 12 }}>🔄</div>
              <div style={{ color: GOL, fontSize: 14, fontWeight: 500 }}>Processando {fileName}...</div>
              <div style={{ color: TXD, fontSize: 11, marginTop: 6 }}>Detectando operadora → Parseando transações → Conciliando com ERP</div>
            </div>
          )}
        </div>
      )}

      {/* STEP 2: Resultado */}
      {step === "resultado" && (
        <div style={{ animation: "fadeIn 0.3s ease" }}>
          {/* Summary bar */}
          <div style={{ background: BG2, borderRadius: 12, padding: 16, marginBottom: 12, border: `1px solid ${BD}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: TX }}>📄 {fileName}</div>
                <div style={{ fontSize: 10, color: TXD }}>Operadora detectada: <span style={{ color: GOL, fontWeight: 600 }}>{operadora.toUpperCase()}</span> • {stats.total} transações</div>
              </div>
              <button onClick={() => { setStep("upload"); setResultados([]); setTransacoes([]); setFileName(""); }}
                style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${BD}`, background: "transparent", color: TXM, fontSize: 11, cursor: "pointer" }}>
                ↻ Nova Conciliação
              </button>
            </div>

            {/* KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
              {[
                { label: "Valor Bruto", value: fmtBRL(stats.valorBrutoTotal), cor: TX },
                { label: "Valor Líquido", value: fmtBRL(stats.valorLiquidoTotal), cor: G },
                { label: "Taxas Total", value: fmtBRL(stats.taxaTotal), cor: R },
                { label: "Taxa Média", value: `${stats.taxaMedia.toFixed(2)}%`, cor: Y },
              ].map((k, i) => (
                <div key={i} style={{ background: BG3, borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
                  <div style={{ fontSize: 9, color: TXD, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{k.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: k.cor }}>{k.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Status filter buttons */}
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            <button onClick={() => setFiltroStatus("todos")} style={{
              padding: "6px 14px", borderRadius: 8, fontSize: 11, cursor: "pointer", fontWeight: 600,
              border: filtroStatus === "todos" ? `1px solid ${GO}` : `1px solid ${BD}`,
              background: filtroStatus === "todos" ? GO + "18" : "transparent",
              color: filtroStatus === "todos" ? GOL : TXM,
            }}>Todos ({stats.total})</button>
            {(["conciliado", "divergencia", "nao_encontrado", "chargeback", "cancelado"] as const).map(s => {
              const cfg = statusConfig[s];
              const count = stats[s === "nao_encontrado" ? "nao_encontrado" : s];
              if (count === 0) return null;
              return (
                <button key={s} onClick={() => setFiltroStatus(s)} style={{
                  padding: "6px 14px", borderRadius: 8, fontSize: 11, cursor: "pointer", fontWeight: 600,
                  border: filtroStatus === s ? `1px solid ${cfg.cor}` : `1px solid ${BD}`,
                  background: filtroStatus === s ? cfg.bg : "transparent",
                  color: filtroStatus === s ? cfg.cor : TXM,
                }}>{cfg.icon} {cfg.label} ({count})</button>
              );
            })}
          </div>

          {/* Conciliation progress bar */}
          <div style={{ background: BG2, borderRadius: 12, padding: 14, marginBottom: 12, border: `1px solid ${BD}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: TXM }}>Conciliação</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: stats.conciliado === stats.total ? G : GOL }}>
                {stats.total > 0 ? Math.round(stats.conciliado / stats.total * 100) : 0}% conciliado
              </span>
            </div>
            <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: BG3 }}>
              {stats.conciliado > 0 && <div style={{ width: `${stats.conciliado / stats.total * 100}%`, background: G, transition: "width 0.5s" }} />}
              {stats.divergencia > 0 && <div style={{ width: `${stats.divergencia / stats.total * 100}%`, background: Y, transition: "width 0.5s" }} />}
              {stats.nao_encontrado > 0 && <div style={{ width: `${stats.nao_encontrado / stats.total * 100}%`, background: R, transition: "width 0.5s" }} />}
              {stats.chargeback > 0 && <div style={{ width: `${stats.chargeback / stats.total * 100}%`, background: P, transition: "width 0.5s" }} />}
              {stats.cancelado > 0 && <div style={{ width: `${stats.cancelado / stats.total * 100}%`, background: TXD, transition: "width 0.5s" }} />}
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
              {[
                { label: "Conciliado", cor: G, v: stats.conciliado },
                { label: "Divergência", cor: Y, v: stats.divergencia },
                { label: "Não encontrado", cor: R, v: stats.nao_encontrado },
                { label: "Chargeback", cor: P, v: stats.chargeback },
              ].filter(x => x.v > 0).map((x, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: x.cor }} />
                  <span style={{ fontSize: 9, color: TXD }}>{x.label}: {x.v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Results table */}
          <div style={{ background: BG2, borderRadius: 12, border: `1px solid ${BD}`, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 700 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${BD}` }}>
                    {["Status", "Data", "Bandeira", "Tipo", "Parcela", "Valor Bruto", "Taxa", "Valor Líq.", "NSU"].map(h => (
                      <th key={h} style={{ padding: "10px 8px", textAlign: h.includes("Valor") || h === "Taxa" ? "right" : "left", color: GO, fontSize: 9, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => {
                    const cfg = statusConfig[r.status];
                    const isOpen = expandedRow === i;
                    return (
                      <React.Fragment key={i}>
                        <tr
                          onClick={() => setExpandedRow(isOpen ? null : i)}
                          style={{ borderBottom: `0.5px solid ${BD}40`, cursor: "pointer", background: isOpen ? BG3 + "50" : "transparent" }}
                          onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = BG3 + "30"; }}
                          onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = "transparent"; }}
                        >
                          <td style={{ padding: "8px" }}>
                            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: cfg.bg, color: cfg.cor, fontWeight: 600 }}>
                              {cfg.icon} {cfg.label}
                            </span>
                          </td>
                          <td style={{ padding: "8px", color: TXM }}>{r.transacao.data}</td>
                          <td style={{ padding: "8px", color: TX }}>{r.transacao.bandeira}</td>
                          <td style={{ padding: "8px", color: TXM }}>{r.transacao.tipo}</td>
                          <td style={{ padding: "8px", color: TXD }}>{r.transacao.parcela}</td>
                          <td style={{ padding: "8px", textAlign: "right", fontWeight: 600, color: TX }}>{fmtBRL(r.transacao.valorBruto)}</td>
                          <td style={{ padding: "8px", textAlign: "right", color: R, fontSize: 10 }}>{fmtBRL(r.transacao.taxa)} ({r.transacao.taxaPct.toFixed(1)}%)</td>
                          <td style={{ padding: "8px", textAlign: "right", fontWeight: 600, color: G }}>{fmtBRL(r.transacao.valorLiquido)}</td>
                          <td style={{ padding: "8px", color: TXD, fontFamily: "monospace", fontSize: 10 }}>{r.transacao.nsu || "—"}</td>
                        </tr>
                        {isOpen && (
                          <tr><td colSpan={9} style={{ padding: "0 8px 8px 8px", background: BG3 + "50" }}>
                            <div style={{ padding: "10px 12px", borderRadius: 8, background: BG2, border: `1px solid ${BD}`, fontSize: 11 }}>
                              <div style={{ marginBottom: 6, color: cfg.cor, fontWeight: 600 }}>{r.obs}</div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 10 }}>
                                <div>
                                  <div style={{ color: TXD, fontSize: 9, marginBottom: 2 }}>OPERADORA</div>
                                  <div style={{ color: TXM }}>Autorização: {r.transacao.autorizacao || "—"}</div>
                                  <div style={{ color: TXM }}>Previsão pgto: {r.transacao.previsaoPgto || "—"}</div>
                                  <div style={{ color: TXM }}>Status: {r.transacao.status}</div>
                                </div>
                                {r.erp && (
                                  <div>
                                    <div style={{ color: TXD, fontSize: 9, marginBottom: 2 }}>ERP (MATCH)</div>
                                    <div style={{ color: TXM }}>Cliente: {r.erp.cliente}</div>
                                    <div style={{ color: TXM }}>Doc: {r.erp.doc}</div>
                                    <div style={{ color: TXM }}>Valor ERP: {fmtBRL(r.erp.valor)}</div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td></tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* AI Analysis of fees */}
          {stats.total > 0 && (
            <div style={{ marginTop: 12, background: BG2, borderRadius: 12, padding: 16, border: `1px solid ${GO}30` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{ width: 24, height: 24, borderRadius: 6, background: `linear-gradient(135deg,${GO},${GOL})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#0F0F0D" }}>PS</div>
                <span style={{ fontSize: 12, fontWeight: 600, color: GOL }}>Análise IA — Taxas e Conciliação</span>
              </div>
              {stats.taxaMedia > 3.5 && (
                <div style={{ padding: "8px 12px", borderRadius: 8, background: R + "10", border: `1px solid ${R}30`, marginBottom: 6, fontSize: 11, color: TXM, display: "flex", gap: 8 }}>
                  <span>🔴</span>
                  <span>Taxa média de <strong style={{ color: R }}>{stats.taxaMedia.toFixed(2)}%</strong> está acima do mercado (referência: 2.5-3.0% crédito, 1.5-2.0% débito). Renegociar com a operadora pode economizar R$ {((stats.taxaMedia - 2.8) / 100 * stats.valorBrutoTotal).toFixed(0)}/período.</span>
                </div>
              )}
              {stats.nao_encontrado > 0 && (
                <div style={{ padding: "8px 12px", borderRadius: 8, background: R + "10", border: `1px solid ${R}30`, marginBottom: 6, fontSize: 11, color: TXM, display: "flex", gap: 8 }}>
                  <span>🔴</span>
                  <span><strong style={{ color: R }}>{stats.nao_encontrado} transações</strong> da operadora não foram encontradas no ERP. Possíveis vendas não registradas totalizando {fmtBRL(resultados.filter(r => r.status === "nao_encontrado").reduce((s, r) => s + r.transacao.valorBruto, 0))}.</span>
                </div>
              )}
              {stats.chargeback > 0 && (
                <div style={{ padding: "8px 12px", borderRadius: 8, background: P + "10", border: `1px solid ${P}30`, marginBottom: 6, fontSize: 11, color: TXM, display: "flex", gap: 8 }}>
                  <span>🔄</span>
                  <span><strong style={{ color: P }}>{stats.chargeback} chargeback(s)</strong> detectado(s). Valor em risco: {fmtBRL(resultados.filter(r => r.status === "chargeback").reduce((s, r) => s + r.transacao.valorBruto, 0))}. Abrir contestação junto à operadora em até 7 dias.</span>
                </div>
              )}
              {stats.conciliado === stats.total && (
                <div style={{ padding: "8px 12px", borderRadius: 8, background: G + "10", border: `1px solid ${G}30`, fontSize: 11, color: TXM, display: "flex", gap: 8 }}>
                  <span>🟢</span>
                  <span>100% conciliado. Todas as transações da operadora foram encontradas no ERP com valores corretos.</span>
                </div>
              )}
              {stats.divergencia > 0 && (
                <div style={{ padding: "8px 12px", borderRadius: 8, background: Y + "10", border: `1px solid ${Y}30`, fontSize: 11, color: TXM, display: "flex", gap: 8 }}>
                  <span>🟡</span>
                  <span><strong style={{ color: Y }}>{stats.divergencia} divergência(s)</strong> de valor entre operadora e ERP. Verificar se são arredondamentos ou diferenças reais de preço.</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
