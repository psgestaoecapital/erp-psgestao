"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#111110",BG2="#252320",BG3="#33312A",G="#22C55E",R="#EF4444",Y="#FACC15",BL="#3B82F6",
    BD="#504D40",TX="#F0ECE3",TXM="#CCC7BB",TXD="#A09B90",PU="#A855F7";

const fmtBRL=(v:number)=>{
  if(Math.abs(v)>=1000000) return `R$ ${(v/1000000).toFixed(1)}M`;
  if(Math.abs(v)>=1000) return `R$ ${(v/1000).toFixed(0)}K`;
  return `R$ ${v.toFixed(0)}`;
};

type ClientData = {
  id:string; nome:string; cnpj:string; cidade:string; 
  receita:number; despesa:number; resultado:number; margem:number;
  status:"critico"|"atencao"|"saudavel"|"sem_dados";
  alertas:number; ultimoSync:string; tarefas:number;
};

export default function BPOPage(){
  const [clients,setClients]=useState<ClientData[]>([]);
  const [loading,setLoading]=useState(true);
  const [filtro,setFiltro]=useState("todos");
  const [busca,setBusca]=useState("");

  useEffect(()=>{
    loadBPOData();
  },[]);

  const loadBPOData=async()=>{
    setLoading(true);
    // Load all companies
    const{data:companies}=await supabase.from("companies").select("*").order("created_at");
    if(!companies){setLoading(false);return;}

    // Load all imports to check sync status
    const{data:imports}=await supabase.from("omie_imports").select("company_id,import_type,record_count,imported_at");

    // Process each company
    const results:ClientData[]=[];
    
    for(const comp of companies){
      const compImports=(imports||[]).filter((i:any)=>i.company_id===comp.id);
      const hasData=compImports.length>0;
      const lastSync=compImports.length>0
        ?compImports.sort((a:any,b:any)=>new Date(b.imported_at).getTime()-new Date(a.imported_at).getTime())[0]?.imported_at
        :"";

      // Try to get processed data for this company
      let receita=0,despesa=0,resultado=0,margem=0,alertas=0,tarefas=0;
      let status:"critico"|"atencao"|"saudavel"|"sem_dados"="sem_dados";

      if(hasData){
        try{
          const res=await fetch(`/api/omie/process`,{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({company_ids:[comp.id]})
          });
          const d=await res.json();
          if(d.success&&d.data){
            receita=d.data.total_rec_operacional||d.data.total_receitas||0;
            despesa=d.data.total_despesas||0;
            resultado=d.data.resultado_periodo||0;
            margem=Number(d.data.margem)||0;
            
            // Calculate alerts
            if(resultado<0) alertas++;
            if(margem<0) alertas++;
            if(margem<10&&margem>=0) alertas++;
            
            // Random tasks for demo (replace with real task system later)
            tarefas=alertas>0?Math.floor(Math.random()*5)+alertas:Math.floor(Math.random()*3);
            
            // Determine health status
            if(resultado<0||margem<-10) status="critico";
            else if(margem<10||alertas>1) status="atencao";
            else status="saudavel";
          }
        }catch(e){
          // If process fails, mark as sem_dados
        }
      }

      results.push({
        id:comp.id,
        nome:comp.nome_fantasia||comp.razao_social||"Sem nome",
        cnpj:comp.cnpj||"",
        cidade:comp.cidade_estado||"",
        receita,despesa,resultado,margem,
        status,alertas,tarefas,
        ultimoSync:lastSync?new Date(lastSync).toLocaleDateString("pt-BR"):"Nunca",
      });
    }
    
    setClients(results);
    setLoading(false);
  };

  const statusCor=(s:string)=>s==="critico"?R:s==="atencao"?Y:s==="saudavel"?G:TXD;
  const statusLabel=(s:string)=>s==="critico"?"Crítico":s==="atencao"?"Atenção":s==="saudavel"?"Saudável":"Sem dados";
  const statusIcon=(s:string)=>s==="critico"?"🔴":s==="atencao"?"🟡":s==="saudavel"?"🟢":"⚪";

  const filtered=clients
    .filter(c=>filtro==="todos"||c.status===filtro)
    .filter(c=>!busca||c.nome.toLowerCase().includes(busca.toLowerCase())||c.cnpj.includes(busca));

  const totalClients=clients.length;
  const criticos=clients.filter(c=>c.status==="critico").length;
  const atencao=clients.filter(c=>c.status==="atencao").length;
  const saudaveis=clients.filter(c=>c.status==="saudavel").length;
  const semDados=clients.filter(c=>c.status==="sem_dados").length;
  const totalAlertas=clients.reduce((a,c)=>a+c.alertas,0);
  const totalTarefas=clients.reduce((a,c)=>a+c.tarefas,0);
  const totalReceita=clients.reduce((a,c)=>a+c.receita,0);

  return(
  <div style={{padding:20,maxWidth:1200,margin:"0 auto",background:BG,minHeight:"100vh"}}>
    
    {/* Header */}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
      <div>
        <div style={{fontSize:22,fontWeight:700,color:GOL}}>BPO Inteligente — Central de Clientes</div>
        <div style={{fontSize:11,color:TXD}}>Visão consolidada de todos os clientes • Operado por PS — Consultor Digital</div>
      </div>
      <div style={{display:"flex",gap:8}}>
        <a href="/dashboard" style={{padding:"8px 16px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← Dashboard</a>
        <a href="/dashboard/bpo/rotinas" style={{padding:"8px 16px",border:`1px solid ${PU}`,borderRadius:8,color:PU,fontSize:11,textDecoration:"none",fontWeight:600}}>🤖 Rotinas &amp; Automação</a>
        <a href="/dashboard/bpo/rotinas" style={{padding:"8px 16px",border:`1px solid ${GO}`,borderRadius:8,color:GO,fontSize:11,textDecoration:"none",fontWeight:600}}>⚡ Rotinas</a>
        <button onClick={loadBPOData} style={{padding:"8px 16px",borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:11,fontWeight:600,border:"none",cursor:"pointer"}}>
          ↻ Atualizar
        </button>
      </div>
    </div>

    {/* KPIs */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:16}}>
      {[
        {l:"Total clientes",v:totalClients.toString(),c:GOL,icon:"🏢"},
        {l:"Críticos",v:criticos.toString(),c:R,icon:"🔴"},
        {l:"Atenção",v:atencao.toString(),c:Y,icon:"🟡"},
        {l:"Saudáveis",v:saudaveis.toString(),c:G,icon:"🟢"},
        {l:"Alertas",v:totalAlertas.toString(),c:R,icon:"⚠️"},
        {l:"Receita total",v:fmtBRL(totalReceita),c:G,icon:"💰"},
      ].map((k,i)=>(
        <div key={i} style={{background:BG2,borderRadius:10,padding:"10px 12px",borderLeft:`3px solid ${k.c}`,border:`1px solid ${BD}`,boxShadow:"0 1px 4px rgba(0,0,0,0.2)"}}>
          <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:0.4}}>{k.icon} {k.l}</div>
          <div style={{fontSize:20,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
        </div>
      ))}
    </div>

    {/* Search + Filter */}
    <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center"}}>
      <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar cliente por nome ou CNPJ..."
        style={{flex:1,background:BG2,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"8px 12px",fontSize:12,outline:"none"}}/>
      <div style={{display:"flex",gap:4}}>
        {[{id:"todos",n:"Todos",c:GOL},{id:"critico",n:"Críticos",c:R},{id:"atencao",n:"Atenção",c:Y},{id:"saudavel",n:"Saudáveis",c:G},{id:"sem_dados",n:"Sem dados",c:TXD}].map(f=>(
          <button key={f.id} onClick={()=>setFiltro(f.id)} style={{padding:"6px 12px",borderRadius:20,fontSize:10,border:`1px solid ${filtro===f.id?f.c:BD}`,background:filtro===f.id?f.c+"18":"transparent",color:filtro===f.id?f.c:TXM,fontWeight:filtro===f.id?600:400,cursor:"pointer"}}>{f.n}</button>
        ))}
      </div>
    </div>

    {/* Loading */}
    {loading&&(
      <div style={{textAlign:"center",padding:60}}>
        <div style={{fontSize:28,marginBottom:12}}>⏳</div>
        <div style={{fontSize:14,color:GOL,fontWeight:600}}>PS analisando todos os clientes...</div>
        <div style={{fontSize:11,color:TXD,marginTop:4}}>Processando dados financeiros de cada empresa</div>
      </div>
    )}

    {/* Client Cards */}
    {!loading&&(
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(340,1fr))",gap:10}}>
        {filtered.map(client=>(
          <div key={client.id} style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden",boxShadow:"0 2px 8px rgba(0,0,0,0.3)",transition:"transform 0.2s",cursor:"pointer"}}
            onClick={()=>window.location.href=`/dashboard?empresa=${client.id}`}
            onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.borderColor=statusCor(client.status);}}
            onMouseLeave={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.borderColor=BD;}}>
            
            {/* Status bar */}
            <div style={{height:3,background:statusCor(client.status)}}/>
            
            <div style={{padding:"12px 16px"}}>
              {/* Header */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                <div>
                  <div style={{fontSize:14,fontWeight:600,color:TX}}>{client.nome}</div>
                  <div style={{fontSize:10,color:TXD}}>{client.cnpj}{client.cidade?` • ${client.cidade}`:""}</div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  {client.alertas>0&&<span style={{fontSize:9,padding:"2px 6px",borderRadius:6,background:R+"20",color:R,fontWeight:600}}>{client.alertas} alerta{client.alertas>1?"s":""}</span>}
                  <span style={{fontSize:9,padding:"2px 8px",borderRadius:6,background:statusCor(client.status)+"20",color:statusCor(client.status),fontWeight:600}}>
                    {statusIcon(client.status)} {statusLabel(client.status)}
                  </span>
                </div>
              </div>

              {/* Financial KPIs */}
              {client.status!=="sem_dados"?(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:10}}>
                  <div style={{background:BG3,borderRadius:6,padding:"6px 8px",textAlign:"center"}}>
                    <div style={{fontSize:8,color:TXD}}>Receita</div>
                    <div style={{fontSize:13,fontWeight:700,color:G}}>{fmtBRL(client.receita)}</div>
                  </div>
                  <div style={{background:BG3,borderRadius:6,padding:"6px 8px",textAlign:"center"}}>
                    <div style={{fontSize:8,color:TXD}}>Despesa</div>
                    <div style={{fontSize:13,fontWeight:700,color:Y}}>{fmtBRL(client.despesa)}</div>
                  </div>
                  <div style={{background:BG3,borderRadius:6,padding:"6px 8px",textAlign:"center"}}>
                    <div style={{fontSize:8,color:TXD}}>Resultado</div>
                    <div style={{fontSize:13,fontWeight:700,color:client.resultado>=0?G:R}}>{fmtBRL(client.resultado)}</div>
                  </div>
                </div>
              ):(
                <div style={{background:BG3,borderRadius:6,padding:"12px 8px",textAlign:"center",marginBottom:10}}>
                  <div style={{fontSize:11,color:TXD}}>Nenhum dado importado ainda</div>
                  <div style={{fontSize:9,color:TXD,marginTop:2}}>Configure o conector do ERP deste cliente</div>
                </div>
              )}

              {/* Footer */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{display:"flex",gap:8}}>
                  {client.margem!==0&&<span style={{fontSize:9,color:client.margem>0?G:R}}>Margem: {client.margem}%</span>}
                  {client.tarefas>0&&<span style={{fontSize:9,color:Y}}>📋 {client.tarefas} tarefas</span>}
                </div>
                <span style={{fontSize:9,color:TXD}}>Sync: {client.ultimoSync}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    )}

    {!loading&&filtered.length===0&&(
      <div style={{textAlign:"center",padding:40,background:BG2,borderRadius:12,border:`1px solid ${BD}`}}>
        <div style={{fontSize:14,color:TXM}}>Nenhum cliente encontrado</div>
        <div style={{fontSize:11,color:TXD,marginTop:4}}>Cadastre empresas no Admin para começar o BPO</div>
      </div>
    )}

    {/* Footer */}
    <div style={{fontSize:10,color:TXD,textAlign:"center",marginTop:20,padding:12,background:BG2,borderRadius:8,border:`1px solid ${BD}`}}>
      PS Gestão — BPO Inteligente | Multi-Client HQ | Clique em qualquer cliente para abrir o dashboard completo
    </div>
  </div>);
}
