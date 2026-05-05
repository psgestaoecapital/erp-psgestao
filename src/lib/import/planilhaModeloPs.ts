// src/lib/import/planilhaModeloPs.ts
// ============================================================================
// Modulo isolado para detectar e processar a Planilha Modelo PS Gestao v1.0
// E importado pelo /api/import/universal/route.ts SEM modificar o resto da logica.
// ============================================================================

import * as XLSX from 'xlsx';
import crypto from 'crypto';

export const ASSINATURA_PLANILHA_PS = '💰 LANÇAMENTOS';
export const ASSINATURA_PLANILHA_PS_FALLBACK = 'LANÇAMENTOS';

export const HEADERS_LANCAMENTO_PS = [
  'CNPJ', 'Tipo', 'Linha de Negócio', 'Data Competência',
  'Data Vencimento', 'Valor (R$)', 'Categoria', 'Subcategoria',
];

export interface ParsedSheetPS {
  name: string;
  headers: string[];
  rows: any[][];
  rowCount: number;
}

export interface DetectionPS {
  isPlanilhaModeloPs: boolean;
  confidence: number;
  sheetIndex: number;
  reason: string;
  matchedHeaders?: number;
}

export interface LancamentoRecordPS {
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

function normalizar(s: string): string {
  return (s ?? '').toString().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function normalizarCnpj(cnpj: string): string {
  return (cnpj ?? '').toString().replace(/\D/g, '');
}

export function parseDate(v: any): string | null {
  if (!v) return null;
  if (typeof v === 'number') {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + v * 86400 * 1000);
    return d.toISOString().slice(0, 10);
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
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

export function parseValor(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(/R\$\s*/gi, '').replace(/\s/g, '');
  const temVirg = s.includes(',');
  const temPonto = s.includes('.');
  if (temVirg && temPonto) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (temVirg) {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

function gerarHash(record: Partial<LancamentoRecordPS>, idx: number): string {
  const base = [
    record.company_id || '', record.tipo || '',
    record.data_emissao || record.data_vencimento || '',
    record.valor_documento ?? '', record.nome_pessoa || '',
    record.descricao || '', idx,
  ].join('|');
  return 'plan_' + crypto.createHash('md5').update(base).digest('hex').slice(0, 32);
}

function statusFrom(dataPagamento: string | null): string {
  return dataPagamento ? 'PAGO' : 'A VENCER';
}

/**
 * Parse de TODAS as abas do workbook (formato leve, usado só para detecção).
 * O parser antigo continua usando seu próprio fluxo para os outros tipos.
 */
export function parseWorkbookForPS(buffer: ArrayBuffer): ParsedSheetPS[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const aoa: any[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1, defval: '', raw: false,
    });
    if (aoa.length === 0) return { name, headers: [], rows: [], rowCount: 0 };
    let headerRowIdx = 0;
    for (let i = 0; i < Math.min(5, aoa.length); i++) {
      const r = aoa[i] || [];
      const stringCount = r.filter(
        (c) => typeof c === 'string' && c.trim().length > 1
      ).length;
      if (stringCount >= 3) { headerRowIdx = i; break; }
    }
    const headers = (aoa[headerRowIdx] || []).map((h) => String(h ?? '').trim());
    const rows = aoa.slice(headerRowIdx + 1).filter(
      (r) => r.some((c) => c !== '' && c !== null)
    );
    return { name, headers, rows, rowCount: rows.length };
  });
}

/**
 * Detecta se o workbook eh uma Planilha Modelo PS Gestao v1.0.
 * NAO interfere com a deteccao dos outros formatos (SIGA, Omie, etc).
 */
export function detectarPlanilhaModeloPs(sheets: ParsedSheetPS[]): DetectionPS {
  for (let i = 0; i < sheets.length; i++) {
    const sh = sheets[i];
    const nameNorm = normalizar(sh.name);
    const eAbaPS =
      nameNorm.includes('lancamentos') ||
      sh.name.includes(ASSINATURA_PLANILHA_PS) ||
      sh.name.includes(ASSINATURA_PLANILHA_PS_FALLBACK);

    if (eAbaPS) {
      const headersNorm = sh.headers.map(normalizar);
      const matches = HEADERS_LANCAMENTO_PS.filter((h) =>
        headersNorm.includes(normalizar(h))
      ).length;
      if (matches >= 5) {
        return {
          isPlanilhaModeloPs: true,
          confidence: 100,
          sheetIndex: i,
          reason: `Aba "${sh.name}" com ${matches}/${HEADERS_LANCAMENTO_PS.length} cabecalhos da Planilha Modelo PS`,
          matchedHeaders: matches,
        };
      }
    }
  }
  return {
    isPlanilhaModeloPs: false,
    confidence: 0,
    sheetIndex: -1,
    reason: 'Nao e Planilha Modelo PS — formato sera tratado pelo parser legado',
  };
}

/**
 * Mapeia linhas da aba LANCAMENTOS para registros validados.
 */
export function mapearLinhasPS(
  sheet: ParsedSheetPS,
  empresasMap: Map<string, string>,
  linhasNegocioMap: Map<string, Map<string, string>>
): { records: LancamentoRecordPS[]; erros: any[] } {
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

  const records: LancamentoRecordPS[] = [];
  const erros: any[] = [];

  sheet.rows.forEach((row, idxRow) => {
    try {
      const cnpjRaw = colCnpj >= 0 ? row[colCnpj] : null;
      const cnpjNorm = normalizarCnpj(String(cnpjRaw || ''));
      if (!cnpjNorm || cnpjNorm.length !== 14) return;
      if (cnpjNorm === '00000000000100' || cnpjNorm === '00000000000000') return;

      const company_id = empresasMap.get(cnpjNorm);
      if (!company_id) {
        erros.push({ linha: idxRow + 2, erro: `CNPJ ${cnpjRaw} nao cadastrado` });
        return;
      }

      const tipoRaw = String(row[colTipo] || '').toUpperCase().trim();
      if (tipoRaw !== 'PAGAR' && tipoRaw !== 'RECEBER') {
        erros.push({ linha: idxRow + 2, erro: `Tipo invalido: "${tipoRaw}"` });
        return;
      }

      const dataCompt = colDataCompt >= 0 ? parseDate(row[colDataCompt]) : null;
      const dataVenc = colDataVenc >= 0 ? parseDate(row[colDataVenc]) : null;
      const dataPgto = colDataPgto >= 0 ? parseDate(row[colDataPgto]) : null;
      if (!dataVenc && !dataCompt) {
        erros.push({ linha: idxRow + 2, erro: 'Data Vencimento ou Competencia obrigatoria' });
        return;
      }

      const valor = colValor >= 0 ? parseValor(row[colValor]) : null;
      if (!valor || valor <= 0) {
        erros.push({ linha: idxRow + 2, erro: `Valor invalido: ${row[colValor]}` });
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
                erro: `LN "${lnNome}" nao cadastrada para esta empresa`,
              });
              return;
            }
          }
        }
      }

      const cliente = colPessoa >= 0 ? String(row[colPessoa] || '').trim() : '';
      const descRaw = colDesc >= 0 ? String(row[colDesc] || '').trim() : '';
      const desc = (descRaw || cliente || 'Lancamento sem descricao').slice(0, 200);

      const rec: LancamentoRecordPS = {
        company_id,
        business_line_id,
        tipo: tipoRaw as 'PAGAR' | 'RECEBER',
        data_emissao: dataCompt,
        data_vencimento: dataVenc || dataCompt!,
        data_pagamento: dataPgto,
        valor_documento: valor,
        valor_pago: valorPago,
        status: statusFrom(dataPgto),
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
