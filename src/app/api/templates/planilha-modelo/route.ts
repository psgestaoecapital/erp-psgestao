// src/app/api/templates/planilha-modelo/route.ts
// Gera Planilha Modelo PS Gestao v1.0 dinamicamente em runtime via exceljs.

import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

const TEMPLATE_FILENAME = 'Planilha_Modelo_PS_Gestao_v1.0.xlsx';
const COLOR_ESPRESSO = 'FF3D2314';
const COLOR_OFFWHITE = 'FFFAF7F2';
const COLOR_DOURADO = 'FFC8941A';
const COLOR_GRAY = 'FFF5F2ED';
const COLOR_SUCCESS = 'FF2D7A4F';
const COLOR_WHITE = 'FFFFFFFF';

export const runtime = 'nodejs';
export const dynamic = 'force-static';
export const revalidate = 3600;

export async function GET() {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'PS Gestao ERP';
    wb.created = new Date();

    // ABA 1: LEIA-ME
    const ws1 = wb.addWorksheet('📘 LEIA-ME', {
      views: [{ showGridLines: false }],
      properties: { tabColor: { argb: COLOR_ESPRESSO } },
    });
    ws1.mergeCells('A1:H1');
    const banner1 = ws1.getCell('A1');
    banner1.value = 'PS GESTAO ERP — Planilha Modelo Universal v1.0';
    banner1.font = { name: 'Calibri', size: 20, bold: true, color: { argb: COLOR_WHITE } };
    banner1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ESPRESSO } };
    banner1.alignment = { horizontal: 'center', vertical: 'middle' };
    ws1.getRow(1).height = 50;

    let r = 3;
    const intro = [
      'O QUE E ESTA PLANILHA',
      '',
      'Esta e a planilha oficial para carregar historico de receitas e despesas no PS Gestao ERP.',
      'Funciona para QUALQUER cliente — multi-tenant. Cada empresa tem seu proprio company_id.',
      'Apos preenchimento, suba pelo modulo IMPORTAR > Universal no ERP.',
      'O sistema valida, classifica via PSGC e popula o Dashboard automaticamente em ate 5 minutos.',
      '',
      'COMO PREENCHER',
      '',
      'CNPJ: cole o CNPJ da empresa (formato 00.000.000/0001-00).',
      'Tipo: PAGAR (despesa) ou RECEBER (receita). Use a lista suspensa.',
      'Linha de Negocio: nome exato da LN cadastrada no ERP.',
      'Data Competencia: quando o evento aconteceu.',
      'Data Vencimento: quando o pagamento e/era devido.',
      'Data Pagamento: SO se ja foi pago. Vazio = ainda em aberto.',
      'Valor: ponto ou virgula (R$ 1.500,00 ou 1500.00).',
      'Categoria/Subcategoria: mapeada automaticamente para o PSGC.',
      '',
      'APOS O UPLOAD',
      '',
      'O ERP cria registro em erp_importacoes (auditoria).',
      'Cada lancamento e inserido com import_hash unico (idempotencia).',
      'O pipeline PSGC processa e popula psgc_dre.',
      'Em ate 5 min o cron processa e o Dashboard fica vivo.',
      'Pode rodar a importacao mais de uma vez — duplicados sao ignorados.',
    ];
    intro.forEach((txt) => {
      ws1.mergeCells(`A${r}:H${r}`);
      const c = ws1.getCell(`A${r}`);
      c.value = txt;
      const isHeader = txt === 'O QUE E ESTA PLANILHA' || txt === 'COMO PREENCHER' || txt === 'APOS O UPLOAD';
      c.font = isHeader
        ? { name: 'Calibri', size: 14, bold: true, color: { argb: COLOR_ESPRESSO } }
        : { name: 'Calibri', size: 10, color: { argb: COLOR_ESPRESSO } };
      if (isHeader) {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_GRAY } };
      }
      c.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      ws1.getRow(r).height = isHeader ? 28 : 20;
      r++;
    });
    ws1.getColumn('A').width = 22;
    ['B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach((c) => (ws1.getColumn(c).width = 15));

    // ABA 2: LANCAMENTOS
    const ws2 = wb.addWorksheet('💰 LANÇAMENTOS', {
      views: [{ showGridLines: false, state: 'frozen', xSplit: 5, ySplit: 2 }],
      properties: { tabColor: { argb: COLOR_DOURADO } },
    });
    ws2.mergeCells('A1:Q1');
    const banner2 = ws2.getCell('A1');
    banner2.value = 'LANCAMENTOS — Receitas e Despesas (preencha esta aba)';
    banner2.font = { name: 'Calibri', size: 16, bold: true, color: { argb: COLOR_WHITE } };
    banner2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ESPRESSO } };
    banner2.alignment = { horizontal: 'center', vertical: 'middle' };
    ws2.getRow(1).height = 35;

    const headers: [string, number][] = [
      ['CNPJ', 18], ['Empresa (auto)', 22], ['Tipo', 12], ['Linha de Negócio', 30],
      ['Data Competência', 14], ['Data Vencimento', 14], ['Data Pagamento', 14],
      ['Valor (R$)', 13], ['Valor Pago (R$)', 13], ['Status (auto)', 13],
      ['Categoria', 22], ['Subcategoria', 28], ['Centro de Custo', 16],
      ['Descrição', 35], ['Cliente/Fornecedor', 22], ['Forma Pagamento', 14],
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
      const statusCell = ws2.getCell(row, 10);
      statusCell.value = { formula: `IF(AND(A${row}<>"",G${row}<>""),"PAGO",IF(A${row}<>"","A VENCER",""))` };
      statusCell.alignment = { horizontal: 'center', vertical: 'middle' };
      statusCell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: COLOR_SUCCESS } };
      ws2.getCell(row, 3).dataValidation = {
        type: 'list', allowBlank: true, formulae: ['"PAGAR,RECEBER"'],
      };
    }

    // ABA 3: PSGC
    const ws3 = wb.addWorksheet('📊 PSGC', { views: [{ showGridLines: false }] });
    ws3.mergeCells('A1:D1');
    const banner3 = ws3.getCell('A1');
    banner3.value = 'PSGC — Plano de Contas Canonico (referencia)';
    banner3.font = { name: 'Calibri', size: 16, bold: true, color: { argb: COLOR_WHITE } };
    banner3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ESPRESSO } };
    banner3.alignment = { horizontal: 'center', vertical: 'middle' };
    ws3.getRow(1).height = 35;
    ['Codigo', 'Conta', 'Grupo DRE', 'Natureza'].forEach((h, i) => {
      const c = ws3.getCell(2, i + 1);
      c.value = h;
      c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLOR_WHITE } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ESPRESSO } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    ws3.getRow(2).height = 35;
    const psgcData: string[][] = [
      ['1.1', 'Receita de Venda de Produtos', 'ROB', 'receita'],
      ['1.2', 'Receita de Prestacao de Servicos', 'ROB', 'receita'],
      ['1.3', 'Receita de Mensalidades/Assinaturas', 'ROB', 'receita'],
      ['1.4', 'Outras Receitas Operacionais', 'ROB', 'receita'],
      ['3.1', 'ICMS', 'IMPOSTOS_VENDA', 'tributo'],
      ['3.2', 'ISS', 'IMPOSTOS_VENDA', 'tributo'],
      ['3.3', 'PIS/COFINS', 'IMPOSTOS_VENDA', 'tributo'],
      ['3.4', 'Simples Nacional/DAS', 'IMPOSTOS_VENDA', 'tributo'],
      ['4.1', 'Materia-Prima e Insumos', 'CMV', 'custo'],
      ['4.3', 'Mao de Obra Direta', 'CMV', 'custo'],
      ['4.4', 'Terceirizacao Produtiva', 'CMV', 'custo'],
      ['5.1', 'Comissoes sobre Vendas', 'DESP_VARIAVEL', 'despesa'],
      ['6.1', 'Pessoal — Folha e Encargos', 'DESP_FIXA', 'despesa'],
      ['6.2', 'Pro-Labore e Distribuicao', 'DESP_FIXA', 'despesa'],
      ['6.3', 'Ocupacao — Aluguel e Estrutura', 'DESP_FIXA', 'despesa'],
      ['6.4', 'Utilidades — Energia, Agua, Internet', 'DESP_FIXA', 'despesa'],
      ['6.5', 'Servicos Administrativos', 'DESP_FIXA', 'despesa'],
      ['6.6', 'Software e Sistemas', 'DESP_FIXA', 'despesa'],
      ['6.7', 'Marketing e Comercial', 'DESP_FIXA', 'despesa'],
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
        c.font = {
          name: j === 0 ? 'Consolas' : 'Calibri',
          size: 9, bold: j === 0,
          color: { argb: COLOR_ESPRESSO },
        };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
        c.alignment = { horizontal: j === 0 ? 'center' : 'left', vertical: 'middle' };
      });
    });
    ws3.getColumn('A').width = 10;
    ws3.getColumn('B').width = 42;
    ws3.getColumn('C').width = 18;
    ws3.getColumn('D').width = 18;

    // ABA 4: RESUMO
    const ws4 = wb.addWorksheet('📈 RESUMO', { views: [{ showGridLines: false }] });
    ws4.mergeCells('A1:D1');
    const banner4 = ws4.getCell('A1');
    banner4.value = 'RESUMO — Totalizadores Automaticos';
    banner4.font = { name: 'Calibri', size: 16, bold: true, color: { argb: COLOR_WHITE } };
    banner4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ESPRESSO } };
    banner4.alignment = { horizontal: 'center', vertical: 'middle' };
    ws4.getRow(1).height = 35;

    const resumo: Array<[string, { formula: string }, string?]> = [
      ['Total de lancamentos', { formula: "COUNTA('💰 LANÇAMENTOS'!A3:A1004)" }, '0'],
      ['Total de receitas', { formula: "COUNTIF('💰 LANÇAMENTOS'!C3:C1004,\"RECEBER\")" }, '0'],
      ['Total de despesas', { formula: "COUNTIF('💰 LANÇAMENTOS'!C3:C1004,\"PAGAR\")" }, '0'],
      ['Soma receitas (R$)', { formula: "SUMIF('💰 LANÇAMENTOS'!C3:C1004,\"RECEBER\",'💰 LANÇAMENTOS'!H3:H1004)" }, 'R$ #,##0.00'],
      ['Soma despesas (R$)', { formula: "SUMIF('💰 LANÇAMENTOS'!C3:C1004,\"PAGAR\",'💰 LANÇAMENTOS'!H3:H1004)" }, 'R$ #,##0.00'],
    ];
    resumo.forEach(([label, formula, fmt], i) => {
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
    const cR = ws4.getCell(9, 1);
    cR.value = 'RESULTADO LIQUIDO';
    cR.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLOR_WHITE } };
    cR.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ESPRESSO } };
    cR.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    const cV = ws4.getCell(9, 2);
    cV.value = { formula: 'B7-B8' } as any;
    cV.numFmt = 'R$ #,##0.00';
    cV.font = { name: 'Calibri', size: 12, bold: true, color: { argb: COLOR_WHITE } };
    cV.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ESPRESSO } };
    cV.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
    ws4.getRow(9).height = 32;
    ws4.getColumn('A').width = 32;
    ws4.getColumn('B').width = 20;

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
