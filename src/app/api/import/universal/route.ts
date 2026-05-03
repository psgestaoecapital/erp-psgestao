// src/app/api/import/universal/route.ts
// ========================================================================
// Upload Universal v2.0 — Suporta:
//   1. Planilha Modelo PS Gestão (assinatura: aba "💰 LANÇAMENTOS")
//   2. Detecção automática de outros formatos (SIGA, Omie, ContaAzul)
//   3. Multi-tenant via CNPJ → company_id
//   4. Idempotência via import_hash
// ========================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import crypto from 'crypto';

// ============ Tipos ============
type DetectedKind =
  | 'planilha_modelo_ps'
  | 'lancamentos_generico'
  | 'clientes'
  | 'fornecedores'
  | 'contas_receber'
  | 'contas_pagar'
  | 'produtos_servicos'
  | 'desconhecido';

interface ParsedSheet {
  name: string;
  headers: string[];
  rows: any[][];
  rowCount: number;
}

interface DetectionResult {
  kind: DetectedKind;
  confidence: number;
  sheetIndex: number;
  reason: string;
}

interface LancamentoRecord {
  company_id: string;
  business_line_id: string | null;
  tipo: 'PAGAR' | 'RECEBER';
  data_emissao: string | null;
  data_vencimento: string;
  data_pagamento: string | null;
  valor_documento: number;
  valor_pago: number | null;
  status: string;
  categoria: string | null;
  subcategoria: string | null;
  centro_custo: string | null;
  descricao: string | null;
  nome_pessoa: string | null;
  forma_pagamento: string | null;
  import_hash: string;
}

// ============ Constantes ============
const ASSINATURA_PLANILHA_PS = '💰 LANÇAMENTOS';
const ASSINATURA_PLANILHA_PS_FALLBACK = 'LANÇAMENTOS';

const HEADERS_LANCAMENTO_PS = [
  'CNPJ',
  'Tipo',
  'Linha de Negócio',
  'Data Competência',
  'Data Vencimento',
  'Valor (R$)',
  'Categoria',
  'Subcategoria',
];

