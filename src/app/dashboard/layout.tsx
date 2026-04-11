"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AuthProvider } from "@/lib/AuthProvider";
import AgenteIA from "./components/AgenteIA";
import { useRouter } from "next/navigation";

const GO="#C6973F",GOL="#E8C872",G="#22C55E",Y="#FACC15",R="#EF4444",
    BG2="#1C1B18",BG3="#2A2822",BD="#3D3A30",TX="#E8E5DC",TXM="#A8A498",TXD="#918C82";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [showGuide, setShowGuide] = useState(false);
  const [demoMode, setDemoMode] = useState(()=>{if(typeof window!=="undefined"){return localStorage.getItem("ps_demo_mode")==="true";}return false;});

  const toggleDemo=()=>{const nv=!demoMode;setDemoMode(nv);if(typeof window!=="undefined")localStorage.setItem("ps_demo_mode",String(nv));};
  const [checklist, setChecklist] = useState<{id:string,titulo:string,desc:string,ok:boolean,link:string}[]>([]);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data?.user) { router.push("/"); return; }
      setUser(data.user);
      // Carregar role do usuÃ¡rio
      const { data: profile } = await supabase.from("users").select("role").eq("id", data.user.id).single();
      if (profile?.role) setUserRole(profile.role);
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
    checks.push({id:"negocios",titulo:"Definir linhas de negÃ³cio",desc:"Cadastre os negÃ³cios/departamentos que geram receita na empresa",ok:!!(bls && bls.length > 0),link:"/dashboard/dados"});

    // 3. Check Omie connection
    const hasOmie = companies?.some(c => c.omie_app_key);
    checks.push({id:"omie",titulo:"Conectar ao Omie (ou preencher dados manualmente)",desc:"Conecte o ERP para importar dados automaticamente, ou preencha manualmente",ok:!!hasOmie,link:"/dashboard/dados"});

    // 4. Check omie imports
    const { data: imports } = await supabase.from("omie_imports").select("id").limit(1);
    checks.push({id:"importar",titulo:"Importar dados financeiros",desc:"Importe contas a pagar, receber, clientes e estoque do Omie",ok:!!(imports && imports.length > 0),link:"/dashboard/dados"});

    // 5. Check cost structure
    const { data: custos } = await supabase.from("m3_dre_sede").select("id").limit(1);
    checks.push({id:"custos",titulo:"Preencher custos da estrutura",desc:"Informe os custos mensais da sede (aluguel, folha ADM, veÃ­culos, etc)",ok:!!(custos && custos.length > 0),link:"/dashboard/dados"});

    // 6. Check context
    const { data: ctx } = await supabase.from("ai_reports").select("id").eq("report_type","contexto_humano").limit(1);
    checks.push({id:"contexto",titulo:"Preencher Painel de Contexto",desc:"Conte Ã  IA os problemas, oportunidades e metas da empresa",ok:!!(ctx && ctx.length > 0),link:"/dashboard/dados"});

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
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0F0F0D", flexDirection: "column" }}>
      <style>{`
        @keyframes logoPulse {
          0%, 100% { transform: scale(1); opacity: 0.85; filter: drop-shadow(0 0 8px rgba(197,165,90,0.15)); }
          50% { transform: scale(1.06); opacity: 1; filter: drop-shadow(0 0 24px rgba(197,165,90,0.4)); }
        }
        @keyframes dotPulse {
          0%, 80%, 100% { opacity: 0.2; }
          40% { opacity: 1; }
        }
      `}</style>
      <img src="/images/logo-login.png" alt="PS GestÃ£o e Capital" style={{
        width: 180, height: "auto", animation: "logoPulse 2s ease-in-out infinite",
      }}/>
      <div style={{ display: "flex", gap: 6, marginTop: 24 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "linear-gradient(135deg, #C6973F, #E8C872)",
            animation: `dotPulse 1.4s ease-in-out ${i * 0.2}s infinite`,
          }}/>
        ))}
      </div>
      <div style={{ color: "#918C82", fontSize: 11, marginTop: 16, letterSpacing: 2, textTransform: "uppercase" }}>Carregando sistema</div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0C0C0A" }}>
      <header style={{
        background: "linear-gradient(180deg, #141412 0%, #0C0C0A 100%)",
        padding: "0 24px", height: 60, borderBottom: "1px solid #2A2822",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        position: "sticky", top: 0, zIndex: 100,
        boxShadow: "0 1px 12px rgba(0,0,0,0.4)"
      }}>
        <a href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
          <img src="/images/logo-header.png" alt="PS GestÃ£o" style={{ height: 38, width: "auto", filter: "drop-shadow(0 2px 8px rgba(198,151,63,0.15))" }}/>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#E8C872", letterSpacing: 0.3 }}>PS GestÃ£o e Capital</div>
            <div style={{ fontSize: 8, color: "#918C82", letterSpacing: 2, textTransform: "uppercase", fontWeight: 500 }}>Consultor Digital Â· v8.0</div>
          </div>
        </a>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={()=>setShowGuide(true)} style={{ fontSize: 10, color: completedCount<checklist.length?"#FBBF24":"#34D399", padding: "5px 12px", borderRadius: 8, border: `1px solid ${completedCount<checklist.length?"#FBBF2425":"#34D39925"}`, background: completedCount<checklist.length?"#FBBF2408":"#34D39908", fontWeight: 600 }}>
            {completedCount<checklist.length?`â¡ ${completedCount}/${checklist.length}`:"â Pronto"}
          </button>
          <a href="/dashboard/visao-mensal" style={{ fontSize: 10, color: "#34D399", textDecoration: "none", padding: "5px 12px", borderRadius: 8, border: "1px solid #34D39930", background: "#34D39908", fontWeight: 600 }}>ð VisÃ£o DiÃ¡ria</a>
          <a href="/dashboard/dados" style={{ fontSize: 10, color: "#E8C872", textDecoration: "none", padding: "5px 12px", borderRadius: 8, border: "1px solid #C6973F30", background: "#C6973F08", fontWeight: 600 }}>ð Dados</a>
          <a href="/dashboard/rateio" style={{ fontSize: 10, color: "#FBBF24", textDecoration: "none", padding: "5px 12px", borderRadius: 8, border: "1px solid #FBBF2430", background: "#FBBF2408", fontWeight: 600 }}>ð Rateio</a>
          <a href="/dashboard/orcamento" style={{ fontSize: 10, color: "#60A5FA", textDecoration: "none", padding: "5px 12px", borderRadius: 8, border: "1px solid #60A5FA30", background: "#60A5FA08", fontWeight: 600 }}>ð OrÃ§amento</a>
          <a href="/dashboard/ficha-tecnica" style={{ fontSize: 10, color: "#A78BFA", textDecoration: "none", padding: "5px 12px", borderRadius: 8, border: "1px solid #A78BFA30", background: "#A78BFA08", fontWeight: 600 }}>ð§ Ficha TÃ©cnica</a>
          <a href="/dashboard/viabilidade" style={{ fontSize: 10, color: "#A78BFA", textDecoration: "none", padding: "5px 12px", borderRadius: 8, border: "1px solid #A78BFA30", background: "#A78BFA08", fontWeight: 600 }}>ð Viabilidade</a>
          <a href="/dashboard/tutorial" style={{ fontSize: 10, color: "#2DD4BF", textDecoration: "none", padding: "5px 12px", borderRadius: 8, border: "1px solid #2DD4BF30", background: "#2DD4BF08", fontWeight: 600 }}>ð Ajuda</a>
          <a href="/dashboard/sugestoes" style={{ fontSize: 10, color: "#F0ECE3", textDecoration: "none", padding: "5px 12px", borderRadius: 8, border: "1px solid #2A2822", background: "transparent" }}>ð¡</a>
          {(userRole==="acesso_total")&&<a href="/dashboard/industrial" style={{ fontSize: 10, color: "#F97316", textDecoration: "none", padding: "5px 12px", borderRadius: 8, border: "1px solid #F9731630", background: "#F9731608", fontWeight: 600 }}>ð­ Industrial</a>}
          {(userRole==="acesso_total")&&<a href="/dashboard/custo-industrial" style={{ fontSize: 10, color: "#FBBF24", textDecoration: "none", padding: "5px 12px", borderRadius: 8, border: "1px solid #FBBF2430", background: "#FBBF2408", fontWeight: 600 }}>ð° Custo</a>}
          {(userRole==="acesso_total"||userRole==="adm"||userRole==="financeiro")&&<a href="/dashboard/antifraude" style={{ fontSize: 10, color: "#EF4444", textDecoration: "none", padding: "5px 12px", borderRadius: 8, border: "1px solid #EF444430", background: "#EF444408", fontWeight: 600 }}>ð¡ï¸ Anti-Fraude</a>}
          {(userRole==="acesso_total"||userRole==="adm"||userRole==="financeiro"||userRole==="operacional")&&<a href="/dashboard/operacional" style={{ fontSize: 10, color: "#2DD4BF", textDecoration: "none", padding: "5px 12px", borderRadius: 8, border: "1px solid #2DD4BF30", background: "#2DD4BF08", fontWeight: 600 }}>ð Operacional</a>}
          {(userRole==="acesso_total"||userRole==="adm"||userRole==="operacional")&&<a href="/dashboard/importar-universal" style={{ fontSize: 10, color: "#FBBF24", textDecoration: "none", padding: "5px 12px", borderRadius: 8, border: "1px solid #FBBF2430", background: "#FBBF2408", fontWeight: 600 }}>ð¤ Importar</a>}
          {(userRole==="acesso_total")&&<a href="/dashboard/noc" style={{ fontSize: 10, color: "#60A5FA", textDecoration: "none", padding: "5px 12px", borderRadius: 8, border: "1px solid #60A5FA30", background: "#60A5FA08", fontWeight: 600 }}>ð¥ï¸ NOC</a>}
          {(userRole==="wealth_advisor"||userRole==="wealth_admin"||userRole==="acesso_total")&&<a href="/wealth" style={{ fontSize: 10, color: "#C6973F", textDecoration: "none", padding: "5px 12px", borderRadius: 8, border: "1px solid #C6973F30", background: "#C6973F08", fontWeight: 600 }}>ð° Wealth</a>}
          <a href="/dashboard/consultor" style={{ fontSize: 10, color: "#C6973F", textDecoration: "none", padding: "5px 12px", borderRadius: 8, border: "1px solid #C6973F30", background: "#C6973F08", fontWeight: 600 }}>ð§  Consultor IA</a>
          {(userRole==="adm"||userRole==="acesso_total")&&<a href="/dashboard/admin" style={{ fontSize: 10, color: "#B0AB9F", textDecoration: "none", padding: "5px 12px", borderRadius: 8, border: "1px solid #2A2822" }}>âï¸ Admin</a>}
          {(userRole==="adm"||userRole==="acesso_total")&&<a href="/dashboard/dev" style={{ fontSize: 10, color: "#60A5FA", textDecoration: "none", padding: "5px 12px", borderRadius: 8, border: "1px solid #60A5FA30", background: "#60A5FA08" }}>ð ï¸ Dev</a>}
          <div style={{ width: 1, height: 20, background: "#2A2822", margin: "0 4px" }}/>
          <button onClick={toggleDemo} title={demoMode?"Desativar modo demonstraÃ§Ã£o":"Ativar modo demonstraÃ§Ã£o â oculta nomes"} style={{
            padding: "5px 10px", borderRadius: 8, border: `1px solid ${demoMode?"#22C55E30":"#2A2822"}`,
            background: demoMode?"#22C55E12":"transparent", color: demoMode?"#22C55E":"#918C82", fontSize: 10, fontWeight: 600, cursor: "pointer"
          }}>{demoMode?"ðï¸ Demo ON":"ðï¸âð¨ï¸"}</button>
          <span style={{ fontSize: 10, color: "#918C82", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{demoMode?"demo@psgestao.com":user?.email}</span>
          <button onClick={handleLogout} style={{
            padding: "5px 12px", borderRadius: 8, border: "1px solid #2A2822",
            background: "transparent", color: "#918C82", fontSize: 10, fontWeight: 500
          }}>Sair</button>
        </div>
      </header>

      {/* Global Demo Mode â oculta nomes, mantÃ©m nÃºmeros visÃ­veis */}
      {demoMode&&<style>{`
        /* APENAS seletores de empresa â NÃO seletores de perÃ­odo */
        select[style*="color:#E8C872"], select[style*="color: rgb(232, 200, 114)"] { filter: blur(5px) !important; }
        
        /* Nome do grupo/empresa no topo do dashboard */
        div[style*="fontSize:15"][style*="fontWeight:700"][style*="color:#E8C872"],
        div[style*="fontSize:15"][style*="fontWeight:700"][style*="color: rgb(232, 200, 114)"],
        div[style*="font-size: 15px"][style*="font-weight: 700"] { filter: blur(6px) !important; }
        
        /* Info da empresa abaixo do nome (cidade, CNPJ) */
        div[style*="fontSize:11"][style*="color:#918C82"]:not([style*="textTransform"]):not([style*="text-transform"]),
        span[style*="fontSize:11"][style*="color:#918C82"]:not([style*="uppercase"]) { filter: blur(5px) !important; }
        
        /* Classe manual para qualquer elemento */
        .ps-blur { filter: blur(6px) !important; user-select: none !important; }
      `}</style>}

      {/* Guide Popup */}
      {showGuide&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:520,width:"100%",border:`1px solid ${GO}40`,boxShadow:"0 8px 32px rgba(0,0,0,0.5)",maxHeight:"85vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div>
                <div style={{fontSize:16,fontWeight:700,color:GOL}}>Guia de ConfiguraÃ§Ã£o</div>
                <div style={{fontSize:11,color:TXM,marginTop:2}}>{completedCount} de {checklist.length} etapas concluÃ­das</div>
              </div>
              <button onClick={dismissGuide} style={{background:"none",border:"none",color:TXM,fontSize:18,cursor:"pointer"}}>â</button>
            </div>

            {/* Progress bar */}
            <div style={{background:BG3,borderRadius:6,height:8,marginBottom:16,overflow:"hidden"}}>
              <div style={{background:`linear-gradient(90deg,${GO},${GOL})`,height:"100%",borderRadius:6,width:`${(completedCount/checklist.length)*100}%`,transition:"width 0.3s"}}/>
            </div>

            {checklist.map((item,i)=>(
              <div key={item.id} style={{display:"flex",gap:12,alignItems:"flex-start",padding:"10px 0",borderBottom:`0.5px solid ${BD}40`}}>
                <div style={{width:28,height:28,borderRadius:8,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                  background:item.ok?G+"20":Y+"15",border:`1px solid ${item.ok?G:Y}40`,fontSize:14,color:item.ok?G:Y}}>
                  {item.ok?"â":(i+1)}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600,color:item.ok?TXM:TX,textDecoration:item.ok?"line-through":"none"}}>{item.titulo}</div>
                  <div style={{fontSize:10,color:TXD,marginTop:2}}>{item.desc}</div>
                </div>
                {!item.ok&&(
                  <a href={item.link} onClick={()=>setShowGuide(false)} style={{fontSize:10,color:GO,textDecoration:"none",padding:"4px 12px",borderRadius:6,border:`1px solid ${GO}`,whiteSpace:"nowrap",flexShrink:0}}>
                    Fazer agora â
                  </a>
                )}
              </div>
            ))}

            {completedCount===checklist.length?(
              <div style={{textAlign:"center",padding:16,marginTop:12}}>
                <div style={{fontSize:32}}>ð</div>
                <div style={{fontSize:14,fontWeight:600,color:G,marginTop:8}}>Tudo configurado!</div>
                <div style={{fontSize:11,color:TXM,marginTop:4}}>O sistema estÃ¡ pronto para gerar anÃ¡lises com dados reais.</div>
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

      <AuthProvider>
      {children}
      <AgenteIA/>
    </AuthProvider>
    </div>
  );
}
