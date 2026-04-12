'use client';

export default function Page() {
  return (
    <div style={{ fontFamily:'system-ui', background:'#FAF7F2', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ maxWidth:500, textAlign:'center', padding:40 }}>
        <div style={{ fontSize:56, marginBottom:16 }}>🛡</div>
        <h1 style={{ color:'#3D2314', fontSize:26, marginBottom:8 }}>Anti-Fraude</h1>
        <p style={{ color:'#888', fontSize:14, marginBottom:24 }}>Detecção automática de inconsistências e padrões suspeitos.</p>
        <div style={{ background:'white', borderRadius:12, padding:20, textAlign:'left', marginBottom:20 }}>
          <div style={{ fontSize:13, fontWeight:600, color:'#3D2314', marginBottom:10 }}>Funcionalidades planejadas:</div>
          <div style={{ fontSize:12, color:'#666', padding:'4px 0', borderBottom:'1px solid #f5f0e8' }}>• Alertas de lançamentos duplicados</div>
          <div style={{ fontSize:12, color:'#666', padding:'4px 0', borderBottom:'1px solid #f5f0e8' }}>• Detecção de valores atípicos</div>
          <div style={{ fontSize:12, color:'#666', padding:'4px 0', borderBottom:'1px solid #f5f0e8' }}>• Cruzamento NF-e vs lançamentos</div>
          <div style={{ fontSize:12, color:'#666', padding:'4px 0', borderBottom:'1px solid #f5f0e8' }}>• Score de risco por fornecedor</div>
        </div>
        <div style={{ display:'inline-block', padding:'8px 16px', borderRadius:20, fontSize:12, fontWeight:600, background:'#FFF3CD', color:'#856404' }}>
          Em desenvolvimento
        </div>
        <div style={{ marginTop:20 }}>
          <a href="/dashboard" style={{ color:'#C8941A', fontSize:13, textDecoration:'none' }}>← Voltar ao Dashboard</a>
        </div>
      </div>
    </div>
  );
}
