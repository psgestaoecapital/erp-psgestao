'use client';
// IBPT PR 2/4 — Importador da tabela IBPT (Lei 12.741) na Central de Dev. SÓ PS_ADMIN.
// A tabela IBPT é ÚNICA (núcleo): uma carga serve TODOS os tenants. A API do IBPT está fora do ar,
// então o CEO baixa o CSV/ZIP do site e sobe aqui. Parse no NAVEGADOR + envio em LOTES (a tabela
// completa é ~400k linhas; função serverless tem limite de ~4,5MB por request). Valida o cabeçalho
// e falha claro se divergir — não carrega no escuro (RD-38).
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import JSZip from 'jszip';

const C = { p:'#3D2314', s:'#C8941A', bg:'#FAF7F2', card:'#FFFFFF', bd:'#E7DED3', tx:'#3D2314', txm:'#6B5D4F', g:'#16A34A', r:'#DC2626', y:'#CA8A04' };

type Linha = { ncm:string; uf?:string; nacional_federal:string; importado_federal:string; estadual:string; municipal:string; ex_tipi?:string; tipo?:string; descricao?:string; chave?:string };

// nomes das colunas do arquivo IBPT (deolhonoimposto), tolerante a acento/caixa
function norm(s:string){ return s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim(); }
const COLS: Record<string,string[]> = {
  ncm:['codigo','ncm','nbs'], uf:['uf'],
  nacional_federal:['nacionalfederal','nacional'], importado_federal:['importadosfederal','importadofederal','importado'],
  estadual:['estadual'], municipal:['municipal'],
  ex_tipi:['ex','extipi'], tipo:['tipo'], descricao:['descricao'], chave:['chave'],
  // metadados que o próprio arquivo do IBPT traz em TODA linha (mesma estrutura da API):
  versao:['versao'], vigencia_inicio:['vigenciainicio','iniciovigencia'], vigencia_fim:['vigenciafim','fimvigencia'], fonte:['fonte'],
};

