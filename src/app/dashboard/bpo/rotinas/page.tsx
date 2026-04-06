"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#111110",BG2="#252320",BG3="#33312A",G="#22C55E",R="#EF4444",Y="#FACC15",BL="#3B82F6",
    BD="#504D40",TX="#F0ECE3",TXM="#CCC7BB",TXD="#A09B90",PU="#A855F7";

const ROTINAS_TIPO = [
  {id:"classificacao",nome:"Auto-classificação de lançamentos",desc:"IA classifica contas a pagar/receber automaticamente por categoria",executor:"ia",freq:"diaria",icon:"🤖",cor:PU},
  {id:"conciliacao",nome:"Conciliação bancária",desc:"Cruza extrato bancário com lançamentos do ERP. IA resolve 90%, humano os 10%",executor:"hibrido",freq:"diaria",icon:"🏦",cor:BL},
  {id:"sync_dados",nome:"Sincronizar dados do ERP",desc:"Importa novos lançamentos, clientes e fornecedores do ERP do cliente",executor:"ia",freq:"diaria",icon:"🔄",cor:G},
  {id:"anomalias",nome:"Detectar anomalias",desc:"IA identifica duplicidades, valores fora do padrão, classificações erradas",executor:"ia",freq:"diaria",icon:"🔍",cor:Y},
  {id:"cobranca",nome:"Gestão de cobrança",desc:"Identifica inadimplentes, envia lembretes, gera boletos de cobrança",executor:"hibrido",freq:"semanal",icon:"💳",cor:R},
  {id:"contas_pagar",nome:"Contas a pagar da semana",desc:"Lista vencimentos da semana, programa pagamentos, alerta sobre atrasos",executor:"hibrido",freq:"semanal",icon:"📋",cor:Y},
  {id:"fluxo_caixa",nome:"Previsão de fluxo de caixa",desc:"IA projeta entradas e saídas dos próximos 30/60/90 dias",executor:"ia",freq:"semanal",icon:"📈",cor:G},
  {id:"nfe_emissao",nome:"Emissão de NF-e",desc:"Emite notas fiscais de serviço ou produto via eNotas/Focus NFe",executor:"humano",freq:"sob_demanda",icon:"📄",cor:BL},
  {id:"boleto_emissao",nome:"Emissão de boletos",desc:"Gera boletos de cobrança via Asaas/Cora para clientes inadimplentes",executor:"hibrido",freq:"sob_demanda",icon:"🧾",cor:GO},
  {id:"dre_mensal",nome:"DRE mensal",desc:"Gera demonstrativo de resultado do exercício com comparativo mês a mês",executor:"ia",freq:"mensal",icon:"📊",cor:GOL},
  {id:"relatorio_ia",nome:"Relatório executivo IA",desc:"PS gera relatório com 8 seções: pontos críticos, oportunidades, Carta ao Sócio",executor:"ia",freq:"mensal",icon:"📑",cor:PU},
  {id:"fechamento",nome:"Fechamento mensal",desc:"Reconcilia todos os lançamentos, verifica pendências, fecha o período",executor:"humano",freq:"mensal",icon:"🔒",cor:R},
  {id:"obrigacoes",nome:"Obrigações fiscais",desc:"Alerta sobre prazos de DARF, DAS, GFIP, SPED e outras obrigações",executor:"ia",freq:"mensal",icon:"📅",cor:Y},
  {id:"balanco",nome:"Balanço e indicadores",desc:"Gera balanço patrimonial simplificado e indicadores financeiros chave",executor:"ia",freq:"mensal",icon:"⚖️",cor:BL},
];

const freqLabel=(f:string)=>f==="diaria"?"Diária":f==="semanal"?"Semanal":f==="mensal"?"Mensal":"Sob demanda";
const freqCor=(f:string)=>f==="diaria"?R:f==="semanal"?Y:f==="mensal"?BL:TXD;
const execLabel=(e:string)=>e==="ia"?"🤖 PS (IA)":e==="humano"?"👤 Operador":"🤝 Híbrido";
const execCor=(e:string)=>e==="ia"?PU:e==="humano"?GO:BL;

