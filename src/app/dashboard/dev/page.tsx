'use client';
import { useState, useEffect, useRef } from 'react';

const C = { p:'#3D2314', s:'#C8941A', f:'#FAF7F2', bg:'#1A1208', card:'#2A1A0E', g:'#2D8B4E', r:'#C0392B' };

export default function DevPage() {
  const [tab, setTab] = useState('chat');

  return (
    <div style={{ fontFamily:"'Courier New',monospace", background:C.bg, color:C.f, minHeight:'100vh' }}>
      {/* Header */}
      <div style={{ background:C.card, padding:'12px 20px', borderBottom:'2px solid '+C.s, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <span style={{ color:C.s, fontWeight:700, fontSize:16 }}>{'</>'} DEV MODULE</span>
          <span style={{ color:'#666', fontSize:11, marginLeft:12 }}>PS Gestao ERP</span>
        </div>
        <a href="/dashboard" style={{ color:C.s, fontSize:12, textDecoration:'none' }}>← Dashboard</a>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:'1px solid #333', background:C.card }}>
        {[
          { id:'chat', label:'Chat Dev', icon:'💬' },
          { id:'deploy', label:'Deploy', icon:'🚀' },
          { id:'sql', label:'SQL Editor', icon:'🗄' },
          { id:'files', label:'Arquivos', icon:'📁' },
        ].map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{ background:tab===t.id?C.p:'transparent', color:tab===t.id?C.s:C.f, border:'none', padding:'10px 18px', fontSize:12, cursor:'pointer', fontFamily:'inherit', borderBottom:tab===t.id?'2px solid '+C.s:'2px solid transparent' }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div style={{ padding:16 }}>
        {tab === 'chat' && <ChatDev />}
        {tab === 'deploy' && <DeployManager />}
        {tab === 'sql' && <SQLEditor />}
        {tab === 'files' && <FileExplorer />}
      </div>
    </div>
  );
}

// ============================================================
// CHAT DEV
// ============================================================
function ChatDev() {
  const [messages, setMessages] = useState<{role:string;content:string}[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState('');
  const chatRef = useRef<HTMLDivElement>(null);

  async function send() {
    if (!input.trim() || loading) return;
    const newMsg = { role: 'user', content: input.trim() };
    const updated = [...messages, newMsg];
    setMessages(updated);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/dev/chat', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updated })
      });
      const data = await res.json();
      if (data.content) {
        setMessages([...updated, { role: 'assistant', content: data.content }]);
        setModel(data.model || '');
      } else {
        setMessages([...updated, { role: 'assistant', content: 'Erro: ' + (data.error || 'Sem resposta') }]);
      }
    } catch (e: any) {
      setMessages([...updated, { role: 'assistant', content: 'Erro: ' + e.message }]);
    }
    setLoading(false);
    setTimeout(() => chatRef.current?.scrollTo(0, chatRef.current.scrollHeight), 100);
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 120px)' }}>
      <div ref={chatRef} style={{ flex:1, overflowY:'auto', padding:8 }}>
        {messages.length === 0 && (
          <div style={{ textAlign:'center', padding:40, color:'#666' }}>
            <div style={{ fontSize:32, marginBottom:8 }}>💬</div>
            <div style={{ fontSize:14 }}>Chat Dev — Claude integrado ao ERP</div>
            <div style={{ fontSize:11, marginTop:8, color:'#555' }}>Pergunte sobre o sistema, peca codigo, debug — tudo aqui dentro</div>
            <div style={{ display:'flex', gap:8, justifyContent:'center', marginTop:16, flexWrap:'wrap' }}>
              {['Gere a rota para...','Qual o status do deploy?','Monte o SQL para...','Corrija o bug em...'].map((s,i) => (
                <button key={i} onClick={()=>setInput(s)} style={{ background:C.card, color:C.s, border:'1px solid #333', padding:'6px 12px', borderRadius:6, fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom:12, display:'flex', justifyContent:m.role==='user'?'flex-end':'flex-start' }}>
            <div style={{
              maxWidth:'85%', padding:'10px 14px', borderRadius:12,
              background: m.role==='user' ? C.p : C.card,
              border: m.role==='user' ? 'none' : '1px solid #333',
              color: C.f, fontSize:13, lineHeight:1.5, whiteSpace:'pre-wrap', wordBreak:'break-word'
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ marginBottom:12 }}>
            <div style={{ background:C.card, border:'1px solid #333', padding:'10px 14px', borderRadius:12, color:C.s, fontSize:13, display:'inline-block' }}>
              Pensando...
            </div>
          </div>
        )}
      </div>
      <div style={{ display:'flex', gap:8, padding:'8px 0', borderTop:'1px solid #333' }}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&send()}
          placeholder="Pergunte algo sobre o sistema..."
          style={{ flex:1, background:C.card, color:C.f, border:'1px solid #444', borderRadius:8, padding:'10px 14px', fontSize:13, fontFamily:'inherit', outline:'none' }} />
        <button onClick={send} disabled={loading||!input.trim()}
          style={{ background:C.s, color:C.bg, border:'none', padding:'10px 20px', borderRadius:8, fontSize:13, cursor:'pointer', fontFamily:'inherit', fontWeight:700, opacity:loading?0.5:1 }}>
          Enviar
        </button>
      </div>
      {model && <div style={{ fontSize:10, color:'#555', textAlign:'right' }}>Modelo: {model}</div>}
    </div>
  );
}

