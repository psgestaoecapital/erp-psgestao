"use client";
// TELA DO DONO · "Acessos → Escopo de dados". O CLIENT_OWNER define, em linguagem simples,
// QUAIS SETORES cada pessoa da SUA empresa pode ver e DE QUAIS DADOS (jornada/ponto, SST, tudo),
// em VER ou VER E EDITAR. Sem jargão (nada de user_scope/domínio na UI). Backbone: fn_owner_scope_*.
// Guardas no banco (SECURITY DEFINER): só dono/PS · escopo company_id · aditivo · trilha.
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const GO="var(--ps-gold,#C8941A)",BG="var(--ps-bg,#FAF7F2)",BG2="var(--ps-bg2,#FFFFFF)",BG3="var(--ps-bg3,#F0ECE3)",
  G="#22C55E",R="#EF4444",BL="#3B82F6",BD="var(--ps-border,#E0D8CC)",TX="var(--ps-text,#3D2314)",TXM="var(--ps-text-m,#6B5D4F)";

// tipos de dado em linguagem do usuário -> domínios técnicos
const TIPOS_DADO = [
  { key:"TODOS", label:"Todos os dados", desc:"Enxerga tudo da área (produção, jornada/ponto, segurança)." },
  { key:"gente", label:"Jornada e ponto", desc:"Horas, faltas, extras, banco de horas (agregado)." },
  { key:"sst",   label:"Segurança do trabalho", desc:"Jornada para fins de SST (CAT, pausas, fadiga)." },
];

type Membro = { user_id:string; email:string; full_name:string|null; is_owner:boolean; resumo:string };
type Unidade = { id:string; nome:string; tipo:string; is_todos:boolean };
type Grant = { scope_id:string; unidade_id:string; unidade_nome:string; unidade_tipo:string; dominios:string[]; nivel:string; ativo:boolean };

