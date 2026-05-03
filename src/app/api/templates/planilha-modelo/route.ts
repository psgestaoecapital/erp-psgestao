// src/app/api/templates/planilha-modelo/route.ts
// ========================================================================
// Gera a Planilha Modelo PS Gestão v1.0 dinamicamente em runtime.
// Sem dependência de Storage. Cache HTTP de 1 hora.
// Identidade visual oficial: Espresso #3D2314, Off-white #FAF7F2, Dourado #C8941A.
// ========================================================================

import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

const TEMPLATE_FILENAME = 'Planilha_Modelo_PS_Gestao_v1.0.xlsx';

// Paleta oficial PS Gestão
const COLOR_ESPRESSO = 'FF3D2314';
const COLOR_ESPRESSO_LIGHT = 'FF5C3825';
const COLOR_OFFWHITE = 'FFFAF7F2';
const COLOR_DOURADO = 'FFC8941A';
const COLOR_GRAY = 'FFF5F2ED';
const COLOR_SUCCESS = 'FF2D7A4F';
const COLOR_DANGER = 'FF9B2D2D';
const COLOR_WHITE = 'FFFFFFFF';

export const runtime = 'nodejs';
export const dynamic = 'force-static';
export const revalidate = 3600;

export async function GET() {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'PS Gestão ERP';
    wb.created = new Date();

    // ============= ABA 1: 📘 LEIA-ME =============
    const ws1 = wb.addWorksheet('📘 LEIA-ME', {
      views: [{ showGridLines: false }],
      properties: { tabColor: { argb: COLOR_ESPRESSO } },
    });

    ws1.mergeCells('A1:H1');
    const banner1 = ws1.getCell('A1');
    banner1.value = 'PS GESTÃO ERP — Planilha Modelo Universal v1.0';
    banner1.font = { name: 'Calibri', size: 20, bold: true, color: { argb: COLOR_WHITE } };
    banner1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ESPRESSO } };
    banner1.alignment = { horizontal: 'center', vertical: 'middle' };
    ws1.getRow(1).height = 50;

    ws1.mergeCells('A2:H2');
    const sub1 = ws1.getCell('A2');
    sub1.value = 'Onboarding histórico de lançamentos — Multi-tenant — Identidade visual oficial';
    sub1.font = { name: 'Calibri', size: 11, italic: true, color: { argb: COLOR_DOURADO } };
    sub1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_OFFWHITE } };
    sub1.alignment = { horizontal: 'center', vertical: 'middle' };
    ws1.getRow(2).height = 25;

    let r = 4;

    // Seção: O QUE É
    ws1.mergeCells(`A${r}:H${r}`);
    const sec1 = ws1.getCell(`A${r}`);
    sec1.value = '🎯  O QUE É ESTA PLANILHA';
    sec1.font = { name: 'Calibri', size: 14, bold: true, color: { argb: COLOR_ESPRESSO } };
    sec1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_GRAY } };
    sec1.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    ws1.getRow(r).height = 30;
    r++;

    const intro = [
      'Esta é a planilha oficial para carregar histórico de receitas e despesas no PS Gestão ERP.',
      'Funciona para QUALQUER cliente — multi-tenant. Cada empresa tem seu próprio company_id.',
      'Após preenchimento, suba pelo módulo IMPORTAR > Universal no ERP.',
      'O sistema valida, classifica via PSGC e popula o Dashboard automaticamente em até 5 minutos.',
    ];
    intro.forEach((txt) => {
      ws1.mergeCells(`A${r}:H${r}`);
      const c = ws1.getCell(`A${r}`);
      c.value = '• ' + txt;
      c.font = { name: 'Calibri', size: 10, color: { argb: COLOR_ESPRESSO } };
      c.alignment = { horizontal: 'left', vertical: 'middle', indent: 2 };
      ws1.getRow(r).height = 22;
      r++;
    });

    r++;
    ws1.mergeCells(`A${r}:H${r}`);
    const sec2 = ws1.getCell(`A${r}`);
    sec2.value = '📝  COMO PREENCHER A ABA LANÇAMENTOS';
    sec2.font = { name: 'Calibri', size: 14, bold: true, color: { argb: COLOR_ESPRESSO } };
    sec2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_GRAY } };
    sec2.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    ws1.getRow(r).height = 30;
    r++;

    const instrucoes: [string, string][] = [
      ['CNPJ', 'Cole o CNPJ da empresa (formato 00.000.000/0001-00). Será resolvido automaticamente para o company_id correto.'],
      ['Tipo', 'Selecione: PAGAR (despesa) ou RECEBER (receita). Use a lista suspensa.'],
      ['Linha de Negócio', 'Use o nome exato da LN cadastrada no ERP para esta empresa.'],
      ['Data Competência', 'Quando o evento aconteceu. Formato AAAA-MM-DD ou DD/MM/AAAA.'],
      ['Data Vencimento', 'Quando o pagamento é/era devido.'],
      ['Data Pagamento', 'Preencha SOMENTE se já foi pago/recebido. Se vazio = ainda em aberto.'],
      ['Valor (R$)', 'Use ponto ou vírgula (R$ 1.500,00 ou 1500.00).'],
      ['Status (auto)', 'Auto-preenchido por fórmula. Pode forçar CANCELADO se necessário.'],
      ['Categoria', 'Receitas Operacionais, Custo das Vendas, Despesas Administrativas, etc.'],
      ['Subcategoria', 'Detalhamento (ex: Salários, Energia, Aluguel). Mapeada automaticamente para o PSGC.'],
      ['Centro de Custo', 'Opcional. Códigos como "4 - Adm" (rateio), "1 - Comercial".'],
      ['Descrição', 'Texto livre descritivo (até 200 caracteres).'],
      ['Cliente/Fornecedor', 'Nome da contraparte.'],
      ['Forma Pagamento', 'Pix, Boleto, Transferência, Cartão, etc.'],
    ];
    instrucoes.forEach(([nome, descricao]) => {
      const cA = ws1.getCell(`A${r}`);
      cA.value = nome;
      cA.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLOR_ESPRESSO } };
      cA.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_OFFWHITE } };
      cA.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      ws1.mergeCells(`B${r}:H${r}`);
      const cB = ws1.getCell(`B${r}`);
      cB.value = descricao;
      cB.font = { name: 'Calibri', size: 10, color: { argb: COLOR_ESPRESSO_LIGHT } };
      cB.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_OFFWHITE } };
      cB.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 };
      ws1.getRow(r).height = 35;
      r++;
    });

    r += 2;
    ws1.mergeCells(`A${r}:H${r}`);
    const sec3 = ws1.getCell(`A${r}`);
    sec3.value = '🚀  APÓS O UPLOAD';
    sec3.font = { name: 'Calibri', size: 14, bold: true, color: { argb: COLOR_ESPRESSO } };
    sec3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_GRAY } };
    sec3.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    ws1.getRow(r).height = 30;
    r++;

    const passos = [
      '1. O ERP cria registro em erp_importacoes para auditoria completa.',
      '2. Cada lançamento é validado e inserido em erp_lancamentos com import_hash único.',
      '3. O pipeline PSGC processa as classificações e popula psgc_dre.',
      '4. m2_dre_divisional é atualizado automaticamente para Dashboard.',
      '5. Em até 5 minutos o cron processa as filas e o Dashboard fica vivo.',
      '6. Pode rodar a importação MAIS DE UMA VEZ — duplicados são ignorados pelo import_hash.',
    ];
    passos.forEach((p) => {
      ws1.mergeCells(`A${r}:H${r}`);
      const c = ws1.getCell(`A${r}`);
      c.value = p;
      c.font = { name: 'Calibri', size: 10, color: { argb: COLOR_ESPRESSO } };
      c.alignment = { horizontal: 'left', vertical: 'middle', indent: 2 };
      ws1.getRow(r).height = 22;
      r++;
    });

    ws1.getColumn('A').width = 22;
    ['B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach((c) => (ws1.getColumn(c).width = 15));

    // ============= ABA 2: 💰 LANÇAMENTOS =============
    const ws2 = wb.addWorksheet('💰 LANÇAMENTOS', {
      views: [{ showGridLines: false, state: 'frozen', xSplit: 5, ySplit: 2 }],
      properties: { tabColor: { argb: COLOR_DOURADO } },
    });

    ws2.mergeCells('A1:Q1');
    const banner2 = ws2.getCell('A1');
    banner2.value = 'LANÇAMENTOS — Receitas e Despesas (preencha esta aba)';
    banner2.font = { name: 'Calibri', size: 16, bold: true, color: { argb: COLOR_WHITE } };
    banner2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ESPRESSO } };
    banner2.alignment = { horizontal: 'center', vertical: 'middle' };
    ws2.getRow(1).height = 35;

    const headers: [string, number][] = [
      ['CNPJ', 18],
      ['Empresa (auto)', 22],
      ['Tipo', 12],
      ['Linha de Negócio', 30],
      ['Data Competência', 14],
      ['Data Vencimento', 14],
      ['Data Pagamento', 14],
      ['Valor (R$)', 13],
      ['Valor Pago (R$)', 13],
      ['Status (auto)', 13],
      ['Categoria', 22],
      ['Subcategoria', 28],
      ['Centro de Custo', 16],
      ['Descrição', 35],
      ['Cliente/Fornecedor', 22],
      ['Forma Pagamento', 14],
      ['Hash Único (auto)', 30],
    ];
    headers.forEach(([h, w], i) => {
      const cell = ws2.getCell(2, i + 1);
      cell.value = h;
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLOR_WHITE } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ESPRESSO } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      ws2.getColumn(i + 1).width = w;
    });
    ws2.getRow(2).height = 40;

    // Linhas vazias pré-formatadas (até 1004) com bandagem
    for (let row = 3; row <= 1004; row++) {
      const even = (row - 3) % 2 === 1;
      const fillColor = even ? COLOR_GRAY : COLOR_OFFWHITE;
      for (let col = 1; col <= 17; col++) {
        const cell = ws2.getCell(row, col);
        cell.font = { name: 'Calibri', size: 9, color: { argb: COLOR_ESPRESSO } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
        if (col >= 5 && col <= 7) {
          cell.numFmt = 'yyyy-mm-dd';
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else if (col === 8 || col === 9) {
          cell.numFmt = 'R$ #,##0.00';
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        } else if (col === 3) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        }
      }
      // Status auto (col 10)
      const statusCell = ws2.getCell(row, 10);
      statusCell.value = { formula: `IF(AND(A${row}<>"",G${row}<>""),"PAGO",IF(A${row}<>"","A VENCER",""))` };
      statusCell.alignment = { horizontal: 'center', vertical: 'middle' };
      statusCell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: COLOR_SUCCESS } };
    }

    // Validação Tipo (PAGAR/RECEBER)
    for (let row = 3; row <= 1004; row++) {
      ws2.getCell(row, 3).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"PAGAR,RECEBER"'],
      };
    }

    // ============= ABA 3: 📊 PSGC =============
    const ws3 = wb.addWorksheet('📊 PSGC', {
      views: [{ showGridLines: false }],
    });
    ws3.mergeCells('A1:D1');
    const banner3 = ws3.getCell('A1');
    banner3.value = 'PSGC — Plano de Contas Canônico (referência)';
    banner3.font = { name: 'Calibri', size: 16, bold: true, color: { argb: COLOR_WHITE } };
    banner3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ESPRESSO } };
    banner3.alignment = { horizontal: 'center', vertical: 'middle' };
    ws3.getRow(1).height = 35;

    const psgcHeaders = ['Código', 'Conta', 'Grupo DRE', 'Natureza'];
    psgcHeaders.forEach((h, i) => {
      const c = ws3.getCell(2, i + 1);
      c.value = h;
      c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLOR_WHITE } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ESPRESSO } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    ws3.getRow(2).height = 35;

    const psgcData = [
      ['1.1', 'Receita de Venda de Produtos', 'ROB', 'receita'],
      ['1.2', 'Receita de Prestação de Serviços', 'ROB', 'receita'],
      ['1.3', 'Receita de Mensalidades/Assinaturas', 'ROB', 'receita'],
      ['1.4', 'Outras Receitas Operacionais', 'ROB', 'receita'],
      ['3.1', 'ICMS', 'IMPOSTOS_VENDA', 'tributo'],
      ['3.2', 'ISS', 'IMPOSTOS_VENDA', 'tributo'],
      ['3.3', 'PIS/COFINS', 'IMPOSTOS_VENDA', 'tributo'],
      ['3.4', 'Simples Nacional/DAS', 'IMPOSTOS_VENDA', 'tributo'],
      ['4.1', 'Matéria-Prima e Insumos', 'CMV', 'custo'],
      ['4.2', 'Mercadoria para Revenda', 'CMV', 'custo'],
      ['4.3', 'Mão de Obra Direta', 'CMV', 'custo'],
      ['4.4', 'Terceirização Produtiva', 'CMV', 'custo'],
      ['5.1', 'Comissões sobre Vendas', 'DESP_VARIAVEL', 'despesa'],
      ['6.1', 'Pessoal — Folha e Encargos', 'DESP_FIXA', 'despesa'],
      ['6.2', 'Pró-Labore e Distribuição', 'DESP_FIXA', 'despesa'],
      ['6.3', 'Ocupação — Aluguel e Estrutura', 'DESP_FIXA', 'despesa'],
      ['6.4', 'Utilidades — Energia, Água, Internet', 'DESP_FIXA', 'despesa'],
      ['6.5', 'Serviços Administrativos', 'DESP_FIXA', 'despesa'],
      ['6.6', 'Software e Sistemas', 'DESP_FIXA', 'despesa'],
      ['6.7', 'Marketing e Comercial', 'DESP_FIXA', 'despesa'],
      ['6.8', 'Veículos e Combustível', 'DESP_FIXA', 'despesa'],
      ['6.9', 'Seguros e Licenças', 'DESP_FIXA', 'despesa'],
      ['6.10', 'Material de Consumo e Suprimentos', 'DESP_FIXA', 'despesa'],
      ['8.1', 'Receitas Financeiras', 'RESULT_FIN', 'resultado_fin'],
      ['8.2', 'Despesas Financeiras', 'RESULT_FIN', 'resultado_fin'],
      ['10.1', 'IRPJ', 'IR_CSLL', 'tributo'],
      ['10.2', 'CSLL', 'IR_CSLL', 'tributo'],
    ];
    psgcData.forEach((row, i) => {
      const rowNum = 3 + i;
      const even = i % 2 === 1;
      const fillColor = even ? COLOR_GRAY : COLOR_OFFWHITE;
      row.forEach((v, j) => {
        const c = ws3.getCell(rowNum, j + 1);
        c.value = v;
        c.font = { name: j === 0 ? 'Consolas' : 'Calibri', size: 9, bold: j === 0, color: { argb: COLOR_ESPRESSO } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
        c.alignment = { horizontal: j === 0 ? 'center' : 'left', vertical: 'middle' };
      });
    });
    ws3.getColumn('A').width = 10;
    ws3.getColumn('B').width = 42;
    ws3.getColumn('C').width = 18;
    ws3.getColumn('D').width = 18;

    // ============= ABA 4: 📈 RESUMO =============
    const ws4 = wb.addWorksheet('📈 RESUMO', { views: [{ showGridLines: false }] });
    ws4.mergeCells('A1:D1');
    const banner4 = ws4.getCell('A1');
    banner4.value = 'RESUMO — Totalizadores Automáticos';
    banner4.font = { name: 'Calibri', size: 16, bold: true, color: { argb: COLOR_WHITE } };
    banner4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ESPRESSO } };
    banner4.alignment = { horizontal: 'center', vertical: 'middle' };
    ws4.getRow(1).height = 35;

    const resumoLinhas: [string, { formula: string }, string?][] = [
      ['Total de lançamentos', { formula: "COUNTA('💰 LANÇAMENTOS'!A3:A1004)" }, '0'],
      ['Total de receitas (RECEBER)', { formula: 'COUNTIF(\'💰 LANÇAMENTOS\'!C3:C1004,"RECEBER")' }, '0'],
      ['Total de despesas (PAGAR)', { formula: 'COUNTIF(\'💰 LANÇAMENTOS\'!C3:C1004,"PAGAR")' }, '0'],
      ['Soma das receitas (R$)', { formula: 'SUMIF(\'💰 LANÇAMENTOS\'!C3:C1004,"RECEBER",\'💰 LANÇAMENTOS\'!H3:H1004)' }, 'R$ #,##0.00'],
      ['Soma das despesas (R$)', { formula: 'SUMIF(\'💰 LANÇAMENTOS\'!C3:C1004,"PAGAR",\'💰 LANÇAMENTOS\'!H3:H1004)' }, 'R$ #,##0.00'],
    ];
    resumoLinhas.forEach(([label, formula, fmt], i) => {
      const row = 4 + i;
      const cA = ws4.getCell(row, 1);
      cA.value = label;
      cA.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLOR_ESPRESSO } };
      cA.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_OFFWHITE } };
      cA.alignment = { horizontal: 'left', vertical: 'middle' };
      const cB = ws4.getCell(row, 2);
      cB.value = formula as any;
      cB.font = { name: 'Calibri', size: 10, color: { argb: COLOR_ESPRESSO } };
      cB.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_OFFWHITE } };
      cB.alignment = { horizontal: 'right', vertical: 'middle' };
      if (fmt) cB.numFmt = fmt;
    });

    const resRow = 9;
    const cResLabel = ws4.getCell(resRow, 1);
    cResLabel.value = 'RESULTADO LÍQUIDO';
    cResLabel.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLOR_WHITE } };
    cResLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ESPRESSO } };
    cResLabel.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    const cResVal = ws4.getCell(resRow, 2);
    cResVal.value = { formula: 'B7-B8' } as any;
    cResVal.numFmt = 'R$ #,##0.00';
    cResVal.font = { name: 'Calibri', size: 12, bold: true, color: { argb: COLOR_WHITE } };
    cResVal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ESPRESSO } };
    cResVal.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
    ws4.getRow(resRow).height = 32;

    ws4.getColumn('A').width = 32;
    ws4.getColumn('B').width = 20;
    ws4.getColumn('C').width = 20;
    ws4.getColumn('D').width = 20;

    // ============= ESCREVER E RETORNAR =============
    const buffer = await wb.xlsx.writeBuffer();

    return new NextResponse(buffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${TEMPLATE_FILENAME}"`,
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (e: any) {
    console.error('[templates/planilha-modelo] erro:', e);
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
// Suppress lint warning for unused color constant intentionally kept for palette completeness
void COLOR_DANGER;
