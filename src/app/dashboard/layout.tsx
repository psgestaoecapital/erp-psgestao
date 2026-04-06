"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

const GO="#C6973F",GOL="#E8C872",G="#22C55E",Y="#FACC15",R="#EF4444",
    BG2="#1C1B18",BG3="#2A2822",BD="#3D3A30",TX="#E8E5DC",TXM="#A8A498",TXD="#6B6960";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showGuide, setShowGuide] = useState(false);
  const [checklist, setChecklist] = useState<{id:string,titulo:string,desc:string,ok:boolean,link:string}[]>([]);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data?.user) { router.push("/"); return; }
      setUser(data.user);
      setLoading(false);
      checkOnboarding();
    }).catch(() => {
      router.push("/");
    });
  }, [router]);

  const checkOnboarding = async () => {
    const checks: {id:string,titulo:string,desc:string,ok:boolean,link:string}[] = [];

    // 1. Check companies
    const { data: companies } = await supabase.from("companies").select("id,nome_fantasia,razao_social,omie_app_key").limit(10);
    const hasCompanies = companies && companies.length > 0;
    checks.push({id:"empresa",titulo:"Cadastrar empresa(s)",desc:"Cadastre pelo menos uma empresa no painel Administrador",ok:!!hasCompanies,link:"/dashboard/admin"});

    // 2. Check business lines
    const { data: bls } = await supabase.from("business_lines").select("id").limit(1);
    checks.push({id:"negocios",titulo:"Definir linhas de negócio",desc:"Cadastre os negócios/departamentos que geram receita na empresa",ok:!!(bls && bls.length > 0),link:"/dashboard/dados"});

    // 3. Check Omie connection
    const hasOmie = companies?.some(c => c.omie_app_key);
    checks.push({id:"omie",titulo:"Conectar ao Omie (ou preencher dados manualmente)",desc:"Conecte o ERP para importar dados automaticamente, ou preencha manualmente",ok:!!hasOmie,link:"/dashboard/dados"});

    // 4. Check omie imports
    const { data: imports } = await supabase.from("omie_imports").select("id").limit(1);
    checks.push({id:"importar",titulo:"Importar dados financeiros",desc:"Importe contas a pagar, receber, clientes e estoque do Omie",ok:!!(imports && imports.length > 0),link:"/dashboard/dados"});

    // 5. Check cost structure
    const { data: custos } = await supabase.from("m3_dre_sede").select("id").limit(1);
    checks.push({id:"custos",titulo:"Preencher custos da estrutura",desc:"Informe os custos mensais da sede (aluguel, folha ADM, veículos, etc)",ok:!!(custos && custos.length > 0),link:"/dashboard/dados"});

    // 6. Check context
    const { data: ctx } = await supabase.from("ai_reports").select("id").eq("report_type","contexto_humano").limit(1);
    checks.push({id:"contexto",titulo:"Preencher Painel de Contexto",desc:"Conte à IA os problemas, oportunidades e metas da empresa",ok:!!(ctx && ctx.length > 0),link:"/dashboard/dados"});

    setChecklist(checks);

    // Show guide if not all steps are complete
    const allDone = checks.every(c => c.ok);
    const dismissed = localStorage.getItem("guide_dismissed");
    if (!allDone && !dismissed) {
      setShowGuide(true);
    }
  };

  const dismissGuide = () => {
    setShowGuide(false);
    localStorage.setItem("guide_dismissed", new Date().toISOString());
  };

  const completedCount = checklist.filter(c => c.ok).length;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0F0F0D" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, margin: "0 auto 12px",
          background: "linear-gradient(135deg, #C6973F 0%, #E8C872 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20, fontWeight: 800, color: "#0F0F0D" }}>PS</div>
        <div style={{ color: "#A8A498", fontSize: 13 }}>Carregando...</div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0F0F0D" }}>
      <header style={{
        background: "linear-gradient(135deg, #0F0F0D 0%, #2A2822 100%)",
        padding: "12px 20px", borderBottom: "1px solid #3D3A30",
        display: "flex", justifyContent: "space-between", alignItems: "center"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: "linear-gradient(135deg, #C6973F 0%, #E8C872 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, fontWeight: 800, color: "#0F0F0D"
          }}>PS</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#E8C872" }}>PS Gestão e Capital</div>
            <div style={{ fontSize: 9, color: "#6B6960", letterSpacing: 1, textTransform: "uppercase" }}>ERP Inteligente</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={()=>setShowGuide(true)} style={{ fontSize: 11, color: completedCount<checklist.length?"#FACC15":"#22C55E", textDecoration: "none", padding: "6px 12px", borderRadius: 6, border: `0.5px solid ${completedCount<checklist.length?"#FACC1540":"#22C55E40"}`, background: "transparent", cursor: "pointer" }}>
            {completedCount<checklist.length?`⚡ ${completedCount}/${checklist.length} etapas`:"✓ Tudo pronto"}
          </button>
          <a href="/dashboard/dados" style={{ fontSize: 11, color: "#E8C872", textDecoration: "none", padding: "6px 12px", borderRadius: 6, border: "0.5px solid #C6973F", background: "#C6973F15" }}>Entrada de Dados</a>
          <a href="/dashboard/admin" style={{ fontSize: 11, color: "#C6973F", textDecoration: "none", padding: "6px 12px", borderRadius: 6, border: "0.5px solid #C6973F40" }}>Administrador</a>
          <span style={{ fontSize: 11, color: "#A8A498" }}>{user?.email}</span>
          <button onClick={handleLogout} style={{
            padding: "6px 14px", borderRadius: 6, border: "0.5px solid #3D3A30",
            background: "transparent", color: "#A8A498", fontSize: 11
          }}>Sair</button>
        </div>
      </header>

      {/* Guide Popup */}
      {showGuide&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:520,width:"100%",border:`1px solid ${GO}40`,boxShadow:"0 8px 32px rgba(0,0,0,0.5)",maxHeight:"85vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div>
                <div style={{fontSize:16,fontWeight:700,color:GOL}}>Guia de Configuração</div>
                <div style={{fontSize:11,color:TXM,marginTop:2}}>{completedCount} de {checklist.length} etapas concluídas</div>
              </div>
              <button onClick={dismissGuide} style={{background:"none",border:"none",color:TXM,fontSize:18,cursor:"pointer"}}>✕</button>
            </div>

            {/* Progress bar */}
            <div style={{background:BG3,borderRadius:6,height:8,marginBottom:16,overflow:"hidden"}}>
              <div style={{background:`linear-gradient(90deg,${GO},${GOL})`,height:"100%",borderRadius:6,width:`${(completedCount/checklist.length)*100}%`,transition:"width 0.3s"}}/>
            </div>

            {checklist.map((item,i)=>(
              <div key={item.id} style={{display:"flex",gap:12,alignItems:"flex-start",padding:"10px 0",borderBottom:`0.5px solid ${BD}40`}}>
                <div style={{width:28,height:28,borderRadius:8,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                  background:item.ok?G+"20":Y+"15",border:`1px solid ${item.ok?G:Y}40`,fontSize:14,color:item.ok?G:Y}}>
                  {item.ok?"✓":(i+1)}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600,color:item.ok?TXM:TX,textDecoration:item.ok?"line-through":"none"}}>{item.titulo}</div>
                  <div style={{fontSize:10,color:TXD,marginTop:2}}>{item.desc}</div>
                </div>
                {!item.ok&&(
                  <a href={item.link} onClick={()=>setShowGuide(false)} style={{fontSize:10,color:GO,textDecoration:"none",padding:"4px 12px",borderRadius:6,border:`1px solid ${GO}`,whiteSpace:"nowrap",flexShrink:0}}>
                    Fazer agora →
                  </a>
                )}
              </div>
            ))}

            {completedCount===checklist.length?(
              <div style={{textAlign:"center",padding:16,marginTop:12}}>
                <div style={{fontSize:32}}>🎉</div>
                <div style={{fontSize:14,fontWeight:600,color:G,marginTop:8}}>Tudo configurado!</div>
                <div style={{fontSize:11,color:TXM,marginTop:4}}>O sistema está pronto para gerar análises com dados reais.</div>
                <button onClick={dismissGuide} style={{marginTop:12,padding:"10px 24px",borderRadius:8,border:"none",background:`linear-gradient(135deg,${GO},${GOL})`,color:"#0F0F0D",fontSize:13,fontWeight:600,cursor:"pointer"}}>
                  Ir para o Dashboard
                </button>
              </div>
            ):(
              <div style={{textAlign:"center",marginTop:16}}>
                <button onClick={dismissGuide} style={{padding:"8px 20px",borderRadius:8,border:`1px solid ${BD}`,background:"transparent",color:TXM,fontSize:11,cursor:"pointer"}}>
                  Fazer depois
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {children}
    </div>
  );
}
