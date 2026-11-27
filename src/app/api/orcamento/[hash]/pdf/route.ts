// Orçamento (CEO 24/11) — PDF REAL da proposta (arquivo .pdf que o usuário baixa).
// Gera a partir dos MESMOS dados da proposta pública (hash_publico, service-role como a rota pública).
// pdf-lib (JS puro, roda no serverless — sem Chromium). Cabeçalho com até 3 logos (prestadora/gestora/
// cliente), itens, totais e condições. NÃO recria a página pública; é o formato imprimível/baixável.
import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const HASH_RE = /^[a-f0-9]{16,64}$/i;

async function embedLogo(pdf: PDFDocument, url: string | null | undefined) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("png")) return await pdf.embedPng(buf);
    if (ct.includes("jpeg") || ct.includes("jpg")) return await pdf.embedJpg(buf);
    // tenta PNG e cai pra JPG
    try { return await pdf.embedPng(buf); } catch { try { return await pdf.embedJpg(buf); } catch { return null; } }
  } catch { return null; }
}

const brl = (n: number) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export async function GET(_req: NextRequest, ctx: { params: Promise<{ hash: string }> }) {
  const { hash } = await ctx.params;
  if (!HASH_RE.test(hash)) return NextResponse.json({ erro: "Link inválido" }, { status: 400 });

  const { data: orc } = await supabaseAdmin.from("erp_orcamentos").select("*").eq("hash_publico", hash).maybeSingle();
  if (!orc) return NextResponse.json({ erro: "Proposta não encontrada" }, { status: 404 });
  const { data: itens } = await supabaseAdmin.from("erp_orcamentos_itens").select("*").eq("orcamento_id", orc.id).order("ordem");
  const { data: empresa } = await supabaseAdmin.from("companies").select("razao_social, nome_fantasia, logo_url").eq("id", orc.company_id).maybeSingle();

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ESP = rgb(0.24, 0.14, 0.08), CINZA = rgb(0.42, 0.36, 0.31), LINHA = rgb(0.88, 0.85, 0.80);
  let page = pdf.addPage([595, 842]); // A4
  const M = 48; let y = 842 - M;
  const txt = (s: string, x: number, yy: number, size = 10, f = font, color = ESP) => page.drawText(s ?? "", { x, y: yy, size, font: f, color });

  // Cabeçalho: até 3 logos (prestadora, gestão da obra, cliente)
  const logos = [
    { nome: empresa?.nome_fantasia || empresa?.razao_social || "Prestadora", url: empresa?.logo_url, papel: "PRESTADORA" },
    { nome: orc.gestora_nome, url: orc.gestora_logo_url, papel: "GESTÃO DA OBRA" },
    { nome: orc.cliente_nome, url: orc.cliente_logo_url, papel: "CLIENTE" },
  ].filter((l) => l.url || l.nome);
  let lx = M;
  for (const l of logos) {
    const img = await embedLogo(pdf, l.url);
    if (img) {
      const h = 34, w = Math.min(120, (img.width / img.height) * h);
      page.drawImage(img, { x: lx, y: y - h, width: w, height: h });
    } else if (l.nome) {
      txt(l.nome, lx, y - 20, 11, bold);
    }
    txt(l.papel, lx, y - 46, 7, font, CINZA);
    lx += 175;
  }
  y -= 70;
  page.drawLine({ start: { x: M, y }, end: { x: 595 - M, y }, thickness: 1, color: LINHA });
  y -= 24;

  txt(`Proposta ${orc.numero || ""}`, M, y, 16, bold);
  y -= 18;
  if (orc.cliente_nome) { txt(`Cliente: ${orc.cliente_nome}`, M, y, 10, font, CINZA); y -= 14; }
  if (orc.data_emissao) { txt(`Emissão: ${new Date(orc.data_emissao).toLocaleDateString("pt-BR")}`, M, y, 9, font, CINZA); y -= 14; }
  y -= 8;

  // Cabeçalho da tabela de itens
  const colX = { desc: M, qtd: 330, un: 380, unit: 420, sub: 500 };
  const header = () => {
    txt("Item", colX.desc, y, 8, bold, CINZA); txt("Qtd", colX.qtd, y, 8, bold, CINZA);
    txt("Un", colX.un, y, 8, bold, CINZA); txt("Preço", colX.unit, y, 8, bold, CINZA);
    txt("Subtotal", colX.sub, y, 8, bold, CINZA); y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: 595 - M, y }, thickness: 0.5, color: LINHA }); y -= 14;
  };
  header();
  for (const it of itens || []) {
    if (y < M + 90) { page = pdf.addPage([595, 842]); y = 842 - M; header(); }
    const nome = (it.produto_nome || it.servico_descricao || it.produto_descricao || "Item").toString().slice(0, 58);
    txt(nome, colX.desc, y, 9);
    txt(String(it.quantidade ?? ""), colX.qtd, y, 9);
    txt((it.unidade || "").toString(), colX.un, y, 9);
    txt(brl(it.preco_unitario), colX.unit, y, 9);
    txt(brl(it.subtotal), colX.sub, y, 9);
    y -= 15;
  }
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: 595 - M, y }, thickness: 1, color: LINHA }); y -= 20;
  txt("TOTAL", colX.unit - 30, y, 12, bold); txt(brl(orc.total ?? orc.valor_total), colX.sub - 10, y, 12, bold);
  y -= 30;

  // Condições / texto da proposta
  const cond = (orc.texto_proposta || orc.observacoes || "").toString();
  if (cond.trim()) {
    txt("Condições", M, y, 10, bold); y -= 15;
    for (const linha of cond.split("\n")) {
      for (let i = 0; i < linha.length; i += 95) {
        if (y < M + 20) { page = pdf.addPage([595, 842]); y = 842 - M; }
        txt(linha.slice(i, i + 95), M, y, 8, font, CINZA); y -= 11;
      }
    }
  }

  const bytes = await pdf.save();
  const nomeArq = `proposta-${(orc.numero || "orcamento").toString().replace(/[^\w.-]+/g, "_")}.pdf`;
  return new NextResponse(bytes as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nomeArq}"`,
      "Cache-Control": "no-store",
    },
  });
}