// ============================================================
// DEPLOY MANAGER
// ============================================================
function DeployManager() {
  const [path, setPath] = useState('');
  const [content, setContent] = useState('');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [queue, setQueue] = useState<{path:string;content:string;status:string}[]>([]);

  function addToQueue() {
    if (!path.trim() || !content.trim()) return;
    setQueue([...queue, { path: path.trim(), content, status: 'pendente' }]);
    setPath(''); setContent('');
  }

  async function deployOne(filePath: string, fileContent: string, index: number) {
    const updated = [...queue];
    updated[index].status = 'deployando';
    setQueue([...updated]);

    const res = await fetch('/api/dev/deploy', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ path: filePath, content: fileContent, message: message || 'Deploy via Dev Module' })
    });
    const data = await res.json();
    updated[index].status = data.success ? 'ok' : 'erro';
    setQueue([...updated]);
    return data;
  }

  async function deployAll() {
    setLoading(true);
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].status === 'pendente') {
        await deployOne(queue[i].path, queue[i].content, i);
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    setLoading(false);
  }

  async function deploySingle() {
    if (!path.trim() || !content.trim()) return;
    setLoading(true);
    const res = await fetch('/api/dev/deploy', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ path: path.trim(), content, message: message || 'Deploy via Dev Module' })
    });
    setResult(await res.json());
    setLoading(false);
  }

  const is: any = { width:'100%', padding:'8px 12px', border:'1px solid #444', borderRadius:6, fontSize:12, background:C.card, color:C.f, fontFamily:'inherit' };

  return (
    <div>
      <div style={{ display:'grid', gap:10 }}>
        <input style={is} value={path} onChange={e=>setPath(e.target.value)} placeholder="Caminho do arquivo (ex: src/app/api/teste/route.ts)" />
        <input style={is} value={message} onChange={e=>setMessage(e.target.value)} placeholder="Mensagem do commit (opcional)" />
        <textarea style={{...is, height:250, fontSize:11}} value={content} onChange={e=>setContent(e.target.value)} placeholder="Cole o conteudo do arquivo aqui..." />
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={deploySingle} disabled={loading||!path||!content}
            style={{ background:C.g, color:'white', border:'none', padding:'8px 20px', borderRadius:6, fontSize:12, cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>
            {loading ? 'Deployando...' : '🚀 Deploy Direto'}
          </button>
          <button onClick={addToQueue} disabled={!path||!content}
            style={{ background:C.s, color:C.bg, border:'none', padding:'8px 20px', borderRadius:6, fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>
            + Adicionar a Fila
          </button>
          {queue.length > 0 && (
            <button onClick={deployAll} disabled={loading}
              style={{ background:C.p, color:C.f, border:'none', padding:'8px 20px', borderRadius:6, fontSize:12, cursor:'pointer', fontFamily:'inherit', fontWeight:700 }}>
              ⚡ Deploy Fila ({queue.filter(q=>q.status==='pendente').length})
            </button>
          )}
        </div>
      </div>

      {result && (
        <div style={{ marginTop:12, padding:12, borderRadius:8, background: result.success?'rgba(45,139,78,0.2)':'rgba(192,57,43,0.2)', border:'1px solid '+(result.success?C.g:C.r), fontSize:12 }}>
          {result.success ? '✅ '+result.path+' — commit '+result.commit : '❌ '+result.error}
        </div>
      )}

      {queue.length > 0 && (
        <div style={{ marginTop:16 }}>
          <div style={{ fontSize:13, fontWeight:700, color:C.s, marginBottom:8 }}>Fila de Deploy ({queue.length})</div>
          {queue.map((q, i) => (
            <div key={i} style={{ padding:'6px 12px', marginBottom:4, borderRadius:6, background:C.card, border:'1px solid #333', fontSize:11, display:'flex', justifyContent:'space-between' }}>
              <span>{q.path}</span>
              <span style={{ color: q.status==='ok'?C.g:q.status==='erro'?C.r:q.status==='deployando'?'#3498DB':C.s }}>
                {q.status==='ok'?'✅':q.status==='erro'?'❌':q.status==='deployando'?'⏳':'⏸'} {q.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// SQL EDITOR
// ============================================================
function SQLEditor() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

  async function runQuery() {
    if (!query.trim()) return;
    setLoading(true); setResult(null);
    const res = await fetch('/api/dev/sql', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ query: query.trim() })
    });
    const data = await res.json();
    setResult(data);
    setHistory(prev => [query.trim(), ...prev.slice(0, 19)]);
    setLoading(false);
  }

  const is: any = { width:'100%', padding:'10px 14px', border:'1px solid #444', borderRadius:6, fontSize:12, background:C.card, color:C.f, fontFamily:"'Courier New',monospace" };

  return (
    <div>
      <textarea style={{...is, height:150}} value={query} onChange={e=>setQuery(e.target.value)}
        placeholder={"SELECT * FROM modulos_sistema ORDER BY ordem;\n\n-- Exemplos rapidos:\n-- SELECT * FROM assessorias;\n-- SELECT * FROM permissoes_nivel WHERE nivel = 'administrador';\n-- SELECT * FROM planos_licenca;"} />
      <div style={{ display:'flex', gap:8, margin:'8px 0' }}>
        <button onClick={runQuery} disabled={loading||!query.trim()}
          style={{ background:C.g, color:'white', border:'none', padding:'8px 20px', borderRadius:6, fontSize:12, cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>
          {loading ? 'Executando...' : '▶ Executar'}
        </button>
        <button onClick={()=>setQuery('')}
          style={{ background:'#333', color:C.f, border:'none', padding:'8px 16px', borderRadius:6, fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>
          Limpar
        </button>
        {history.length > 0 && (
          <select style={{ background:C.card, color:C.f, border:'1px solid #444', borderRadius:6, padding:'4px 8px', fontSize:11, fontFamily:'inherit' }}
            onChange={e => { if (e.target.value) setQuery(e.target.value); }} defaultValue="">
            <option value="">Historico...</option>
            {history.map((h, i) => <option key={i} value={h}>{h.substring(0, 60)}...</option>)}
          </select>
        )}
      </div>

      {result && (
        <div style={{ marginTop:8 }}>
          {result.error ? (
            <div style={{ padding:12, borderRadius:8, background:'rgba(192,57,43,0.15)', border:'1px solid '+C.r, fontSize:12, color:C.r }}>
              ❌ {result.error}
              {result.hint && <div style={{ color:'#888', marginTop:4, fontSize:11 }}>{result.hint}</div>}
            </div>
          ) : result.data ? (
            <div>
              <div style={{ fontSize:11, color:C.g, marginBottom:6 }}>✅ {result.rows || (Array.isArray(result.data) ? result.data.length : 1)} resultado(s)</div>
              <div style={{ overflowX:'auto', maxHeight:400, overflowY:'auto' }}>
                {Array.isArray(result.data) && result.data.length > 0 ? (
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11, fontFamily:'inherit' }}>
                    <thead>
                      <tr>{Object.keys(result.data[0]).map(k => (
                        <th key={k} style={{ textAlign:'left', padding:'6px 8px', borderBottom:'1px solid '+C.s, color:C.s, whiteSpace:'nowrap' }}>{k}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {result.data.slice(0, 50).map((row: any, i: number) => (
                        <tr key={i} style={{ borderBottom:'1px solid #222' }}>
                          {Object.values(row).map((v: any, j: number) => (
                            <td key={j} style={{ padding:'4px 8px', color:C.f, maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                              {v === null ? <span style={{ color:'#555' }}>null</span> : typeof v === 'object' ? JSON.stringify(v).substring(0, 50) : String(v)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <pre style={{ color:C.f, fontSize:11 }}>{JSON.stringify(result.data, null, 2)}</pre>
                )}
              </div>
            </div>
          ) : (
            <div style={{ fontSize:12, color:C.g }}>✅ Query executada</div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// FILE EXPLORER
// ============================================================
function FileExplorer() {
  const [files, setFiles] = useState<any[]>([]);
  const [currentPath, setCurrentPath] = useState('src/app');
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadFiles(currentPath); }, [currentPath]);

  async function loadFiles(path: string) {
    setLoading(true);
    const res = await fetch('/api/dev/deploy?path=' + encodeURIComponent(path), { credentials:'include' });
    const data = await res.json();
    setFiles(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  function navigate(item: any) {
    if (item.type === 'dir') {
      setCurrentPath(item.path);
    }
  }

  function goUp() {
    const parts = currentPath.split('/');
    if (parts.length > 1) {
      parts.pop();
      setCurrentPath(parts.join('/'));
    }
  }

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
        <button onClick={goUp} style={{ background:C.card, color:C.s, border:'1px solid #444', padding:'4px 10px', borderRadius:4, fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>⬆</button>
        <div style={{ fontSize:12, color:C.s, fontFamily:'monospace' }}>/{currentPath}</div>
      </div>

      {loading ? <div style={{ color:'#666', fontSize:12 }}>Carregando...</div> : (
        <div>
          {files.sort((a,b) => (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) || a.name.localeCompare(b.name)).map((f, i) => (
            <div key={i} onClick={() => navigate(f)}
              style={{ padding:'6px 12px', marginBottom:2, borderRadius:4, background:C.card, border:'1px solid #222', fontSize:12, cursor:f.type==='dir'?'pointer':'default', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span>
                <span style={{ marginRight:8 }}>{f.type === 'dir' ? '📁' : f.name.endsWith('.tsx')?'⚛':'📄'}</span>
                <span style={{ color: f.type==='dir'?C.s:C.f }}>{f.name}</span>
              </span>
              {f.size && <span style={{ color:'#555', fontSize:10 }}>{(f.size/1024).toFixed(1)}kb</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
