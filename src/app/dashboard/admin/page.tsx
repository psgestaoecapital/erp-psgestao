"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#111110",BG2="#252320",BG3="#33312A",G="#22C55E",R="#EF4444",Y="#FACC15",BL="#3B82F6",
    BD="#504D40",TX="#F0ECE3",TXM="#CCC7BB",TXD="#A09B90";

const ROLES = [
  {role:"admin",nome:"Administrador",desc:"Acesso total. Gestão de empresas, usuários e configurações.",cor:GOL,icon:"👑",tabs:["geral","negocios","resultado","financeiro","precos","relatorio"]},
  {role:"socio",nome:"Sócio / CEO",desc:"Dashboard completo, relatórios, Fale com PS, plano de ação.",cor:GO,icon:"💼",tabs:["geral","negocios","resultado","financeiro","precos","relatorio"]},
  {role:"financeiro",nome:"Financeiro",desc:"DRE, custos, contas a pagar/receber. Sem gestão de usuários.",cor:G,icon:"📊",tabs:["geral","resultado","financeiro","precos"]},
  {role:"comercial",nome:"Comercial",desc:"Receitas, clientes, vendas. Sem visibilidade de custos detalhados.",cor:BL,icon:"🎯",tabs:["geral","negocios","precos"]},
  {role:"operacional",nome:"Operacional",desc:"Plano de ação, alertas, dados operacionais básicos.",cor:Y,icon:"⚙️",tabs:["geral","negocios"]},
  {role:"consultor",nome:"Consultor Externo",desc:"Acesso completo em leitura. Para consultores PS Gestão.",cor:"#A855F7",icon:"🔍",tabs:["geral","negocios","resultado","financeiro","precos","relatorio"]},
  {role:"visualizador",nome:"Visualizador",desc:"Apenas painel geral. Sem acesso a dados detalhados.",cor:TXD,icon:"👁️",tabs:["geral"]},
];
const getRN=(r:string)=>ROLES.find(x=>x.role===r)?.nome||r;
const getRC=(r:string)=>ROLES.find(x=>x.role===r)?.cor||TXD;

