"use client";
// MAPA DE COBERTURA POR RAMO (interno · equipe PS). RD-51: mede telas ENTREGUES (pronto E ativo) vs.
// tagueadas por ramo, com o dado que existe — sem alvo inventado. Backbone: fn_ramos_cobertura(_modulos).
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="var(--ps-gold,#C8941A)",BG="var(--ps-bg,#FAF7F2)",BG2="var(--ps-bg2,#FFFFFF)",BG3="var(--ps-bg3,#F0ECE3)",
  G="#22C55E",R="#EF4444",BD="var(--ps-border,#E0D8CC)",TX="var(--ps-text,#3D2314)",TXM="var(--ps-text-m,#6B5D4F)";

type Linha = { ramo:string; is_comuns:boolean; total:number; prontas:number; faltam:number };
type Mod = { modulo_id:string; nome:string; ramos:string[]|null; status:string; ativo:boolean; comum:boolean };

const pct=(p:number,t:number)=> t>0 ? Math.round((p/t)*100) : null;
const corPct=(v:number|null)=> v===null?TXM : v>=80?G : v>=40?GO : R;

export default function RamosCoberturaPage(){
  const [loading,setLoading]=useState(true);
  const [autorizado,setAutorizado]=useState(false);
  const [linhas,setLinhas]=useState<Linha[]>([]);
  const [mods,setMods]=useState<Mod[]>([]);
  const [erro,setErro]=useState<string|null>(null);

  useEffect(()=>{(async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    if(!user){ setLoading(false); return; }
    const{data:up}=await supabase.from("users").select("system_role").eq("id",user.id).single();
    if(up?.system_role!=="PS_ADMIN"){ setLoading(false); return; }
    setAutorizado(true);
    const [{data:cov,error:e1},{data:md,error:e2}]=await Promise.all([
      supabase.rpc("fn_ramos_cobertura"),
      supabase.rpc("fn_ramos_cobertura_modulos"),
    ]);
    if(e1||e2){ setErro((e1||e2)?.message||"Erro ao carregar."); }
    setLinhas((cov as Linha[])??[]);
    setMods((md as Mod[])??[]);
    setLoading(false);
  })();},[]);

  if(loading) return <div style={{padding:32,color:TXM}}>Carregando…</div>;
  if(!autorizado) return <div style={{padding:32,color:R}}>Mapa de cobertura é interno da equipe PS.</div>;

  const comuns=linhas.find(l=>l.is_comuns);
  const ramos=linhas.filter(l=>!l.is_comuns);
  const especificos=mods.filter(m=>!m.comum);

  return (
    <div style={{padding:"24px 28px",maxWidth:900,margin:"0 auto",color:TX}}>
      <div style={{fontSize:22,fontWeight:800}}>Mapa de cobertura por ramo</div>
      <div style={{fontSize:13,color:TXM,marginTop:4,marginBottom:20}}>
        Telas industriais <b>entregues</b> (prontas e ativas) vs. tagueadas por ramo. Número real — sem alvo inventado.
        Ramo sem tela específica aparece 0/0. <span style={{color:GO}}>Uso interno PS.</span>
      </div>
      {erro && <div style={{margin:"0 0 14px",padding:"10px 14px",borderRadius:8,background:R+"18",color:R,fontSize:13}}>{erro}</div>}

      {comuns && (
        <div style={{background:BG2,border:`1px solid ${BD}`,borderRadius:12,padding:"12px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><b>Telas comuns</b> <span style={{color:TXM,fontSize:12}}>(valem para todos os ramos)</span></div>
          <div style={{fontSize:13}}><b>{comuns.prontas}</b>/{comuns.total} entregues <span style={{color:TXM}}>· {comuns.faltam} faltam</span></div>
        </div>
      )}

      <div style={{background:BG2,border:`1px solid ${BD}`,borderRadius:12,overflow:"hidden",marginBottom:24}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 90px 90px 70px",padding:"10px 16px",background:BG3,fontSize:12,fontWeight:700,borderBottom:`1px solid ${BD}`}}>
          <span>Ramo</span><span style={{textAlign:"right"}}>Entregues</span><span style={{textAlign:"right"}}>Faltam</span><span style={{textAlign:"right"}}>%</span>
        </div>
        {ramos.map(l=>{ const v=pct(l.prontas,l.total); return (
          <div key={l.ramo} style={{display:"grid",gridTemplateColumns:"1fr 90px 90px 70px",padding:"9px 16px",fontSize:13,borderBottom:`1px solid ${BD}`,
            opacity:l.total===0?.55:1}}>
            <span style={{fontWeight:600}}>{l.ramo}</span>
            <span style={{textAlign:"right"}}>{l.prontas}/{l.total}</span>
            <span style={{textAlign:"right",color:l.faltam>0?GO:TXM}}>{l.faltam}</span>
            <span style={{textAlign:"right",fontWeight:700,color:corPct(v)}}>{v===null?"—":v+"%"}</span>
          </div>
        );})}
      </div>

      <div style={{fontSize:15,fontWeight:700,marginBottom:8}}>Telas específicas cadastradas</div>
      {especificos.length===0 && <div style={{color:TXM,fontSize:13,padding:"10px 0"}}>Nenhuma tela específica de ramo ainda — tudo é comum por enquanto.</div>}
      {especificos.map(m=>(
        <div key={m.modulo_id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${BD}`,fontSize:13}}>
          <span>{m.nome} <span style={{color:TXM,fontSize:11}}>({m.modulo_id})</span></span>
          <span style={{display:"flex",gap:6,alignItems:"center"}}>
            {(m.ramos||[]).map(r=><span key={r} style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:10,background:GO+"20",color:GO,border:`1px solid ${GO}40`}}>{r}</span>)}
            <span style={{fontSize:11,color:m.ativo?G:TXM}}>{m.ativo?"ativo":"inativo"}</span>
            <span style={{fontSize:11,color:m.status==="pronto"?G:TXM}}>{m.status}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