// ============ Helpers ============
function normalizar(s: string): string {
  return (s ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function normalizarCnpj(cnpj: string): string {
  return (cnpj ?? '').toString().replace(/\D/g, '');
}

function parseDate(v: any): string | null {
  if (!v) return null;
  if (typeof v === 'number') {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const ms = v * 86400 * 1000;
    const d = new Date(epoch.getTime() + ms);
    return d.toISOString().slice(0, 10);
  }
  if (v instanceof Date) {
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (m) {
    const [, d, mo, y] = m;
    const yyyy = y.length === 2 ? '20' + y : y;
    return `${yyyy}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

function parseValor(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(/R\$\s*/gi, '').replace(/\s/g, '');
  const temVirgula = s.includes(',');
  const temPonto = s.includes('.');
  if (temVirgula && temPonto) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (temVirgula) {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

function gerarHash(record: Partial<LancamentoRecord>, idx: number): string {
  const base = [
    record.company_id || '',
    record.tipo || '',
    record.data_emissao || record.data_vencimento || '',
    record.valor_documento ?? '',
    record.nome_pessoa || '',
    record.descricao || '',
    idx,
  ].join('|');
  return 'plan_' + crypto.createHash('md5').update(base).digest('hex').slice(0, 32);
}

function normalizarStatus(v: any, dataPagamento: string | null): string {
  if (dataPagamento) return 'PAGO';
  if (!v) return 'A VENCER';
  const s = String(v).toUpperCase().trim();
  if (s.includes('PAGO') || s.includes('RECEBI') || s.includes('QUITAD') || s.includes('LIQUIDAD')) return 'PAGO';
  if (s.includes('CANCEL')) return 'CANCELADO';
  return 'A VENCER';
}

// ============ Parsing do XLSX ============
function parseWorkbook(buffer: ArrayBuffer): ParsedSheet[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    if (aoa.length === 0) {
      return { name, headers: [], rows: [], rowCount: 0 };
    }
    let headerRowIdx = 0;
    for (let i = 0; i < Math.min(5, aoa.length); i++) {
      const r = aoa[i] || [];
      const stringCount = r.filter((c) => typeof c === 'string' && c.trim().length > 1).length;
      if (stringCount >= 3) {
        headerRowIdx = i;
        break;
      }
    }
    const headers = (aoa[headerRowIdx] || []).map((h) => String(h ?? '').trim());
    const rows = aoa.slice(headerRowIdx + 1).filter((r) => r.some((c) => c !== '' && c !== null));
    return { name, headers, rows, rowCount: rows.length };
  });
}

// ============ Detecção de Tipo ============
function detectarTipo(sheets: ParsedSheet[]): DetectionResult {
  for (let i = 0; i < sheets.length; i++) {
    const sh = sheets[i];
    const nameNorm = normalizar(sh.name);
    if (
      nameNorm.includes('lancamentos') ||
      sh.name.includes(ASSINATURA_PLANILHA_PS) ||
      sh.name.includes(ASSINATURA_PLANILHA_PS_FALLBACK)
    ) {
      const headersNorm = sh.headers.map(normalizar);
      const matches = HEADERS_LANCAMENTO_PS.filter((h) => headersNorm.includes(normalizar(h))).length;
      if (matches >= 5) {
        return {
          kind: 'planilha_modelo_ps',
          confidence: 100,
          sheetIndex: i,
          reason: `Aba "${sh.name}" com ${matches}/${HEADERS_LANCAMENTO_PS.length} cabeçalhos da Planilha Modelo PS detectados`,
        };
      }
    }
  }

  for (let i = 0; i < sheets.length; i++) {
    const sh = sheets[i];
    if (sh.rowCount < 2) continue;
    const headersNorm = sh.headers.map(normalizar);
    const temData = headersNorm.some((h) => h.includes('data') || h.includes('vencimento') || h.includes('competencia'));
    const temValor = headersNorm.some((h) => h.includes('valor') || h.includes('montante') || h.includes('total'));
    const temTipo = headersNorm.some(
      (h) => h.includes('tipo') || h.includes('receita') || h.includes('despesa') || h.includes('pagar') || h.includes('receber')
    );
    if (temData && temValor && temTipo) {
      return {
        kind: 'lancamentos_generico',
        confidence: 70,
        sheetIndex: i,
        reason: `Aba "${sh.name}" tem colunas de data, valor e tipo`,
      };
    }
  }

  for (let i = 0; i < sheets.length; i++) {
    const sh = sheets[i];
    const headersNorm = sh.headers.map(normalizar);
    if (headersNorm.some((h) => h.includes('cliente')) && headersNorm.some((h) => h.includes('cnpj') || h.includes('cpf'))) {
      return { kind: 'clientes', confidence: 60, sheetIndex: i, reason: `Aba "${sh.name}" parece cadastro de clientes` };
    }
    if (headersNorm.some((h) => h.includes('fornecedor'))) {
      return { kind: 'fornecedores', confidence: 60, sheetIndex: i, reason: `Aba "${sh.name}" parece cadastro de fornecedores` };
    }
  }

  return { kind: 'desconhecido', confidence: 0, sheetIndex: 0, reason: 'Nenhum formato reconhecido' };
}

// ============ Mapeamento Planilha PS → Records ============
function mapearPlanilhaPS(
  sheet: ParsedSheet,
  empresasMap: Map<string, string>,
  linhasNegocioMap: Map<string, Map<string, string>>
): { records: LancamentoRecord[]; erros: any[] } {
  const headersNorm = sheet.headers.map(normalizar);
  const idx = (target: string) => headersNorm.findIndex((h) => h === normalizar(target));

  const colCnpj = idx('CNPJ');
  const colTipo = idx('Tipo');
  const colLn = idx('Linha de Negócio');
  const colDataCompt = idx('Data Competência');
  const colDataVenc = idx('Data Vencimento');
  const colDataPgto = idx('Data Pagamento');
  const colValor = idx('Valor (R$)');
  const colValorPago = idx('Valor Pago (R$)');
  const colCategoria = idx('Categoria');
  const colSubcat = idx('Subcategoria');
  const colCC = idx('Centro de Custo');
  const colDesc = idx('Descrição');
  const colPessoa = idx('Cliente/Fornecedor');
  const colForma = idx('Forma Pagamento');

  const records: LancamentoRecord[] = [];
  const erros: any[] = [];

  sheet.rows.forEach((row, idxRow) => {
    try {
      const cnpjRaw = colCnpj >= 0 ? row[colCnpj] : null;
      const cnpjNorm = normalizarCnpj(String(cnpjRaw || ''));

      if (!cnpjNorm || cnpjNorm.length !== 14) return;
      if (cnpjNorm === '00000000000100' || cnpjNorm === '00000000000000') return;

      const company_id = empresasMap.get(cnpjNorm);
      if (!company_id) {
        erros.push({ linha: idxRow + 2, erro: `CNPJ ${cnpjRaw} não cadastrado no sistema` });
        return;
      }

      const tipoRaw = String(row[colTipo] || '').toUpperCase().trim();
      if (tipoRaw !== 'PAGAR' && tipoRaw !== 'RECEBER') {
        erros.push({ linha: idxRow + 2, erro: `Tipo inválido: "${tipoRaw}". Use PAGAR ou RECEBER` });
        return;
      }

      const dataCompt = colDataCompt >= 0 ? parseDate(row[colDataCompt]) : null;
      const dataVenc = colDataVenc >= 0 ? parseDate(row[colDataVenc]) : null;
      const dataPgto = colDataPgto >= 0 ? parseDate(row[colDataPgto]) : null;

      if (!dataVenc && !dataCompt) {
        erros.push({ linha: idxRow + 2, erro: 'Data de Vencimento ou Competência obrigatória' });
        return;
      }

      const valor = colValor >= 0 ? parseValor(row[colValor]) : null;
      if (!valor || valor <= 0) {
        erros.push({ linha: idxRow + 2, erro: `Valor inválido: ${row[colValor]}` });
        return;
      }
      const valorPago = colValorPago >= 0 ? parseValor(row[colValorPago]) : null;

      let business_line_id: string | null = null;
      if (colLn >= 0) {
        const lnNome = String(row[colLn] || '').trim();
        if (lnNome) {
          const lnsEmpresa = linhasNegocioMap.get(company_id);
          if (lnsEmpresa) {
            business_line_id = lnsEmpresa.get(normalizar(lnNome)) || null;
            if (!business_line_id) {
              erros.push({
                linha: idxRow + 2,
                erro: `Linha de Negócio "${lnNome}" não cadastrada para esta empresa`,
              });
              return;
            }
          }
        }
      }

      const cliente = colPessoa >= 0 ? String(row[colPessoa] || '').trim() : '';
      const descRaw = colDesc >= 0 ? String(row[colDesc] || '').trim() : '';
      const desc = (descRaw || cliente || 'Lançamento sem descrição').slice(0, 200);

      const rec: LancamentoRecord = {
        company_id,
        business_line_id,
        tipo: tipoRaw as 'PAGAR' | 'RECEBER',
        data_emissao: dataCompt,
        data_vencimento: dataVenc || dataCompt!,
        data_pagamento: dataPgto,
        valor_documento: valor,
        valor_pago: valorPago,
        status: normalizarStatus(null, dataPgto),
        categoria: colCategoria >= 0 ? String(row[colCategoria] || '').trim() || null : null,
        subcategoria: colSubcat >= 0 ? String(row[colSubcat] || '').trim() || null : null,
        centro_custo: colCC >= 0 ? String(row[colCC] || '').trim() || null : null,
        descricao: desc,
        nome_pessoa: cliente || null,
        forma_pagamento: colForma >= 0 ? String(row[colForma] || '').trim() || null : null,
        import_hash: '',
      };
      rec.import_hash = gerarHash(rec, idxRow);

      records.push(rec);
    } catch (e: any) {
      erros.push({ linha: idxRow + 2, erro: e.message });
    }
  });

  return { records, erros };
}

// ============ Handler POST ============
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const action = (formData.get('action') as string) || 'preview';
    const sheetIndexParam = formData.get('sheet_index');
    const userIdRaw = formData.get('user_id') as string | null;

    if (!file) {
      return NextResponse.json({ ok: false, error: 'Arquivo não enviado' }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!url || !key) {
      return NextResponse.json({ ok: false, error: 'Variáveis de ambiente Supabase ausentes' }, { status: 500 });
    }
    const supa = createClient(url, key);

    const buffer = await file.arrayBuffer();
    const sheets = parseWorkbook(buffer);

    if (sheets.length === 0) {
      return NextResponse.json({ ok: false, error: 'Arquivo vazio ou inválido' }, { status: 400 });
    }

    const detection = detectarTipo(sheets);
    const sheetIndex = sheetIndexParam !== null && sheetIndexParam !== undefined
      ? parseInt(String(sheetIndexParam), 10)
      : detection.sheetIndex;
    const sheetEscolhida = sheets[sheetIndex];

    if (action === 'preview') {
      return NextResponse.json({
        ok: true,
        action: 'preview',
        arquivo: { nome: file.name, tamanho_kb: Math.round(file.size / 1024) },
        sheets: sheets.map((s, i) => ({
          index: i,
          nome: s.name,
          linhas: s.rowCount,
          colunas: s.headers.length,
          headers: s.headers,
          eh_planilha_ps: s.name.includes(ASSINATURA_PLANILHA_PS),
        })),
        deteccao: detection,
        sheet_selecionada: {
          index: sheetIndex,
          nome: sheetEscolhida?.name,
          headers: sheetEscolhida?.headers,
          preview_linhas: (sheetEscolhida?.rows || []).slice(0, 10),
        },
      });
    }

    if (action !== 'confirm') {
      return NextResponse.json({ ok: false, error: `Ação inválida: ${action}` }, { status: 400 });
    }

    if (detection.kind !== 'planilha_modelo_ps') {
      return NextResponse.json(
        {
          ok: false,
          error: `Importação automática disponível apenas para Planilha Modelo PS Gestão. Tipo detectado: ${detection.kind}`,
          deteccao: detection,
        },
        { status: 400 }
      );
    }

    const { data: empresasArr, error: errEmp } = await supa
      .from('companies')
      .select('id, cnpj');
    if (errEmp) throw errEmp;
    const empresasMap = new Map<string, string>();
    (empresasArr || []).forEach((e: any) => {
      const c = normalizarCnpj(e.cnpj || '');
      if (c) empresasMap.set(c, e.id);
    });

    const { data: lnsArr, error: errLn } = await supa
      .from('business_lines')
      .select('id, company_id, name')
      .eq('is_active', true);
    if (errLn) throw errLn;
    const linhasNegocioMap = new Map<string, Map<string, string>>();
    (lnsArr || []).forEach((ln: any) => {
      if (!linhasNegocioMap.has(ln.company_id)) linhasNegocioMap.set(ln.company_id, new Map());
      linhasNegocioMap.get(ln.company_id)!.set(normalizar(ln.name), ln.id);
    });

    const { records, erros: errosMapa } = mapearPlanilhaPS(sheetEscolhida, empresasMap, linhasNegocioMap);

    if (records.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'Nenhum registro válido para importar',
        erros_mapeamento: errosMapa,
      }, { status: 400 });
    }

    const porEmpresa = new Map<string, LancamentoRecord[]>();
    records.forEach((r) => {
      if (!porEmpresa.has(r.company_id)) porEmpresa.set(r.company_id, []);
      porEmpresa.get(r.company_id)!.push(r);
    });

    const resultados: any[] = [];
    let totalInseridos = 0;
    let totalDuplicados = 0;
    let totalErros = errosMapa.length;
    const todosErros: any[] = [...errosMapa];

    for (const [companyId, recs] of porEmpresa.entries()) {
      for (let i = 0; i < recs.length; i += 200) {
        const chunk = recs.slice(i, i + 200);
        const { data, error } = await supa.rpc('fn_planilha_universal_processar', {
          p_company_id: companyId,
          p_user_id: userIdRaw || null,
          p_arquivo_nome: file.name,
          p_records: chunk,
        });
        if (error) {
          totalErros += chunk.length;
          todosErros.push({ company_id: companyId, chunk_inicio: i, erro: error.message });
          continue;
        }
        const r = data as any;
        totalInseridos += r.inseridos || 0;
        totalDuplicados += r.duplicados || 0;
        totalErros += r.erros || 0;
        if (r.lista_erros && Array.isArray(r.lista_erros)) {
          todosErros.push(...r.lista_erros.map((e: any) => ({ ...e, company_id: companyId })));
        }
        resultados.push({ company_id: companyId, chunk: i, ...r });
      }
    }

    return NextResponse.json({
      ok: true,
      action: 'confirm',
      tipo: detection.kind,
      arquivo: file.name,
      total_linhas_planilha: sheetEscolhida.rowCount,
      total_registros_validos: records.length,
      empresas: porEmpresa.size,
      inseridos: totalInseridos,
      duplicados: totalDuplicados,
      erros: totalErros,
      lista_erros: todosErros.slice(0, 50),
      detalhes_por_empresa: resultados,
      mensagem:
        totalInseridos > 0
          ? `${totalInseridos} lançamentos importados. Pipeline PSGC processará em até 5 minutos. Dashboard será atualizado automaticamente.`
          : 'Nenhum registro novo importado',
    });
  } catch (e: any) {
    console.error('[import/universal] erro fatal:', e);
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}

// ============ Handler GET (info) ============
export async function GET() {
  return NextResponse.json({
    ok: true,
    versao: '2.0',
    formatos_suportados: [
      'planilha_modelo_ps (importação automática completa)',
      'lancamentos_generico (em desenvolvimento)',
      'clientes (em desenvolvimento)',
      'fornecedores (em desenvolvimento)',
    ],
    template_url: '/api/templates/planilha-modelo',
    documentacao: 'Baixe a Planilha Modelo PS Gestão, preencha e suba aqui.',
  });
}
