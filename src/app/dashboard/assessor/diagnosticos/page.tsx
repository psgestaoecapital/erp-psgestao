'use client';
import { useState, useEffect } from 'react';

export default function DiagnosticosPage() {
  const [clientes, setClientes] = useState<any[]>([]);
  const [diagnosticos, setDiagnosticos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState<string|null>(null);
  const [form, setForm] = useState({ cliente_id:'', titulo:'', tipo:'completo' });
  const [importData, setImportData] = useState({ csv:'', tipo_abc:'clientes' });
  const [abcResult, setAbcResult] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);
  async function load() {
    const [cliRes, diagRes] = await Promise.all([
      fetch('/api/assessor/clientes', { credentials:'include' }),
      fetch('/api/assessor/diagnostico', { credentials:'include' })
    ]);
    const cliData = await cliRes.json();
    const diagData = await diagRes.json();
    setClientes(Array.isArray(cliData)?cliData:[]);
    setDiagnosticos(Array.isArray(diagData)?diagData:[]);
    setLoading(false);
  }

  async function createDiag() {
    setSaving(true);
    const res = await fetch('/api/assessor/diagnostico', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify(form) });
    if (res.ok) { setShowNew(false); setMsg('Diagnostico criado!'); load(); }
    else { const d=await res.json(); setMsg('Erro: '+d.error); }
    setSaving(false);
  }

  async function runImport(diagId: string) {
    setSaving(true); setAbcResult(null);
    const res = await fetch('/api/assessor/import', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ diagnostico_id:diagId, dados_csv:importData.csv, tipo_abc:importData.tipo_abc }) });
    const data = await res.json();
    if (res.ok) { setAbcResult(data.abc); setMsg('Curva ABC gerada!'); load(); }
    else setMsg('Erro: '+data.error);
    setSaving(false);
  }

  const is:any = { width:'100%', padding:'8px 12px', border:'1px solid #ddd', borderRadius:6, fontSize:13, background:'white', color:'#3D2314' };
  if (loading) return <div style={{ padding:40, textAlign:'center', fontFamily:'system-ui' }}>Carregando...</div>;

  return (
    <div style={{ fontFamily:'system-ui', background:'#FAF7F2', minHeight:'100vh', padding:24 }}>
      <div style={{ maxWidth:960, margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <div>
            <a href="/dashboard/assessor" style={{ color:'#C8941A', fontSize:12, textDecoration:'none' }}>← Dashboard</a>
            <h1 style={{ color:'#3D2314', fontSize:22, margin:'4px 0 0' }}>Diagnosticos</h1>
          </div>
          <button onClick={()=>setShowNew(!showNew)} style={{ background:'#3D2314', color:'#FAF7F2', border:'none', padding:'10px 20px', borderRadius:8, fontSize:14, cursor:'pointer', fontWeight:600 }}>
            {showNew?'Cancelar':'+ Novo Diagnostico'}
          </button>
        </div>
        {msg && <div style={{ padding:10, borderRadius:8, background:msg.includes('Erro')?'#F8D7DA':'#D4EDDA', fontSize:13, marginBottom:16 }}>{msg}</div>}
        {showNew && (
          <div style={{ background:'white', borderRadius:12, padding:20, marginBottom:20 }}>
            <div style={{ display:'grid', gap:12 }}>
              <select style={is} value={form.cliente_id} onChange={e=>setForm({...form,cliente_id:e.target.value})}>
                <option value="">Selecione o cliente...</option>
                {clientes.map((c:any)=><option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
              <input style={is} value={form.titulo} onChange={e=>setForm({...form,titulo:e.target.value})} placeholder="Titulo (ex: Diagnostico 360 - Abr/2026)" />
              <select style={is} value={form.tipo} onChange={e=>setForm({...form,tipo:e.target.value})}>
                <option value="completo">Completo (360)</option><option value="express">Express</option><option value="setorial">Setorial</option>
              </select>
              <button onClick={createDiag} disabled={saving||!form.cliente_id||!form.titulo} style={{ background:'#C8941A', color:'white', border:'none', padding:'10px', borderRadius:8, fontSize:14, cursor:'pointer', fontWeight:600 }}>{saving?'Criando...':'Criar Diagnostico'}</button>
            </div>
          </div>
        )}
        {showImport && (
          <div style={{ background:'white', borderRadius:12, padding:20, marginBottom:20, border:'2px solid #C8941A' }}>
            <h3 style={{ color:'#3D2314', fontSize:15, marginBottom:4 }}>Importar Dados — Curva ABC</h3>
            <p style={{ color:'#888', fontSize:12, marginBottom:12 }}>Cole dados CSV (separados por ; ou ,) com colunas nome + valor</p>
            <select style={{...is,marginBottom:8}} value={importData.tipo_abc} onChange={e=>setImportData({...importData,tipo_abc:e.target.value})}>
              <option value="clientes">ABC Clientes</option><option value="produtos">ABC Produtos</option><option value="fornecedores">ABC Fornecedores</option>
            </select>
            <textarea style={{...is,height:150,fontFamily:'monospace',fontSize:11}} value={importData.csv} onChange={e=>setImportData({...importData,csv:e.target.value})}
              placeholder={"Cliente;Valor Total\nEmpresa A;500000\nEmpresa B;300000"} />
            <div style={{ display:'flex', gap:8, marginTop:8 }}>
              <button onClick={()=>runImport(showImport)} disabled={saving||!importData.csv} style={{ background:'#C8941A', color:'white', border:'none', padding:'8px 20px', borderRadius:8, fontSize:13, cursor:'pointer', fontWeight:600 }}>{saving?'Processando...':'Gerar Curva ABC'}</button>
              <button onClick={()=>{setShowImport(null);setAbcResult(null);}} style={{ background:'#eee', color:'#3D2314', border:'none', padding:'8px 20px', borderRadius:8, fontSize:13, cursor:'pointer' }}>Fechar</button>
            </div>
            {abcResult && (
              <div style={{ marginTop:12, padding:12, background:'#FAF7F2', borderRadius:8 }}>
                <div style={{ fontSize:14, fontWeight:700, color:'#3D2314' }}>Curva ABC Gerada</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginTop:8, fontSize:12 }}>
                  <div><strong style={{ color:'#2D8B4E' }}>A:</strong> {abcResult.qtd_a}</div>
                  <div><strong style={{ color:'#F39C12' }}>B:</strong> {abcResult.qtd_b}</div>
                  <div><strong style={{ color:'#C0392B' }}>C:</strong> {abcResult.qtd_c}</div>
                  <div><strong>Total:</strong> R$ {abcResult.total_valor?.toLocaleString('pt-BR')}</div>
                </div>
              </div>
            )}
          </div>
        )}
        <div style={{ background:'white', borderRadius:12, padding:20 }}>
          {diagnosticos.length===0 ? <p style={{ color:'#999', fontSize:13, textAlign:'center', padding:20 }}>Nenhum diagnostico ainda.</p> :
            diagnosticos.map((d:any)=>(
              <div key={d.id} style={{ borderBottom:'1px solid #f0f0f0', padding:'12px 0' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div>
                    <div style={{ fontWeight:600, color:'#3D2314' }}>{d.titulo}</div>
                    <div style={{ fontSize:12, color:'#888' }}>{d.clientes_assessoria?.nome} | {d.tipo} | {new Date(d.created_at).toLocaleDateString('pt-BR')}</div>
                    {d.diagnostico_curvas_abc?.length>0 && <div style={{ fontSize:11, color:'#C8941A', marginTop:4 }}>{d.diagnostico_curvas_abc.map((a:any)=>a.tipo+': A='+a.qtd_a+' B='+a.qtd_b+' C='+a.qtd_c).join(' | ')}</div>}
                  </div>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    <span style={{ background:d.status==='concluido'?'#D4EDDA':d.status==='em_andamento'?'#FFF3CD':'#F0F0F0', padding:'3px 10px', borderRadius:12, fontSize:11 }}>{d.status}</span>
                    <button onClick={()=>setShowImport(showImport===d.id?null:d.id)} style={{ background:'#3D2314', color:'#FAF7F2', border:'none', padding:'6px 12px', borderRadius:6, fontSize:12, cursor:'pointer' }}>Importar</button>
                  </div>
                </div>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}
