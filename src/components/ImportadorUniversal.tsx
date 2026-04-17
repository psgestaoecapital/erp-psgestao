"use client";
import React, { useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";

// ═══ PS Gestão Visual Identity ═══
const GO="#C6973F",GOL="#E8C872",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",
  G="#34D399",R="#F87171",Y="#FBBF24",B="#60A5FA",
  BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F",TXD="#918C82";

// ═══ MAPEAMENTO INTELIGENTE DE COLUNAS ═══
// Reconhece nomes de colunas de vários sistemas (SIGA, Omie, ContaAzul, genérico)
const COLUMN_ALIASES: Record<string, string[]> = {
  nome_pessoa: [
    "nome fantasia", "nome fantasia/apelido", "razao social", "razão social",
    "fornecedor", "cliente", "nome", "favorecido", "pagador", "sacado",
    "nome_pessoa", "nome_fantasia", "razao_social", "beneficiario", "beneficiário",
    "parceiro", "contato", "empresa", "name",
  ],
  descricao: [
    "descricao", "descrição", "descr", "historico", "histórico", "observacao",
    "observação", "obs", "memo", "detalhes", "description", "complemento",
  ],
  valor_documento: [
    "valor", "valor base", "valor_documento", "vlr", "total", "montante",
    "amount", "valor total", "valor doc", "valor_base",
  ],
  valor_receber: [
    "receber", "receita", "entrada", "credito", "crédito", "credit",
    "valor receber", "valor_receber", "income", "revenue",
  ],
  valor_pagar: [
    "pagar", "despesa", "saida", "saída", "debito", "débito", "debit",
    "valor pagar", "valor_pagar", "expense", "pagamento",
  ],
  data_emissao: [
    "emissao", "emissão", "data emissao", "data emissão", "dt emissao",
    "data_emissao", "issue date", "data lancamento", "data lançamento",
    "competencia", "competência",
  ],
  data_vencimento: [
    "vencimento", "data vencimento", "dt vencimento", "data_vencimento",
    "due date", "prazo", "validade", "venc",
  ],
  data_pagamento: [
    "quitado", "quitado em", "data pagamento", "dt pagamento", "data_pagamento",
    "pago em", "liquidado em", "data quitacao", "data quitação", "payment date",
  ],
  status: [
    "situacao", "situação", "status", "estado", "status_titulo", "sit",
  ],
  categoria: [
    "categoria", "category", "plano de contas", "plano_contas", "conta",
    "classificacao", "classificação", "tipo despesa",
  ],
  centro_custo: [
    "centro de custos", "centro de custo", "centro_custo", "cc",
    "departamento", "setor", "cost center",
  ],
  numero_documento: [
    "documento", "doc", "numero", "número", "nf", "nota", "nota fiscal",
    "numero_documento", "cod", "codigo", "código", "nfe", "num doc",
  ],
  conta_corrente: [
    "conta corrente", "conta_corrente", "banco", "bank", "conta bancaria",
    "conta bancária",
  ],
};

// ═══ FUNÇÕES UTILITÁRIAS ═══
function normalizeColName(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function detectSeparator(text: string): string {
  const firstLines = text.split("\n").slice(0, 5).join("\n");
  const semis = (firstLines.match(/;/g) || []).length;
  const commas = (firstLines.match(/,/g) || []).length;
  const tabs = (firstLines.match(/\t/g) || []).length;
  if (tabs > semis && tabs > commas) return "\t";
  if (semis > commas) return ";";
  return ",";
}

function parseNumber(val: string): number {
  if (!val || val.trim() === "" || val.trim() === "-") return 0;
  let v = val.trim();
  // Detect Brazilian format: 1.234,56
  if (v.includes(",") && v.includes(".")) {
    if (v.lastIndexOf(",") > v.lastIndexOf(".")) {
      // Brazilian: 1.234,56
      v = v.replace(/\./g, "").replace(",", ".");
    } else {
      // US: 1,234.56
      v = v.replace(/,/g, "");
    }
  } else if (v.includes(",") && !v.includes(".")) {
    // Could be decimal comma: 3,80
    v = v.replace(",", ".");
  }
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function parseDate(val: string): string | null {
  if (!val || val.trim() === "") return null;
  const v = val.trim();
  // dd/mm/yyyy or dd-mm-yyyy
  const p1 = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (p1) {
    let a = parseInt(p1[3]);
    if (p1[3].length === 2) a += 2000;
    const m = String(parseInt(p1[2])).padStart(2, "0");
    const d = String(parseInt(p1[1])).padStart(2, "0");
    return `${a}-${m}-${d}`;
  }
  // yyyy-mm-dd
  const p2 = v.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (p2) return `${p2[1]}-${String(parseInt(p2[2])).padStart(2, "0")}-${String(parseInt(p2[3])).padStart(2, "0")}`;
  return null;
}

function mapStatus(val: string): string {
  const v = (val || "").toLowerCase().trim();
  if (v === "quitado" || v === "pago" || v === "liquidado" || v === "recebido") return "PAGO";
  if (v === "cancelado" || v === "estornado") return "CANCELADO";
  if (v === "vencido" || v === "atrasado") return "VENCIDO";
  return "PENDENTE";
}

type ColumnMapping = Record<string, number | null>;
type ParsedRow = Record<string, string>;

interface ImporterProps {
  companyId: string;
  onImportComplete?: (count: number) => void;
}

export default function ImportadorUniversal({ companyId, onImportComplete }: ImporterProps) {
  const [step, setStep] = useState<"upload" | "mapping" | "preview" | "importing" | "done">("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<ParsedRow[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [autoDetected, setAutoDetected] = useState<Record<string, string>>({});
  const [importResult, setImportResult] = useState<{ success: number; errors: number; total: number }>({ success: 0, errors: 0, total: 0 });
  const [errorMsg, setErrorMsg] = useState("");
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // ═══ STEP 1: Upload e parse do arquivo ═══
  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setErrorMsg("");

    try {
      const ext = file.name.split(".").pop()?.toLowerCase();

      if (ext === "csv" || ext === "txt" || ext === "tsv") {
        // Tentar ler com diferentes encodings
        let text = "";
        for (const enc of ["UTF-8", "ISO-8859-1", "Windows-1252"]) {
          try {
            text = await file.text();
            if (enc !== "UTF-8") {
              const buf = await file.arrayBuffer();
              const decoder = new TextDecoder(enc);
              text = decoder.decode(buf);
            }
            if (!text.includes("�")) break; // sem chars corrompidos
          } catch { continue; }
        }

        const sep = detectSeparator(text);
        const lines = text.split("\n").filter(l => l.trim());
        if (lines.length < 2) { setErrorMsg("Arquivo vazio ou sem dados"); return; }

        const hdrs = lines[0].split(sep).map(h => h.trim().replace(/^["']|["']$/g, ""));
        setHeaders(hdrs);

        const rows: ParsedRow[] = [];
        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i].split(sep).map(v => v.trim().replace(/^["']|["']$/g, ""));
          if (vals.length < hdrs.length / 2) continue; // skip incomplete rows
          const row: ParsedRow = {};
          hdrs.forEach((h, j) => { row[h] = vals[j] || ""; });
          rows.push(row);
        }
        setRawRows(rows);
        autoMapColumns(hdrs);
        setStep("mapping");

      } else if (ext === "xlsx" || ext === "xls") {
        // Usar SheetJS para Excel
        const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.2/package/xlsx.mjs" as any).catch(() => null);
        if (!XLSX) {
          // Fallback: tentar carregar de CDN
          setErrorMsg("Para arquivos Excel, use o formato CSV por enquanto. Exporte do Excel como CSV (separado por vírgula ou ponto-e-vírgula).");
          return;
        }
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
        if (data.length < 2) { setErrorMsg("Planilha vazia"); return; }

        const hdrs = data[0].map(h => String(h || "").trim());
        setHeaders(hdrs);

        const rows: ParsedRow[] = [];
        for (let i = 1; i < data.length; i++) {
          const row: ParsedRow = {};
          hdrs.forEach((h, j) => { row[h] = String(data[i]?.[j] || ""); });
          rows.push(row);
        }
        setRawRows(rows);
        autoMapColumns(hdrs);
        setStep("mapping");

      } else {
        setErrorMsg("Formato não suportado. Use CSV, TXT, TSV ou XLSX.");
      }
    } catch (err: any) {
      setErrorMsg(`Erro ao ler arquivo: ${err.message}`);
    }
  }, []);

  // ═══ AUTO-DETECT: Mapear colunas automaticamente ═══
  const autoMapColumns = (hdrs: string[]) => {
    const newMapping: ColumnMapping = {};
    const detected: Record<string, string> = {};

    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      let bestIdx: number | null = null;
      let bestAlias = "";
      for (let i = 0; i < hdrs.length; i++) {
        const norm = normalizeColName(hdrs[i]);
        for (const alias of aliases) {
          const normAlias = normalizeColName(alias);
          if (norm === normAlias || norm.includes(normAlias) || normAlias.includes(norm)) {
            if (!bestIdx && bestIdx !== 0) { bestIdx = i; bestAlias = hdrs[i]; }
            // Prefer exact match
            if (norm === normAlias) { bestIdx = i; bestAlias = hdrs[i]; break; }
          }
        }
      }
      newMapping[field] = bestIdx;
      if (bestIdx !== null) detected[field] = bestAlias;
    }

    setMapping(newMapping);
    setAutoDetected(detected);
  };

  // ═══ STEP 2: Preview dos dados mapeados ═══
  const getMappedRows = () => {
    return rawRows.filter(row => {
      // Skip "Saldo Inicial" and empty rows
      const nome = mapping.nome_pessoa !== null ? row[headers[mapping.nome_pessoa!]] : "";
      if (!nome || nome.includes("Saldo Inicial")) return false;
      return true;
    }).map(row => {
      const get = (field: string) => {
        const idx = mapping[field];
        if (idx === null || idx === undefined) return "";
        return row[headers[idx]] || "";
      };

      const valReceber = parseNumber(get("valor_receber"));
      const valPagar = parseNumber(get("valor_pagar"));
      const valDoc = parseNumber(get("valor_documento"));
      const valor = valReceber > 0 ? valReceber : valPagar > 0 ? valPagar : valDoc;
      const tipo = valReceber > 0 ? "receber" : "pagar";

      const statusRaw = get("status");
      const status = statusRaw ? mapStatus(statusRaw) : "PENDENTE";
      const statusFinal = status === "PAGO" && tipo === "receber" ? "RECEBIDO" : status;

      // Categoria com subcategoria
      const catRaw = get("categoria");
      let categoria = catRaw;
      let subcategoria = "";
      if (catRaw.includes(" > ")) {
        const parts = catRaw.split(" > ", 2);
        categoria = parts[0].trim();
        subcategoria = parts[1].trim();
      }

      return {
        company_id: companyId,
        tipo,
        nome_pessoa: get("nome_pessoa"),
        descricao: get("descricao"),
        numero_documento: get("numero_documento"),
        valor_documento: valor,
        data_emissao: parseDate(get("data_emissao")),
        data_vencimento: parseDate(get("data_vencimento")),
        data_previsao: parseDate(get("data_vencimento")) || parseDate(get("data_emissao")),
        data_pagamento: parseDate(get("data_pagamento")),
        status: statusFinal,
        categoria,
        subcategoria,
        centro_custo: get("centro_custo"),
        conta_corrente: get("conta_corrente")?.replace(/^[•\s]+/, "").trim() || "",
      };
    }).filter(r => r.valor_documento > 0);
  };

  // ═══ STEP 3: Importar pro Supabase ═══
  const doImport = async () => {
    setStep("importing");
    const rows = getMappedRows();
    let success = 0;
    let errors = 0;

    // Inserir em batches de 50
    const batchSize = 50;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await supabase.from("erp_lancamentos").insert(batch);
      if (error) {
        console.error("Erro batch:", error);
        errors += batch.length;
      } else {
        success += batch.length;
      }
      setProgress(Math.round(((i + batchSize) / rows.length) * 100));
    }

    setImportResult({ success, errors, total: rows.length });
    setStep("done");
    if (onImportComplete) onImportComplete(success);
  };

  const mapped = step === "preview" || step === "mapping" ? getMappedRows() : [];
  const totalReceber = mapped.filter(r => r.tipo === "receber").reduce((s, r) => s + r.valor_documento, 0);
  const totalPagar = mapped.filter(r => r.tipo === "pagar").reduce((s, r) => s + r.valor_documento, 0);

  const fmtR = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
  const card: React.CSSProperties = { background: BG2, borderRadius: 12, border: `1px solid ${BD}`, padding: 20, marginBottom: 16 };
  const btn: React.CSSProperties = { background: GO, color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
  const btnSec: React.CSSProperties = { ...btn, background: BG3, color: TX, border: `1px solid ${BD}` };
  const sel: React.CSSProperties = { background: BG3, border: `1px solid ${BD}`, borderRadius: 6, color: TX, padding: "4px 8px", fontSize: 11 };

  return (
    <div style={{ minHeight: "100vh", background: BG, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: GOL }}>📥 Importador Universal</div>
          <div style={{ fontSize: 11, color: TXD }}>CSV, TXT, TSV ou XLSX — qualquer sistema de origem</div>
        </div>
        <a href="/dashboard" style={{ padding: "8px 14px", border: `1px solid ${BD}`, borderRadius: 8, color: TX, fontSize: 11, textDecoration: "none" }}>← Dashboard</a>
      </div>

      {errorMsg && (
        <div style={{ ...card, borderColor: R + "60", background: R + "10" }}>
          <div style={{ color: R, fontSize: 12 }}>⚠️ {errorMsg}</div>
        </div>
      )}

      {/* ═══ STEP 1: UPLOAD ═══ */}
      {step === "upload" && (
        <div style={{ ...card, textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
          <div style={{ fontSize: 14, color: TX, marginBottom: 8 }}>Arraste ou selecione o arquivo financeiro</div>
          <div style={{ fontSize: 11, color: TXD, marginBottom: 20 }}>Aceita: CSV, TXT, TSV, XLSX — de qualquer sistema (SIGA, Omie, ContaAzul, Excel genérico)</div>
          <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,.xlsx,.xls" onChange={handleFile} style={{ display: "none" }} />
          <button style={btn} onClick={() => fileRef.current?.click()}>Selecionar arquivo</button>
          <div style={{ fontSize: 10, color: TXD, marginTop: 16 }}>
            O sistema detecta automaticamente: separador (vírgula, ponto-e-vírgula, tab), formato de número (1.234,56 ou 1,234.56), formato de data (dd/mm/aaaa ou aaaa-mm-dd), e encoding (UTF-8 ou Latin-1)
          </div>
        </div>
      )}

      {/* ═══ STEP 2: MAPEAMENTO ═══ */}
      {step === "mapping" && (
        <>
          <div style={card}>
            <div style={{ fontSize: 14, fontWeight: 600, color: GOL, marginBottom: 12 }}>
              🔗 Mapeamento de colunas — {fileName}
              <span style={{ fontSize: 11, color: TXD, fontWeight: 400, marginLeft: 8 }}>
                {rawRows.length} linhas detectadas, {headers.length} colunas
              </span>
            </div>
            <div style={{ fontSize: 11, color: TXM, marginBottom: 16 }}>
              O sistema mapeou automaticamente as colunas. Ajuste se necessário.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 200px", gap: "6px 12px", alignItems: "center" }}>
              <div style={{ fontSize: 10, color: GOL, fontWeight: 600 }}>Campo ERP</div>
              <div style={{ fontSize: 10, color: GOL, fontWeight: 600 }}>Coluna do arquivo</div>
              <div style={{ fontSize: 10, color: GOL, fontWeight: 600 }}>Status</div>

              {Object.entries(COLUMN_ALIASES).map(([field]) => {
                const idx = mapping[field];
                const isRequired = ["nome_pessoa", "valor_documento", "valor_pagar", "valor_receber"].includes(field);
                const hasValue = idx !== null && idx !== undefined;
                const detected = autoDetected[field];

                return (
                  <React.Fragment key={field}>
                    <div style={{ fontSize: 11, color: isRequired ? TX : TXM }}>
                      {field.replace(/_/g, " ")}{isRequired && " *"}
                    </div>
                    <select value={idx ?? -1} onChange={e => {
                      const v = parseInt(e.target.value);
                      setMapping(prev => ({ ...prev, [field]: v === -1 ? null : v }));
                    }} style={sel}>
                      <option value={-1}>— não mapear —</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                    <div style={{ fontSize: 10, color: hasValue ? G : TXD }}>
                      {hasValue ? `✓ ${detected || headers[idx!]}` : "—"}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button style={btnSec} onClick={() => { setStep("upload"); setRawRows([]); setHeaders([]); }}>← Voltar</button>
            <button style={btn} onClick={() => setStep("preview")}>Próximo: Preview →</button>
          </div>
        </>
      )}

      {/* ═══ STEP 3: PREVIEW ═══ */}
      {step === "preview" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 12 }}>
            {[
              { l: "Total registros", v: mapped.length, c: GOL },
              { l: "A receber", v: fmtR(totalReceber), c: G },
              { l: "A pagar", v: fmtR(totalPagar), c: R },
              { l: "Líquido", v: fmtR(totalReceber - totalPagar), c: totalReceber - totalPagar >= 0 ? G : R },
            ].map((m, i) => (
              <div key={i} style={{ background: BG2, borderRadius: 10, padding: "10px 12px", borderLeft: `3px solid ${m.c}` }}>
                <div style={{ fontSize: 8, color: TXD, textTransform: "uppercase" }}>{m.l}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: m.c }}>{m.v}</div>
              </div>
            ))}
          </div>

          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "10px 16px", borderBottom: `1px solid ${BD}`, fontSize: 13, fontWeight: 600, color: GOL }}>
              Preview (primeiros 20 registros)
            </div>
            <div style={{ overflowX: "auto", maxHeight: 400 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${GO}30` }}>
                    <th style={{ padding: "8px 6px", textAlign: "left", color: GOL, fontSize: 9 }}>Tipo</th>
                    <th style={{ padding: "8px 6px", textAlign: "left", color: GOL, fontSize: 9 }}>Nome</th>
                    <th style={{ padding: "8px 6px", textAlign: "left", color: GOL, fontSize: 9 }}>Descrição</th>
                    <th style={{ padding: "8px 6px", textAlign: "right", color: GOL, fontSize: 9 }}>Valor</th>
                    <th style={{ padding: "8px 6px", textAlign: "center", color: GOL, fontSize: 9 }}>Vencimento</th>
                    <th style={{ padding: "8px 6px", textAlign: "center", color: GOL, fontSize: 9 }}>Status</th>
                    <th style={{ padding: "8px 6px", textAlign: "left", color: GOL, fontSize: 9 }}>Categoria</th>
                  </tr>
                </thead>
                <tbody>
                  {mapped.slice(0, 20).map((r, i) => (
                    <tr key={i} style={{ borderBottom: `0.5px solid ${BD}30` }}>
                      <td style={{ padding: "6px", color: r.tipo === "receber" ? G : R, fontWeight: 600 }}>
                        {r.tipo === "receber" ? "↓ REC" : "↑ PAG"}
                      </td>
                      <td style={{ padding: "6px", color: TX, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.nome_pessoa}</td>
                      <td style={{ padding: "6px", color: TXM, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.descricao}</td>
                      <td style={{ padding: "6px", textAlign: "right", color: r.tipo === "receber" ? G : R, fontWeight: 600 }}>{fmtR(r.valor_documento)}</td>
                      <td style={{ padding: "6px", textAlign: "center", color: TXM }}>{r.data_vencimento || "—"}</td>
                      <td style={{ padding: "6px", textAlign: "center" }}>
                        <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: r.status === "PAGO" || r.status === "RECEBIDO" ? G + "20" : r.status === "PENDENTE" ? B + "20" : Y + "20", color: r.status === "PAGO" || r.status === "RECEBIDO" ? G : r.status === "PENDENTE" ? B : Y }}>
                          {r.status}
                        </span>
                      </td>
                      <td style={{ padding: "6px", color: TXD, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.categoria}{r.subcategoria ? ` > ${r.subcategoria}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {mapped.length > 20 && (
              <div style={{ padding: "8px 16px", textAlign: "center", fontSize: 10, color: TXD, borderTop: `1px solid ${BD}30` }}>
                +{mapped.length - 20} registros não mostrados
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button style={btnSec} onClick={() => setStep("mapping")}>← Ajustar mapeamento</button>
            <button style={btn} onClick={doImport}>
              ✅ Importar {mapped.length} registros
            </button>
          </div>
        </>
      )}

      {/* ═══ STEP 4: IMPORTANDO ═══ */}
      {step === "importing" && (
        <div style={{ ...card, textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 16, color: GOL, marginBottom: 12 }}>⏳ Importando...</div>
          <div style={{ width: "100%", height: 8, background: BG3, borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
            <div style={{ width: `${progress}%`, height: "100%", background: GO, transition: "width 0.3s" }} />
          </div>
          <div style={{ fontSize: 11, color: TXD }}>{progress}% concluído</div>
        </div>
      )}

      {/* ═══ STEP 5: RESULTADO ═══ */}
      {step === "done" && (
        <div style={card}>
          <div style={{ fontSize: 16, fontWeight: 700, color: importResult.errors === 0 ? G : Y, marginBottom: 12 }}>
            {importResult.errors === 0 ? "✅ Importação concluída!" : "⚠️ Importação parcial"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 16 }}>
            <div style={{ background: BG3, borderRadius: 8, padding: 12, textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: G }}>{importResult.success}</div>
              <div style={{ fontSize: 10, color: TXD }}>Importados</div>
            </div>
            <div style={{ background: BG3, borderRadius: 8, padding: 12, textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: importResult.errors > 0 ? R : TXD }}>{importResult.errors}</div>
              <div style={{ fontSize: 10, color: TXD }}>Erros</div>
            </div>
            <div style={{ background: BG3, borderRadius: 8, padding: 12, textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: GOL }}>{importResult.total}</div>
              <div style={{ fontSize: 10, color: TXD }}>Total</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={btn} onClick={() => { setStep("upload"); setRawRows([]); setHeaders([]); setProgress(0); }}>
              Importar outro arquivo
            </button>
            <a href="/dashboard/visao-mensal?empresa=consolidado" style={{ ...btnSec, textDecoration: "none", display: "inline-block" }}>
              Ver no Dashboard →
            </a>
          </div>
        </div>
      )}

      <div style={{ fontSize: 9, color: TXD, textAlign: "center", marginTop: 16 }}>PS Gestão e Capital — Importador Universal v1.0</div>
    </div>
  );
}
