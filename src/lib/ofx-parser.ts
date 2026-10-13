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
  id_externo: string;           // FITID > CHECKNUM > REFNUM; '' se nenhum (NÃO gerar aleatório — quebra dedup)
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
      const refNum = getTag('REFNUM');
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
        // FITID > CHECKNUM > REFNUM; '' se nenhum. NUNCA gerar aleatório: id volátil impede a dedup
        // por transação (cada import viraria "novo"). Sem id → dedup por chave natural na RPC (FIX #8).
        id_externo: idExterno || checkNum || refNum || '',
        documento: checkNum || null,
        tipo_ofx: tipoOfx || (valorRaw >= 0 ? 'CREDIT' : 'DEBIT'),
      });
    }
  } catch (e) {
    return {
      movimentos: [],
      erro: 'Erro ao processar OFX: ' + (e instanceof Error ? e.message : String(e)),
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

// SPEC SONDA-SALDO (diagnóstico, temporário): detecta se o OFX traz saldo de fechamento.
// NÃO altera parseOFX nem seu retorno. Só olha. Registra o VALOR CRU da <BALAMT>/<DTASOF>
// (o saldo e sua data — não é dado de terceiro) e a presença das tags. Nada de descrição/nome/CPF.
export interface SondaSaldoOFX {
  ledgerbal_presente: boolean;   // <LEDGERBAL> (saldo contábil de fechamento)
  availbal_presente: boolean;    // <AVAILBAL> (saldo disponível)
  balamt_bruto: string | null;   // <BALAMT> dentro de <LEDGERBAL>, cru (pode vir com vírgula/sinal)
  dtasof_bruto: string | null;   // <DTASOF> dentro de <LEDGERBAL>, cru (data do saldo)
  availbal_balamt_bruto: string | null; // <BALAMT> dentro de <AVAILBAL>, cru
  tags_detectadas: string[];     // quais das tags de saldo apareceram no arquivo
}

export function detectarSaldoOFX(texto: string): SondaSaldoOFX {
  const temTag = (t: string): boolean => new RegExp(`<${t}[\\s>]`, 'i').test(texto);
  const pegarEm = (bloco: string, t: string): string | null => {
    const m = bloco.match(new RegExp(`<${t}>([^<\\n\\r]+)`, 'i'));
    return m ? m[1].trim() : null;
  };
  const ledger = texto.match(/<LEDGERBAL>([\s\S]*?)<\/LEDGERBAL>/i)?.[1] ?? '';
  const avail = texto.match(/<AVAILBAL>([\s\S]*?)<\/AVAILBAL>/i)?.[1] ?? '';
  const tags = ['LEDGERBAL', 'BALAMT', 'DTASOF', 'AVAILBAL'].filter(temTag);
  return {
    ledgerbal_presente: temTag('LEDGERBAL'),
    availbal_presente: temTag('AVAILBAL'),
    balamt_bruto: pegarEm(ledger, 'BALAMT'),
    dtasof_bruto: pegarEm(ledger, 'DTASOF'),
    availbal_balamt_bruto: pegarEm(avail, 'BALAMT'),
    tags_detectadas: tags,
  };
}

// Saldo Bancário (18/09): converte o saldo CRU lido por detectarSaldoOFX em valor numérico e data
// timestamptz, para gravar erp_banco_contas.saldo_extrato via fn_conciliacao_criar_lote. REUSA
// detectarSaldoOFX (não reescreve o leitor). Função PURA e testável.
export interface SaldoFechamentoOFX {
  presente: boolean         // havia <LEDGERBAL><BALAMT> no arquivo
  valor: number | null      // BALAMT → number (aceita vírgula e sinal)
  dataISO: string | null    // DTASOF → ISO timestamptz (respeita o fuso do OFX quando presente)
  balamt_bruto: string | null
  dtasof_bruto: string | null
}

// BALAMT cru → number. OFX padrão usa '.' decimal; bancos BR às vezes mandam ','. Preserva o sinal.
export function parseValorOFX(raw: string | null): number | null {
  if (!raw) return null
  let s = raw.trim().replace(/\s/g, '')
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.') // 1.234,56 → 1234.56
  else if (s.includes(',')) s = s.replace(',', '.')                                   // 500,00 → 500.00
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// DTASOF cru (YYYYMMDD[HHMMSS][.mmm][-3:BRT]) → ISO com offset quando o OFX traz o fuso.
export function parseDataOFX(raw: string | null): string | null {
  if (!raw) return null
  const m = raw.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?(?:\.\d+)?(?:\[\s*([+-]?\d+(?:\.\d+)?)\s*(?::[A-Za-z]+)?\s*\])?/)
  if (!m) return null
  const [, Y, Mo, D, h, mi, s, tz] = m
  let offset = ''
  if (tz !== undefined && tz !== '') {
    const off = parseFloat(tz)
    const sign = off < 0 ? '-' : '+'
    const abs = Math.abs(off)
    const oh = String(Math.floor(abs)).padStart(2, '0')
    const om = String(Math.round((abs % 1) * 60)).padStart(2, '0')
    offset = `${sign}${oh}:${om}`
  }
  return `${Y}-${Mo}-${D}T${h ?? '00'}:${mi ?? '00'}:${s ?? '00'}${offset}`
}

export function parseSaldoFechamento(texto: string): SaldoFechamentoOFX {
  const sonda = detectarSaldoOFX(texto)
  if (!sonda.ledgerbal_presente || !sonda.balamt_bruto) {
    return { presente: false, valor: null, dataISO: null, balamt_bruto: sonda.balamt_bruto, dtasof_bruto: sonda.dtasof_bruto }
  }
  return {
    presente: true,
    valor: parseValorOFX(sonda.balamt_bruto),
    dataISO: parseDataOFX(sonda.dtasof_bruto),
    balamt_bruto: sonda.balamt_bruto,
    dtasof_bruto: sonda.dtasof_bruto,
  }
}

// Saldo Anterior (adendo #1541): alguns bancos (ex.: Sicredi/Sicoob) emitem o saldo do
// extrato como uma LINHA <STMTTRN> com MEMO "SALDO ANTERIOR" / "SALDO DO DIA" / só "SALDO".
// Isso NÃO é movimento — vira ruído em conciliacao_movimento e desalinha o total. Este helper
// PURO decide se a descrição normalizada de uma linha OFX é, na verdade, uma linha de saldo.
//
// Aceita (é saldo, NÃO é movimento):
//   "SALDO", "SALDO ANTERIOR", "SALDO DO DIA", "SALDO ANTERIOR 1234", "SALDO 123456"
// Recusa (é movimento de verdade — mantém):
//   "SALDO REMUNERADO", "SALDO DEVEDOR", "APLIC SALDO", "RESGATE SALDO REMUNERADO"
//
// Trabalha sobre o MESMO texto normalizado de descricao_limpa (upper, sem acento/pontuação).
export function ehLinhaSaldoOFX(descricao: string): boolean {
  if (!descricao) return false
  const norm = descricao
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!norm.startsWith('SALDO')) return false
  // Resto após "SALDO ": vazio, "ANTERIOR[...]", "DO DIA[...]", ou só dígitos → é linha de saldo.
  // "REMUNERADO"/"DEVEDOR"/qualquer outra palavra → é movimento, não é saldo.
  const resto = norm.slice('SALDO'.length).trim()
  if (resto === '') return true
  if (/^ANTERIOR(\s.*)?$/.test(resto)) return true
  if (/^DO DIA(\s.*)?$/.test(resto)) return true
  if (/^DIA(\s.*)?$/.test(resto)) return true
  if (/^\d[\d\s]*$/.test(resto)) return true // "SALDO 123456" (valor colado)
  return false
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
