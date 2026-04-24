import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPA_URL = "https://horsymhsinqcimflrtjo.supabase.co";
const KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";

// ==================================================================
// MAPEAMENTO DE COLUNAS — generico + preset SIGA
// ==================================================================
const COLUMN_MAP: Record<string, Record<string, string[]>> = {
  clientes: {
    nome: ["razao social","razão social","nome","nome fantasia","cliente","name","company","empresa","denominacao"],
    nome_fantasia: ["nome fantasia","fantasia","apelido","nome fantasia/apelido"],
    cpf_cnpj: ["cpf","cnpj","cpf/cnpj","cpf_cnpj","documento","cnpj/cpf","inscricao"],
    email: ["email","e-mail","mail","correio"],
    telefone: ["telefone","tel","fone","phone","tel comercial"],
    celular: ["celular","cel","mobile","whatsapp"],
    cidade: ["cidade","city","municipio"],
    uf: ["uf","estado","state"],
  },
  fornecedores: {
    nome: ["razao social","razão social","nome","fornecedor","supplier","nome fantasia","empresa","nome fantasia/apelido"],
    nome_fantasia: ["nome fantasia","fantasia","apelido"],
    cpf_cnpj: ["cpf","cnpj","cpf/cnpj","documento"],
    email: ["email","e-mail"],
    telefone: ["telefone","tel","fone"],
    cidade: ["cidade","city","municipio"],
    uf: ["uf","estado"],
  },
  receber: {
    descricao: ["descricao","descrição","historico","histórico","description","observacao","detalhamento"],
    valor: ["valor","value","amount","total","vlr","valor documento","valor titulo","valor base","receber"],
    data_vencimento: ["vencimento","data vencimento","dt vencimento","venc","data vcto"],
    data_emissao: ["emissao","emissão","data emissao","data emissão","dt emissao","data lancamento","competencia","data"],
    data_pagamento: ["pagamento","data pagamento","dt pagamento","data recebimento","dt baixa","quitado em","quitado"],
    cliente_nome: ["cliente","customer","client","sacado","pagador","nome cliente","nome fantasia/apelido","nome fantasia","apelido"],
    categoria: ["categoria","category","plano contas","conta contabil","classificacao"],
    numero_documento: ["documento","doc","numero","num doc","nr documento","numero documento","nf","nota","codigo","código"],
    status: ["status","situacao","situação"],
    forma_pagamento: ["forma pgto","forma pagamento","meio pagamento","meio de pagamento","tipo pgto"],
    centro_custo: ["centro custo","cc","cost center","centro de custo","centro de custos"],
    cliente_relacionado: ["cliente relacionado","relacionado"],
  },
  pagar: {
    descricao: ["descricao","descrição","historico","histórico","description","observacao","detalhamento"],
    valor: ["valor","value","amount","total","vlr","valor documento","valor titulo","valor base","pagar"],
    data_vencimento: ["vencimento","data vencimento","dt vencimento","venc"],
    data_emissao: ["emissao","emissão","data emissao","data emissão","dt emissao","data lancamento","competencia","data"],
    data_pagamento: ["pagamento","data pagamento","dt pagamento","dt baixa","quitado em","quitado"],
    fornecedor_nome: ["fornecedor","supplier","vendor","cedente","beneficiario","nome fornecedor","credor","nome fantasia/apelido","nome fantasia","apelido"],
    categoria: ["categoria","category","plano contas","conta contabil","classificacao"],
    numero_documento: ["documento","doc","numero","num doc","nr documento","numero documento","codigo","código"],
    status: ["status","situacao","situação"],
    forma_pagamento: ["forma pgto","forma pagamento","meio pagamento","meio de pagamento","tipo pgto"],
    centro_custo: ["centro custo","cc","cost center","centro de custo","centro de custos"],
    cliente_relacionado: ["cliente relacionado","relacionado"],
  },
  produtos: {
    codigo: ["codigo","código","code","sku","ref","referencia","id","cod"],
    nome: ["nome","descricao","descrição","produto","product","item","mercadoria"],
    unidade: ["unidade","un","unit","und","medida"],
    preco_venda: ["preco venda","preço venda","preco","preço","price","valor venda"],
    preco_custo: ["preco custo","preço custo","custo","cost","valor custo"],
    estoque_atual: ["estoque","estoque atual","stock","saldo","quantidade","qtd"],
    ncm: ["ncm","ncm/sh"],
    categoria: ["categoria","grupo","departamento","secao","familia"],
  },
};

