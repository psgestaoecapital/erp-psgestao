// src/lib/ofx-parser.ts
// Parser OFX foundational — extrai movimentos de extratos bancarios e faturas
// de cartao via blocos STMTTRN (formato comum a OFX 1.x SGML e 2.x XML).
// Reutiliza regex do legado /api/ofx-upload/route.ts (validado em prod com 18 movs).
// Robustez adicionada (PR foundational): try/catch, validacoes, fallbacks.

export interface MovimentoOFX {
  data_transacao: string;       // ISO yyyy-mm-dd
  valor: number;                // SEMPRE positivo (modulo)
  natureza: 'credito' | 'debito';
  descricao: string;            // texto original ate 300 chars
  descricao_limpa: string;      // upper, sem acento/pontuacao, ate 300
  id_externo: string;           // FITID (ou gerado se ausente)
  documento: string | null;     // CHECKNUM
  tipo_ofx: string;             // TRNTYPE original (CREDIT/DEBIT/etc)
}

export interface ResultadoParseOFX {
  movimentos: MovimentoOFX[];
  aviso?: string;        // mensagem se algo suspeito (ex: encoding ?, etc)
  erro?: string;         // mensagem amigavel se falhar (movimentos vazio)
  total_brutos: number;  // total de blocos STMTTRN encontrados (antes de validar cada)
}

/**
 * Parser OFX robusto.
 *
 * Aceita o conteudo de um arquivo OFX (texto). Extrai movimentos e devolve
 * lista padronizada. NAO lanca exceptions — sempre retorna ResultadoParseOFX
 * com `erro` populado em caso de problema.
 *
 * Suporta:
 *   - OFX 1.x SGML (extratos bancarios e faturas de cartao)
 *   - OFX 2.x XML (mesma estrutura interna STMTTRN)
 *
 * Validacoes:
 *   - Texto vazio -> erro amigavel
 *   - Sem tag <OFX> -> erro amigavel
 *   - Sem blocos STMTTRN -> erro amigavel
 *   - Caracteres '?' / '[?]' frequentes -> aviso (encoding suspeito)
 *   - DTPOSTED malformado -> linha pulada (nao quebra o parse inteiro)
 *   - TRNAMT NaN -> linha pulada
 */
export function parseOFX(texto: string): ResultadoParseOFX {
  if (!texto || texto.trim().length === 0) {
    return {
      movimentos: [],
      erro: 'Arquivo vazio. Selecione um arquivo OFX valido.',
      total_brutos: 0,
    };
  }

  // Validacao basica: tag <OFX> deve existir (case-insensitive)
  if (!/<OFX[\s>]/i.test(texto)) {
    return {
      movimentos: [],
      erro: 'Arquivo nao parece ser OFX. Esperado tag <OFX> no conteudo.',
      total_brutos: 0,
    };
  }

  let aviso: string | undefined;

  // Detecta encoding suspeito: '?' ou '[?]' indicam conversao de caracter falhada
  // (heuristica: mais de 5 ocorrencias seguidas em areas de texto sugere problema)
  const interrogacoes = (texto.match(/\?{3,}/g) || []).length;
  const placeholders = (texto.match(/\[\?\]/g) || []).length;
  if (interrogacoes >= 3 || placeholders >= 3) {
    aviso = 'Caracteres suspeitos detectados (?). Pode ser problema de encoding — verifique se o arquivo foi salvo em UTF-8 ou latin1.';
  }

  const movimentos: MovimentoOFX[] = [];
  let totalBrutos = 0;

  try {
    const trnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/g;
    let match: RegExpExecArray | null;

    while ((match = trnRegex.exec(texto)) !== null) {
      totalBrutos++;
      const bloco = match[1];

      const getTag = (tag: string): string => {
        try {
          const m = bloco.match(new RegExp(`<${tag}>([^<\\n\\r]+)`, 'i'));
          return m ? m[1].trim() : '';
        } catch {
          return '';
        }
      };

      const tipoOfx = getTag('TRNTYPE');
      const dataStr = getTag('DTPOSTED');
      const valorStr = getTag('TRNAMT');
      const idExterno = getTag('FITID');
      const checkNum = getTag('CHECKNUM');
      const memo = getTag('MEMO') || getTag('NAME') || '';

      // Skip silencioso se faltam campos obrigatorios
      if (!dataStr || !valorStr) continue;

      // YYYYMMDD ou YYYYMMDDHHMMSS — validar dimensao minima
      if (dataStr.length < 8) continue;
      const y = dataStr.slice(0, 4);
      const m = dataStr.slice(4, 6);
      const d = dataStr.slice(6, 8);

      // Sanity check de data (mes 01-12, dia 01-31)
      const mesNum = parseInt(m, 10);
      const diaNum = parseInt(d, 10);
      const anoNum = parseInt(y, 10);
      if (
        isNaN(mesNum) || mesNum < 1 || mesNum > 12 ||
        isNaN(diaNum) || diaNum < 1 || diaNum > 31 ||
        isNaN(anoNum) || anoNum < 1900 || anoNum > 2100
      ) {
        continue;
      }

      const dataISO = `${y}-${m}-${d}`;
      const valorRaw = parseFloat(valorStr.replace(',', '.'));
      if (isNaN(valorRaw)) continue;

      // Natureza pelo sinal do valor (credito > 0, debito < 0)
      // OFX TRNTYPE pode dizer CREDIT/DEBIT mas o sinal e a fonte primaria
      const natureza: 'credito' | 'debito' = valorRaw >= 0 ? 'credito' : 'debito';
      const valor = Math.abs(valorRaw);

      const descricao = memo.slice(0, 300);
      const descricaoLimpa = memo
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '') // remove acentos
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .replace(/[^A-Z0-9\s]/g, '')
        .trim()
        .slice(0, 300);

      movimentos.push({
        data_transacao: dataISO,
        valor,
        natureza,
        descricao,
        descricao_limpa: descricaoLimpa,
        id_externo: idExterno || `${dataISO}-${valorRaw}-${Math.random().toString(36).substring(2, 8)}`,
        documento: checkNum || null,
        tipo_ofx: tipoOfx || (valorRaw >= 0 ? 'CREDIT' : 'DEBIT'),
      });
    }
  } catch (e: any) {
    return {
      movimentos: [],
      erro: 'Erro ao processar OFX: ' + (e?.message || String(e)),
      total_brutos: totalBrutos,
    };
  }

  // Fallback gracioso: 0 movimentos parseados apos encontrar blocos
  if (totalBrutos === 0) {
    return {
      movimentos: [],
      erro: 'Nenhum bloco de transacao (<STMTTRN>) encontrado no arquivo. Confirme se o OFX esta completo.',
      total_brutos: 0,
      aviso,
    };
  }

  if (movimentos.length === 0) {
    return {
      movimentos: [],
      erro: `${totalBrutos} bloco(s) de transacao encontrados mas nenhum tinha data + valor validos. Arquivo pode estar corrompido.`,
      total_brutos: totalBrutos,
      aviso,
    };
  }

  return {
    movimentos,
    aviso,
    total_brutos: totalBrutos,
  };
}

/**
 * Calcula hash SHA-256 de um File (para deduplicacao no backend).
 * Funciona apenas no browser (usa crypto.subtle).
 */
export async function calcularHashSHA256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
