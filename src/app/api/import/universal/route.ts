import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SUPA_URL = "https://horsymhsinqcimflrtjo.supabase.co";
const KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";

// âââ MAPEAMENTO INTELIGENTE DE COLUNAS âââ
const COLUMN_MAP: Record<string, Record<string, string[]>> = {
  clientes: {
    nome: ["razao social","razÃ£o social","nome","nome fantasia","cliente","name","company","empresa","razao","denominacao"],
    nome_fantasia: ["nome fantasia","fantasia","trade name","apelido"],
    cpf_cnpj: ["cpf","cnpj","cpf/cnpj","cpf_cnpj","documento","document","cnpj/cpf","inscricao"],
    email: ["email","e-mail","e_mail","mail","correio"],
    telefone: ["telefone","tel","fone","phone","tel comercial","telefone comercial"],
    celular: ["celular","cel","mobile","whatsapp","whats","tel celular"],
    cep: ["cep","zip","codigo postal","postal"],
    endereco: ["endereco","endereÃ§o","rua","logradouro","address","street"],
    numero: ["numero","nÃºmero","num","nro","number","nÂ°","nÂº"],
    bairro: ["bairro","neighborhood","district"],
    cidade: ["cidade","city","municipio","municÃ­pio","localidade"],
    uf: ["uf","estado","state","sigla"],
    ie: ["ie","inscricao estadual","inscr estadual","insc est"],
    observacoes: ["observacao","observaÃ§Ãµes","obs","nota","notes"],
  },
  fornecedores: {
    nome: ["razao social","razÃ£o social","nome","fornecedor","supplier","nome fantasia","empresa"],
    nome_fantasia: ["nome fantasia","fantasia"],
    cpf_cnpj: ["cpf","cnpj","cpf/cnpj","documento","cnpj/cpf"],
    email: ["email","e-mail"],
    telefone: ["telefone","tel","fone","phone"],
    celular: ["celular","cel","mobile","whatsapp"],
    cidade: ["cidade","city","municipio"],
    uf: ["uf","estado"],
    banco: ["banco","bank"],
    agencia: ["agencia","agÃªncia","agency"],
    conta: ["conta","account","conta corrente"],
    pix: ["pix","chave pix","chave"],
  },
  receber: {
    descricao: ["descricao","descriÃ§Ã£o","historico","histÃ³rico","description","memo","observacao","detalhamento"],
    valor: ["valor","value","amount","total","vlr","vl","valor documento","valor titulo","valor original"],
    data_vencimento: ["vencimento","data vencimento","dt vencimento","due date","venc","dt venc","data vcto"],
    data_emissao: ["emissao","data emissao","dt emissao","issue date","data lancamento","dt lancamento","competencia","data"],
    data_pagamento: ["pagamento","data pagamento","dt pagamento","payment date","data recebimento","dt recebimento","dt baixa"],
    cliente_nome: ["cliente","customer","client","sacado","pagador","nome cliente"],
    categoria: ["categoria","category","plano contas","conta contabil","classificacao","tipo"],
    numero_documento: ["documento","doc","numero","nÂº","num doc","nr documento","numero documento","nf","nota"],
    numero_nf: ["nf","nota fiscal","nfe","numero nf","nr nf","nf-e"],
    status: ["status","situacao","situaÃ§Ã£o","estado","st"],
    forma_pagamento: ["forma pgto","forma pagamento","payment method","meio pagamento","tipo pgto"],
    centro_custo: ["centro custo","cc","cost center","centro de custo"],
  },
  pagar: {
    descricao: ["descricao","descriÃ§Ã£o","historico","histÃ³rico","description","memo","observacao","detalhamento"],
    valor: ["valor","value","amount","total","vlr","vl","valor documento","valor titulo"],
    data_vencimento: ["vencimento","data vencimento","dt vencimento","due date","venc","dt venc"],
    data_emissao: ["emissao","data emissao","dt emissao","issue date","data lancamento","dt lancamento","competencia","data"],
    data_pagamento: ["pagamento","data pagamento","dt pagamento","payment date","dt baixa"],
    fornecedor_nome: ["fornecedor","supplier","vendor","cedente","beneficiario","nome fornecedor","credor"],
    categoria: ["categoria","category","plano contas","conta contabil","classificacao","tipo"],
    numero_documento: ["documento","doc","numero","nÂº","num doc","nr documento","numero documento"],
    numero_nf: ["nf","nota fiscal","nfe","numero nf"],
    codigo_barras: ["codigo barras","cod barras","barcode","linha digitavel"],
    status: ["status","situacao","situaÃ§Ã£o"],
    forma_pagamento: ["forma pgto","forma pagamento","payment method","tipo pgto"],
    centro_custo: ["centro custo","cc","cost center"],
  },
  produtos: {
    codigo: ["codigo","cÃ³digo","code","sku","ref","referencia","id","cod"],
    nome: ["nome","descricao","descriÃ§Ã£o","produto","product","name","item","mercadoria"],
    unidade: ["unidade","un","unit","und","medida"],
    preco_venda: ["preco venda","preÃ§o venda","preco","preÃ§o","price","valor venda","pvenda","pv"],
    preco_custo: ["preco custo","preÃ§o custo","custo","cost","valor custo","pcusto","pc"],
    estoque_atual: ["estoque","estoque atual","stock","saldo","quantidade","qtd","qty"],
    estoque_minimo: ["estoque minimo","est min","min stock","minimo"],
    ncm: ["ncm","ncm/sh","codigo ncm"],
    categoria: ["categoria","grupo","category","departamento","secao","familia"],
    marca: ["marca","brand","fabricante"],
  },
};