// ==================================================================
// Detectar formato SIGA
// ==================================================================
function detectPreset(headers: string[]): "siga" | "generico" {
  const h = headers.map(x => x.toLowerCase().trim());
  const hasReceber = h.some(x => x === "receber");
  const hasPagar = h.some(x => x === "pagar");
  const hasQuitado = h.some(x => x.includes("quitado em") || x === "quitado");
  const hasSaldo = h.some(x => x === "saldo");
  if (hasReceber && hasPagar && (hasQuitado || hasSaldo)) return "siga";
  return "generico";
}

function detectTipo(headers: string[]): string {
  const h = headers.map(x => x.toLowerCase().trim());
  const scores: Record<string, number> = { clientes: 0, fornecedores: 0, receber: 0, pagar: 0, produtos: 0 };
  for (const [tipo, campos] of Object.entries(COLUMN_MAP)) {
    for (const aliases of Object.values(campos)) {
      for (const alias of aliases) {
        if (h.some(hdr => hdr.includes(alias) || alias.includes(hdr))) scores[tipo]++;
      }
    }
  }
  if (h.some(x => x.includes("cliente") || x.includes("sacado"))) scores.receber += 3;
  if (h.some(x => x.includes("fornecedor") || x.includes("cedente") || x.includes("credor"))) scores.pagar += 3;
  if (h.some(x => x.includes("estoque") || x.includes("sku") || x.includes("produto"))) scores.produtos += 3;
  if (h.some(x => x.includes("vencimento"))) { scores.receber += 2; scores.pagar += 2; }
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

function mapColumns(headers: string[], tipo: string): Record<string, number> {
  const campos = COLUMN_MAP[tipo] || {};
  const mapped: Record<string, number> = {};
  const h = headers.map(x => x.toLowerCase().trim());
  for (const [field, aliases] of Object.entries(campos)) {
    for (let i = 0; i < h.length; i++) {
      if (Object.values(mapped).includes(i)) continue;
      const hdr = h[i];
      if (aliases.some(a => hdr === a || hdr.includes(a) || a.includes(hdr))) {
        mapped[field] = i;
        break;
      }
    }
  }
  return mapped;
}

// Mapeamento específico SIGA (busca por header exato)
function mapColumnsSIGA(headers: string[]): Record<string, number> {
  const h = headers.map(x => x.toLowerCase().trim());
  const m: Record<string, number> = {};
  const find = (name: string) => h.findIndex(x => x === name);
  const findContains = (name: string) => h.findIndex(x => x.includes(name));
  
  m.data_emissao = find("emissao") !== -1 ? find("emissao") : find("emissão");
  m.data_vencimento = find("vencimento");
  m.data_pagamento = findContains("quitado em");
  if (m.data_pagamento === -1) m.data_pagamento = find("quitado");
  m.status = find("situacao") !== -1 ? find("situacao") : find("situação");
  m.forma_pagamento = findContains("meio");
  m.numero_documento = find("codigo") !== -1 ? find("codigo") : find("código");
  m.numero_nf = find("documento");
  m.nome_pessoa = findContains("nome fantasia");
  m.descricao = find("descricao") !== -1 ? find("descricao") : find("descrição");
  m.valor_base = findContains("valor base");
  m.valor_receber = find("receber");
  m.valor_pagar = find("pagar");
  m.conta_corrente = findContains("conta corrente");
  m.categoria = find("categoria");
  m.centro_custo = findContains("centro de custo");
  m.cliente_relacionado = findContains("cliente relacionado");
  
  // Remove campos -1
  Object.keys(m).forEach(k => { if (m[k] === -1) delete m[k]; });
  return m;
}

// ==================================================================
// Parsers
// ==================================================================
function parseDate(val: any): string | null {
  if (val == null || val === "") return null;
  if (val instanceof Date) return val.toISOString().split("T")[0];
  const s = String(val).trim();
  if (!s) return null;
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m1) { let y = parseInt(m1[3]); if (m1[3].length === 2) y += 2000; return `${y}-${m1[2].padStart(2, "0")}-${m1[1].padStart(2, "0")}`; }
  const m2 = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m2) return `${m2[1]}-${m2[2].padStart(2, "0")}-${m2[3].padStart(2, "0")}`;
  if (/^\d{5}$/.test(s)) { const d = new Date((parseInt(s) - 25569) * 86400 * 1000); return d.toISOString().split("T")[0]; }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  return null;
}

