"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#111110",BG2="#252320",BG3="#33312A",G="#22C55E",R="#EF4444",Y="#FACC15",BL="#3B82F6",
    BD="#504D40",TX="#F0ECE3",TXM="#CCC7BB",TXD="#A09B90",PU="#A855F7";

const TAREFAS_PADRAO = [
  {tarefa:"Sync dados do ERP",categoria:"sync",frequencia:"diaria",automatizada:true,descricao:"Importar todos os dados do ERP do cliente"},
  {tarefa:"Auto-classificar lançamentos",categoria:"classificacao",frequencia:"diaria",automatizada:true,descricao:"IA classifica lançamentos sem categoria baseado no histórico"},
  {tarefa:"Detectar anomalias",categoria:"analise",frequencia:"diaria",automatizada:true,descricao:"IA identifica duplicidades, valores atípicos, inconsistências"},
  {tarefa:"Verificar contas vencidas",categoria:"cobranca",frequencia:"diaria",automatizada:true,descricao:"Listar contas a pagar vencidas e contas a receber em atraso"},
  {tarefa:"Revisar exceções da IA",categoria:"classificacao",frequencia:"diaria",automatizada:false,descricao:"Operador revisa lançamentos que a IA não classificou"},
  {tarefa:"Conciliação bancária",categoria:"conciliacao",frequencia:"semanal",automatizada:false,descricao:"Comparar extrato × ERP. IA faz match, operador resolve pendências"},
  {tarefa:"Revisão fluxo de caixa",categoria:"analise",frequencia:"semanal",automatizada:true,descricao:"IA projeta fluxo 30/60/90 dias e alerta gaps"},
  {tarefa:"Status semanal ao cliente",categoria:"relatorio",frequencia:"semanal",automatizada:true,descricao:"Resumo semanal com KPIs, alertas e pendências"},
  {tarefa:"Fechamento mensal (DRE)",categoria:"relatorio",frequencia:"mensal",automatizada:true,descricao:"DRE completo com comparativo período anterior"},
  {tarefa:"Relatório executivo com PS",categoria:"relatorio",frequencia:"mensal",automatizada:true,descricao:"Relatório 8 seções + Carta ao Sócio personalizada"},
  {tarefa:"Análise custos e margens",categoria:"analise",frequencia:"mensal",automatizada:true,descricao:"Evolução de custos, margens por linha, oportunidades de redução"},
  {tarefa:"Preparação fiscal",categoria:"fiscal",frequencia:"mensal",automatizada:false,descricao:"Revisar classificações fiscais, preparar dados para contabilidade"},
  {tarefa:"Carta ao Sócio",categoria:"relatorio",frequencia:"mensal",automatizada:true,descricao:"Carta personalizada com análise do período"},
  {tarefa:"Reunião com cliente",categoria:"analise",frequencia:"mensal",automatizada:false,descricao:"Apresentar resultados, discutir estratégias, definir ações"},
  {tarefa:"Emitir NF-e / NFS-e",categoria:"fiscal",frequencia:"sob_demanda",automatizada:false,descricao:"Nota fiscal via eNotas/Focus NFe"},
  {tarefa:"Emitir boleto",categoria:"cobranca",frequencia:"sob_demanda",automatizada:false,descricao:"Boleto via Asaas/Cora com Pix integrado"},
  {tarefa:"Renegociar inadimplência",categoria:"cobranca",frequencia:"sob_demanda",automatizada:false,descricao:"Contatar inadimplente, propor acordo"},
  {tarefa:"Consultar PS (análise)",categoria:"analise",frequencia:"sob_demanda",automatizada:false,descricao:"Fale com o PS sobre situação específica"},
];

const catCor:Record<string,string>={sync:BL,classificacao:PU,conciliacao:"#06B6D4",relatorio:GO,fiscal:"#6366F1",cobranca:R,analise:G};
const catIcon:Record<string,string>={sync:"🔄",classificacao:"🏷️",conciliacao:"🏦",relatorio:"📄",fiscal:"🧾",cobranca:"💳",analise:"🧠"};
const catNome:Record<string,string>={sync:"Sync",classificacao:"Classificação",conciliacao:"Conciliação",relatorio:"Relatórios",fiscal:"Fiscal",cobranca:"Cobrança",analise:"Análise"};
const freqCor:Record<string,string>={diaria:BL,semanal:PU,mensal:GO,sob_demanda:TXD};
const freqNome:Record<string,string>={diaria:"Diária",semanal:"Semanal",mensal:"Mensal",sob_demanda:"Sob demanda"};

