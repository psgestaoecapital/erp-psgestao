"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",
    G="#34D399",R="#F87171",Y="#FBBF24",B="#60A5FA",P="#A78BFA",
    BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F",TXD="#6B6960";

const fmtR=(v:number)=>`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

export default function BPOSupervisorPage(){
  const [companies,setCompanies]=useState<any[]>([]);
  const [users,setUsers]=useState<any[]>([]);
  const [operators,setOperators]=useState<any[]>([]);
  const [opClients,setOpClients]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [tab,setTab]=useState<"visao"|"operadores"|"atribuir">("visao");
  const [showAssign,setShowAssign]=useState(false);
  const [assignOp,setAssignOp]=useState("");
  const [assignComp,setAssignComp]=useState("");
  const [msg,setMsg]=useState("");

  useEffect(()=>{loadData();},[]);

  const loadData=async()=>{
    setLoading(true);
    const{data:comps}=await supabase.from("companies").select("*").order("nome_fantasia");
    if(comps)setCompanies(comps);
    const{data:usrs}=await supabase.from("users").select("*").order("full_name");
    if(usrs){setUsers(usrs);setOperators(usrs.filter((u:any)=>u.role==="operacional"||u.role==="financeiro"));}
    const{data:oc}=await supabase.from("operator_clients").select("*");
    if(oc)setOpClients(oc);
    setLoading(false);
  };

  const atribuirEmpresa=async()=>{
    if(!assignOp||!assignComp)return;
    const{data:{user}}=await supabase.auth.getUser();
    const{error}=await supabase.from("operator_clients").insert({user_id:assignOp,company_id:assignComp,assigned_by:user?.id});
    if(error){setMsg("Erro: "+error.message);return;}
    setMsg("Empresa atribuída ao operador!");setShowAssign(false);loadData();
  };

  const removerAtribuicao=async(id:string)=>{
    await supabase.from("operator_clients").delete().eq("id",id);
    setMsg("Atribuição removida.");loadData();
  };

  const getOpEmpresas=(uid:string)=>opClients.filter(oc=>oc.user_id===uid).map(oc=>{
    const comp=companies.find(c=>c.id===oc.company_id);
    return{...oc,empresa:comp?.nome_fantasia||comp?.razao_social||"—"};
  });

  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"8px 12px",fontSize:12,outline:"none",width:"100%"};

  if(loading)return(
    <div style={{minHeight:"100vh",background:BG,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{color:TXM,fontSize:13}}>Carregando dashboard BPO...</div>
    </div>
  );

  return(
    <div style={{padding:20,maxWidth:1100,margin:"0 auto",background:BG,minHeight:"100vh"}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:20,fontWeight:700,color:GOL}}>Dashboard BPO — Supervisor</div>
          <div style={{fontSize:11,color:TXD}}>Visão consolidada de todas as empresas e operadores</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <a href="/dashboard/bpo" style={{padding:"8px 16px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← BPO</a>
          <a href="/dashboard" style={{padding:"8px 16px",border:`1px solid ${BD}`,borderRadius:8,color:TXM,fontSize:11,textDecoration:"none"}}>Dashboard</a>
        </div>
      </div>

      {msg&&<div onClick={()=>setMsg("")} style={{background:G+"15",border:`1px solid ${G}30`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:G,cursor:"pointer"}}>{msg}</div>}

      {/* Tabs */}
      <div style={{display:"flex",gap:4,marginBottom:16}}>
        {([["visao","📊 Visão Geral"],["operadores","👥 Operadores"],["atribuir","🔗 Atribuições"]] as const).map(([id,label])=>(
          <button key={id} onClick={()=>setTab(id)} style={{padding:"8px 18px",borderRadius:10,fontSize:11,border:tab===id?`1px solid ${GO}50`:"1px solid transparent",background:tab===id?`linear-gradient(135deg,${GO}18,${GO}08)`:"transparent",color:tab===id?GOL:TXM,fontWeight:tab===id?600:400}}>{label}</button>
        ))}
      </div>

      {/* VISÃO GERAL */}
      {tab==="visao"&&(<div>
        {/* KPIs */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(150px, 1fr))",gap:10,marginBottom:16}}>
          {[
            {label:"Empresas",value:companies.length,cor:TX},
            {label:"Operadores",value:operators.length,cor:P},
            {label:"Atribuições",value:opClients.length,cor:B},
            {label:"Sem Operador",value:companies.filter(c=>!opClients.find(oc=>oc.company_id===c.id)).length,cor:companies.filter(c=>!opClients.find(oc=>oc.company_id===c.id)).length>0?R:G},
          ].map((k,i)=>(
            <div key={i} style={{background:BG2,borderRadius:12,padding:"14px 16px",border:`1px solid ${BD}`,textAlign:"center"}}>
              <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>{k.label}</div>
              <div style={{fontSize:26,fontWeight:700,color:k.cor}}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Company list with operator */}
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden"}}>
          <div style={{padding:"14px 16px",borderBottom:`1px solid ${BD}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:13,fontWeight:600,color:TX}}>Empresas e Operadores Responsáveis</span>
            <button onClick={()=>setShowAssign(true)} style={{padding:"6px 14px",borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:11,fontWeight:600,border:"none",cursor:"pointer"}}>+ Atribuir</button>
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",fontSize:11,minWidth:500}}>
              <thead><tr style={{borderBottom:`1px solid ${BD}`}}>
                {["Empresa","CNPJ","Operador","Ações"].map(h=>(
                  <th key={h} style={{padding:"10px 12px",textAlign:"left",color:GO,fontSize:9,textTransform:"uppercase",letterSpacing:1,fontWeight:600}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {companies.map((comp,i)=>{
                  const atribs=opClients.filter(oc=>oc.company_id===comp.id);
                  const ops=atribs.map(a=>{
                    const u=users.find(u=>u.id===a.user_id);
                    return{...a,nome:u?.full_name||u?.email||"—"};
                  });
                  return(
                    <tr key={comp.id} style={{borderBottom:`1px solid ${BD}20`}}>
                      <td style={{padding:"10px 12px",fontWeight:500,color:TX}}>{comp.nome_fantasia||comp.razao_social}</td>
                      <td style={{padding:"10px 12px",color:TXD,fontFamily:"monospace",fontSize:10}}>{comp.cnpj||"—"}</td>
                      <td style={{padding:"10px 12px"}}>
                        {ops.length>0?ops.map((o,oi)=>(
                          <span key={oi} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:6,background:P+"15",border:`1px solid ${P}30`,color:P,fontSize:10,fontWeight:500,marginRight:4}}>
                            {o.nome}
                            <span onClick={()=>removerAtribuicao(o.id)} style={{cursor:"pointer",fontSize:12,color:TXD}} title="Remover">✕</span>
                          </span>
                        )):<span style={{color:R,fontSize:10,fontWeight:500}}>⚠ Sem operador</span>}
                      </td>
                      <td style={{padding:"10px 12px"}}>
                        <button onClick={()=>{setAssignComp(comp.id);setShowAssign(true);}} style={{padding:"3px 10px",borderRadius:6,border:`1px solid ${BD}`,background:"transparent",color:TXM,fontSize:10,cursor:"pointer"}}>+ Operador</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>)}

      {/* OPERADORES */}
      {tab==="operadores"&&(<div>
        <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:12}}>{operators.length} operadores cadastrados</div>
        {operators.length===0&&(
          <div style={{background:BG2,borderRadius:12,padding:24,border:`1px solid ${BD}`,textAlign:"center"}}>
            <div style={{fontSize:13,color:TXM}}>Nenhum operador cadastrado. Convide usuários com o papel "Operacional" no painel Admin.</div>
            <a href="/dashboard/admin" style={{display:"inline-block",marginTop:12,padding:"8px 16px",borderRadius:8,border:`1px solid ${GO}`,color:GO,fontSize:11,textDecoration:"none"}}>Ir para Admin → Convites</a>
          </div>
        )}
        {operators.map(op=>{
          const emps=getOpEmpresas(op.id);
          return(
            <div key={op.id} style={{background:BG2,borderRadius:12,padding:"14px 16px",marginBottom:8,border:`1px solid ${BD}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:36,height:36,borderRadius:"50%",background:P+"20",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>⚙️</div>
                  <div>
                    <div style={{fontSize:13,fontWeight:600,color:TX}}>{op.full_name||op.email}</div>
                    <div style={{fontSize:10,color:TXD}}>{op.email} · {op.role}</div>
                  </div>
                </div>
                <div style={{fontSize:18,fontWeight:700,color:emps.length>0?P:R}}>{emps.length}</div>
              </div>
              {emps.length>0&&(
                <div style={{marginTop:10,display:"flex",flexWrap:"wrap",gap:6}}>
                  {emps.map((e,ei)=>(
                    <span key={ei} style={{padding:"4px 10px",borderRadius:8,background:BG3,border:`1px solid ${BD}`,fontSize:10,color:TXM}}>{e.empresa}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>)}

      {/* ATRIBUIÇÕES */}
      {tab==="atribuir"&&(<div>
        <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:12}}>Gestão de Atribuições</div>
        <div style={{background:BG2,borderRadius:12,padding:16,border:`1px solid ${BD}`,marginBottom:12}}>
          <div style={{fontSize:12,color:TXM,marginBottom:12}}>Atribua empresas aos operadores. O operador só verá as empresas atribuídas a ele.</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8,alignItems:"flex-end"}}>
            <div>
              <div style={{fontSize:10,color:TXD,marginBottom:3}}>Operador</div>
              <select value={assignOp} onChange={e=>setAssignOp(e.target.value)} style={inp}>
                <option value="">Selecione...</option>
                {operators.map(o=><option key={o.id} value={o.id}>{o.full_name||o.email}</option>)}
              </select>
            </div>
            <div>
              <div style={{fontSize:10,color:TXD,marginBottom:3}}>Empresa</div>
              <select value={assignComp} onChange={e=>setAssignComp(e.target.value)} style={inp}>
                <option value="">Selecione...</option>
                {companies.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
              </select>
            </div>
            <button onClick={atribuirEmpresa} style={{padding:"8px 16px",borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:11,fontWeight:600,border:"none",cursor:"pointer",height:38}}>Atribuir</button>
          </div>
        </div>

        {/* Current assignments */}
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden"}}>
          <div style={{padding:"12px 16px",borderBottom:`1px solid ${BD}`,fontSize:12,fontWeight:600,color:GOL}}>Atribuições Ativas ({opClients.length})</div>
          {opClients.length===0?(
            <div style={{padding:20,textAlign:"center",color:TXD,fontSize:11}}>Nenhuma atribuição. Atribua empresas aos operadores acima.</div>
          ):(
            <div>
              {opClients.map((oc,i)=>{
                const op=users.find(u=>u.id===oc.user_id);
                const comp=companies.find(c=>c.id===oc.company_id);
                return(
                  <div key={oc.id} style={{padding:"10px 16px",borderBottom:`1px solid ${BD}20`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{display:"flex",alignItems:"center",gap:12}}>
                      <span style={{fontSize:10,color:P,fontWeight:600}}>{op?.full_name||op?.email||"—"}</span>
                      <span style={{fontSize:10,color:TXD}}>→</span>
                      <span style={{fontSize:10,color:TX}}>{comp?.nome_fantasia||comp?.razao_social||"—"}</span>
                    </div>
                    <button onClick={()=>removerAtribuicao(oc.id)} style={{padding:"3px 8px",borderRadius:6,border:`1px solid ${R}30`,background:"transparent",color:R,fontSize:10,cursor:"pointer"}}>Remover</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>)}

      {/* Assign Modal */}
      {showAssign&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setShowAssign(false)}>
          <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:400,width:"100%",border:`1px solid ${BD}`}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:16,fontWeight:600,color:GOL,marginBottom:16}}>Atribuir Empresa ao Operador</div>
            <div style={{marginBottom:12}}>
              <div style={{fontSize:10,color:TXD,marginBottom:3}}>Operador</div>
              <select value={assignOp} onChange={e=>setAssignOp(e.target.value)} style={inp}>
                <option value="">Selecione o operador...</option>
                {operators.map(o=><option key={o.id} value={o.id}>{o.full_name||o.email}</option>)}
              </select>
            </div>
            <div style={{marginBottom:16}}>
              <div style={{fontSize:10,color:TXD,marginBottom:3}}>Empresa</div>
              <select value={assignComp} onChange={e=>setAssignComp(e.target.value)} style={inp}>
                <option value="">Selecione a empresa...</option>
                {companies.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
              </select>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={atribuirEmpresa} style={{padding:"10px 20px",borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>Atribuir</button>
              <button onClick={()=>setShowAssign(false)} style={{padding:"10px 20px",borderRadius:8,border:`1px solid ${BD}`,background:"transparent",color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