export default function RotinasPage(){
  const [companies,setCompanies]=useState<any[]>([]);
  const [rotinas,setRotinas]=useState<any[]>([]);
  const [selectedComp,setSelectedComp]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [msg,setMsg]=useState("");
  const [tab,setTab]=useState("configurar");

  useEffect(()=>{loadData();},[]);

  const loadData=async()=>{
    const{data:comps}=await supabase.from("companies").select("*").order("created_at");
    if(comps)setCompanies(comps);
    const{data:rots}=await supabase.from("bpo_rotinas").select("*");
    if(rots)setRotinas(rots);
    setLoading(false);
  };

  const getCompRotinas=(compId:string)=>rotinas.filter(r=>r.company_id===compId);
  const isRotinaAtiva=(compId:string,tipo:string)=>rotinas.some(r=>r.company_id===compId&&r.tipo===tipo&&r.ativo);

  const toggleRotina=async(compId:string,tipo:string)=>{
    const existing=rotinas.find(r=>r.company_id===compId&&r.tipo===tipo);
    const template=ROTINAS_TIPO.find(t=>t.id===tipo);
    if(!template)return;

    if(existing){
      await supabase.from("bpo_rotinas").update({ativo:!existing.ativo}).eq("id",existing.id);
      setRotinas(rotinas.map(r=>r.id===existing.id?{...r,ativo:!r.ativo}:r));
      setMsg(existing.ativo?"Rotina desativada":"Rotina ativada!");
    }else{
      const{data:{user}}=await supabase.auth.getUser();
      const{data}=await supabase.from("bpo_rotinas").insert({
        company_id:compId,tipo,nome:template.nome,descricao:template.desc,
        frequencia:template.freq,executor:template.executor,ativo:true,
        created_by:user?.id
      }).select().single();
      if(data)setRotinas([...rotinas,data]);
      setMsg("Rotina ativada!");
    }
    setTimeout(()=>setMsg(""),2000);
  };

  const ativarTodas=async(compId:string)=>{
    const{data:{user}}=await supabase.auth.getUser();
    for(const t of ROTINAS_TIPO){
      const exists=rotinas.find(r=>r.company_id===compId&&r.tipo===t.id);
      if(!exists){
        const{data}=await supabase.from("bpo_rotinas").insert({
          company_id:compId,tipo:t.id,nome:t.nome,descricao:t.desc,
          frequencia:t.freq,executor:t.executor,ativo:true,created_by:user?.id
        }).select().single();
        if(data)setRotinas(prev=>[...prev,data]);
      }else if(!exists.ativo){
        await supabase.from("bpo_rotinas").update({ativo:true}).eq("id",exists.id);
        setRotinas(prev=>prev.map(r=>r.id===exists.id?{...r,ativo:true}:r));
      }
    }
    setMsg("Todas as rotinas ativadas!");
    setTimeout(()=>setMsg(""),2000);
  };

  const selectedCompany=companies.find(c=>c.id===selectedComp);
  const compRotinas=selectedComp?getCompRotinas(selectedComp):[];
  const ativasCount=compRotinas.filter(r=>r.ativo).length;
  const iaCount=compRotinas.filter(r=>r.ativo&&r.executor==="ia").length;
  const hibCount=compRotinas.filter(r=>r.ativo&&r.executor==="hibrido").length;
  const humCount=compRotinas.filter(r=>r.ativo&&r.executor==="humano").length;

  // Painel de tarefas do dia (todas as empresas)
  const hoje=new Date();
  const diaSemana=hoje.getDay();
  const diaMes=hoje.getDate();
  const todasRotinasAtivas=rotinas.filter(r=>r.ativo);
  const tarefasHoje=todasRotinasAtivas.filter(r=>{
    if(r.frequencia==="diaria") return true;
    if(r.frequencia==="semanal"&&(diaSemana===1||diaSemana===4)) return true; // seg e qui
    if(r.frequencia==="mensal"&&(diaMes===1||diaMes===5||diaMes===15)) return true;
    return false;
  });

  return(
  <div style={{padding:20,maxWidth:1200,margin:"0 auto",background:BG,minHeight:"100vh"}}>
    {/* Header */}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
      <div>
        <div style={{fontSize:22,fontWeight:700,color:GOL}}>Rotinas BPO — Automação com IA</div>
        <div style={{fontSize:11,color:TXD}}>Configure as tarefas que o PS executa automaticamente para cada cliente</div>
      </div>
      <div style={{display:"flex",gap:8}}>
        <a href="/dashboard/bpo" style={{padding:"8px 16px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← BPO</a>
      </div>
    </div>

    {msg&&<div style={{background:G+"20",border:`1px solid ${G}`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:G}} onClick={()=>setMsg("")}>{msg}</div>}

    {/* Tabs */}
    <div style={{display:"flex",gap:4,marginBottom:16}}>
      {[{id:"configurar",n:"Configurar Rotinas"},{id:"tarefas",n:`Tarefas de Hoje (${tarefasHoje.length})`},{id:"resumo",n:"Resumo por Executor"}].map(t=>(
        <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"8px 16px",borderRadius:20,fontSize:11,border:`1px solid ${tab===t.id?GO:BD}`,background:tab===t.id?GO+"18":"transparent",color:tab===t.id?GOL:TXM,fontWeight:tab===t.id?600:400,cursor:"pointer"}}>{t.n}</button>
      ))}
    </div>

    {/* TAB: CONFIGURAR */}
    {tab==="configurar"&&(
    <div style={{display:"flex",gap:12}}>
      {/* Left: Company list */}
      <div style={{width:260,flexShrink:0}}>
        <div style={{fontSize:12,fontWeight:600,color:TX,marginBottom:8}}>Selecione o cliente</div>
        {companies.map(c=>{
          const cr=getCompRotinas(c.id);
          const ativas=cr.filter(r=>r.ativo).length;
          const isSelected=selectedComp===c.id;
          return(
            <div key={c.id} onClick={()=>setSelectedComp(c.id)} style={{padding:"10px 12px",marginBottom:4,borderRadius:8,cursor:"pointer",border:`1px solid ${isSelected?GO:BD}`,background:isSelected?GO+"12":BG2,transition:"all 0.2s"}}
              onMouseEnter={e=>{if(!isSelected)e.currentTarget.style.background=BG3}} onMouseLeave={e=>{if(!isSelected)e.currentTarget.style.background=isSelected?GO+"12":BG2}}>
              <div style={{fontSize:12,fontWeight:600,color:isSelected?GOL:TX}}>{c.nome_fantasia||c.razao_social}</div>
              <div style={{fontSize:9,color:TXD,marginTop:2}}>
                {ativas>0?<span style={{color:G}}>{ativas} rotinas ativas</span>:<span>Nenhuma rotina</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Right: Routine config */}
      <div style={{flex:1}}>
        {!selectedComp?(
          <div style={{textAlign:"center",padding:60,background:BG2,borderRadius:12,border:`1px solid ${BD}`}}>
            <div style={{fontSize:28,marginBottom:8}}>👈</div>
            <div style={{fontSize:14,color:TXM}}>Selecione um cliente para configurar as rotinas</div>
          </div>
        ):(
          <div>
            {/* Company header */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div>
                <div style={{fontSize:16,fontWeight:700,color:GOL}}>{selectedCompany?.nome_fantasia||selectedCompany?.razao_social}</div>
                <div style={{fontSize:10,color:TXD}}>{ativasCount} rotinas ativas | {iaCount} IA + {hibCount} Híbridas + {humCount} Manuais</div>
              </div>
              <button onClick={()=>ativarTodas(selectedComp)} style={{padding:"8px 16px",borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:11,fontWeight:600,border:"none",cursor:"pointer"}}>Ativar todas</button>
            </div>

            {/* Routines by frequency */}
            {["diaria","semanal","mensal","sob_demanda"].map(freq=>{
              const tiposFreq=ROTINAS_TIPO.filter(t=>t.freq===freq);
              if(tiposFreq.length===0) return null;
              return(
                <div key={freq} style={{marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:600,color:freqCor(freq),marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
                    <span style={{width:8,height:8,borderRadius:"50%",background:freqCor(freq),display:"inline-block"}}/>
                    Rotinas {freqLabel(freq)}s
                  </div>
                  {tiposFreq.map(tipo=>{
                    const ativa=isRotinaAtiva(selectedComp,tipo.id);
                    return(
                      <div key={tipo.id} style={{background:BG2,borderRadius:10,marginBottom:6,border:`1px solid ${ativa?tipo.cor+"40":BD}`,overflow:"hidden"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px"}}>
                          <div style={{display:"flex",alignItems:"center",gap:10,flex:1}}>
                            <span style={{fontSize:20}}>{tipo.icon}</span>
                            <div>
                              <div style={{fontSize:12,fontWeight:600,color:ativa?TX:TXD}}>{tipo.nome}</div>
                              <div style={{fontSize:9,color:TXD,marginTop:2}}>{tipo.desc}</div>
                            </div>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <span style={{fontSize:9,padding:"2px 8px",borderRadius:6,background:execCor(tipo.executor)+"15",color:execCor(tipo.executor),border:`1px solid ${execCor(tipo.executor)}30`}}>{execLabel(tipo.executor)}</span>
                            <div onClick={()=>toggleRotina(selectedComp,tipo.id)} style={{width:40,height:22,borderRadius:11,background:ativa?G:BD,cursor:"pointer",transition:"background 0.2s",position:"relative"}}>
                              <div style={{width:18,height:18,borderRadius:"50%",background:"white",position:"absolute",top:2,left:ativa?20:2,transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.3)"}}/>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>)}

    {/* TAB: TAREFAS DE HOJE */}
    {tab==="tarefas"&&(
    <div>
      <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:12}}>
        Tarefas para hoje — {hoje.toLocaleDateString("pt-BR")}
        <span style={{fontSize:11,color:TXD,marginLeft:8}}>{tarefasHoje.length} tarefas de {companies.length} clientes</span>
      </div>
      {tarefasHoje.length===0?(
        <div style={{textAlign:"center",padding:40,background:BG2,borderRadius:12,border:`1px solid ${BD}`}}>
          <div style={{fontSize:28,marginBottom:8}}>✅</div>
          <div style={{fontSize:14,color:G}}>Nenhuma tarefa pendente para hoje!</div>
          <div style={{fontSize:11,color:TXD,marginTop:4}}>Configure rotinas na aba "Configurar Rotinas"</div>
        </div>
      ):(
        <div>
          {companies.map(comp=>{
            const compTarefas=tarefasHoje.filter(t=>t.company_id===comp.id);
            if(compTarefas.length===0)return null;
            return(
              <div key={comp.id} style={{marginBottom:12}}>
                <div style={{fontSize:12,fontWeight:600,color:GOL,marginBottom:6}}>{comp.nome_fantasia||comp.razao_social}</div>
                {compTarefas.map((t,i)=>{
                  const template=ROTINAS_TIPO.find(rt=>rt.id===t.tipo);
                  return(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:BG2,borderRadius:8,marginBottom:3,border:`1px solid ${BD}`,borderLeft:`3px solid ${template?.cor||TXD}`}}>
                      <span style={{fontSize:16}}>{template?.icon||"📋"}</span>
                      <div style={{flex:1}}>
                        <div style={{fontSize:11,fontWeight:600,color:TX}}>{t.nome}</div>
                        <div style={{fontSize:9,color:TXD}}>{freqLabel(t.frequencia)} | {execLabel(t.executor)}</div>
                      </div>
                      <span style={{fontSize:9,padding:"3px 10px",borderRadius:6,background:t.executor==="ia"?PU+"20":Y+"20",color:t.executor==="ia"?PU:Y,fontWeight:600}}>
                        {t.executor==="ia"?"Auto":"Pendente"}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>)}

    {/* TAB: RESUMO */}
    {tab==="resumo"&&(
    <div>
      <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:12}}>Resumo de automação por executor</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:20}}>
        {[
          {label:"🤖 PS (IA) — Automático",items:ROTINAS_TIPO.filter(t=>t.executor==="ia"),cor:PU,desc:"Executadas automaticamente pelo PS sem intervenção humana"},
          {label:"🤝 Híbrido — IA + Humano",items:ROTINAS_TIPO.filter(t=>t.executor==="hibrido"),cor:BL,desc:"IA faz 80-90%, operador valida e resolve exceções"},
          {label:"👤 Operador — Manual",items:ROTINAS_TIPO.filter(t=>t.executor==="humano"),cor:GO,desc:"Requer ação humana mas com assistência do PS"},
        ].map((g,gi)=>(
          <div key={gi} style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden"}}>
            <div style={{padding:"10px 14px",borderBottom:`1px solid ${BD}`,background:g.cor+"10"}}>
              <div style={{fontSize:13,fontWeight:600,color:g.cor}}>{g.label}</div>
              <div style={{fontSize:9,color:TXD,marginTop:2}}>{g.desc}</div>
            </div>
            <div style={{padding:10}}>
              {g.items.map((item,ii)=>(
                <div key={ii} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:ii<g.items.length-1?`1px solid ${BD}30`:"none"}}>
                  <span style={{fontSize:14}}>{item.icon}</span>
                  <div>
                    <div style={{fontSize:11,color:TX}}>{item.nome}</div>
                    <div style={{fontSize:8,color:TXD}}>{freqLabel(item.freq)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{background:BG2,borderRadius:12,padding:16,border:`1px solid ${BD}`}}>
        <div style={{fontSize:13,fontWeight:600,color:GOL,marginBottom:8}}>Impacto da automação</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
          {[
            {l:"Total de rotinas",v:"14",c:GOL},
            {l:"Automáticas (IA)",v:`${ROTINAS_TIPO.filter(t=>t.executor==="ia").length}`,c:PU},
            {l:"Tempo manual estimado",v:"16h/cliente",c:R},
            {l:"Tempo com PS",v:"15min/cliente",c:G},
          ].map((k,i)=>(
            <div key={i} style={{background:BG3,borderRadius:8,padding:10,textAlign:"center"}}>
              <div style={{fontSize:9,color:TXD}}>{k.l}</div>
              <div style={{fontSize:18,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>)}
  </div>);
}
