'use client';
import { useState, useEffect } from 'react';

export default function AssessorDashboard() {
  const [assessoria, setAssessoria] = useState<any>(null);
  const [clientes, setClientes] = useState<any[]>([]);
  const [diagnosticos, setDiagnosticos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const res = await fetch('/api/assessor', { credentials: 'include' });
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setAssessoria(data[0]);
        const cliRes = await fetch('/api/assessor/clientes', { credentials: 'include' });
        setClientes(await cliRes.json());
        const diagRes = await fetch('/api/assessor/diagnostico', { credentials: 'include' });
        const diagData = await diagRes.json();
        setDiagnosticos(Array.isArray(diagData) ? diagData : []);
      } else {
        setNeedsOnboarding(true);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  if (loading) return <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'60vh', color:'#3D2314', fontFamily:'system-ui' }}>Carregando PS Assessor...</div>;

  if (needsOnboarding) {
    return (
      <div style={{ maxWidth:600, margin:'60px auto', textAlign:'center', fontFamily:'system-ui' }}>
        <h1 style={{ color:'#3D2314', fontSize:28, marginBottom:8 }}>PS Assessor</h1>
        <p style={{ color:'#666', marginBottom:24 }}>Configure sua assessoria para comecar</p>
        <a href="/dashboard/assessor/onboarding" style={{ display:'inline-block', background:'#3D2314', color:'#FAF7F2', padding:'14px 32px', borderRadius:8, textDecoration:'none', fontSize:16, fontWeight:600 }}>Configurar Assessoria</a>
      </div>
    );
  }

  const cores = { p: assessoria?.cor_primaria || '#3D2314', s: assessoria?.cor_secundaria || '#C8941A', f: assessoria?.cor_fundo || '#FAF7F2' };
  const diagConcluidos = diagnosticos.filter((d:any) => d.status === 'concluido' || d.status === 'entregue').length;

  return (
    <div style={{ fontFamily:'system-ui', background:cores.f, minHeight:'100vh', padding:24 }}>
      <div style={{ maxWidth:1100, margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 }}>
          <div>
            <h1 style={{ color:cores.p, fontSize:24, margin:0 }}>{assessoria?.nome_fantasia || assessoria?.nome}</h1>
            <p style={{ color:'#888', fontSize:13 }}>Plano {assessoria?.plano?.toUpperCase()} | {clientes.length}/{assessoria?.max_clientes} clientes</p>
          </div>
          <a href="/dashboard/assessor/onboarding" style={{ color:cores.s, fontSize:13, textDecoration:'none' }}>Configuracoes</a>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:16, marginBottom:24 }}>
          {[
            { v: clientes.length, l: 'Clientes' },
            { v: diagnosticos.length, l: 'Diagnosticos' },
            { v: diagConcluidos, l: 'Concluidos' },
            { v: diagnosticos.length - diagConcluidos, l: 'Em andamento' },
          ].map((k,i) => (
            <div key={i} style={{ background:'white', borderRadius:12, padding:20, borderLeft:'4px solid '+cores.s }}>
              <div style={{ fontSize:28, fontWeight:700, color:cores.p }}>{k.v}</div>
              <div style={{ fontSize:12, color:'#888', marginTop:4 }}>{k.l}</div>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', gap:12, marginBottom:24 }}>
          <a href="/dashboard/assessor/clientes" style={{ background:cores.p, color:cores.f, padding:'10px 20px', borderRadius:8, textDecoration:'none', fontSize:14, fontWeight:600 }}>+ Novo Cliente</a>
          <a href="/dashboard/assessor/diagnosticos" style={{ background:cores.s, color:'white', padding:'10px 20px', borderRadius:8, textDecoration:'none', fontSize:14, fontWeight:600 }}>+ Novo Diagnostico</a>
        </div>
        <div style={{ background:'white', borderRadius:12, padding:20 }}>
          <h3 style={{ color:cores.p, marginBottom:12, fontSize:16 }}>Diagnosticos Recentes</h3>
          {diagnosticos.length === 0 ? (
            <p style={{ color:'#999', fontSize:13 }}>Nenhum diagnostico ainda. Cadastre um cliente e inicie o primeiro diagnostico.</p>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead><tr style={{ borderBottom:'2px solid '+cores.s }}>
                <th style={{ textAlign:'left', padding:8, color:cores.p }}>Cliente</th>
                <th style={{ textAlign:'left', padding:8, color:cores.p }}>Titulo</th>
                <th style={{ textAlign:'center', padding:8, color:cores.p }}>Status</th>
                <th style={{ textAlign:'right', padding:8, color:cores.p }}>Data</th>
              </tr></thead>
              <tbody>{diagnosticos.slice(0,10).map((d:any) => (
                <tr key={d.id} style={{ borderBottom:'1px solid #eee' }}>
                  <td style={{ padding:8 }}>{d.clientes_assessoria?.nome || '-'}</td>
                  <td style={{ padding:8 }}>{d.titulo}</td>
                  <td style={{ padding:8, textAlign:'center' }}>
                    <span style={{ background: d.status==='concluido'||d.status==='entregue'?'#D4EDDA':d.status==='em_andamento'?'#FFF3CD':'#F0F0F0', padding:'3px 10px', borderRadius:12, fontSize:11 }}>{d.status}</span>
                  </td>
                  <td style={{ padding:8, textAlign:'right', color:'#888' }}>{new Date(d.created_at).toLocaleDateString('pt-BR')}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