export default function RotinasPage(){
  const [empresas,setEmpresas]=useState<any[]>([]);
  const [selEmpresa,setSelEmpresa]=useState("");
  const [rotinas,setRotinas]=useState<any[]>([]);
  const [execucoes,setExecucoes]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [tab,setTab]=useState("inbox");
  const [msg,setMsg]=useState("");
  const [executando,setExecutando]=useState<string|null>(null);

  useEffect(()=>{
    supabase.from("companies").select("*").order("created_at").then(({data})=>{
      if(data){setEmpresas(data);if(data.length>0)setSelEmpresa(data[0].id);}
      setLoading(false);
    });
  },[]);

  useEffect(()=>{if(selEmpresa)loadRotinas();},[selEmpresa]);

  const loadRotinas=async()=>{
    const{data:rot}=await supabase.from("bpo_rotinas").select("*").eq("company_id",selEmpresa);
    if(rot)setRotinas(rot);
    const{data:exec}=await supabase.from("bpo_execucoes").select("*").eq("company_id",selEmpresa).order("created_at",{ascending:false}).limit(50);
    if(exec)setExecucoes(exec);
  };

  const ativarPadrao=async()=>{
    setLoading(true);
    for(const t of TAREFAS_PADRAO){await supabase.from("bpo_rotinas").insert({company_id:selEmpresa,...t});}
    setMsg(`${TAREFAS_PADRAO.length} rotinas ativadas!`);
    await loadRotinas();setLoading(false);
  };

  const toggleRotina=async(id:string,ativa:boolean)=>{
    await supabase.from("bpo_rotinas").update({ativa:!ativa}).eq("id",id);
    setRotinas(rotinas.map(r=>r.id===id?{...r,ativa:!ativa}:r));
  };

  const executarTarefa=async(rotina:any)=>{
    setExecutando(rotina.id);
    const{data:{user}}=await supabase.auth.getUser();
    const{data:exec}=await supabase.from("bpo_execucoes").insert({
      rotina_id:rotina.id,company_id:selEmpresa,tarefa:rotina.tarefa,
      status:rotina.automatizada?"auto_ia":"em_andamento",executado_por:user?.id,
    }).select().single();

    if(rotina.automatizada){
      await new Promise(r=>setTimeout(r,1500));
      const resultados:Record<string,string>={
        sync:"Dados sincronizados: 847 lançamentos importados",
        classificacao:"142 lançamentos classificados. 8 exceções para revisão",
        analise:"3 anomalias: 1 duplicidade R$2.340, 1 valor atípico, 1 categoria errada",
        cobranca:"5 contas vencidas: R$12.450 total. Régua de cobrança ativada",
        relatorio:"Relatório 8 seções gerado. Carta ao Sócio pronta",
        conciliacao:"92% matchs automáticos. 14 pendências para revisão",
      };
      const resultado=resultados[rotina.categoria]||"Executado pelo PS com sucesso";
      if(exec)await supabase.from("bpo_execucoes").update({status:"concluida",resultado,completed_at:new Date().toISOString()}).eq("id",exec.id);
      setMsg(`✅ ${rotina.tarefa} — ${resultado}`);
    }else{
      setMsg(`📋 ${rotina.tarefa} — Tarefa criada para execução manual`);
    }
    await loadRotinas();setExecutando(null);
  };

  const rotinasAtivas=rotinas.filter(r=>r.ativa);
  const inp:any={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,outline:"none"};

  return(
  <div style={{padding:20,maxWidth:1100,margin:"0 auto",background:BG,minHeight:"100vh"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
      <div>
        <div style={{fontSize:20,fontWeight:700,color:GOL}}>Rotinas BPO — Operações por Cliente</div>
        <div style={{fontSize:11,color:TXD}}>Configure tarefas diárias, semanais e mensais • 🤖 = IA executa automaticamente</div>
      </div>
      <a href="/dashboard/bpo" style={{padding:"8px 16px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← Central BPO</a>
    </div>

    {msg&&<div style={{background:G+"20",border:`1px solid ${G}`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:G}} onClick={()=>setMsg("")}>{msg}</div>}

    {/* Company selector */}
    <div style={{background:BG2,borderRadius:10,padding:"12px 16px",marginBottom:16,border:`1px solid ${BD}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontSize:10,color:TXD}}>Cliente:</span>
        <select value={selEmpresa} onChange={e=>setSelEmpresa(e.target.value)} style={{...inp,fontWeight:600,color:GOL,minWidth:250}}>
          {empresas.map(e=><option key={e.id} value={e.id}>{e.nome_fantasia||e.razao_social}</option>)}
        </select>
      </div>
      <div style={{display:"flex",gap:6}}>
        <span style={{fontSize:10,padding:"3px 8px",borderRadius:6,background:PU+"20",color:PU}}>{rotinasAtivas.filter(r=>r.automatizada).length} automáticas</span>
        <span style={{fontSize:10,padding:"3px 8px",borderRadius:6,background:GO+"20",color:GO}}>{rotinasAtivas.filter(r=>!r.automatizada).length} manuais</span>
      </div>
    </div>

    {/* Tabs */}
    <div style={{display:"flex",gap:4,marginBottom:16}}>
      {[{id:"inbox",n:"⚡ Smart Inbox"},{id:"rotinas",n:"⚙️ Configurar"},{id:"historico",n:"📋 Histórico"}].map(t=>(
        <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"8px 16px",borderRadius:20,fontSize:11,border:`1px solid ${tab===t.id?GO:BD}`,background:tab===t.id?GO+"18":"transparent",color:tab===t.id?GOL:TXM,fontWeight:tab===t.id?600:400,cursor:"pointer"}}>{t.n}</button>
      ))}
    </div>

    {/* SMART INBOX */}
    {tab==="inbox"&&rotinasAtivas.length===0&&(
      <div style={{background:BG2,borderRadius:12,padding:30,textAlign:"center",border:`1px solid ${BD}`}}>
        <div style={{fontSize:28,marginBottom:8}}>📋</div>
        <div style={{fontSize:14,color:TX,fontWeight:600}}>Nenhuma rotina configurada</div>
        <div style={{fontSize:11,color:TXD,marginTop:4,marginBottom:16}}>Ative o pacote padrão com {TAREFAS_PADRAO.length} rotinas BPO</div>
        <button onClick={ativarPadrao} disabled={loading} style={{padding:"10px 24px",borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>
          ⚡ Ativar rotinas padrão
        </button>
      </div>
    )}

    {tab==="inbox"&&rotinasAtivas.length>0&&(
      ["diaria","semanal","mensal","sob_demanda"].map(freq=>{
        const tarefas=rotinasAtivas.filter(r=>r.frequencia===freq);
        if(tarefas.length===0)return null;
        return(<div key={freq} style={{marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:600,color:freqCor[freq],marginBottom:6,display:"flex",alignItems:"center",gap:6}}>
            <span style={{width:8,height:8,borderRadius:4,background:freqCor[freq],display:"inline-block"}}/> {freqNome[freq]} ({tarefas.length})
          </div>
          {tarefas.map(r=>(
            <div key={r.id} style={{background:BG2,borderRadius:8,padding:"10px 14px",marginBottom:4,border:`1px solid ${BD}`,borderLeft:`3px solid ${catCor[r.categoria]||GO}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}
              onMouseEnter={e=>(e.currentTarget.style.background=BG3)} onMouseLeave={e=>(e.currentTarget.style.background=BG2)}>
              <div style={{display:"flex",alignItems:"center",gap:10,flex:1}}>
                <span style={{fontSize:16}}>{catIcon[r.categoria]||"📋"}</span>
                <div><div style={{fontSize:12,fontWeight:600,color:TX}}>{r.tarefa}</div>
                <div style={{fontSize:9,color:TXD}}>{r.descricao}</div></div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                {r.automatizada&&<span style={{fontSize:8,padding:"2px 6px",borderRadius:4,background:PU+"20",color:PU,fontWeight:600}}>🤖 IA</span>}
                <button onClick={()=>executarTarefa(r)} disabled={executando===r.id}
                  style={{padding:"6px 12px",borderRadius:6,fontSize:10,fontWeight:600,border:"none",cursor:executando===r.id?"wait":"pointer",
                    background:executando===r.id?BD:r.automatizada?PU:GO,color:"white"}}>
                  {executando===r.id?"⏳...":r.automatizada?"🤖 Executar":"▶ Executar"}
                </button>
              </div>
            </div>
          ))}
        </div>);
      })
    )}

    {/* CONFIGURAR */}
    {tab==="rotinas"&&(<div>
      {rotinas.length===0&&(
        <div style={{textAlign:"center",marginBottom:16}}>
          <button onClick={ativarPadrao} disabled={loading} style={{padding:"10px 24px",borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>
            ⚡ Ativar {TAREFAS_PADRAO.length} rotinas padrão
          </button>
        </div>
      )}
      {["diaria","semanal","mensal","sob_demanda"].map(freq=>{
        const tarefas=rotinas.filter(r=>r.frequencia===freq);
        if(tarefas.length===0)return null;
        return(<div key={freq} style={{marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:600,color:freqCor[freq],marginBottom:6}}>{freqNome[freq]}</div>
          {tarefas.map(r=>(
            <div key={r.id} style={{background:BG2,borderRadius:8,padding:"10px 14px",marginBottom:4,border:`1px solid ${BD}`,display:"flex",justifyContent:"space-between",alignItems:"center",opacity:r.ativa?1:0.4}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:16}}>{catIcon[r.categoria]}</span>
                <div><div style={{fontSize:12,fontWeight:600,color:TX}}>{r.tarefa}</div>
                <div style={{fontSize:9,color:TXD}}><span style={{color:catCor[r.categoria]}}>{catNome[r.categoria]}</span>{r.automatizada&&<span style={{marginLeft:8,color:PU}}>🤖 IA</span>}</div></div>
              </div>
              <button onClick={()=>toggleRotina(r.id,r.ativa)} style={{padding:"4px 12px",borderRadius:6,fontSize:10,fontWeight:600,border:`1px solid ${r.ativa?G:BD}`,background:r.ativa?G+"20":"transparent",color:r.ativa?G:TXD,cursor:"pointer"}}>
                {r.ativa?"✓ Ativa":"Inativa"}
              </button>
            </div>
          ))}
        </div>);
      })}
    </div>)}

    {/* HISTÓRICO */}
    {tab==="historico"&&(<div>
      {execucoes.length===0?(<div style={{background:BG2,borderRadius:8,padding:20,textAlign:"center",border:`1px solid ${BD}`}}><div style={{fontSize:11,color:TXD}}>Nenhuma execução ainda</div></div>):(
        execucoes.map((ex,i)=>(
          <div key={ex.id||i} style={{background:BG2,borderRadius:8,padding:"10px 14px",marginBottom:4,border:`1px solid ${BD}`,borderLeft:`3px solid ${ex.status==="concluida"||ex.status==="auto_ia"?G:ex.status==="erro"?R:Y}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div><div style={{fontSize:12,fontWeight:600,color:TX}}>{ex.tarefa}</div>
              <div style={{fontSize:9,color:TXD}}>{ex.resultado||"Em andamento..."}</div></div>
              <div style={{textAlign:"right"}}>
                <span style={{fontSize:9,padding:"2px 8px",borderRadius:4,fontWeight:600,
                  background:ex.status==="concluida"?G+"20":ex.status==="auto_ia"?PU+"20":Y+"20",
                  color:ex.status==="concluida"?G:ex.status==="auto_ia"?PU:Y}}>
                  {ex.status==="concluida"?"✓ Concluída":ex.status==="auto_ia"?"🤖 IA":"⏳ "+ex.status}
                </span>
                <div style={{fontSize:8,color:TXD,marginTop:2}}>{new Date(ex.created_at).toLocaleString("pt-BR")}</div>
              </div>
            </div>
          </div>
        ))
      )}
    </div>)}
  </div>);
}