// Auto-detect tipo based on columns found
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
  // Boost based on unique keywords
  if (h.some(x => x.includes("cliente") || x.includes("sacado"))) scores.receber += 3;
  if (h.some(x => x.includes("fornecedor") || x.includes("cedente") || x.includes("credor"))) scores.pagar += 3;
  if (h.some(x => x.includes("estoque") || x.includes("sku") || x.includes("produto"))) scores.produtos += 3;
  if (h.some(x => x.includes("vencimento"))) { scores.receber += 2; scores.pagar += 2; }
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

// Map headers to fields
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

// Parse date flexibly
function parseDate(val: any): string | null {
  if (!val) return null;
  const s = String(val).trim();
  // DD/MM/YYYY or DD-MM-YYYY
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m1) { let y = parseInt(m1[3]); if (m1[3].length === 2) y += 2000; return `${y}-${m1[2].padStart(2, "0")}-${m1[1].padStart(2, "0")}`; }
  // YYYY-MM-DD
  const m2 = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m2) return `${m2[1]}-${m2[2].padStart(2, "0")}-${m2[3].padStart(2, "0")}`;
  // Excel serial number
  if (/^\d{5}$/.test(s)) { const d = new Date((parseInt(s) - 25569) * 86400 * 1000); return d.toISOString().split("T")[0]; }
  // Try native parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  return null;
}