export default function AdminPage(){
  const [empresas,setEmpresas]=useState<any[]>([]);
  const [usuarios,setUsuarios]=useState<any[]>([]);
  const [convites,setConvites]=useState<any[]>([]);
  const [tab,setTab]=useState("empresas");
  const [showForm,setShowForm]=useState(false);
  const [showInvite,setShowInvite]=useState(false);
  const [selectedCompany,setSelectedCompany]=useState("");
  const [inviteRole,setInviteRole]=useState("socio");
  const [inviteEmail,setInviteEmail]=useState("");
  const [generatedLink,setGeneratedLink]=useState("");
  const [copied,setCopied]=useState(false);
  const [newEmp,setNewEmp]=useState({razao_social:"",nome_fantasia:"",cnpj:"",cidade_estado:""});
  const [msg,setMsg]=useState("");

  useEffect(()=>{loadData();},[]);
  const loadData=async()=>{
    const{data:emp}=await supabase.from("companies").select("*").order("created_at",{ascending:false});
    if(emp)setEmpresas(emp);
    const{data:inv}=await supabase.from("invites").select("*,companies(nome_fantasia,razao_social)").order("created_at",{ascending:false}).limit(20);
    if(inv)setConvites(inv);
    const{data:usr}=await supabase.from("users").select("*").order("created_at",{ascending:false});
    if(usr)setUsuarios(usr);
  };

  const criarEmpresa=async(e:React.FormEvent)=>{
    e.preventDefault();
    const{data:{user}}=await supabase.auth.getUser();
    if(!user)return;
    let{data:up}=await supabase.from("users").select("org_id").eq("id",user.id).single();
    let orgId=up?.org_id;
    if(!orgId){
      const{data:org}=await supabase.from("organizations").insert({name:"PS Gestão e Capital",slug:"psgestao-"+Date.now()}).select().single();
      if(org){orgId=org.id;await supabase.from("users").upsert({id:user.id,org_id:orgId,full_name:"Administrador",email:user.email!,role:"admin"});}
    }
    const{error}=await supabase.from("companies").insert({...newEmp,org_id:orgId});
    if(error){setMsg("Erro: "+error.message);return;}
    setMsg("Empresa cadastrada!");setNewEmp({razao_social:"",nome_fantasia:"",cnpj:"",cidade_estado:""});setShowForm(false);loadData();
  };

  const gerarConvite=async()=>{
    if(!selectedCompany)return;
    const{data:{user}}=await supabase.auth.getUser();if(!user)return;
    let{data:up}=await supabase.from("users").select("org_id").eq("id",user.id).single();
    const code="conv_"+Math.random().toString(36).substring(2,10)+Date.now().toString(36);
    const{error}=await supabase.from("invites").insert({org_id:up?.org_id,company_id:selectedCompany,email:inviteEmail||null,role:inviteRole,invite_code:code,created_by:user.id});
    if(error){setMsg("Erro: "+error.message);return;}
    setGeneratedLink(window.location.origin+"/convite?code="+code);setCopied(false);loadData();
  };

  const atualizarRole=async(uid:string,nr:string)=>{
    await supabase.from("users").update({role:nr}).eq("id",uid);
    setUsuarios(usuarios.map(u=>u.id===uid?{...u,role:nr}:u));setMsg("Nível atualizado!");
  };

  const inp={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,outline:"none",width:"100%"};

  return(
  <div style={{padding:"20px",maxWidth:1000,margin:"0 auto",background:BG,minHeight:"100vh"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
      <div>
        <div style={{fontSize:20,fontWeight:700,color:GOL}}>Painel Administrativo</div>
        <div style={{fontSize:11,color:TXD}}>Gestão de empresas, usuários e permissões</div>
      </div>
      <a href="/dashboard" style={{padding:"8px 16px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← Dashboard</a>
    </div>

    {msg&&<div style={{background:G+"20",border:`1px solid ${G}`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:G}} onClick={()=>setMsg("")}>{msg}</div>}

    <div style={{display:"flex",gap:4,marginBottom:16}}>
      {[{id:"empresas",n:"Empresas"},{id:"usuarios",n:"Usuários & Níveis"},{id:"convites",n:"Convites"},{id:"niveis",n:"Mapa de Permissões"}].map(t=>(
        <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"8px 16px",borderRadius:20,fontSize:11,border:`1px solid ${tab===t.id?GO:BD}`,background:tab===t.id?GO+"18":"transparent",color:tab===t.id?GOL:TXM,fontWeight:tab===t.id?600:400,cursor:"pointer"}}>{t.n}</button>
      ))}
    </div>

    {/* EMPRESAS */}
    {tab==="empresas"&&(<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:600,color:TX}}>{empresas.length} empresas</div>
        <button onClick={()=>setShowForm(!showForm)} style={{padding:"8px 16px",borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>+ Nova Empresa</button>
      </div>
      {showForm&&(
        <div style={{background:BG2,borderRadius:12,padding:16,marginBottom:10,border:`1px solid ${BD}`}}>
          <div style={{fontSize:13,fontWeight:700,color:GOL,marginBottom:10}}>Cadastrar Nova Empresa</div>
          <form onSubmit={criarEmpresa}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[{l:"Razão Social *",k:"razao_social",p:"Razão Social"},{l:"Nome Fantasia",k:"nome_fantasia",p:"Nome comercial"},{l:"CNPJ",k:"cnpj",p:"00.000.000/0000-00"},{l:"Cidade/UF",k:"cidade_estado",p:"Chapecó/SC"}].map(f=>(
                <div key={f.k}><div style={{fontSize:10,color:TXD,marginBottom:3}}>{f.l}</div>
                <input value={(newEmp as any)[f.k]} onChange={e=>setNewEmp({...newEmp,[f.k]:e.target.value})} placeholder={f.p} style={inp}/></div>
              ))}
            </div>
            <div style={{marginTop:10,display:"flex",gap:8}}>
              <button type="submit" style={{padding:"8px 16px",borderRadius:8,background:GO,color:BG,fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>Salvar</button>
              <button type="button" onClick={()=>setShowForm(false)} style={{padding:"8px 16px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
            </div>
          </form>
        </div>
      )}
      {empresas.map(emp=>(
        <div key={emp.id} style={{background:BG2,borderRadius:10,padding:"12px 16px",marginBottom:6,border:`1px solid ${BD}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><div style={{fontSize:14,fontWeight:600,color:TX}}>{emp.nome_fantasia||emp.razao_social}</div>
          <div style={{fontSize:10,color:TXD}}>{emp.cnpj||"Sem CNPJ"} | {emp.cidade_estado||"Sem cidade"}</div></div>
          <div style={{fontSize:9,color:TXD}}>{new Date(emp.created_at).toLocaleDateString("pt-BR")}</div>
        </div>
      ))}
    </div>)}

    {/* USUÁRIOS */}
    {tab==="usuarios"&&(<div>
      <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:12}}>{usuarios.length} usuários</div>
      {usuarios.map(u=>(
        <div key={u.id} style={{background:BG2,borderRadius:10,padding:"12px 16px",marginBottom:8,border:`1px solid ${BD}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:getRC(u.role)+"20",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>
                {ROLES.find(r=>r.role===u.role)?.icon||"👤"}
              </div>
              <div><div style={{fontSize:13,fontWeight:600,color:TX}}>{u.full_name||u.email||"Sem nome"}</div>
              <div style={{fontSize:10,color:TXD}}>{u.email||""}</div></div>
            </div>
            <select value={u.role||"visualizador"} onChange={e=>atualizarRole(u.id,e.target.value)} style={{background:BG3,border:`1px solid ${BD}`,color:getRC(u.role),borderRadius:6,padding:"6px 10px",fontSize:11,fontWeight:600,cursor:"pointer"}}>
              {ROLES.map(r=><option key={r.role} value={r.role}>{r.icon} {r.nome}</option>)}
            </select>
          </div>
          <div style={{fontSize:9,color:TXD,marginTop:6}}>{ROLES.find(r=>r.role===u.role)?.desc}</div>
        </div>
      ))}
    </div>)}

    {/* CONVITES */}
    {tab==="convites"&&(<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:600,color:TX}}>Convidar usuário</div>
        <button onClick={()=>setShowInvite(!showInvite)} style={{padding:"8px 16px",borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>+ Gerar Convite</button>
      </div>
      {showInvite&&(
        <div style={{background:BG2,borderRadius:12,padding:16,marginBottom:10,border:`1px solid ${BD}`}}>
          <div style={{fontSize:13,fontWeight:700,color:GOL,marginBottom:10}}>Gerar Link de Convite</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Empresa *</div>
            <select value={selectedCompany} onChange={e=>setSelectedCompany(e.target.value)} style={inp}>
              <option value="">Selecione</option>
              {empresas.map(emp=><option key={emp.id} value={emp.id}>{emp.nome_fantasia||emp.razao_social}</option>)}
            </select></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Nível de Acesso *</div>
            <select value={inviteRole} onChange={e=>setInviteRole(e.target.value)} style={{...inp,color:getRC(inviteRole),fontWeight:600}}>
              {ROLES.map(r=><option key={r.role} value={r.role}>{r.icon} {r.nome}</option>)}
            </select></div>
            <div style={{gridColumn:"1/3"}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>E-mail (opcional)</div>
            <input value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="email@empresa.com" style={inp}/></div>
          </div>
          <div style={{background:BG3,borderRadius:8,padding:10,marginBottom:12,borderLeft:`3px solid ${getRC(inviteRole)}`}}>
            <div style={{fontSize:11,fontWeight:600,color:getRC(inviteRole)}}>{ROLES.find(r=>r.role===inviteRole)?.icon} {getRN(inviteRole)}</div>
            <div style={{fontSize:10,color:TXM,marginTop:3}}>{ROLES.find(r=>r.role===inviteRole)?.desc}</div>
          </div>
          <button onClick={gerarConvite} style={{padding:"8px 16px",borderRadius:8,background:GO,color:BG,fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>Gerar Link</button>
          {generatedLink&&(
            <div style={{marginTop:12,background:BG3,borderRadius:8,padding:12,border:`1px solid ${G}`}}>
              <div style={{fontSize:10,fontWeight:600,color:G,marginBottom:6}}>Link gerado! Envie para o usuário:</div>
              <div style={{display:"flex",gap:8}}>
                <input value={generatedLink} readOnly style={{...inp,flex:1,fontSize:10}}/>
                <button onClick={()=>{navigator.clipboard.writeText(generatedLink);setCopied(true);setTimeout(()=>setCopied(false),3000);}} style={{padding:"8px 14px",borderRadius:6,background:copied?G:GO,color:BG,border:"none",fontSize:11,fontWeight:600,cursor:"pointer"}}>{copied?"✓ Copiado!":"Copiar"}</button>
              </div>
            </div>
          )}
        </div>
      )}
      <div style={{fontSize:12,fontWeight:600,color:TX,marginTop:16,marginBottom:8}}>Convites recentes</div>
      {convites.map((inv,i)=>(
        <div key={inv.id||i} style={{background:BG2,borderRadius:8,padding:"10px 14px",marginBottom:4,border:`1px solid ${BD}`,borderLeft:`3px solid ${inv.used?G:getRC(inv.role)}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontSize:12,fontWeight:600,color:TX}}>{inv.companies?.nome_fantasia||inv.companies?.razao_social||"Empresa"}</div>
            <div style={{fontSize:9,color:TXD}}>{inv.email||"Sem e-mail"} | <span style={{color:getRC(inv.role),fontWeight:600}}>{getRN(inv.role)}</span> | {new Date(inv.created_at).toLocaleDateString("pt-BR")}</div></div>
            <span style={{fontSize:9,padding:"2px 8px",borderRadius:4,background:inv.used?G+"20":Y+"20",color:inv.used?G:Y,fontWeight:600}}>{inv.used?"Usado":"Pendente"}</span>
          </div>
        </div>
      ))}
    </div>)}

    {/* MAPA DE PERMISSÕES */}
    {tab==="niveis"&&(<div>
      <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:12}}>Mapa de Permissões por Nível</div>
      <div style={{background:BG2,borderRadius:12,padding:16,border:`1px solid ${BD}`,overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,minWidth:700}}>
          <thead><tr style={{borderBottom:`1px solid ${BD}`}}>
            <th style={{padding:8,textAlign:"left",color:GOL,fontSize:9}}>Funcionalidade</th>
            {ROLES.map(r=><th key={r.role} style={{padding:8,textAlign:"center",color:r.cor,fontSize:8,lineHeight:1.3}}>{r.icon}<br/>{r.nome.split("/")[0].split(" ")[0]}</th>)}
          </tr></thead>
          <tbody>
            {[
              {f:"Painel Geral",p:[1,1,1,1,1,1,1]},
              {f:"Negócios",p:[1,1,0,1,1,1,0]},
              {f:"Resultado (DRE)",p:[1,1,1,0,0,1,0]},
              {f:"Financeiro",p:[1,1,1,0,0,1,0]},
              {f:"Preços",p:[1,1,1,1,0,1,0]},
              {f:"Relatório PS",p:[1,1,0,0,0,1,0]},
              {f:"Fale com o PS",p:[1,1,0,0,0,1,0]},
              {f:"Entrada de Dados",p:[1,1,1,0,0,0,0]},
              {f:"Plano de Ação",p:[1,1,1,0,1,1,0]},
              {f:"Ver custos detalhados",p:[1,1,1,0,0,1,0]},
              {f:"Drill-down",p:[1,1,1,1,0,1,0]},
              {f:"Admin (esta tela)",p:[1,0,0,0,0,0,0]},
              {f:"Convidar usuários",p:[1,0,0,0,0,0,0]},
            ].map((row,i)=>(
              <tr key={i} style={{borderBottom:`0.5px solid ${BD}40`}}>
                <td style={{padding:"6px 8px",color:TX,fontWeight:500}}>{row.f}</td>
                {row.p.map((p,j)=><td key={j} style={{padding:6,textAlign:"center",fontSize:14,color:p?G:R}}>{p?"✓":"✕"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:8}}>✓ Acesso permitido | ✕ Sem acesso | Configure na aba "Usuários & Níveis"</div>
    </div>)}
  </div>);
}