// data do IBPT vem como DD/MM/AAAA (ou já AAAA-MM-DD). Devolve AAAA-MM-DD (formato do <input type=date>).
function paraDataIso(s: string): string | null {
  const t = (s ?? '').trim();
  if (!t) return null;
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

export interface MetaArquivo {
  versao: string | null; vigIni: string | null; vigFim: string | null; fonte: string | null;
  faltando: string[];        // colunas de metadado ausentes no cabeçalho
  erro: string | null;       // arquivo heterogêneo (mais de uma versão/vigência) → recusar
}

// Lê os metadados (versão/vigência/fonte) do ARQUIVO e valida que são homogêneos entre TODAS as linhas.
// A tabela do IBPT é homogênea; se vier misturada, é arquivo errado — recusa com mensagem clara.
function analisarMetadados(texto: string): MetaArquivo {
  const linhas = texto.replace(/\r/g,'').split('\n').filter(l => l.trim() !== '');
  const header = (linhas[0] ?? '').split(';').map(h => norm(h));
  const idx: Record<string, number> = {};
  for (const campo of ['versao','vigencia_inicio','vigencia_fim','fonte'] as const) {
    const i = header.findIndex(h => COLS[campo].includes(h));
    if (i >= 0) idx[campo] = i;
  }
  const rotulo: Record<string,string> = { versao:'versao', vigencia_inicio:'vigenciainicio', vigencia_fim:'vigenciafim' };
  const faltando = (['versao','vigencia_inicio','vigencia_fim'] as const).filter(c => idx[c] === undefined).map(c => rotulo[c]);
  // índice do código/NCM: usado só para PULAR cabeçalhos embutidos. Ao concatenar as tabelas de um ZIP
  // multi-UF, cada arquivo traz sua própria linha de cabeçalho — sem este guard, a palavra
  // literal "versao"/"vigenciainicio" entraria nos conjuntos e o arquivo (legítimo, multi-UF) seria
  // recusado como heterogêneo. Só linhas com código numérico contam para a checagem.
  const iNcm = header.findIndex(h => COLS.ncm.includes(h));
  const sVer = new Set<string>(); const sIni = new Set<string>(); const sFim = new Set<string>(); const sFonte = new Set<string>();
  for (let i = 1; i < linhas.length; i++) {
    const c = linhas[i].split(';');
    const cod = (c[iNcm >= 0 ? iNcm : 0] ?? '').replace(/\D/g,'');
    if (!cod) continue; // cabeçalho embutido (ZIP multi-CSV) ou linha sem código — não conta
    if (idx.versao !== undefined) { const v = (c[idx.versao] ?? '').trim(); if (v) sVer.add(v); }
    if (idx.vigencia_inicio !== undefined) { const v = (c[idx.vigencia_inicio] ?? '').trim(); if (v) sIni.add(v); }
    if (idx.vigencia_fim !== undefined) { const v = (c[idx.vigencia_fim] ?? '').trim(); if (v) sFim.add(v); }
    if (idx.fonte !== undefined) { const v = (c[idx.fonte] ?? '').trim(); if (v) sFonte.add(v); }
  }
  const mistos: string[] = [];
  if (sVer.size > 1) mistos.push(`versões diferentes (${[...sVer].slice(0,4).join(', ')}${sVer.size>4?'…':''})`);
  if (sIni.size > 1) mistos.push(`vigência início diferente (${[...sIni].slice(0,4).join(', ')}${sIni.size>4?'…':''})`);
  if (sFim.size > 1) mistos.push(`vigência fim diferente (${[...sFim].slice(0,4).join(', ')}${sFim.size>4?'…':''})`);
  const erro = mistos.length
    ? `Arquivo heterogêneo: ${mistos.join(' · ')}. A tabela do IBPT é homogênea — provavelmente é o arquivo errado. Baixe uma única versão/vigência.`
    : null;
  return {
    versao: [...sVer][0] ?? null,
    vigIni: paraDataIso([...sIni][0] ?? ''),
    vigFim: paraDataIso([...sFim][0] ?? ''),
    fonte: [...sFonte][0] ?? null,
    faltando, erro,
  };
}

// UF vem do NOME do arquivo do IBPT: TabelaIBPTaxSC26.2.B → 'SC'. Fallback quando o CSV não tem coluna UF.
function ufDoNome(nome: string): string | undefined {
  const m = nome.match(/IBPTax([A-Za-z]{2})/);
  return m ? m[1].toUpperCase() : undefined;
}
// só o BASENAME (o ZIP pode ter pastas)
function baseName(p: string): string { return p.split('/').pop() ?? p; }

export interface EntradaTabela { nome: string; texto: string; uf?: string }
export interface ClassificacaoArquivos {
  entradas: EntradaTabela[];               // tabelas IBPT (TabelaIBPTax*.csv/.txt) para processar
  ignorados: string[];                     // Cartaz*/Manual*/Material*/Tutorial*/PDF — ignorados em silêncio
  recusados: { nome: string; motivo: string }[]; // TabelaIBPTax em formato errado (xls/pdf) — recusar com mensagem
}

// Classifica os arquivos: processa SOMENTE "TabelaIBPTax*" em CSV/TXT (a UF vem do nome). Ignora o
// material de divulgação (Cartaz/Manual/Material/Tutorial/PDF). Recusa uma Tabela que venha como
// XLS/PDF (WPS mostra "Planilha XLS" por associação; o arquivo do IBPT é CSV com ';'). Não parseia XLS.
async function classificarArquivos(file: File): Promise<ClassificacaoArquivos> {
  const dec = new TextDecoder('iso-8859-1'); // IBPT costuma vir em Latin-1 (acento na descrição)
  const entradas: EntradaTabela[] = [];
  const ignorados: string[] = [];
  const recusados: { nome: string; motivo: string }[] = [];
  const ehTabela = (n: string) => /tabelaibptax/i.test(n);
  const ehCsv = (n: string) => /\.(csv|txt)$/i.test(n);
  const ehBloqueado = (n: string) => /\.(xls|xlsx|pdf)$/i.test(n);

  if (file.name.toLowerCase().endsWith('.zip')) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    for (const caminho of Object.keys(zip.files)) {
      if (zip.files[caminho].dir) continue;
      const nome = baseName(caminho);
      if (ehTabela(nome) && ehCsv(nome)) {
        entradas.push({ nome, texto: dec.decode(await zip.files[caminho].async('uint8array')), uf: ufDoNome(nome) });
      } else if (ehTabela(nome) && ehBloqueado(nome)) {
        recusados.push({ nome, motivo: 'Tabela em formato XLS/PDF — o importador lê CSV (;). Exporte/baixe a tabela como CSV.' });
      } else {
        ignorados.push(nome); // Cartaz/Manual/Material/Tutorial/PDF e quaisquer outros
      }
    }
    if (entradas.length === 0 && recusados.length === 0) {
      throw new Error('O ZIP não tem nenhuma "TabelaIBPTax*.csv". Confira se baixou a tabela (não só o cartaz/material).');
    }
    return { entradas, ignorados, recusados };
  }

  // arquivo único (não-ZIP)
  const nome = baseName(file.name);
  if (ehBloqueado(nome)) {
    recusados.push({ nome, motivo: 'Arquivo XLS/PDF — parece o cartaz/material de divulgação. Suba a TabelaIBPTax em CSV (;).' });
    return { entradas, ignorados, recusados };
  }
  entradas.push({ nome, texto: dec.decode(new Uint8Array(await file.arrayBuffer())), uf: ufDoNome(nome) });
  return { entradas, ignorados, recusados };
}

