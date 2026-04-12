'use client';
import { useState, useEffect } from 'react';

export default function ClientesPage() {
  const [clientes, setClientes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nome:'', cnpj:'', segmento:'', regime_tributario:'', contato_nome:'', contato_email:'', contato_telefone:'', cidade:'', uf:'SC', num_colaboradores:'', faturamento_anual:'' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { loadClientes(); }, []);
  async function loadClientes() {
    const res = await fetch('/api/assessor/clientes', { credentials:'include' });
    const data = await res.json();
    if (Array.isArray(data)) setClientes(data);
    setLoading(false);
  }

  async function handleSave() {
    setSaving(true); setMsg('');
    const body = { ...form, num_colaboradores: form.num_colaboradores?parseInt(form.num_colaboradores):null, faturamento_anual: form.faturamento_anual?parseFloat(form.faturamento_anual.replace(/\./g,'').replace(',','.')):null };
    const res = await fetch('/api/assessor/clientes', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const data = await res.json();
    if (res.ok) { setMsg('Cadastrado!'); setForm({ nome:'', cnpj:'', segmento:'', regime_tributario:'', contato_nome:'', contato_email:'', contato_telefone:'', cidade:'', uf:'SC', num_colaboradores:'', faturamento_anual:'' }); setShowForm(false); loadClientes(); }
    else setMsg('Erro: '+(data.error||'Falha'));
    setSaving(false);
  }

  const is:any = { width:'100%', padding:'8px 12px', border:'1px solid #ddd', borderRadius:6, fontSize:13, background:'white', color:'#3D2314' };
  const ls:any = { display:'block', fontSize:11, color:'#888', marginBottom:3, fontWeight:600 };
  if (loading) return <div style={{ padding:40, textAlign:'center', color:'#3D2314', fontFamily:'system-ui' }}>Carregando...</div>;

  return (
    <div style={{ fontFamily:'system-ui', background:'#FAF7F2', minHeight:'100vh', padding:24 }}>
      <div style={{ maxWidth:900, margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <div>
            <a href="/dashboard/assessor" style={{ color:'#C8941A', fontSize:12, textDecoration:'none' }}>← Dashboard</a>
            <h1 style={{ color:'#3D2314', fontSize:22, margin:'4px 0 0' }}>Clientes</h1>
          </div>
          <button onClick={()=>setShowForm(!showForm)} style={{ background:'#3D2314', color:'#FAF7F2', border:'none', padding:'10px 20px', borderRadius:8, fontSize:14, cursor:'pointer', fontWeight:600 }}>
            {showForm?'Cancelar':'+ Novo Cliente'}
          </button>
        </div>
        {msg && <div style={{ padding:10, borderRadius:8, background:msg.includes('Erro')?'#F8D7DA':'#D4EDDA', fontSize:13, marginBottom:16 }}>{msg}</div>}
        {showForm && (
          <div style={{ background:'white', borderRadius:12, padding:20, marginBottom:20 }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div><label style={ls}>Nome *</label><input style={is} value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})} /></div>
              <div><label style={ls}>CNPJ</label><input style={is} value={form.cnpj} onChange={e=>setForm({...form,cnpj:e.target.value})} /></div>
              <div><label style={ls}>Segmento</label><input style={is} value={form.segmento} onChange={e=>setForm({...form,segmento:e.target.value})} /></div>
              <div><label style={ls}>Regime Tributario</label>
                <select style={is} value={form.regime_tributario} onChange={e=>setForm({...form,regime_tributario:e.target.value})}>
                  <option value="">Selecione</option><option>Simples Nacional</option><option>Lucro Presumido</option><option>Lucro Real</option>
                </select></div>
              <div><label style={ls}>Contato</label><input style={is} value={form.contato_nome} onChange={e=>setForm({...form,contato_nome:e.target.value})} /></div>
              <div><label style={ls}>Email</label><input style={is} value={form.contato_email} onChange={e=>setForm({...form,contato_email:e.target.value})} /></div>
              <div><label style={ls}>Cidade</label><input style={is} value={form.cidade} onChange={e=>setForm({...form,cidade:e.target.value})} /></div>
              <div><label style={ls}>UF</label><input style={is} value={form.uf} onChange={e=>setForm({...form,uf:e.target.value})} maxLength={2} /></div>
            </div>
            <button onClick={handleSave} disabled={saving||!form.nome} style={{ marginTop:16, background:'#C8941A', color:'white', border:'none', padding:'10px 24px', borderRadius:8, fontSize:14, cursor:'pointer', fontWeight:600 }}>{saving?'Salvando...':'Cadastrar'}</button>
          </div>
        )}
        <div style={{ background:'white', borderRadius:12, padding:20 }}>
          {clientes.length===0 ? <p style={{ color:'#999', fontSize:13, textAlign:'center', padding:20 }}>Nenhum cliente cadastrado.</p> : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead><tr style={{ borderBottom:'2px solid #C8941A' }}>
                {['Nome','CNPJ','Segmento','Cidade/UF','Status'].map(h=><th key={h} style={{ textAlign:'left', padding:8, color:'#3D2314', fontSize:12 }}>{h}</th>)}
              </tr></thead>
              <tbody>{clientes.map((c:any)=>(
                <tr key={c.id} style={{ borderBottom:'1px solid #f0f0f0' }}>
                  <td style={{ padding:8, fontWeight:600 }}>{c.nome}</td>
                  <td style={{ padding:8, color:'#888' }}>{c.cnpj||'-'}</td>
                  <td style={{ padding:8 }}>{c.segmento||'-'}</td>
                  <td style={{ padding:8 }}>{c.cidade?c.cidade+'/'+c.uf:'-'}</td>
                  <td style={{ padding:8 }}><span style={{ background:'#D4EDDA', padding:'2px 8px', borderRadius:8, fontSize:11 }}>{c.status}</span></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
