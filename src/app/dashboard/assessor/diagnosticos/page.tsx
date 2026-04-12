'use client';
import { useState, useEffect } from 'react';

export default function DiagnosticosPage() {
  const [clientes, setClientes] = useState<any[]>([]);
  const [empresasERP, setEmpresasERP] = useState<any[]>([]);
  const [diagnosticos, setDiagnosticos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState<string|null>(null);
  const [showERP, setShowERP] = useState<string|null>(null);
  const [form, setForm] = useState({ cliente_id:'', titulo:'', tipo:'completo' });
  const [importData, setImportData] = useState({ csv:'', tipo_abc:'clientes' });
  const [erpEmpresa, setErpEmpresa] = useState('');
  const [abcResult, setAbcResult] = useState<any>(null);
  const [erpResult, setErpResult] = useState<any>(null);
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

    // Load ERP empresas
    try {
      const empRes = await fetch('/api/empresas', { credentials:'include' });
      if (empRes.ok) {
        const empData = await empRes.json();
        setEmpresasERP(Array.isArray(empData)?empData: empData?.empresas ? empData.empresas : []);
      }
    } catch(e) { console.log('Empresas ERP nao disponivel'); }

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

  async function runERP(diagId: string) {
    if (!erpEmpresa) { setMsg('Selecione a empresa do ERP'); return; }
    setSaving(true); setErpResult(null); setMsg('');
    const res = await fetch('/api/assessor/analisar-erp', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ diagnostico_id: diagId, empresa_id: erpEmpresa }) });
    const data = await res.json();
    if (res.ok) { setErpResult(data); setMsg('Analise ERP concluida! ' + (data.total_lancamentos || 0) + ' lancamentos processados.'); load(); }
    else setMsg('Erro: ' + (data.error || 'Falha na analise'));
    setSaving(false);
  }

  const is: any = { width:'100%', padding:'8px 12px', border:'1px solid #ddd', borderRadius:6, fontSize:13, background:'white', color:'#3D2314' };
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
              <input style={is} value={form.titulo} onChange={e=>setForm({...form,titulo:e.target.value})} placeholder="Titulo (ex: Diagnostico 360 - Tryo Gessos)" />
              <select style={is} value={form.tipo} onChange={e=>setForm({...form,tipo:e.target.value})}>
                <option value="completo">Completo (360)</option><option value="express">Express</option><option value="setorial">Setorial</option>
              </select>
              <button onClick={createDiag} disabled={saving||!form.cliente_id||!form.titulo} style={{ background:'#C8941A', color:'white', border:'none', padding:'10px', borderRadius:8, fontSize:14, cursor:'pointer', fontWeight:600 }}>{saving?'Criando...':'Criar Diagnostico'}</button>
            </div>
          </div>
        )}

        {/* ERP Analysis Panel */}
        {showERP && (
          <div style={{ background:'white', borderRadius:12, padding:20, marginBottom:20, border:'2px solid #3D2314' }}>
            <h3 style={{ color:'#3D2314', fontSize:15, marginBottom:4 }}>🔗 Analisar Dados do ERP</h3>
            <p style={{ color:'#888', fontSize:12, marginBottom:12 }}>Selecione a empresa cadastrada no ERP para puxar todos os lancamentos automaticamente</p>
            <select style={{...is, marginBottom:12}} value={erpEmpresa} onChange={e=>setErpEmpresa(e.target.value)}>
              <option value="">Selecione a empresa do ERP...</option>
              {empresasERP.map((e:any)=><option key={e.id} value={e.id}>{e.nome} {e.cnpj ? '('+e.cnpj+')' : ''}</option>)}
            </select>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={()=>runERP(showERP)} disabled={saving||!erpEmpresa} style={{ background:'#3D2314', color:'#FAF7F2', border:'none', padding:'8px 20px', borderRadius:8, fontSize:13, cursor:'pointer', fontWeight:600 }}>
                {saving?'Analisando...':'⚡ Analisar Empresa'}
              </button>
              <button onClick={()=>{setShowERP(null);setErpResult(null);}} style={{ background:'#eee', color:'#3D2314', border:'none', padding:'8px 20px', borderRadius:8, fontSize:13, cursor:'pointer' }}>Fechar</button>
            </div>
            {erpResult && (
              <div style={{ marginTop:16, padding:16, background:'#FAF7F2', borderRadius:8 }}>
                <div style={{ fontSize:16, fontWeight:700, color:'#3D2314', marginBottom:8 }}>Analise Concluida — {erpResult.empresa}</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:12, marginBottom:12 }}>
                  <div style={{ background:'white', padding:12, borderRadius:8, borderLeft:'3px solid #C8941A' }}>
                    <div style={{ fontSize:11, color:'#888' }}>Lancamentos processados</div>
                    <div style={{ fontSize:20, fontWeight:700, color:'#3D2314' }}>{erpResult.total_lancamentos?.toLocaleString('pt-BR')}</div>
                  </div>
                  {erpResult.faturamento && (
                    <>
                      <div style={{ background:'white', padding:12, borderRadius:8, borderLeft:'3px solid #2D8B4E' }}>
                        <div style={{ fontSize:11, color:'#888' }}>Receita Total</div>
                        <div style={{ fontSize:20, fontWeight:700, color:'#2D8B4E' }}>R$ {erpResult.faturamento.receita?.toLocaleString('pt-BR', {minimumFractionDigits:2})}</div>
                      </div>
                      <div style={{ background:'white', padding:12, borderRadius:8, borderLeft:'3px solid #C0392B' }}>
                        <div style={{ fontSize:11, color:'#888' }}>Despesa Total</div>
                        <div style={{ fontSize:20, fontWeight:700, color:'#C0392B' }}>R$ {erpResult.faturamento.despesa?.toLocaleString('pt-BR', {minimumFractionDigits:2})}</div>
                      </div>
                      <div style={{ background:'white', padding:12, borderRadius:8, borderLeft:'3px solid ' + (erpResult.faturamento.resultado >= 0 ? '#2D8B4E' : '#C0392B') }}>
                        <div style={{ fontSize:11, color:'#888' }}>Resultado | Margem {erpResult.faturamento.margem}</div>
                        <div style={{ fontSize:20, fontWeight:700, color: erpResult.faturamento.resultado >= 0 ? '#2D8B4E' : '#C0392B' }}>R$ {erpResult.faturamento.resultado?.toLocaleString('pt-BR', {minimumFractionDigits:2})}</div>
                      </div>
                    </>
                  )}
                </div>
                {erpResult.analises?.length > 0 && (
                  <div>
                    <div style={{ fontSize:13, fontWeight:600, color:'#3D2314', marginBottom:8 }}>Analises Geradas:</div>
                    {erpResult.analises.map((a:any, i:number) => (
                      <div key={i} style={{ fontSize:12, color:'#555', padding:'4px 0', borderBottom:'1px solid #eee' }}>
                        <strong>{a.tipo}</strong>
                        {a.itens !== undefined && <span> — {a.itens} itens (A:{a.a} B:{a.b} C:{a.c})</span>}
                        {a.meses !== undefined && <span> — {a.meses} meses | Resultado: R$ {a.resultado?.toLocaleString('pt-BR')}</span>}
                        {a.valor !== undefined && <span> | Total: R$ {a.valor?.toLocaleString('pt-BR')}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Import CSV Panel */}
        {showImport && (
          <div style={{ background:'white', borderRadius:12, padding:20, marginBottom:20, border:'2px solid #C8941A' }}>
            <h3 style={{ color:'#3D2314', fontSize:15, marginBottom:4 }}>📥 Importar CSV — Curva ABC</h3>
            <p style={{ color:'#888', fontSize:12, marginBottom:12 }}>Cole dados CSV com colunas nome + valor</p>
            <select style={{...is,marginBottom:8}} value={importData.tipo_abc} onChange={e=>setImportData({...importData,tipo_abc:e.target.value})}>
              <option value="clientes">ABC Clientes</option><option value="produtos">ABC Produtos</option><option value="fornecedores">ABC Fornecedores</option>
            </select>
            <textarea style={{...is,height:120,fontFamily:'monospace',fontSize:11}} value={importData.csv} onChange={e=>setImportData({...importData,csv:e.target.value})}
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

        {/* Diagnosticos List */}
        <div style={{ background:'white', borderRadius:12, padding:20 }}>
          {diagnosticos.length===0 ? <p style={{ color:'#999', fontSize:13, textAlign:'center', padding:20 }}>Nenhum diagnostico ainda.</p> :
            diagnosticos.map((d:any)=>(
              <div key={d.id} style={{ borderBottom:'1px solid #f0f0f0', padding:'12px 0' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div>
                    <div style={{ fontWeight:600, color:'#3D2314' }}>{d.titulo}</div>
                    <div style={{ fontSize:12, color:'#888' }}>{d.clientes_assessoria?.nome} | {d.tipo} | {new Date(d.created_at).toLocaleDateString('pt-BR')}</div>
                    {d.dados_importados?.fonte === 'erp_interno' && (
                      <div style={{ fontSize:11, color:'#3D2314', marginTop:2 }}>🔗 Dados do ERP: {d.dados_importados.empresa_nome} — {d.dados_importados.total_lancamentos} lancamentos</div>
                    )}
                    {d.diagnostico_curvas_abc?.length>0 && <div style={{ fontSize:11, color:'#C8941A', marginTop:2 }}>{d.diagnostico_curvas_abc.map((a:any)=>a.tipo+': A='+a.qtd_a+' B='+a.qtd_b+' C='+a.qtd_c).join(' | ')}</div>}
                  </div>
                  <div style={{ display:'flex', gap:6, alignItems:'center', flexShrink:0 }}>
                    <span style={{ background:d.status==='concluido'?'#D4EDDA':d.status==='em_andamento'?'#FFF3CD':'#F0F0F0', padding:'3px 10px', borderRadius:12, fontSize:11 }}>{d.status}</span>
                    <button onClick={()=>{setShowERP(showERP===d.id?null:d.id);setShowImport(null);setErpResult(null);}} style={{ background:'#3D2314', color:'#FAF7F2', border:'none', padding:'6px 10px', borderRadius:6, fontSize:11, cursor:'pointer' }}>🔗 ERP</button>
                    <button onClick={()=>{setShowImport(showImport===d.id?null:d.id);setShowERP(null);setAbcResult(null);}} style={{ background:'#C8941A', color:'white', border:'none', padding:'6px 10px', borderRadius:6, fontSize:11, cursor:'pointer' }}>📥 CSV</button>
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