function parseCsv(texto: string): { rows: Linha[]; header: string[] } {
  const linhas = texto.replace(/\r/g,'').split('\n').filter(l => l.trim() !== '');
  if (linhas.length < 2) throw new Error('Arquivo vazio ou só com cabeçalho.');
  const header = linhas[0].split(';').map(h => norm(h));
  const idx: Record<string, number> = {};
  for (const [campo, nomes] of Object.entries(COLS)) {
    const i = header.findIndex(h => nomes.includes(h));
    if (i >= 0) idx[campo] = i;
  }
  const faltando = (['ncm','nacional_federal','importado_federal','estadual','municipal'] as const).filter(c => idx[c] === undefined);
  if (faltando.length) {
    throw new Error(`Cabeçalho não reconhecido. Faltam colunas: ${faltando.join(', ')}. Cabeçalho lido: [${header.join(' | ')}]. Confirme que é o CSV do IBPT (separado por ;).`);
  }
  const rows: Linha[] = [];
  for (let i = 1; i < linhas.length; i++) {
    const c = linhas[i].split(';');
    const ncm = (c[idx.ncm] ?? '').replace(/\D/g,'');
    if (!ncm) continue;
    rows.push({
      ncm,
      uf: idx.uf !== undefined ? (c[idx.uf] ?? '').trim().toUpperCase() : undefined,
      nacional_federal: c[idx.nacional_federal] ?? '0',
      importado_federal: c[idx.importado_federal] ?? '0',
      estadual: c[idx.estadual] ?? '0',
      municipal: c[idx.municipal] ?? '0',
      ex_tipi: idx.ex_tipi !== undefined ? (c[idx.ex_tipi] ?? '').trim() : undefined,
      tipo: idx.tipo !== undefined ? (c[idx.tipo] ?? '').trim() : undefined,
      descricao: idx.descricao !== undefined ? (c[idx.descricao] ?? '').trim() : undefined,
      chave: idx.chave !== undefined ? (c[idx.chave] ?? '').trim() : undefined,
    });
  }
  return { rows, header: linhas[0].split(';') };
}

