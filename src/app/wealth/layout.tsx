"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, usePathname } from "next/navigation";

const GO="#C6973F",GOL="#E8C872",G="#22C55E",R="#EF4444",
  BG="#0C0C0A",BG2="#1C1B18",BD="#3D3A30",TX="#E8E5DC",TXM="#A8A498",TXD="#918C82",
  ESP="#3D2314",OW="#FAF7F2";

const NAV=[
  {id:"painel",href:"/wealth",label:"Painel",icon:"📊"},
  {id:"clientes",href:"/wealth/clientes",label:"Clientes",icon:"👥"},
  {id:"mercado",href:"/wealth/mercado",label:"Mercado",icon:"📈"},
  {id:"rebalanceamento",href:"/wealth/rebalanceamento",label:"Rebalancear",icon:"⚖️"},
  {id:"relatorios",href:"/wealth/relatorios",label:"Relatórios",icon:"📄"},
  {id:"compliance",href:"/wealth/compliance",label:"Compliance",icon:"🛡️"},
];

export default function WealthLayout({children}:{children:React.ReactNode}){
  const [user,setUser]=useState<any>(null);
  const [role,setRole]=useState("");
  const [loading,setLoading]=useState(true);
  const router=useRouter();
  const pathname=usePathname();

  useEffect(()=>{
    supabase.auth.getUser().then(async({data})=>{
      if(!data?.user){router.push("/");return;}
      setUser(data.user);
      const{data:profile}=await supabase.from("users").select("role").eq("id",data.user.id).single();
      if(profile?.role)setRole(profile.role);
      setLoading(false);
    }).catch(()=>router.push("/"));
  },[router]);

  if(loading) return(
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:BG,flexDirection:"column"}}>
      <style>{`@keyframes wp{0%,100%{opacity:.5}50%{opacity:1}}`}</style>
      <div style={{fontSize:28,fontWeight:700,color:GOL,animation:"wp 2s ease-in-out infinite",letterSpacing:1}}>PS Wealth</div>
      <div style={{color:TXD,fontSize:11,marginTop:12,letterSpacing:2,textTransform:"uppercase"}}>Carregando módulo</div>
    </div>
  );

  const isActive=(href:string)=>{
    if(href==="/wealth") return pathname==="/wealth";
    return pathname?.startsWith(href);
  };

  return(
    <div style={{minHeight:"100vh",background:BG}}>
      {/* HEADER */}
      <header style={{
        background:"linear-gradient(180deg,#141412 0%,#0C0C0A 100%)",
        padding:"0 24px",height:56,borderBottom:`1px solid ${BD}`,
        display:"flex",justifyContent:"space-between",alignItems:"center",
        position:"sticky",top:0,zIndex:100,boxShadow:"0 1px 12px rgba(0,0,0,0.4)"
      }}>
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          <a href="/dashboard" style={{fontSize:10,color:TXD,textDecoration:"none",padding:"4px 10px",borderRadius:6,border:`1px solid ${BD}`,background:"transparent"}}>
            ← ERP
          </a>
          <a href="/wealth" style={{display:"flex",alignItems:"center",gap:8,textDecoration:"none"}}>
            <div style={{width:32,height:32,borderRadius:8,background:`linear-gradient(135deg,${ESP},${GO})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>💰</div>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:GOL,letterSpacing:.3}}>PS Wealth</div>
              <div style={{fontSize:8,color:TXD,letterSpacing:2,textTransform:"uppercase"}}>Gestão Patrimonial · v1.0</div>
            </div>
          </a>
        </div>

        {/* NAV */}
        <nav style={{display:"flex",gap:2,alignItems:"center"}}>
          {NAV.map(n=>(
            <a key={n.id} href={n.href} style={{
              fontSize:11,color:isActive(n.href)?GOL:TXM,textDecoration:"none",
              padding:"6px 12px",borderRadius:8,fontWeight:isActive(n.href)?600:400,
              background:isActive(n.href)?`${GO}15`:"transparent",
              border:isActive(n.href)?`1px solid ${GO}30`:"1px solid transparent",
              transition:"all .2s"
            }}>
              <span style={{marginRight:4}}>{n.icon}</span>{n.label}
            </a>
          ))}
        </nav>

        {/* USER */}
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:10,color:TXD,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user?.email}</span>
          <button onClick={async()=>{await supabase.auth.signOut();router.push("/");}} style={{
            padding:"4px 10px",borderRadius:6,border:`1px solid ${BD}`,
            background:"transparent",color:TXD,fontSize:10,cursor:"pointer"
          }}>Sair</button>
        </div>
      </header>

      {/* CONTENT */}
      <main style={{padding:"20px 24px",maxWidth:1400,margin:"0 auto"}}>
        {children}
      </main>
    </div>
  );
}
