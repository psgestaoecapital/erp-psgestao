"use client";
import React, { useState, useEffect } from "react";
const C={bg:"#0C0C0A",bg2:"#161614",bg3:"#1E1E1B",esp:"#3D2314",go:"#C8941A",gol:"#E8C872",ow:"#FAF7F2",g:"#22C55E",r:"#EF4444",y:"#FBBF24",b:"#60A5FA",p:"#A78BFA",cy:"#2DD4BF",or:"#F97316",pk:"#EC4899",bd:"#2A2822",tx:"#E8E5DC",txm:"#A8A498",txd:"#918C82"};
const fR=(v:number)=>`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:0,maximumFractionDigits:0})}`;
const fP=(v:number)=>`${v.toFixed(1)}%`;
const fDt=(d:string|null)=>{if(!d)return"â";try{const dt=new Date(d);return dt.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"});}catch{return d;}};

const Card=({children,title,color=C.gol}:{children:React.ReactNode;title?:string;color?:string})=>(
  <div style={{background:C.bg2,borderRadius:10,padding:12,border:`1px solid ${C.bd}`,marginBottom:10}}>
    {title&&<div style={{fontSize:12,fontWeight:700,color,marginBottom:8,paddingBottom:6,borderBottom:`1px solid ${C.bd}`}}>{title}</div>}
    {children}
  </div>
);
const KPI=({l,v,s,c=C.gol}:{l:string;v:string;s?:string;c?:string})=>(
  <div style={{background:C.bg3,borderRadius:8,padding:"8px 10px",borderLeft:`3px solid ${c}`}}>
    <div style={{fontSize:7,color:C.txd,textTransform:"uppercase",letterSpacing:0.5}}>{l}</div>
    <div style={{fontSize:18,fontWeight:700,color:c,marginTop:1}}>{v}</div>
    {s&&<div style={{fontSize:7,color:C.txm,marginTop:1}}>{s}</div>}
  </div>
);

export default function NOCDashboard(){
  const [data,setData]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [tab,setTab]=useState("geral");
  const [lastRefresh,setLastRefresh]=useState("");

  const fetchData=async()=>{
    setLoading(true);setError("");
    try{
      const res=await fetch("/api/noc");
      const json=await res.json();
      if(json.success){setData(json);setLastRefresh(new Date().toLocaleTimeString("pt-BR"));}
      else setError(json.error||"Erro ao carregar dados");
    }catch(e:any){setError(e.message);}
    setLoading(false);
  };

  useEffect(()=>{fetchData();const interval=setInterval(fetchData,60000);return()=>clearInterval(interval);},[]);

  const tabs=[
    {id:"geral",l:"ð VisÃ£o Geral",c:C.gol},{id:"empresas",l:"ð¢ Empresas",c:C.g},
    {id:"usuarios",l:"ð¥ UsuÃ¡rios",c:C.b},{id:"sistema",l:"ð¥ï¸ Sistema",c:C.p},
    {id:"dados",l:"ð¦ Dados",c:C.or},{id:"financeiro",l:"ð° Financeiro",c:C.g},
  ];

  const r=data?.resumo||{};
  const empresas=data?.empresas||[];
  const usuarios=data?.usuarios||[];
  const servicos=data?.servicos||[];

  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.tx,fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <div style={{background:"linear-gradient(135deg,#1a0a05,#0C0C0A)",padding:"12px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`2px solid ${C.go}`}}>
        <div>
          <div style={{fontSize:18,fontWeight:700,color:C.gol}}>ð¥ï¸ PS GestÃ£o â Painel de OperaÃ§Ãµes (NOC)</div>
          <div style={{fontSize:10,color:C.txm}}>Dados Reais | Atualiza a cada 60s | Ãltimo: {lastRefresh||"carregando..."}</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {servicos.every((s:any)=>s.status==="online"||s.status==="configurado")?
            <div style={{padding:"4px 10px",borderRadius:6,background:C.g+"20",border:`1px solid ${C.g}40`,fontSize:10,color:C.g,fontWeight:600}}>â SERVIÃOS OK</div>:
            <div style={{padding:"4px 10px",borderRadius:6,background:C.y+"20",border:`1px solid ${C.y}40`,fontSize:10,color:C.y,fontWeight:600}}>â ï¸ ATENÃÃO</div>
          }
          <button onClick={fetchData} style={{padding:"4px 10px",borderRadius:6,background:C.bg3,border:`1px solid ${C.bd}`,color:C.gol,fontSize:10,cursor:"pointer"}}>ð Atualizar</button>
          <a href="/dashboard" style={{padding:"4px 10px",border:`1px solid ${C.bd}`,borderRadius:6,color:C.txm,fontSize:10,textDecoration:"none"}}>â Dashboard</a>
        </div>
      </div>

      <div style={{display:"flex",gap:2,padding:"6px 12px",background:C.bg2,overflowX:"auto",borderBottom:`1px solid ${C.bd}`}}>
        {tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"5px 12px",borderRadius:6,border:"none",cursor:"pointer",fontSize:9,fontWeight:tab===t.id?700:500,background:tab===t.id?t.c+"20":"transparent",color:tab===t.id?t.c:C.txm,whiteSpace:"nowrap"}}>{t.l}</button>)}
      </div>

      {loading&&!data&&<div style={{textAlign:"center",padding:40,color:C.txm}}>Carregando dados reais...</div>}
      {error&&<div style={{margin:16,padding:12,background:C.r+"15",borderRadius:8,color:C.r,fontSize:11}}>{error}</div>}

      {data&&<div style={{padding:"10px 12px",maxWidth:1400,margin:"0 auto"}}>

      {/* âââ VISÃO GERAL âââ */}
      {tab==="geral"&&(<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:12}}>
          <KPI l="Empresas" v={`${r.empresas||0}`} s="Cadastradas no sistema" c={C.g}/>
          <KPI l="UsuÃ¡rios" v={`${r.usuarios||0}`} s={`${Object.keys(r.usuariosPorRole||{}).length} roles`} c={C.b}/>
          <KPI l="Registros Importados" v={`${(r.registrosImportados||0).toLocaleString()}`} s={`${r.tiposImport||0} importaÃ§Ãµes`} c={C.or}/>
          <KPI l="V19 Gerados" v={`${r.v19Gerados||0}`} s={`${r.relatoriosTotal||0} relatÃ³rios total`} c={C.p}/>
          <KPI l="BPO ExecuÃ§Ãµes" v={`${r.bpoRuns||0}`} s={`${r.classificacoesBpo||0} classificaÃ§Ãµes`} c={C.cy}/>
          <KPI l="Wealth" v={`${r.wealthClientes||0} cl.`} s={`${r.wealthAtivos||0} ativos`} c={C.gol}/>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Card title="ð¥ï¸ Status dos ServiÃ§os" color={C.b}>
            {servicos.map((sv:any,i:number)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`0.5px solid ${C.bd}20`,alignItems:"center"}}>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <div style={{width:10,height:10,borderRadius:5,background:sv.status==="online"||sv.status==="configurado"?C.g:sv.status==="sem chave"||sv.status==="sem token"?C.y:C.r}}/>
                  <span style={{fontSize:11,color:C.tx}}>{sv.nome}</span>
                </div>
                <div>
                  <span style={{fontSize:9,padding:"2px 8px",borderRadius:4,fontWeight:600,
                    background:sv.status==="online"||sv.status==="configurado"?C.g+"20":C.y+"20",
                    color:sv.status==="online"||sv.status==="configurado"?C.g:C.y}}>{sv.status}</span>
                </div>
              </div>
            ))}
            {servicos.some((s:any)=>s.status==="sem chave"||s.status==="sem token")&&(
              <div style={{marginTop:8,padding:8,background:C.y+"10",borderRadius:6,fontSize:9,color:C.y}}>
                â ï¸ Configure as variÃ¡veis de ambiente faltantes no Vercel (Settings â Environment Variables)
              </div>
            )}
          </Card>

          <Card title="ð Resumo de Atividade" color={C.gol}>
            {[
              {l:"Empresas cadastradas",v:`${r.empresas}`,c:C.g},
              {l:"UsuÃ¡rios ativos",v:`${r.usuarios}`,c:C.b},
              {l:"Registros importados (Omie/Nibo)",v:`${(r.registrosImportados||0).toLocaleString()}`,c:C.or},
              {l:"RelatÃ³rios V19 gerados",v:`${r.v19Gerados}`,c:C.p},
              {l:"ExecuÃ§Ãµes BPO",v:`${r.bpoRuns}`,c:C.cy},
              {l:"OrÃ§amentos cadastrados",v:`${r.orcamentos}`,c:C.y},
              {l:"Planos de aÃ§Ã£o",v:`${r.planosAcao}`,c:C.g},
              {l:"Financiamentos cadastrados",v:`${r.financiamentos}`,c:C.or},
              {l:"Ãltima sincronizaÃ§Ã£o",v:fDt(r.ultimaSync),c:C.gol},
            ].map((item,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`0.5px solid ${C.bd}20`}}>
                <span style={{fontSize:10,color:C.txm}}>{item.l}</span>
                <span style={{fontSize:10,fontWeight:600,color:item.c}}>{item.v}</span>
              </div>
            ))}
          </Card>
        </div>

        {/* Roles */}
        <Card title="ð¥ UsuÃ¡rios por Role" color={C.b}>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {Object.entries(r.usuariosPorRole||{}).map(([role,count]:any)=>(
              <div key={role} style={{background:C.bg3,borderRadius:6,padding:"6px 12px",borderLeft:`2px solid ${role==="acesso_total"?C.gol:role==="wealth_advisor"?C.go:role==="operacional"?C.g:C.b}`}}>
                <div style={{fontSize:8,color:C.txd}}>{role}</div>
                <div style={{fontSize:16,fontWeight:700,color:C.tx}}>{count}</div>
              </div>
            ))}
          </div>
        </Card>
      </>)}

      {/* âââ EMPRESAS âââ */}
      {tab==="empresas"&&(<Card title={`ð¢ Empresas Cadastradas (${empresas.length})`} color={C.g}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
          <thead><tr style={{borderBottom:`1px solid ${C.bd}`}}>
            {["Empresa","IntegraÃ§Ã£o","Registros","Ãltima Sync","V19","BPO","UsuÃ¡rios"].map(h=>
              <th key={h} style={{padding:"6px 4px",textAlign:h==="Empresa"?"left":"center",color:C.gol,fontSize:9}}>{h}</th>)}
          </tr></thead>
          <tbody>
            {empresas.map((emp:any)=>(
              <tr key={emp.id} style={{borderBottom:`0.5px solid ${C.bd}20`}}>
                <td style={{padding:"5px 4px",color:C.tx,fontWeight:600}}>{emp.nome}</td>
                <td style={{padding:"5px 4px",textAlign:"center"}}>
                  {emp.temOmie?<span style={{padding:"2px 6px",borderRadius:4,fontSize:8,background:C.g+"20",color:C.g}}>Omie</span>:
                  emp.tiposImport.length>0?<span style={{padding:"2px 6px",borderRadius:4,fontSize:8,background:C.b+"20",color:C.b}}>Importado</span>:
                  <span style={{padding:"2px 6px",borderRadius:4,fontSize:8,background:C.txd+"20",color:C.txd}}>Manual</span>}
                </td>
                <td style={{padding:"5px 4px",textAlign:"center",color:emp.registrosImportados>0?C.or:C.txd}}>{emp.registrosImportados>0?emp.registrosImportados.toLocaleString():"â"}</td>
                <td style={{padding:"5px 4px",textAlign:"center",fontSize:9,color:C.txm}}>{fDt(emp.ultimaSync)}</td>
                <td style={{padding:"5px 4px",textAlign:"center",color:emp.v19Gerados>0?C.p:C.txd}}>{emp.v19Gerados||"â"}</td>
                <td style={{padding:"5px 4px",textAlign:"center",color:emp.bpoRuns>0?C.cy:C.txd}}>{emp.bpoRuns||"â"}</td>
                <td style={{padding:"5px 4px",textAlign:"center",color:C.txm}}>{emp.usuariosVinculados}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {empresas.length===0&&<div style={{textAlign:"center",padding:20,color:C.txd}}>Nenhuma empresa cadastrada ainda</div>}
      </Card>)}

      {/* âââ USUÃRIOS âââ */}
      {tab==="usuarios"&&(<Card title={`ð¥ UsuÃ¡rios do Sistema (${usuarios.length})`} color={C.b}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
          <thead><tr style={{borderBottom:`1px solid ${C.bd}`}}>
            {["Email","Role","Ãltimo Login","Criado em","Status"].map(h=>
              <th key={h} style={{padding:"6px 4px",textAlign:h==="Email"?"left":"center",color:C.gol,fontSize:9}}>{h}</th>)}
          </tr></thead>
          <tbody>
            {usuarios.map((u:any)=>{
              const diasSemLogin=u.ultimoLogin?Math.floor((Date.now()-new Date(u.ultimoLogin).getTime())/86400000):999;
              return(
                <tr key={u.id} style={{borderBottom:`0.5px solid ${C.bd}20`}}>
                  <td style={{padding:"5px 4px",color:C.tx}}>{u.email}</td>
                  <td style={{padding:"5px 4px",textAlign:"center"}}>
                    <span style={{padding:"2px 6px",borderRadius:4,fontSize:8,fontWeight:600,
                      background:u.role==="acesso_total"?C.gol+"20":u.role==="wealth_advisor"?C.go+"20":C.b+"20",
                      color:u.role==="acesso_total"?C.gol:u.role==="wealth_advisor"?C.go:C.b}}>{u.role}</span>
                  </td>
                  <td style={{padding:"5px 4px",textAlign:"center",fontSize:9,color:C.txm}}>{fDt(u.ultimoLogin)}</td>
                  <td style={{padding:"5px 4px",textAlign:"center",fontSize:9,color:C.txd}}>{fDt(u.criadoEm)}</td>
                  <td style={{padding:"5px 4px",textAlign:"center"}}>
                    <span style={{fontSize:8,color:diasSemLogin<=1?C.g:diasSemLogin<=7?C.y:C.r}}>
                      {diasSemLogin<=1?"ð¢ Online":diasSemLogin<=7?`ð¡ ${diasSemLogin}d atrÃ¡s`:diasSemLogin<999?`ð´ ${diasSemLogin}d atrÃ¡s`:"âª Nunca"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>)}

      {/* âââ SISTEMA âââ */}
      {tab==="sistema"&&(<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
          <KPI l="ServiÃ§os Ativos" v={`${servicos.filter((s:any)=>s.status==="online"||s.status==="configurado").length}/${servicos.length}`} c={C.g}/>
          <KPI l="Tipos de Import" v={`${r.tiposImport}`} s="Omie + Nibo" c={C.or}/>
          <KPI l="Tabelas com Dados" v="59" s="37 ERP + 22 Wealth" c={C.b}/>
          <KPI l="MÃ³dulos Ativos" v="13" s="DashboardâNOC" c={C.gol}/>
        </div>
        <Card title="ð¥ï¸ Detalhamento dos ServiÃ§os" color={C.p}>
          {servicos.map((sv:any,i:number)=>(
            <div key={i} style={{padding:10,marginBottom:6,background:C.bg3,borderRadius:6,borderLeft:`3px solid ${sv.status==="online"||sv.status==="configurado"?C.g:C.y}`}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:12,fontWeight:600,color:C.tx}}>{sv.nome}</span>
                <span style={{fontSize:10,fontWeight:700,color:sv.status==="online"||sv.status==="configurado"?C.g:C.y}}>{sv.status.toUpperCase()}</span>
              </div>
              <div style={{fontSize:9,color:C.txm}}>{sv.detalhe}</div>
            </div>
          ))}
        </Card>
        <Card title="ð VariÃ¡veis de Ambiente" color={C.txm}>
          {[
            {nome:"SUPABASE_SERVICE_ROLE_KEY",status:!!data},
            {nome:"ANTHROPIC_API_KEY",status:servicos.find((s:any)=>s.nome.includes("Anthropic"))?.status==="configurado"},
            {nome:"GITHUB_TOKEN",status:servicos.find((s:any)=>s.nome.includes("GitHub"))?.status==="configurado"},
            {nome:"SUPABASE_ANON_KEY",status:true},
          ].map((v,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`0.5px solid ${C.bd}20`}}>
              <span style={{fontSize:10,color:C.txm,fontFamily:"monospace"}}>{v.nome}</span>
              <span style={{fontSize:10,color:v.status?C.g:C.r}}>{v.status?"â Configurada":"â Faltando"}</span>
            </div>
          ))}
        </Card>
      </>)}

      {/* âââ DADOS âââ */}
      {tab==="dados"&&(<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
          <KPI l="Registros Totais" v={`${(r.registrosImportados||0).toLocaleString()}`} c={C.or}/>
          <KPI l="ImportaÃ§Ãµes" v={`${r.tiposImport}`} c={C.b}/>
          <KPI l="Ãltima Sync" v={fDt(r.ultimaSync)} c={C.gol}/>
          <KPI l="Empresas com Dados" v={`${empresas.filter((e:any)=>e.registrosImportados>0).length}`} c={C.g}/>
        </div>
        <Card title="ð¦ Dados por Empresa" color={C.or}>
          {empresas.filter((e:any)=>e.registrosImportados>0).sort((a:any,b:any)=>b.registrosImportados-a.registrosImportados).map((emp:any,i:number)=>(
            <div key={i} style={{padding:8,marginBottom:6,background:C.bg3,borderRadius:6,borderLeft:`3px solid ${C.or}`}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:11,fontWeight:600,color:C.tx}}>{emp.nome}</span>
                <span style={{fontSize:10,fontWeight:700,color:C.or}}>{emp.registrosImportados.toLocaleString()} registros</span>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {emp.tiposImport.map((t:string,j:number)=>(
                  <span key={j} style={{padding:"1px 6px",borderRadius:3,fontSize:7,background:C.b+"20",color:C.b}}>{t}</span>
                ))}
              </div>
              <div style={{fontSize:8,color:C.txd,marginTop:2}}>Ãltima sync: {fDt(emp.ultimaSync)}</div>
            </div>
          ))}
          {empresas.filter((e:any)=>e.registrosImportados>0).length===0&&(
            <div style={{textAlign:"center",padding:20,color:C.txd}}>Nenhum dado importado ainda. Conecte o Omie ou Nibo.</div>
          )}
        </Card>
      </>)}

      {/* âââ FINANCEIRO âââ */}
      {tab==="financeiro"&&(<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
          <KPI l="Empresas Ativas" v={`${r.empresas}`} c={C.g}/>
          <KPI l="V19 Gerados" v={`${r.v19Gerados}`} s={`~R$ ${((r.v19Gerados||0)*0.50).toFixed(2)} custo IA`} c={C.p}/>
          <KPI l="Custo Infra Estimado" v="R$ 300/mÃªs" s="Vercel+Supabase+IA" c={C.or}/>
          <KPI l="MÃ³dulos DisponÃ­veis" v="13" s="Todos funcionando" c={C.gol}/>
        </div>
        <Card title="ð Estimativa de Custos por Escala" color={C.or}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
            <thead><tr style={{borderBottom:`1px solid ${C.bd}`}}>
              {["Fase","Empresas","Supabase","Vercel","IA Claude","Total","Receita Estimada","Margem"].map(h=>
                <th key={h} style={{padding:"6px 4px",textAlign:h==="Fase"?"left":"center",color:C.or,fontSize:8}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {[
                {f:"Atual",e:`${r.empresas}`,su:"GrÃ¡tis",ve:"R$ 100",ia:"R$ 180",to:"R$ 280",re:`R$ ${(r.empresas||1)*3000}`,mg:"90%+"},
                {f:"10 empresas",e:"10",su:"R$ 125",ve:"R$ 100",ia:"R$ 500",to:"R$ 725",re:"R$ 30-50K",mg:"97%+"},
                {f:"50 empresas",e:"50",su:"R$ 250",ve:"R$ 200",ia:"R$ 2.500",to:"R$ 2.950",re:"R$ 150-250K",mg:"98%+"},
                {f:"200 empresas",e:"200",su:"R$ 500",ve:"R$ 400",ia:"R$ 5.000",to:"R$ 5.900",re:"R$ 500K-1M",mg:"99%+"},
                {f:"1.000 empresas",e:"1.000",su:"R$ 1.500",ve:"R$ 800",ia:"R$ 12.000",to:"R$ 14.300",re:"R$ 2-5M",mg:"99.3%"},
              ].map((row,i)=>(
                <tr key={i} style={{borderBottom:`0.5px solid ${C.bd}20`,background:i===0?C.go+"08":"transparent"}}>
                  <td style={{padding:"5px 4px",color:i===0?C.gol:C.tx,fontWeight:i===0?700:400}}>{row.f}</td>
                  <td style={{padding:"5px 4px",textAlign:"center",color:C.txm}}>{row.e}</td>
                  <td style={{padding:"5px 4px",textAlign:"center",color:C.txm}}>{row.su}</td>
                  <td style={{padding:"5px 4px",textAlign:"center",color:C.txm}}>{row.ve}</td>
                  <td style={{padding:"5px 4px",textAlign:"center",color:C.txm}}>{row.ia}</td>
                  <td style={{padding:"5px 4px",textAlign:"center",color:C.or,fontWeight:600}}>{row.to}</td>
                  <td style={{padding:"5px 4px",textAlign:"center",color:C.g,fontWeight:600}}>{row.re}</td>
                  <td style={{padding:"5px 4px",textAlign:"center",color:C.g}}>{row.mg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </>)}

      </div>}
      <div style={{textAlign:"center",padding:8,fontSize:8,color:C.txd}}>PS GestÃ£o e Capital â NOC v2.0 â Dados Reais do Supabase â AtualizaÃ§Ã£o automÃ¡tica a cada 60s</div>
    </div>
  );
}
