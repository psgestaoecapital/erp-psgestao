"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#111110",BG2="#252320",BG3="#33312A",G="#22C55E",R="#EF4444",Y="#FACC15",BL="#3B82F6",
    BD="#504D40",TX="#F0ECE3",TXM="#CCC7BB",TXD="#918C82",PU="#A855F7";

const fmtBRL=(v:number)=>`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

type ClientData = {
  id:string; nome:string; cnpj:string; cidade:string; 
  receita:number; despesa:number; resultado:number; margem:number;
  status:"critico"|"atencao"|"saudavel"|"sem_dados";
  alertas:string[]; ultimoSync:string; diasSemSync:number;
  totalTitulos:number; vencidos:number; totalVencido:number;
};

export default function BPOPage(){
  const [clients,setClients]=useState<ClientData[]>([]);
  const [loading,setLoading]=useState(true);
  const [filtro,setFiltro]=useState("todos");
  const [busca,setBusca]=useState("");
  const [running,setRunning]=useState(false);
  const [execResult,setExecResult]=useState<any>(null);

  useEffect(()=>{loadBPOData();},[]);

  const rodarDia=async()=>{
    setRunning(true);setExecResult(null);
    const results:any[]=[];
    for(const c of clients){
      try{
        const r=await fetch("/api/bpo/executar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({company_id:c.id})});
        const d=await r.json();
        results.push({nome:c.nome,success:d.success,alertas:d.alertas_gerados||0,resumo:d.resumo_ia||"",resultados:d.resultados||{}});
      }catch(e:any){results.push({nome:c.nome,success:false,error:e.message});}
    }
    setExecResult(results);setRunning(false);
  };

  const loadBPOData=async()=>{
    setLoading(true);
    const{data:{user}}=await supabase.auth.getUser();
    if(!user){setLoading(false);return;}
    const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
    let companies:any[]=[];
    if(up?.role==="adm"||up?.role==="acesso_total"){const{data}=await supabase.from("companies").select("*").order("created_at");companies=data||[];}
    else{const{data:uc}=await supabase.from("user_companies").select("companies(*)").eq("user_id",user.id);companies=(uc||[]).map((u:any)=>u.companies).filter(Boolean);}
    if(companies.length===0){setLoading(false);return;}

    const compIds=companies.map(c=>c.id);
    const{data:allImports}=await supabase.from("omie_imports").select("company_id,import_type,import_data,record_count,imported_at").in("company_id",compIds);
    const{data:bpoClass}=await supabase.from("bpo_classificacoes").select("company_id,status").in("company_id",compIds);

    const results:ClientData[]=[];
    const now=new Date();

    for(const comp of companies){
      const compImports=(allImports||[]).filter((i:any)=>i.company_id===comp.id);
      const hasData=compImports.length>0;
      const lastSyncDate=compImports.length>0?new Date(compImports.sort((a:any,b:any)=>new Date(b.imported_at).getTime()-new Date(a.imported_at).getTime())[0]?.imported_at):null;
      const diasSemSync=lastSyncDate?Math.floor((now.getTime()-lastSyncDate.getTime())/(1000*60*60*24)):999;

      let receita=0,despesa=0,totalTitulos=0,vencidos=0,totalVencido=0;
      const alertas:string[]=[];
      let status:"critico"|"atencao"|"saudavel"|"sem_dados"="sem_dados";

      if(hasData){
        for(const imp of compImports){
          if(imp.import_type==="contas_receber"){
            const regs=imp.import_data?.conta_receber_cadastro||[];
            if(!Array.isArray(regs))continue;
            for(const r of regs){receita+=Number(r.valor_documento)||0;totalTitulos++;const st=(r.status_titulo||"").toUpperCase();if(st==="VENCIDO"||st==="ATRASADO"){vencidos++;totalVencido+=Number(r.valor_documento)||0;}}
          }
          if(imp.import_type==="contas_pagar"){
            const regs=imp.import_data?.conta_pagar_cadastro||[];
            if(!Array.isArray(regs))continue;
            for(const r of regs){despesa+=Number(r.valor_documento)||0;totalTitulos++;}
          }
        }
        const resultado=receita-despesa;
        const margem=receita>0?Math.round((resultado/receita)*1000)/10:0;

        if(resultado<0) alertas.push("Resultado negativo");
        if(margem<5&&margem>=0) alertas.push("Margem muito baixa");
        if(vencidos>0) alertas.push(`${vencidos} título(s) vencido(s): ${fmtBRL(totalVencido)}`);
        if(diasSemSync>30) alertas.push(`Sem sincronizar há ${diasSemSync} dias`);
        const pendentes=(bpoClass||[]).filter((b:any)=>b.company_id===comp.id&&b.status==="pendente").length;
        if(pendentes>0) alertas.push(`${pendentes} classificação(ões) pendente(s)`);

        if(resultado<0||margem<-10) status="critico";
        else if(margem<10||alertas.length>1) status="atencao";
        else status="saudavel";

        results.push({id:comp.id,nome:comp.nome_fantasia||comp.razao_social||"Sem nome",cnpj:comp.cnpj||"",cidade:comp.cidade_estado||"",receita,despesa,resultado,margem,status,alertas,totalTitulos,vencidos,totalVencido,ultimoSync:lastSyncDate?lastSyncDate.toLocaleDateString("pt-BR"):"Nunca",diasSemSync});
      }else{
        alertas.push("Nenhum dado importado");
        results.push({id:comp.id,nome:comp.nome_fantasia||comp.razao_social||"Sem nome",cnpj:comp.cnpj||"",cidade:comp.cidade_estado||"",receita:0,despesa:0,resultado:0,margem:0,status:"sem_dados",alertas,totalTitulos:0,vencidos:0,totalVencido:0,ultimoSync:"Nunca",diasSemSync:999});
      }
    }
    results.sort((a,b)=>{const o={critico:0,atencao:1,saudavel:2,sem_dados:3};return o[a.status]-o[b.status];});
    setClients(results);setLoading(false);
  };

  const statusCor=(s:string)=>s==="critico"?R:s==="atencao"?Y:s==="saudavel"?G:TXD;
  const statusLabel=(s:string)=>s==="critico"?"Crítico":s==="atencao"?"Atenção":s==="saudavel"?"Saudável":"Sem dados";
  const statusIcon=(s:string)=>s==="critico"?"🔴":s==="atencao"?"🟡":s==="saudavel"?"🟢":"⚪";
  const filtered=clients.filter(c=>filtro==="todos"||c.status===filtro).filter(c=>!busca||c.nome.toLowerCase().includes(busca.toLowerCase())||c.cnpj.includes(busca));

  const totalClients=clients.length;const criticos=clients.filter(c=>c.status==="critico").length;const atencaoN=clients.filter(c=>c.status==="atencao").length;const saudaveis=clients.filter(c=>c.status==="saudavel").length;
  const totalAlertas=clients.reduce((a,c)=>a+c.alertas.length,0);const totalReceita=clients.reduce((a,c)=>a+c.receita,0);

  return(
  <div style={{padding:20,maxWidth:1200,margin:"0 auto",background:BG,minHeight:"100vh"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
      <div><div style={{fontSize:22,fontWeight:700,color:GOL}}>BPO Inteligente</div><div style={{fontSize:11,color:TXM}}>9 modulos ativos • Anti-Fraude integrado • Retroalimentacao automatica • v8.7.3</div></div>
      <div style={{display:"flex",gap:6}}>
        <a href="/dashboard" style={{padding:"8px 16px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← Dashboard</a>
        <button onClick={rodarDia} disabled={running||clients.length===0} style={{padding:"8px 18px",borderRadius:8,background:running?BD:`linear-gradient(135deg,${R},#F97316)`,color:"#fff",fontSize:11,fontWeight:700,border:"none",cursor:running?"wait":"pointer"}}>{running?`⏳ Analisando ${clients.length} empresas...`:"🚀 Rodar BPO do Dia"}</button>
        <button onClick={loadBPOData} style={{padding:"8px 16px",borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:11,fontWeight:600,border:"none",cursor:"pointer"}}>↻ Atualizar</button>
      </div>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))",gap:8,marginBottom:16}}>
      {[
        {href:"/dashboard/bpo/supervisor",icon:"👥",nome:"Supervisor",desc:"Atribuir empresas a operadores",cor:GO},
        {href:"/dashboard/bpo/automacao",icon:"🤖",nome:"Automação IA",desc:"Auto-classificação + score anti-fraude",cor:G},
        {href:"/dashboard/anti-fraude",icon:"🛡️",nome:"Anti-Fraude",desc:"11 camadas • Score 0-100 • Patente INPI",cor:R},
        {href:"/dashboard/bpo/conciliacao",icon:"💳",nome:"Conciliação",desc:"OFX/CSV matching",cor:BL},
        {href:"/dashboard/bpo/rotinas",icon:"📋",nome:"Rotinas",desc:"14 rotinas automáticas",cor:PU},
        {href:"/dashboard/importar",icon:"📥",nome:"Importar",desc:"Upload planilha de dados",cor:Y},
        {href:"/dashboard/consultor",icon:"🧠",nome:"Consultor IA",desc:"Análise de documentos",cor:GOL},
      ].map((m,i)=>(
        <a key={i} href={m.href} style={{background:BG2,borderRadius:12,padding:"12px",border:`1px solid ${BD}`,textDecoration:"none",display:"block",borderLeft:`4px solid ${m.cor}`,transition:"all 0.2s"}}
          onMouseEnter={e=>(e.currentTarget.style.background="#1E1E1B")} onMouseLeave={e=>(e.currentTarget.style.background=BG2)}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{fontSize:20}}>{m.icon}</div>
            <div><div style={{fontSize:12,fontWeight:600,color:TX}}>{m.nome}</div><div style={{fontSize:9,color:TXM}}>{m.desc}</div></div>
          </div>
        </a>
      ))}
    </div>

    <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:16}}>
      {[{l:"Total clientes",v:totalClients.toString(),c:GOL,icon:"🏢"},{l:"Críticos",v:criticos.toString(),c:R,icon:"🔴"},{l:"Atenção",v:atencaoN.toString(),c:Y,icon:"🟡"},{l:"Saudáveis",v:saudaveis.toString(),c:G,icon:"🟢"},{l:"Alertas reais",v:totalAlertas.toString(),c:R,icon:"⚠️"},{l:"Receita total",v:fmtBRL(totalReceita),c:G,icon:"💰"}].map((k,i)=>(
        <div key={i} style={{background:BG2,borderRadius:10,padding:"10px 12px",borderLeft:`3px solid ${k.c}`,border:`1px solid ${BD}`}}>
          <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:0.4}}>{k.icon} {k.l}</div>
          <div style={{fontSize:20,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
        </div>
      ))}
    </div>

    {/* EXECUTION RESULTS */}
    {execResult&&(
      <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,padding:14,marginBottom:16}}>
        <div style={{fontSize:14,fontWeight:700,color:GOL,marginBottom:10}}>📋 Resultado BPO do Dia — {execResult.length} empresa(s)</div>
        {execResult.map((r:any,i:number)=>(
          <div key={i} style={{background:BG3,borderRadius:8,padding:10,marginBottom:6,borderLeft:`3px solid ${r.success?G:R}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:12,fontWeight:600,color:TX}}>{r.nome}</span>
              <span style={{fontSize:9,color:r.alertas>5?R:r.alertas>0?Y:G,fontWeight:600}}>{r.alertas} alertas</span>
            </div>
            {r.resumo&&<div style={{fontSize:10,color:TXM,marginTop:4,lineHeight:1.5}}>{r.resumo}</div>}
            {r.resultados?.fluxo_caixa&&(
              <div style={{display:"flex",gap:8,marginTop:6}}>
                {r.resultados.fluxo_caixa.map((f:any)=>(
                  <span key={f.dias} style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:f.saldo>=0?G+"15":R+"15",color:f.saldo>=0?G:R}}>{f.dias}d: {f.saldo>=0?"+":""}R${(f.saldo/1000).toFixed(0)}K</span>
                ))}
              </div>
            )}
            {r.error&&<div style={{fontSize:10,color:R,marginTop:4}}>Erro: {r.error}</div>}
          </div>
        ))}
      </div>
    )}

    <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center"}}>
      <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar cliente por nome ou CNPJ..." style={{flex:1,background:BG2,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"8px 12px",fontSize:12,outline:"none"}}/>
      <div style={{display:"flex",gap:4}}>
        {[{id:"todos",n:"Todos",c:GOL},{id:"critico",n:"Críticos",c:R},{id:"atencao",n:"Atenção",c:Y},{id:"saudavel",n:"Saudáveis",c:G},{id:"sem_dados",n:"Sem dados",c:TXD}].map(f=>(
          <button key={f.id} onClick={()=>setFiltro(f.id)} style={{padding:"6px 12px",borderRadius:20,fontSize:10,border:`1px solid ${filtro===f.id?f.c:BD}`,background:filtro===f.id?f.c+"18":"transparent",color:filtro===f.id?f.c:TXM,fontWeight:filtro===f.id?600:400,cursor:"pointer"}}>{f.n}</button>
        ))}
      </div>
    </div>

    {loading&&<div style={{textAlign:"center",padding:60}}><div style={{fontSize:28,marginBottom:12}}>⏳</div><div style={{fontSize:14,color:GOL,fontWeight:600}}>Analisando clientes...</div></div>}

    {!loading&&(
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))",gap:10}}>
        {filtered.map(client=>(
          <div key={client.id} style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden",cursor:"pointer",transition:"transform 0.2s"}}
            onClick={()=>window.location.href=`/dashboard?empresa=${client.id}`}
            onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";}} onMouseLeave={e=>{e.currentTarget.style.transform="none";}}>
            <div style={{height:3,background:statusCor(client.status)}}/>
            <div style={{padding:"12px 16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                <div><div style={{fontSize:14,fontWeight:600,color:TX}}>{client.nome}</div><div style={{fontSize:10,color:TXD}}>{client.cnpj}{client.cidade?` • ${client.cidade}`:""}</div></div>
                <span style={{fontSize:9,padding:"2px 8px",borderRadius:6,background:statusCor(client.status)+"20",color:statusCor(client.status),fontWeight:600}}>{statusIcon(client.status)} {statusLabel(client.status)}</span>
              </div>
              {client.status!=="sem_dados"?(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8}}>
                  {[{l:"Receita",v:fmtBRL(client.receita),c:G},{l:"Despesa",v:fmtBRL(client.despesa),c:Y},{l:"Resultado",v:fmtBRL(client.resultado),c:client.resultado>=0?G:R}].map((k,i)=>(
                    <div key={i} style={{background:BG3,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:8,color:TXD}}>{k.l}</div><div style={{fontSize:12,fontWeight:700,color:k.c}}>{k.v}</div></div>
                  ))}
                </div>
              ):(
                <div style={{background:BG3,borderRadius:6,padding:"12px 8px",textAlign:"center",marginBottom:8}}><div style={{fontSize:11,color:TXD}}>Nenhum dado importado</div></div>
              )}
              {client.alertas.length>0&&<div style={{marginBottom:6}}>{client.alertas.slice(0,3).map((a,i)=><div key={i} style={{fontSize:9,color:R,padding:"1px 0"}}>⚠️ {a}</div>)}{client.alertas.length>3&&<div style={{fontSize:9,color:TXD}}>+{client.alertas.length-3} alerta(s)</div>}</div>}
              <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:TXD}}>
                <span>{client.margem!==0&&`Margem: ${client.margem}% • `}{client.totalTitulos} títulos</span>
                <span style={{color:client.diasSemSync>30?Y:TXD}}>Sync: {client.ultimoSync}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    )}

    {!loading&&filtered.length===0&&<div style={{textAlign:"center",padding:40,background:BG2,borderRadius:12,border:`1px solid ${BD}`}}><div style={{fontSize:14,color:TXM}}>Nenhum cliente encontrado</div></div>}

    <div style={{fontSize:10,color:TXD,textAlign:"center",marginTop:20,padding:12,background:BG2,borderRadius:8,border:`1px solid ${BD}`}}>
      PS Gestão e Capital — BPO Inteligente v8.7.3 | {totalClients} empresa(s) | 9 módulos ativos
    </div>
  </div>);
}