function parseNumber(val: any): number {
  if (typeof val === "number") return val;
  if (val == null || val === "") return 0;
  const s = String(val).replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
  return parseFloat(s) || 0;
}

function parseStatus(val: any): string {
  const s = (String(val || "")).toLowerCase().trim();
  if (["pago", "recebido", "liquidado", "baixado", "quitado"].some(x => s.includes(x))) return "pago";
  if (["cancelado", "estornado"].some(x => s.includes(x))) return "cancelado";
  if (["vencido", "atraso", "inadimplente"].some(x => s.includes(x))) return "vencido";
  return "aberto";
}

function normalizeStr(s: string): string {
  return (s || "").trim().toUpperCase().slice(0, 150);
}

// ==================================================================
// Processa 1 linha SIGA -> lançamento
// ==================================================================
function processarLinhaSIGA(row: any[], m: Record<string, number>): { tipo: "receber" | "pagar" | null; data: any } {
  const receber = parseNumber(row[m.valor_receber]);
  const pagar = parseNumber(row[m.valor_pagar]);
  const valorBase = parseNumber(row[m.valor_base]);
  
  let tipo: "receber" | "pagar" | null = null;
  let valor = 0;
  
  if (receber > 0) { tipo = "receber"; valor = receber; }
  else if (pagar > 0) { tipo = "pagar"; valor = pagar; }
  else if (valorBase > 0) {
    // Se não tem receber/pagar mas tem valor base, tentar deduzir pela categoria
    const cat = String(row[m.categoria] || "").toLowerCase();
    if (cat.includes("receita") || cat.includes("credito")) { tipo = "receber"; valor = valorBase; }
    else { tipo = "pagar"; valor = valorBase; }
  }
  
  if (!tipo || valor === 0) return { tipo: null, data: null };
  
  const nomePessoa = String(row[m.nome_pessoa] || "").trim();
  const clienteRel = String(row[m.cliente_relacionado] || "").trim();
  const nomeFinal = nomePessoa || clienteRel;
  
  const descricao = String(row[m.descricao] || "").trim();
  const categoria = String(row[m.categoria] || "").trim();
  const centroCusto = String(row[m.centro_custo] || "").trim();
  
  return {
    tipo,
    data: {
      data_emissao: parseDate(row[m.data_emissao]),
      data_vencimento: parseDate(row[m.data_vencimento]),
      data_pagamento: parseDate(row[m.data_pagamento]),
      status: parseStatus(row[m.status]),
      forma_pagamento: String(row[m.forma_pagamento] || "").trim() || null,
      numero_documento: String(row[m.numero_documento] || "").trim() || null,
      numero_nf: String(row[m.numero_nf] || "").trim() || null,
      nome_pessoa: nomeFinal,
      descricao: descricao || categoria,
      valor_documento: valor,
      valor_pago: receber > 0 || pagar > 0 || parseDate(row[m.data_pagamento]) ? valor : 0,
      categoria_original: categoria,
      centro_custo_original: centroCusto,
      conta_corrente: String(row[m.conta_corrente] || "").trim() || null,
    }
  };
}

