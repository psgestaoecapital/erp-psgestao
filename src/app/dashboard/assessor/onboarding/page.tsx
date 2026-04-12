'use client';
import { useState, useEffect } from 'react';

export default function OnboardingPage() {
  const [form, setForm] = useState({ nome:'', cnpj:'', nome_fantasia:'', email_contato:'', telefone:'', cor_primaria:'#3D2314', cor_secundaria:'#C8941A', cor_fundo:'#FAF7F2' });
  const [saving, setSaving] = useState(false);
  const [existing, setExisting] = useState<any>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch('/api/assessor', { credentials:'include' }).then(r=>r.json()).then(data => {
      if (Array.isArray(data) && data.length > 0) {
        setExisting(data[0]);
        setForm({ nome:data[0].nome||'', cnpj:data[0].cnpj||'', nome_fantasia:data[0].nome_fantasia||'', email_contato:data[0].email_contato||'', telefone:data[0].telefone||'', cor_primaria:data[0].cor_primaria||'#3D2314', cor_secundaria:data[0].cor_secundaria||'#C8941A', cor_fundo:data[0].cor_fundo||'#FAF7F2' });
      }
    });
  }, []);

  async function handleSubmit() {
    setSaving(true); setMsg('');
    const method = existing ? 'PUT' : 'POST';
    const body = existing ? { id:existing.id, ...form } : form;
    const res = await fetch('/api/assessor', { method, credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const data = await res.json();
    if (res.ok) { setMsg(existing?'Atualizada!':'Criada! Redirecionando...'); if(!existing) setTimeout(()=>window.location.href='/dashboard/assessor',1500); else setExisting(data); }
    else setMsg('Erro: '+(data.error||'Falha'));
    setSaving(false);
  }

  const is = { width:'100%', padding:'10px 14px', border:'1px solid #ddd', borderRadius:8, fontSize:14, background:'white', color:'#3D2314' };
  const ls:any = { display:'block', fontSize:12, color:'#888', marginBottom:4, fontWeight:600 };

  return (
    <div style={{ fontFamily:'system-ui', background:'#FAF7F2', minHeight:'100vh', padding:24 }}>
      <div style={{ maxWidth:600, margin:'0 auto' }}>
        <h1 style={{ color:'#3D2314', fontSize:24, marginBottom:4 }}>{existing?'Configuracoes da Assessoria':'Cadastro da Assessoria'}</h1>
        <p style={{ color:'#888', fontSize:13, marginBottom:24 }}>{existing?'Atualize dados e identidade visual':'Configure sua assessoria no PS Assessor'}</p>
        <div style={{ background:'white', borderRadius:12, padding:24 }}>
          <div style={{ display:'grid', gap:16 }}>
            <div><label style={ls}>Nome da Assessoria *</label><input style={is} value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})} placeholder="Ex: Minha Consultoria" /></div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div><label style={ls}>CNPJ</label><input style={is} value={form.cnpj} onChange={e=>setForm({...form,cnpj:e.target.value})} /></div>
              <div><label style={ls}>Nome Fantasia</label><input style={is} value={form.nome_fantasia} onChange={e=>setForm({...form,nome_fantasia:e.target.value})} /></div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div><label style={ls}>Email</label><input style={is} type="email" value={form.email_contato} onChange={e=>setForm({...form,email_contato:e.target.value})} /></div>
              <div><label style={ls}>Telefone</label><input style={is} value={form.telefone} onChange={e=>setForm({...form,telefone:e.target.value})} /></div>
            </div>
            <div style={{ borderTop:'1px solid #eee', paddingTop:16, marginTop:8 }}>
              <h3 style={{ color:'#3D2314', fontSize:14, marginBottom:12 }}>Identidade Visual (White-label)</h3>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
                {[['Cor Primaria','cor_primaria'],['Cor Secundaria','cor_secundaria'],['Cor Fundo','cor_fundo']].map(([label,key])=>(
                  <div key={key}><label style={ls}>{label}</label>
                    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                      <input type="color" value={(form as any)[key]} onChange={e=>setForm({...form,[key]:e.target.value})} style={{ width:40, height:36, border:'none', cursor:'pointer' }} />
                      <input style={{...is,flex:1}} value={(form as any)[key]} onChange={e=>setForm({...form,[key]:e.target.value})} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop:16, padding:16, borderRadius:8, background:form.cor_fundo, border:'1px solid #ddd' }}>
                <div style={{ color:form.cor_primaria, fontWeight:700, fontSize:16 }}>Preview: {form.nome_fantasia||form.nome||'Sua Assessoria'}</div>
                <div style={{ color:form.cor_secundaria, fontSize:12, marginTop:4 }}>Diagnostico Empresarial</div>
                <div style={{ display:'flex', gap:8, marginTop:8 }}>
                  <span style={{ background:form.cor_primaria, color:form.cor_fundo, padding:'4px 12px', borderRadius:4, fontSize:11 }}>Primario</span>
                  <span style={{ background:form.cor_secundaria, color:'white', padding:'4px 12px', borderRadius:4, fontSize:11 }}>Secundario</span>
                </div>
              </div>
            </div>
          </div>
          {msg && <div style={{ marginTop:16, padding:10, borderRadius:8, background:msg.includes('Erro')?'#F8D7DA':'#D4EDDA', fontSize:13 }}>{msg}</div>}
          <button onClick={handleSubmit} disabled={saving||!form.nome} style={{ marginTop:20, width:'100%', padding:'12px', background:'#3D2314', color:'#FAF7F2', border:'none', borderRadius:8, fontSize:15, fontWeight:600, cursor:'pointer' }}>
            {saving?'Salvando...':existing?'Atualizar':'Criar Assessoria'}
          </button>
        </div>
        {existing && <div style={{ textAlign:'center', marginTop:16 }}><a href="/dashboard/assessor" style={{ color:'#C8941A', fontSize:13 }}>Voltar ao Dashboard</a></div>}
      </div>
    </div>
  );
}