export default function EscopoDadosPage(){
  const [loading,setLoading]=useState(true);
  const [autorizado,setAutorizado]=useState(false);
  const [companyIds,setCompanyIds]=useState<string[]>([]);
  const [companyNomes,setCompanyNomes]=useState<Record<string,string>>({});
  const [companyId,setCompanyId]=useState<string>("");
  const [membros,setMembros]=useState<Membro[]>([]);
  const [unidades,setUnidades]=useState<Unidade[]>([]);
  const [selMembro,setSelMembro]=useState<string>("");
  const [grants,setGrants]=useState<Grant[]>([]);
  // form
  const [selUnidades,setSelUnidades]=useState<Set<string>>(new Set());
  const [selTipos,setSelTipos]=useState<Set<string>>(new Set(["TODOS"]));
  const [nivel,setNivel]=useState<"ver"|"editar">("ver");
  const [msg,setMsg]=useState<{t:string;ok:boolean}|null>(null);
  const [salvando,setSalvando]=useState(false);

  useEffect(()=>{ checkAuth(); },[]);

  const checkAuth=async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    if(!user){ setLoading(false); return; }
    const{data:up}=await supabase.from("users").select("role,system_role").eq("id",user.id).single();
    const isSystemAdmin=up?.role==="adm"||up?.role==="acesso_total"||up?.role==="adm_investimentos"||!!up?.system_role;
    const{data:ownerRoles}=await supabase.from("tenant_user_roles").select("company_id").eq("user_id",user.id).eq("role","CLIENT_OWNER").eq("is_active",true);
    const ownerIds=(ownerRoles??[]).map((r:any)=>r.company_id as string);
    if(isSystemAdmin||ownerIds.length>0){
      setAutorizado(true);
      // empresas que ele pode gerir (dono) — admin de sistema vê as próprias empresas de dono também
      let ids=ownerIds;
      if(ids.length===0 && isSystemAdmin){
        const{data:uc}=await supabase.from("user_companies").select("company_id").eq("user_id",user.id);
        ids=(uc??[]).map((r:any)=>r.company_id as string);
      }
      setCompanyIds(ids);
      if(ids.length>0){
        const{data:cs}=await supabase.from("companies").select("id,nome_fantasia,razao_social").in("id",ids);
        const map:Record<string,string>={};(cs??[]).forEach((c:any)=>{map[c.id]=c.nome_fantasia||c.razao_social||c.id;});
        setCompanyNomes(map);
        setCompanyId(ids[0]);
      }
    }
    setLoading(false);
  };

  const carregarEmpresa=useCallback(async(cid:string)=>{
    if(!cid) return;
    const [{data:mem},{data:uni}]=await Promise.all([
      supabase.rpc("fn_owner_scope_membros",{p_company_id:cid}),
      supabase.rpc("fn_owner_scope_unidades",{p_company_id:cid}),
    ]);
    setMembros((mem as Membro[])??[]);
    setUnidades((uni as Unidade[])??[]);
    setSelMembro(""); setGrants([]); setSelUnidades(new Set()); setSelTipos(new Set(["TODOS"])); setNivel("ver");
  },[]);
  useEffect(()=>{ if(companyId) carregarEmpresa(companyId); },[companyId,carregarEmpresa]);

  const carregarGrants=useCallback(async(uid:string)=>{
    if(!companyId||!uid){ setGrants([]); return; }
    const{data}=await supabase.rpc("fn_owner_scope_listar",{p_company_id:companyId,p_user_id:uid});
    setGrants((data as Grant[])??[]);
  },[companyId]);
  useEffect(()=>{ if(selMembro) carregarGrants(selMembro); },[selMembro,carregarGrants]);

  const toggle=(s:Set<string>,v:string)=>{ const n=new Set(s); n.has(v)?n.delete(v):n.add(v); return n; };
  const membroSel=membros.find(m=>m.user_id===selMembro);

  const conceder=async()=>{
    if(!selMembro){ setMsg({t:"Escolha uma pessoa.",ok:false}); return; }
    if(selUnidades.size===0){ setMsg({t:"Marque ao menos um setor (ou 'Todos os setores').",ok:false}); return; }
    if(selTipos.size===0){ setMsg({t:"Marque ao menos um tipo de dado.",ok:false}); return; }
    setSalvando(true); setMsg(null);
    const{data,error}=await supabase.rpc("fn_owner_scope_conceder",{
      p_company_id:companyId, p_user_id:selMembro,
      p_unidade_ids:Array.from(selUnidades), p_dominios:Array.from(selTipos), p_nivel:nivel, p_papel_rotulo:null,
    });
    setSalvando(false);
    if(error){ setMsg({t:error.message,ok:false}); return; }
    const res=data as {ok:boolean;erro?:string;unidades?:number};
    if(!res?.ok){ setMsg({t:res?.erro||"Não foi possível conceder.",ok:false}); return; }
    setMsg({t:`Acesso concedido a ${res.unidades} setor(es).`,ok:true});
    setSelUnidades(new Set());
    carregarGrants(selMembro); // atualiza acessos atuais
    const{data:mem}=await supabase.rpc("fn_owner_scope_membros",{p_company_id:companyId}); setMembros((mem as Membro[])??[]);
  };

  const revogar=async(scopeId:string)=>{
    if(!confirm("Remover este acesso da pessoa?")) return;
    const{data,error}=await supabase.rpc("fn_owner_scope_revogar",{p_scope_id:scopeId});
    if(error){ setMsg({t:error.message,ok:false}); return; }
    const res=data as {ok:boolean;erro?:string};
    if(!res?.ok){ setMsg({t:res?.erro||"Não foi possível remover.",ok:false}); return; }
    setMsg({t:"Acesso removido.",ok:true});
    carregarGrants(selMembro);
  };

  const nomeTipo=(d:string)=>TIPOS_DADO.find(t=>t.key===d)?.label||d;

  if(loading) return <div style={{padding:32,color:TXM}}>Carregando…</div>;
  if(!autorizado) return <div style={{padding:32,color:R}}>Esta tela é do dono da empresa. Você não tem permissão.</div>;

  return (
    <div style={{padding:"24px 28px",maxWidth:1000,margin:"0 auto",color:TX}}>
      <div style={{fontSize:22,fontWeight:800}}>Acessos → Escopo de dados</div>
      <div style={{fontSize:13,color:TXM,marginTop:4,marginBottom:20}}>
        Defina quais setores cada pessoa da sua equipe pode ver — e de quais dados. O efeito aparece na tela da pessoa na hora.
      </div>

      {companyIds.length>1 && (
        <div style={{marginBottom:16}}>
          <label style={{fontSize:12,color:TXM,fontWeight:600}}>Empresa</label><br/>
          <select value={companyId} onChange={e=>setCompanyId(e.target.value)}
            style={{marginTop:4,padding:"8px 10px",borderRadius:8,border:`1px solid ${BD}`,background:BG2,color:TX,minWidth:280}}>
            {companyIds.map(id=><option key={id} value={id}>{companyNomes[id]||id}</option>)}
          </select>
        </div>
      )}

      {msg && (
        <div style={{margin:"0 0 16px",padding:"10px 14px",borderRadius:8,fontSize:13,fontWeight:600,
          background:(msg.ok?G:R)+"18",color:msg.ok?G:R,border:`1px solid ${(msg.ok?G:R)}40`}}>{msg.t}</div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"300px 1fr",gap:20,alignItems:"start"}}>
        {/* Pessoas */}
        <div style={{background:BG2,border:`1px solid ${BD}`,borderRadius:12,overflow:"hidden"}}>
          <div style={{padding:"10px 14px",fontSize:13,fontWeight:700,borderBottom:`1px solid ${BD}`,background:BG3}}>Pessoas da equipe</div>
          {membros.length===0 && <div style={{padding:14,fontSize:12,color:TXM}}>Nenhuma pessoa encontrada.</div>}
          {membros.map(m=>(
            <button key={m.user_id} onClick={()=>setSelMembro(m.user_id)}
              style={{display:"block",width:"100%",textAlign:"left",padding:"10px 14px",border:"none",cursor:"pointer",
                borderBottom:`1px solid ${BD}`,background:selMembro===m.user_id?GO+"18":"transparent",color:TX}}>
              <div style={{fontSize:13,fontWeight:600}}>{m.full_name||m.email}</div>
              <div style={{fontSize:11,color:TXM}}>{m.email}</div>
              <div style={{fontSize:11,marginTop:2,color:m.is_owner?GO:TXM,fontWeight:m.is_owner?700:400}}>
                {m.is_owner?"👑 Dono — vê tudo":m.resumo}</div>
            </button>
          ))}
        </div>

        {/* Concessão */}
        <div>
          {!selMembro && <div style={{padding:24,color:TXM,fontSize:13,background:BG2,border:`1px dashed ${BD}`,borderRadius:12}}>
            Escolha uma pessoa à esquerda para definir o que ela pode ver.</div>}

          {selMembro && membroSel?.is_owner && (
            <div style={{padding:24,color:TXM,fontSize:13,background:BG2,border:`1px solid ${BD}`,borderRadius:12}}>
              👑 <b>{membroSel.full_name||membroSel.email}</b> é dono da empresa e já enxerga todos os setores. Não precisa conceder escopo.</div>
          )}

          {selMembro && !membroSel?.is_owner && (
            <>
              {/* Acessos atuais */}
              <div style={{background:BG2,border:`1px solid ${BD}`,borderRadius:12,marginBottom:18,overflow:"hidden"}}>
                <div style={{padding:"10px 14px",fontSize:13,fontWeight:700,borderBottom:`1px solid ${BD}`,background:BG3}}>Acessos atuais</div>
                {grants.filter(g=>g.ativo).length===0 && <div style={{padding:14,fontSize:12,color:TXM}}>Sem acesso a dados ainda.</div>}
                {grants.filter(g=>g.ativo).map(g=>(
                  <div key={g.scope_id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",borderBottom:`1px solid ${BD}`}}>
                    <div style={{fontSize:12}}>
                      <b>{g.unidade_tipo==="setor"?g.unidade_nome:"Todos os setores"}</b>
                      <span style={{color:TXM}}> · {g.dominios.map(nomeTipo).join(", ")} · {g.nivel==="editar"?"Ver e editar":"Só ver"}</span>
                    </div>
                    <button onClick={()=>revogar(g.scope_id)} style={{fontSize:11,padding:"4px 10px",borderRadius:6,background:R+"12",border:`1px solid ${R}30`,color:R,cursor:"pointer"}}>Remover</button>
                  </div>
                ))}
              </div>

              {/* Novo acesso */}
              <div style={{background:BG2,border:`1px solid ${BD}`,borderRadius:12,padding:16}}>
                <div style={{fontSize:14,fontWeight:700,marginBottom:12}}>Dar novo acesso</div>

                <div style={{fontSize:12,fontWeight:600,color:TXM,marginBottom:6}}>Quais setores esta pessoa pode ver?</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:16,maxHeight:180,overflowY:"auto"}}>
                  {unidades.map(u=>{
                    const on=selUnidades.has(u.id);
                    return <button key={u.id} onClick={()=>setSelUnidades(s=>toggle(s,u.id))}
                      style={{fontSize:12,padding:"5px 10px",borderRadius:20,cursor:"pointer",
                        border:`1px solid ${on?GO:BD}`,background:on?GO+"20":BG,color:on?TX:TXM,fontWeight:u.is_todos?700:400}}>
                      {u.is_todos?"⭐ Todos os setores":u.nome}</button>;
                  })}
                </div>

                <div style={{fontSize:12,fontWeight:600,color:TXM,marginBottom:6}}>Quais dados?</div>
                <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
                  {TIPOS_DADO.map(t=>{
                    const on=selTipos.has(t.key);
                    return <label key={t.key} style={{display:"flex",gap:8,alignItems:"flex-start",cursor:"pointer",fontSize:12}}>
                      <input type="checkbox" checked={on} onChange={()=>setSelTipos(s=>toggle(s,t.key))} style={{marginTop:2}}/>
                      <span><b>{t.label}</b><span style={{color:TXM}}> — {t.desc}</span></span></label>;
                  })}
                </div>

                <div style={{fontSize:12,fontWeight:600,color:TXM,marginBottom:6}}>Pode fazer o quê?</div>
                <div style={{display:"flex",gap:8,marginBottom:18}}>
                  {(["ver","editar"] as const).map(n=>(
                    <button key={n} onClick={()=>setNivel(n)}
                      style={{fontSize:12,padding:"6px 14px",borderRadius:8,cursor:"pointer",
                        border:`1px solid ${nivel===n?BL:BD}`,background:nivel===n?BL+"18":BG,color:nivel===n?BL:TXM,fontWeight:600}}>
                      {n==="ver"?"Só ver":"Ver e editar"}</button>
                  ))}
                </div>

                <button onClick={conceder} disabled={salvando}
                  style={{fontSize:13,fontWeight:700,padding:"10px 20px",borderRadius:8,border:"none",cursor:salvando?"default":"pointer",
                    background:GO,color:"#1A1410",opacity:salvando?.6:1}}>
                  {salvando?"Concedendo…":"Conceder acesso"}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