// ==================================================================
// Read XLSX / CSV
// ==================================================================
async function readFile(file: File): Promise<{ headers: string[]; rows: any[][] }> {
  const fileName = file.name.toLowerCase();
  const isCSV = fileName.endsWith(".csv") || fileName.endsWith(".tsv");
  
  if (isCSV) {
    const text = await file.text();
    const sep = text.includes(";") ? ";" : text.includes("\t") ? "\t" : ",";
    const lines = text.split("\n").filter(l => l.trim().length > 0);
    if (lines.length < 2) throw new Error("Arquivo vazio");
    let hdrIdx = 0;
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const cols = lines[i].split(sep);
      if (cols.length >= 3) { hdrIdx = i; break; }
    }
    const headers = lines[hdrIdx].split(sep).map(h => h.replace(/["']/g, "").trim());
    const rows = lines.slice(hdrIdx + 1).map(l => l.split(sep).map(v => v.replace(/["']/g, "").trim()));
    return { headers, rows };
  }
  
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer() as any);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Planilha vazia");
  
  let hdrRow = 1;
  let bestCount = 0;
  ws.eachRow((row: any, num: any) => {
    if (num > 10) return;
    let filled = 0;
    row.eachCell((_c: any) => filled++);
    if (filled > bestCount && filled >= 3) { bestCount = filled; hdrRow = num; }
  });
  
  const headers: string[] = [];
  const hdrCells = ws.getRow(hdrRow);
  hdrCells.eachCell((cell: any, col: any) => { headers[col - 1] = String(cell.value || "").trim(); });
  
  const rows: any[][] = [];
  ws.eachRow((row: any, num: any) => {
    if (num <= hdrRow) return;
    const r: any[] = [];
    row.eachCell((cell: any, col: any) => { 
      let v = cell.value;
      if (v && typeof v === "object" && "result" in v) v = v.result;
      if (v && typeof v === "object" && "text" in v) v = v.text;
      r[col - 1] = v;
    });
    if (r.some(v => v != null && String(v).trim() !== "")) rows.push(r);
  });
  
  return { headers, rows };
}

// ==================================================================
// POST handler
// ==================================================================
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const action = (formData.get("action") as string) || "analyze";
    const companyId = formData.get("company_id") as string;
    const tipoForced = formData.get("tipo") as string;
    const presetForced = formData.get("preset") as string;
    
    if (!file) return NextResponse.json({ error: "Nenhum arquivo" }, { status: 400 });
    
    const fn = file.name.toLowerCase();
    if (!fn.endsWith(".xlsx") && !fn.endsWith(".xls") && !fn.endsWith(".csv") && !fn.endsWith(".tsv")) {
      return NextResponse.json({ error: "Formato não suportado. Use .xlsx, .xls ou .csv" }, { status: 400 });
    }
    
    const { headers, rows } = await readFile(file);
    const cleanHeaders = headers.filter(h => h && h.length > 0);
    
    // Detectar preset e tipo
    const preset = presetForced || detectPreset(cleanHeaders);
    const tipoDetected = preset === "siga" ? "misto" : detectTipo(cleanHeaders);
    const tipo = tipoForced || tipoDetected;
    
    // Mapeamento
    let mapping: Record<string, number> = {};
    if (preset === "siga") {
      mapping = mapColumnsSIGA(cleanHeaders);
    } else {
      mapping = mapColumns(cleanHeaders, tipo);
    }
    
    // =========================================================
    // ANALYZE MODE
    // =========================================================
    if (action === "analyze") {
      let preview: any[] = [];
      
      if (preset === "siga") {
        // Preview SIGA: mostrar as 10 primeiras linhas com tipo inferido
        preview = rows.slice(0, 10).map(r => {
          const p = processarLinhaSIGA(r, mapping);
          if (!p.tipo) return null;
          return {
            tipo: p.tipo,
            data_emissao: p.data.data_emissao,
            data_vencimento: p.data.data_vencimento,
            data_pagamento: p.data.data_pagamento,
            nome: p.data.nome_pessoa,
            valor: p.data.valor_documento,
            descricao: p.data.descricao,
            categoria: p.data.categoria_original,
            centro_custo: p.data.centro_custo_original,
            status: p.data.status,
          };
        }).filter(Boolean);
      } else {
        preview = rows.slice(0, 10).map(r => {
          const obj: Record<string, any> = {};
          for (const [field, colIdx] of Object.entries(mapping)) {
            obj[field] = r[colIdx] != null ? String(r[colIdx]) : "";
          }
          return obj;
        });
      }
      
      // Contagem prévia SIGA
      let stats: any = null;
      if (preset === "siga") {
        let cReceber = 0, cPagar = 0, totReceber = 0, totPagar = 0;
        for (const r of rows) {
          const p = processarLinhaSIGA(r, mapping);
          if (p.tipo === "receber") { cReceber++; totReceber += p.data.valor_documento; }
          else if (p.tipo === "pagar") { cPagar++; totPagar += p.data.valor_documento; }
        }
        stats = { cReceber, cPagar, totReceber, totPagar };
      }
      
      return NextResponse.json({
        success: true,
        action: "analyze",
        fileName: file.name,
        fileSize: file.size,
        totalRows: rows.length,
        headers: cleanHeaders,
        preset,
        tipoDetected,
        tipo,
        mapping,
        unmappedHeaders: cleanHeaders.filter((_, i) => !Object.values(mapping).includes(i)),
        preview,
        stats,
      });
    }
    
    // =========================================================
    // IMPORT MODE
    // =========================================================
    if (!companyId) return NextResponse.json({ error: "company_id obrigatório" }, { status: 400 });
    
    const sb = createClient(SUPA_URL, KEY());
    
    // ----- SIGA: dupla escrita em erp_pagar/erp_receber + erp_lancamentos -----
    if (preset === "siga") {
      // 1) Carregar clientes e fornecedores existentes da empresa (usa nome_fantasia)
      const [clientesRes, fornecRes] = await Promise.all([
        sb.from("erp_clientes").select("id, nome_fantasia").eq("company_id", companyId),
        sb.from("erp_fornecedores").select("id, nome_fantasia").eq("company_id", companyId),
      ]);
      
      const clientesMap = new Map<string, string>();
      (clientesRes.data || []).forEach((c: any) => clientesMap.set(normalizeStr(c.nome_fantasia), c.id));
      
      const fornecMap = new Map<string, string>();
      (fornecRes.data || []).forEach((f: any) => fornecMap.set(normalizeStr(f.nome_fantasia), f.id));
      
      // 2) Processar todas as linhas
      const lancReceber: any[] = [];
      const lancPagar: any[] = [];
      const clientesNovos = new Set<string>();
      const fornecNovos = new Set<string>();
      
      for (const r of rows) {
        const p = processarLinhaSIGA(r, mapping);
        if (!p.tipo || !p.data.nome_pessoa) continue;
        
        const nomeNorm = normalizeStr(p.data.nome_pessoa);
        
        if (p.tipo === "receber") {
          if (!clientesMap.has(nomeNorm)) clientesNovos.add(p.data.nome_pessoa);
          lancReceber.push({ ...p.data, _nome_norm: nomeNorm });
        } else {
          if (!fornecMap.has(nomeNorm)) fornecNovos.add(p.data.nome_pessoa);
          lancPagar.push({ ...p.data, _nome_norm: nomeNorm });
        }
      }
      
      // 3) Criar clientes novos em lote
      if (clientesNovos.size > 0) {
        const novos = Array.from(clientesNovos).map(nome => ({
          company_id: companyId,
          nome_fantasia: nome.slice(0, 250),
        }));
        const { data: criados, error: errC } = await sb
          .from("erp_clientes")
          .insert(novos)
          .select("id, nome_fantasia");
        if (!errC && criados) {
          criados.forEach((c: any) => clientesMap.set(normalizeStr(c.nome_fantasia), c.id));
        } else if (errC) {
          console.error("Erro criando clientes:", errC.message);
        }
      }
      
      // 4) Criar fornecedores novos em lote
      if (fornecNovos.size > 0) {
        const novos = Array.from(fornecNovos).map(nome => ({
          company_id: companyId,
          nome_fantasia: nome.slice(0, 250),
        }));
        const { data: criados, error: errF } = await sb
          .from("erp_fornecedores")
          .insert(novos)
          .select("id, nome_fantasia");
        if (!errF && criados) {
          criados.forEach((f: any) => fornecMap.set(normalizeStr(f.nome_fantasia), f.id));
        } else if (errF) {
          console.error("Erro criando fornecedores:", errF.message);
        }
      }
      
      // 5) Preparar registros em erp_receber (usa DATE, ref_externa_sistema)
      const recordsReceber = lancReceber.map(l => ({
        company_id: companyId,
        cliente_id: clientesMap.get(l._nome_norm) || null,
        cliente_nome: (l.nome_pessoa || "").slice(0, 250),
        descricao: (l.descricao || "sem descricao").slice(0, 250),
        valor: l.valor_documento,
        valor_pago: l.valor_pago,
        data_emissao: l.data_emissao,
        data_vencimento: l.data_vencimento,
        data_pagamento: l.data_pagamento,
        status: l.status,
        forma_pagamento: (l.forma_pagamento || "").slice(0, 100) || null,
        numero_documento: (l.numero_documento || "").slice(0, 100) || null,
        numero_nf: (l.numero_nf || "").slice(0, 100) || null,
        categoria: (l.categoria_original || "").slice(0, 250) || null,
        centro_custo: (l.centro_custo_original || "").slice(0, 250) || null,
        ref_externa_sistema: "siga",
        importado_em: new Date().toISOString(),
      }));
      
      // 6) Preparar registros em erp_pagar
      const recordsPagar = lancPagar.map(l => ({
        company_id: companyId,
        fornecedor_id: fornecMap.get(l._nome_norm) || null,
        fornecedor_nome: (l.nome_pessoa || "").slice(0, 250),
        descricao: (l.descricao || "sem descricao").slice(0, 250),
        valor: l.valor_documento,
        valor_pago: l.valor_pago,
        data_emissao: l.data_emissao,
        data_vencimento: l.data_vencimento,
        data_pagamento: l.data_pagamento,
        status: l.status,
        forma_pagamento: (l.forma_pagamento || "").slice(0, 100) || null,
        numero_documento: (l.numero_documento || "").slice(0, 100) || null,
        numero_nf: (l.numero_nf || "").slice(0, 100) || null,
        categoria: (l.categoria_original || "").slice(0, 250) || null,
        centro_custo: (l.centro_custo_original || "").slice(0, 250) || null,
        ref_externa_sistema: "siga",
        importado_em: new Date().toISOString(),
      }));
      
      // 7) Preparar registros em erp_lancamentos (DUPLA ESCRITA — padrão PSGC)
      const recordsLancamentos: any[] = [];
      for (const l of lancReceber) {
        recordsLancamentos.push({
          company_id: companyId,
          tipo: "receber",
          cliente_id: clientesMap.get(l._nome_norm) || null,
          nome_pessoa: (l.nome_pessoa || "").slice(0, 250),
          descricao: (l.descricao || "sem descricao").slice(0, 500),
          valor_documento: l.valor_documento,
          valor_pago: l.valor_pago,
          data_emissao: l.data_emissao,
          data_vencimento: l.data_vencimento,
          data_pagamento: l.data_pagamento,
          status: l.status,
          categoria: (l.categoria_original || "").slice(0, 250) || null,
          centro_custo: (l.centro_custo_original || "").slice(0, 250) || null,
          numero_documento: (l.numero_documento || "").slice(0, 100) || null,
          forma_pagamento: (l.forma_pagamento || "").slice(0, 100) || null,
        });
      }
      for (const l of lancPagar) {
        recordsLancamentos.push({
          company_id: companyId,
          tipo: "pagar",
          fornecedor_id: fornecMap.get(l._nome_norm) || null,
          nome_pessoa: (l.nome_pessoa || "").slice(0, 250),
          descricao: (l.descricao || "sem descricao").slice(0, 500),
          valor_documento: l.valor_documento,
          valor_pago: l.valor_pago,
          data_emissao: l.data_emissao,
          data_vencimento: l.data_vencimento,
          data_pagamento: l.data_pagamento,
          status: l.status,
          categoria: (l.categoria_original || "").slice(0, 250) || null,
          centro_custo: (l.centro_custo_original || "").slice(0, 250) || null,
          numero_documento: (l.numero_documento || "").slice(0, 100) || null,
          forma_pagamento: (l.forma_pagamento || "").slice(0, 100) || null,
        });
      }
      
      // 8) Inserir em lotes de 100
      let impReceber = 0, impPagar = 0, impLanc = 0;
      let errReceber = 0, errPagar = 0, errLanc = 0;
      
      for (let i = 0; i < recordsReceber.length; i += 100) {
        const batch = recordsReceber.slice(i, i + 100);
        const { error } = await sb.from("erp_receber").insert(batch);
        if (error) { errReceber += batch.length; console.error("Erro erp_receber:", error.message); }
        else impReceber += batch.length;
      }
      
      for (let i = 0; i < recordsPagar.length; i += 100) {
        const batch = recordsPagar.slice(i, i + 100);
        const { error } = await sb.from("erp_pagar").insert(batch);
        if (error) { errPagar += batch.length; console.error("Erro erp_pagar:", error.message); }
        else impPagar += batch.length;
      }
      
      for (let i = 0; i < recordsLancamentos.length; i += 100) {
        const batch = recordsLancamentos.slice(i, i + 100);
        const { error } = await sb.from("erp_lancamentos").insert(batch);
        if (error) { errLanc += batch.length; console.error("Erro erp_lancamentos:", error.message); }
        else impLanc += batch.length;
      }
      
      return NextResponse.json({
        success: true,
        action: "import",
        preset: "siga",
        totalRows: rows.length,
        imported: impReceber + impPagar,
        impReceber,
        impPagar,
        impLanc,
        errors: errReceber + errPagar + errLanc,
        errReceber,
        errPagar,
        errLanc,
        clientesNovos: clientesNovos.size,
        fornecNovos: fornecNovos.size,
        message: `Importação SIGA: ${impReceber} a receber + ${impPagar} a pagar = ${impReceber + impPagar} lançamentos. ${impLanc} em erp_lancamentos (PSGC). ${clientesNovos.size} clientes e ${fornecNovos.size} fornecedores novos criados.`,
      });
    }
    
    // ----- GENERICO: mantém comportamento antigo -----
    const TABELA_MAP: Record<string, string> = {
      clientes: "erp_clientes", fornecedores: "erp_fornecedores",
      receber: "erp_receber", pagar: "erp_pagar", produtos: "erp_produtos"
    };
    const tabela = TABELA_MAP[tipo];
    if (!tabela) return NextResponse.json({ error: `Tipo inválido: ${tipo}` }, { status: 400 });
    
    const DATE_FIELDS = ["data_vencimento", "data_emissao", "data_pagamento"];
    const NUMBER_FIELDS = ["valor", "valor_pago", "preco_venda", "preco_custo", "estoque_atual"];
    
    const records = rows.map(r => {
      const obj: Record<string, any> = { company_id: companyId };
      for (const [field, colIdx] of Object.entries(mapping)) {
        let val = r[colIdx];
        if (val == null || String(val).trim() === "") continue;
        if (DATE_FIELDS.includes(field)) val = parseDate(val);
        else if (NUMBER_FIELDS.includes(field)) val = parseNumber(val);
        else if (field === "status") val = parseStatus(val);
        else val = String(val).trim();
        if (val != null) obj[field] = val;
      }
      // Pra clientes/fornecedores, campo é nome_fantasia (não existe "nome")
      if ((tipo === "clientes" || tipo === "fornecedores") && obj.nome && !obj.nome_fantasia) {
        obj.nome_fantasia = obj.nome;
        delete obj.nome;
      }
      return obj;
    }).filter(r => {
      if (tipo === "clientes" || tipo === "fornecedores") return r.nome_fantasia;
      if (tipo === "receber" || tipo === "pagar") return r.descricao || r.valor;
      if (tipo === "produtos") return r.nome;
      return true;
    });
    
    if (records.length === 0) return NextResponse.json({ error: "Nenhum registro válido" }, { status: 400 });
    
    let imported = 0, errors = 0;
    for (let i = 0; i < records.length; i += 100) {
      const batch = records.slice(i, i + 100);
      const { error } = await sb.from(tabela).insert(batch);
      if (error) { errors += batch.length; console.error("Import error:", error.message); }
      else imported += batch.length;
    }
    
    return NextResponse.json({
      success: true,
      action: "import",
      tipo,
      tabela,
      preset,
      totalRows: rows.length,
      imported,
      errors,
      message: `${imported} registros importados${errors > 0 ? `, ${errors} com erro` : ""}`,
    });
    
  } catch (error: any) {
    console.error("Import error:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