export default function IbptImportPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [versao, setVersao] = useState('');
  const [vigIni, setVigIni] = useState('');
  const [vigFim, setVigFim] = useState('');
  const [uf, setUf] = useState(''); // vazio = usar coluna UF do arquivo
  const [fonte, setFonte] = useState('IBPT');
  const [rodando, setRodando] = useState(false);
  const [prog, setProg] = useState<{ enviados:number; total:number } | null>(null);
  const [msg, setMsg] = useState<{ ok:boolean; texto:string } | null>(null);
  // auto-preenchimento a partir do arquivo (dado que existe no arquivo não se digita)
  const [analisando, setAnalisando] = useState(false);
  const [avisoArquivo, setAvisoArquivo] = useState<{ ok:boolean; texto:string } | null>(null);
  const [arquivoInvalido, setArquivoInvalido] = useState(false); // heterogêneo → bloqueia importar

  // Ao escolher o arquivo: lê a 1ª linha de dados e pré-preenche versão/vigência/fonte (editáveis).
  // Valida homogeneidade (recusa se misturado) e avisa qual coluna faltou (aí sim, manual).
  async function aoEscolherArquivo(f: File | null) {
    setFile(f); setMsg(null); setAvisoArquivo(null); setArquivoInvalido(false);
    if (!f) return;
    setAnalisando(true);
    try {
      const cls = await classificarArquivos(f);
      const resumoArquivos = `${cls.entradas.length} tabela(s)${cls.ignorados.length ? `, ${cls.ignorados.length} ignorado(s) (cartaz/material)` : ''}${cls.recusados.length ? `, ${cls.recusados.length} recusado(s)` : ''}`;
      if (cls.entradas.length === 0) {
        setArquivoInvalido(true);
        setAvisoArquivo({ ok:false, texto:`Nenhuma TabelaIBPTax*.csv encontrada (${resumoArquivos}).${cls.recusados[0] ? ' ' + cls.recusados[0].motivo : ''}` });
        return;
      }
      // metadados só das TABELAS (cartaz/material não contam). Concatena para checar homogeneidade.
      const m = analisarMetadados(cls.entradas.map(e => e.texto).join('\n'));
      if (m.erro) { setArquivoInvalido(true); setAvisoArquivo({ ok:false, texto:m.erro }); return; }
      if (m.versao) setVersao(m.versao);
      if (m.vigIni) setVigIni(m.vigIni);
      if (m.vigFim) setVigFim(m.vigFim);
      if (m.fonte) setFonte(m.fonte);
      const partesMeta = [m.versao && `versão ${m.versao}`, (m.vigIni && m.vigFim) && `vigência ${m.vigIni} a ${m.vigFim}`, m.fonte && `fonte ${m.fonte}`].filter(Boolean);
      const ufs = [...new Set(cls.entradas.map(e => e.uf).filter(Boolean))];
      const base = `${resumoArquivos}${ufs.length ? ` · UF: ${ufs.join(', ')}` : ''}. `;
      if (m.faltando.length) {
        setAvisoArquivo({ ok:false, texto:`${base}Faltou no cabeçalho: ${m.faltando.join(', ')}. Preencha à mão.` });
      } else {
        setAvisoArquivo({ ok:true, texto:`${base}Pré-preenchido (${partesMeta.join(' · ')}). Confira e importe.` });
      }
    } catch (e) {
      setAvisoArquivo({ ok:false, texto: e instanceof Error ? e.message : 'Não consegui ler o arquivo.' });
    } finally { setAnalisando(false); }
  }

  useEffect(() => { (async () => {
    const { data:{ user } } = await supabase.auth.getUser();
    if (!user) { setIsAdmin(false); return; }
    const { data } = await supabase.from('users').select('system_role,is_robo').eq('id', user.id).single();
    setIsAdmin((data?.system_role === 'PS_ADMIN' || data?.system_role === 'PS_ADMIN_CVM') && data?.is_robo !== true);
  })(); }, []);

  async function importar() {
    setMsg(null); setProg(null);
    if (!file) { setMsg({ ok:false, texto:'Selecione o arquivo CSV ou ZIP do IBPT.' }); return; }
    if (arquivoInvalido) { setMsg({ ok:false, texto:'Arquivo heterogêneo (mais de uma versão/vigência). Corrija o arquivo antes de importar.' }); return; }
    if (!versao.trim()) { setMsg({ ok:false, texto:'Informe a versão da tabela (ex.: 26.1.C).' }); return; }
    if (!vigIni || !vigFim) { setMsg({ ok:false, texto:'Informe a vigência (início e fim).' }); return; }
    setRodando(true);
    try {
      const cls = await classificarArquivos(file);
      if (cls.entradas.length === 0) {
        throw new Error(`Nenhuma TabelaIBPTax*.csv para processar.${cls.recusados[0] ? ' ' + cls.recusados[0].motivo : ''}`);
      }
      // parseia CADA tabela e anexa a UF do NOME do arquivo quando a linha não traz coluna UF
      // (arquivo por UF: TabelaIBPTaxSC…). Junta tudo num só conjunto de linhas.
      const rows: Linha[] = [];
      for (const entrada of cls.entradas) {
        const { rows: rowsArq } = parseCsv(entrada.texto);
        for (const r of rowsArq) {
          if (!(r.uf ?? '').trim() && entrada.uf) r.uf = entrada.uf;
          rows.push(r);
        }
      }
      if (rows.some(r => !(r.uf ?? '').trim()) && !uf.trim()) {
        throw new Error('Há linhas sem UF (nem na coluna, nem no nome do arquivo, nem no campo). Informe a UF ou use arquivos nomeados TabelaIBPTax<UF>.');
      }
      // Dedupe por (NCM, EX, UF) — a PK inclui o EX. Linha exatamente repetida (ou colisão residual de
      // uma dimensão que ainda não mapeamos) não pode quebrar o upsert em lote. Última ocorrência vence.
      // Reporta descartadas (se muitas → sinal de dimensão oculta) e quantas linhas têm EX≠0.
      const ufForm = uf.trim().toUpperCase();
      const posPorChave = new Map<string, number>();
      const dedup: Linha[] = [];
      let exNaoZero = 0;
      for (const r of rows) {
        const ex = (r.ex_tipi ?? '').trim() || '0';
        if (ex !== '0') exNaoZero++;
        const ufk = (r.uf ?? '').trim().toUpperCase() || ufForm;
        const k = `${r.ncm}|${ex}|${ufk}`;
        const pos = posPorChave.get(k);
        if (pos !== undefined) dedup[pos] = r; // última vence
        else { posPorChave.set(k, dedup.length); dedup.push(r); }
      }
      const descartadas = rows.length - dedup.length;
      const linhasParaEnviar = dedup;
      const { data:{ session } } = await supabase.auth.getSession();
      const LOTE = 5000;
      let enviados = 0; let totalInseridos = 0; let totalInvalidas = 0;
      let confirmarReset = false; // vira true só se o operador confirmar substituir uma versão já carregada
      setProg({ enviados:0, total:linhasParaEnviar.length });
      for (let i = 0; i < linhasParaEnviar.length; i += LOTE) {
        const lote = linhasParaEnviar.slice(i, i + LOTE);
        const enviar = () => fetch('/api/dev/ibpt-importar', {
          method:'POST',
          headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${session?.access_token || ''}` },
          body: JSON.stringify({
            versao: versao.trim(), vigencia_inicio: vigIni, vigencia_fim: vigFim,
            fonte: fonte.trim() || 'IBPT', uf: uf.trim().toUpperCase() || undefined,
            reset: i === 0, confirmar_reset: i === 0 ? confirmarReset : undefined, rows: lote,
          }),
        });
        let res = await enviar();
        let d = await res.json();
        // GUARDA ANTI-DATA-LOSS: a versão já tem dados → a rota bloqueia (409). Confirma com o operador
        // antes de apagar/substituir. Se ele cancelar, aborta SEM tocar na versão existente.
        if (i === 0 && res.status === 409 && d?.needs_confirm) {
          const ok = window.confirm(`${d.error}\n\nOK = substituir a versão; Cancelar = abortar sem apagar nada.`);
          if (!ok) { setMsg({ ok:false, texto:`Carga cancelada — a versão ${versao.trim()} foi mantida intacta.` }); return; }
          confirmarReset = true;
          res = await enviar(); d = await res.json();
        }
        if (!res.ok || !d.ok) throw new Error(d.error || `Falha no lote ${i / LOTE + 1}.`);
        totalInseridos += d.inseridos || 0; totalInvalidas += d.invalidas || 0;
        enviados += lote.length; setProg({ enviados, total:linhasParaEnviar.length });
      }
      const ufsCarregadas = new Set(linhasParaEnviar.map(r => (r.uf ?? '').trim().toUpperCase() || ufForm)).size;
      setMsg({ ok:true, texto:`Carga concluída: ${totalInseridos.toLocaleString('pt-BR')} linhas · ${ufsCarregadas} UF(s) · versão ${versao.trim()} (vigência ${vigIni} a ${vigFim}).`
        + ` Arquivos: ${cls.entradas.length} tabela(s) processada(s)${cls.ignorados.length ? `, ${cls.ignorados.length} ignorado(s) (cartaz/material)` : ''}${cls.recusados.length ? `, ${cls.recusados.length} recusado(s)` : ''}.`
        + ` ${exNaoZero.toLocaleString('pt-BR')} linha(s) com EX≠0.`
        + (descartadas ? ` ${descartadas.toLocaleString('pt-BR')} duplicata(s) de (NCM,EX,UF) descartada(s) — última venceu${descartadas > rows.length * 0.02 ? ' ⚠️ volume alto: possível dimensão além de NCM/EX/UF, investigar' : ''}.` : ' Sem duplicata de (NCM,EX,UF) — chave íntegra.')
        + (totalInvalidas ? ` ${totalInvalidas} linha(s) inválida(s) ignorada(s).` : '')
        + ' A tabela serve todos os tenants.' });
    } catch (e) {
      setMsg({ ok:false, texto: e instanceof Error ? e.message : 'Erro inesperado.' });
    } finally { setRodando(false); }
  }

  if (isAdmin === null) return <div style={{ padding:24, color:C.txm, background:C.bg, minHeight:'100vh' }}>Carregando…</div>;
  if (!isAdmin) return <div style={{ padding:24, color:C.r, background:C.bg, minHeight:'100vh' }}>Acesso restrito à equipe PS (PS_ADMIN).</div>;

  const inp = { background:'#F0ECE3', color:C.tx, border:`1px solid ${C.bd}`, borderRadius:8, padding:'8px 10px', fontSize:13, fontFamily:'inherit' } as const;

  return (
    <div style={{ fontFamily:"system-ui,-apple-system,'Segoe UI',Roboto,sans-serif", background:C.bg, color:C.tx, minHeight:'100vh' }}>
      <div style={{ background:C.card, padding:'12px 20px', borderBottom:`2px solid ${C.s}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ color:C.s, fontWeight:700, fontSize:16 }}>Importar tabela IBPT (Lei 12.741)</span>
        <a href="/dashboard/dev?dev=ferramentas" style={{ color:C.s, fontSize:12, textDecoration:'none' }}>← Central de Dev</a>
      </div>
      <div style={{ padding:20, maxWidth:720 }}>
        <div style={{ background:C.card, border:`1px solid ${C.bd}`, borderRadius:12, padding:18 }}>
          <div style={{ fontSize:12, color:C.txm, lineHeight:1.6, marginBottom:16 }}>
            A tabela IBPT é <b>única</b> — alíquotas por NCM×UF, iguais para todas as empresas. Uma carga serve <b>todos os tenants</b> (inclusive clientes futuros). A API do IBPT está fora do ar; baixe o CSV/ZIP em <b>deolhonoimposto.ibpt.org.br</b> e suba aqui. O sistema valida o cabeçalho e recusa se divergir.
          </div>
          <div style={{ display:'grid', gap:12 }}>
            <label style={{ display:'grid', gap:4, fontSize:12, color:C.txm }}>Arquivo (CSV ou ZIP do IBPT)
              <input type="file" accept=".csv,.txt,.zip" onChange={e => void aoEscolherArquivo(e.target.files?.[0] ?? null)} style={inp} />
            </label>
            {analisando && <div style={{ fontSize:11.5, color:C.txm }}>Lendo o arquivo…</div>}
            {avisoArquivo && <div style={{ fontSize:11.5, color: avisoArquivo.ok ? C.g : C.r, lineHeight:1.5 }}>{avisoArquivo.ok ? '✓ ' : '⚠️ '}{avisoArquivo.texto}</div>}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <label style={{ display:'grid', gap:4, fontSize:12, color:C.txm }}>Versão (ex.: 26.1.C)
                <input value={versao} onChange={e => setVersao(e.target.value)} placeholder="26.1.C" style={inp} />
              </label>
              <label style={{ display:'grid', gap:4, fontSize:12, color:C.txm }}>UF (deixe vazio se o arquivo já tem a coluna UF)
                <input value={uf} onChange={e => setUf(e.target.value)} placeholder="ex.: SC" maxLength={2} style={inp} />
              </label>
              <label style={{ display:'grid', gap:4, fontSize:12, color:C.txm }}>Vigência início
                <input type="date" value={vigIni} onChange={e => setVigIni(e.target.value)} style={inp} />
              </label>
              <label style={{ display:'grid', gap:4, fontSize:12, color:C.txm }}>Vigência fim
                <input type="date" value={vigFim} onChange={e => setVigFim(e.target.value)} style={inp} />
              </label>
              <label style={{ display:'grid', gap:4, fontSize:12, color:C.txm }}>Fonte
                <input value={fonte} onChange={e => setFonte(e.target.value)} style={inp} />
              </label>
            </div>
            <button onClick={() => void importar()} disabled={rodando || analisando || arquivoInvalido}
              style={{ background: (rodando || analisando || arquivoInvalido) ? '#F0ECE3' : `linear-gradient(135deg,${C.s},#E0B048)`, color: (rodando || analisando || arquivoInvalido) ? C.txm : C.p, border:'none', borderRadius:8, padding:'10px 16px', fontSize:13, fontWeight:600, cursor: (rodando || analisando || arquivoInvalido) ? 'not-allowed' : 'pointer' }}>
              {rodando ? 'Importando…' : analisando ? 'Lendo arquivo…' : 'Importar tabela'}
            </button>
          </div>
          {prog && (
            <div style={{ marginTop:14 }}>
              <div style={{ fontSize:11, color:C.txm, marginBottom:4 }}>{prog.enviados.toLocaleString('pt-BR')} / {prog.total.toLocaleString('pt-BR')} linhas</div>
              <div style={{ height:8, borderRadius:6, background:'#F0ECE3', overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${prog.total ? Math.round(prog.enviados / prog.total * 100) : 0}%`, background:C.s }} />
              </div>
            </div>
          )}
          {msg && <div style={{ marginTop:14, fontSize:12.5, color: msg.ok ? C.g : C.r, lineHeight:1.5 }}>{msg.ok ? '✅ ' : '❌ '}{msg.texto}</div>}
        </div>
      </div>
    </div>
  );
}