function parseNumber(val: any): number {
  if (typeof val === "number") return val;
  if (!val) return 0;
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

// âââ API â STEP 1: Analyze file âââ
// âââ API â STEP 2: Import data âââ
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const action = formData.get("action") as string || "analyze";
    const companyId = formData.get("company_id") as string;
    const tipoForced = formData.get("tipo") as string;

    if (!file) return NextResponse.json({ error: "Nenhum arquivo" }, { status: 400 });

    const fileName = file.name.toLowerCase();
    const isCSV = fileName.endsWith(".csv") || fileName.endsWith(".tsv");
    const isExcel = fileName.endsWith(".xlsx") || fileName.endsWith(".xls");

    if (!isCSV && !isExcel) return NextResponse.json({ error: "Formato nÃ£o suportado. Use .xlsx, .xls ou .csv" }, { status: 400 });

    let headers: string[] = [];
    let rows: any[][] = [];

    if (isCSV) {
      const text = await file.text();
      const sep = text.includes(";") ? ";" : text.includes("\t") ? "\t" : ",";
      const lines = text.split("\n").filter(l => l.trim().length > 0);
      if (lines.length < 2) return NextResponse.json({ error: "Arquivo vazio ou sem dados" }, { status: 400 });
      // Find header row (first non-empty row with >2 columns)
      let hdrIdx = 0;
      for (let i = 0; i < Math.min(5, lines.length); i++) {
        const cols = lines[i].split(sep);
        if (cols.length >= 3) { hdrIdx = i; break; }
      }
      headers = lines[hdrIdx].split(sep).map(h => h.replace(/["']/g, "").trim());
      rows = lines.slice(hdrIdx + 1).map(l => l.split(sep).map(v => v.replace(/["']/g, "").trim()));
    } else {
      const ExcelJS = require("exceljs");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer() as any);
      const ws = wb.worksheets[0];
      if (!ws) return NextResponse.json({ error: "Planilha vazia" }, { status: 400 });

      // Find header row (first row with >2 non-empty cells)
      let hdrRow = 1;
      ws.eachRow((row: any, num: any) => {
        if (hdrRow > 1) return;
        let filled = 0;
        row.eachCell((_c: any) => filled++);
        if (filled >= 3) hdrRow = num;
      });

      const hdrCells = ws.getRow(hdrRow);
      hdrCells.eachCell((cell: any, col: any) => { headers[col - 1] = String(cell.value || "").trim(); });

      ws.eachRow((row: any, num: any) => {
        if (num <= hdrRow) return;
        const r: any[] = [];
        row.eachCell((cell: any, col: any) => { r[col - 1] = cell.value; });
        if (r.some(v => v != null && String(v).trim() !== "")) rows.push(r);
      });
    }

    // Remove empty headers
    headers = headers.filter(h => h && h.length > 0);

    // Auto-detect tipo
    const tipoDetected = detectTipo(headers);
    const tipo = tipoForced || tipoDetected;

    // Map columns
    const mapping = mapColumns(headers, tipo);

    // âââ ANALYZE MODE â return preview âââ
    if (action === "analyze") {
      const preview = rows.slice(0, 10).map(r => {
        const obj: Record<string, any> = {};
        for (const [field, colIdx] of Object.entries(mapping)) {
          obj[field] = r[colIdx] != null ? String(r[colIdx]) : "";
        }
        return obj;
      });

      return NextResponse.json({
        success: true,
        action: "analyze",
        fileName: file.name,
        fileSize: file.size,
        totalRows: rows.length,
        headers,
        tipoDetected,
        tipo,
        mapping,
        unmappedHeaders: headers.filter((_, i) => !Object.values(mapping).includes(i)),
        preview,
      });
    }

    // âââ IMPORT MODE â save to database âââ
    if (!companyId) return NextResponse.json({ error: "company_id obrigatÃ³rio para importar" }, { status: 400 });

    const TABELA_MAP: Record<string, string> = { clientes: "erp_clientes", fornecedores: "erp_fornecedores", receber: "erp_receber", pagar: "erp_pagar", produtos: "erp_produtos" };
    const tabela = TABELA_MAP[tipo];
    if (!tabela) return NextResponse.json({ error: `Tipo invÃ¡lido: ${tipo}` }, { status: 400 });

    const DATE_FIELDS = ["data_vencimento", "data_emissao", "data_pagamento"];
    const NUMBER_FIELDS = ["valor", "valor_pago", "preco_venda", "preco_custo", "estoque_atual", "estoque_minimo", "estoque_maximo", "limite_credito", "juros", "multa", "desconto"];

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
      return obj;
    }).filter(r => {
      // ValidaÃ§Ã£o mÃ­nima
      if (tipo === "clientes" || tipo === "fornecedores") return r.nome;
      if (tipo === "receber" || tipo === "pagar") return r.descricao || r.valor;
      if (tipo === "produtos") return r.nome;
      return true;
    });

    if (records.length === 0) return NextResponse.json({ error: "Nenhum registro vÃ¡lido encontrado" }, { status: 400 });

    const sb = createClient(SUPA_URL, KEY());
    // Insert in batches of 100
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
      totalRows: rows.length,
      imported,
      errors,
      message: `${imported} registros importados com sucesso${errors > 0 ? `, ${errors} com erro` : ""}`,
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
