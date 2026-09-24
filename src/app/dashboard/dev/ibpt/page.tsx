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
};

async function lerArquivo(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const dec = new TextDecoder('iso-8859-1'); // IBPT costuma vir em Latin-1 (acento na descrição)
  if (file.name.toLowerCase().endsWith('.zip')) {
    const zip = await JSZip.loadAsync(buf);
    const partes: string[] = [];
    for (const nome of Object.keys(zip.files)) {
      if (zip.files[nome].dir) continue;
      if (!/\.(csv|txt)$/i.test(nome)) continue;
      partes.push(dec.decode(await zip.files[nome].async('uint8array')));
    }
    if (partes.length === 0) throw new Error('O ZIP não tem nenhum arquivo .csv/.txt dentro.');
    return partes.join('\n');
  }
  return dec.decode(new Uint8Array(buf));
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

  useEffect(() => { (async () => {
    const { data:{ user } } = await supabase.auth.getUser();
    if (!user) { setIsAdmin(false); return; }
    const { data } = await supabase.from('users').select('system_role,is_robo').eq('id', user.id).single();
    setIsAdmin((data?.system_role === 'PS_ADMIN' || data?.system_role === 'PS_ADMIN_CVM') && data?.is_robo !== true);
  })(); }, []);

  async function importar() {
    setMsg(null); setProg(null);
    if (!file) { setMsg({ ok:false, texto:'Selecione o arquivo CSV ou ZIP do IBPT.' }); return; }
    if (!versao.trim()) { setMsg({ ok:false, texto:'Informe a versão da tabela (ex.: 26.1.C).' }); return; }
    if (!vigIni || !vigFim) { setMsg({ ok:false, texto:'Informe a vigência (início e fim).' }); return; }
    setRodando(true);
    try {
      const texto = await lerArquivo(file);
      const { rows } = parseCsv(texto);
      if (idxTemUf(rows) === false && !uf.trim()) {
        throw new Error('O arquivo não tem coluna UF e você não informou a UF. Escolha a UF (o arquivo do IBPT costuma ser por estado).');
      }
      const { data:{ session } } = await supabase.auth.getSession();
      const LOTE = 5000;
      let enviados = 0; let totalInseridos = 0; let totalInvalidas = 0;
      setProg({ enviados:0, total:rows.length });
      for (let i = 0; i < rows.length; i += LOTE) {
        const lote = rows.slice(i, i + LOTE);
        const res = await fetch('/api/dev/ibpt-importar', {
          method:'POST',
          headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${session?.access_token || ''}` },
          body: JSON.stringify({
            versao: versao.trim(), vigencia_inicio: vigIni, vigencia_fim: vigFim,
            fonte: fonte.trim() || 'IBPT', uf: uf.trim().toUpperCase() || undefined,
            reset: i === 0, rows: lote,
          }),
        });
        const d = await res.json();
        if (!res.ok || !d.ok) throw new Error(d.error || `Falha no lote ${i / LOTE + 1}.`);
        totalInseridos += d.inseridos || 0; totalInvalidas += d.invalidas || 0;
        enviados += lote.length; setProg({ enviados, total:rows.length });
      }
      setMsg({ ok:true, texto:`Carga concluída: ${totalInseridos.toLocaleString('pt-BR')} linhas na versão ${versao.trim()} (vigência ${vigIni} a ${vigFim}).${totalInvalidas ? ` ${totalInvalidas} linha(s) ignorada(s).` : ''} A tabela serve todos os tenants.` });
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
              <input type="file" accept=".csv,.txt,.zip" onChange={e => setFile(e.target.files?.[0] ?? null)} style={inp} />
            </label>
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
            <button onClick={() => void importar()} disabled={rodando}
              style={{ background: rodando ? '#F0ECE3' : `linear-gradient(135deg,${C.s},#E0B048)`, color: rodando ? C.txm : C.p, border:'none', borderRadius:8, padding:'10px 16px', fontSize:13, fontWeight:600, cursor: rodando ? 'not-allowed' : 'pointer' }}>
              {rodando ? 'Importando…' : 'Importar tabela'}
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

// arquivo tem coluna UF? (olha se alguma linha trouxe uf preenchida)
function idxTemUf(rows: Linha[]): boolean {
  return rows.some(r => (r.uf ?? '').length === 2);
}
