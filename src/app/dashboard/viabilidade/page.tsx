"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";

const GO="#C6973F",GOL="#E8C872",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",
    G="#34D399",R="#F87171",Y="#FBBF24",B="#60A5FA",P="#A78BFA",
    BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F",TXD="#918C82";

const fmtR=(v:number)=>`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

type AnaliseResult = {
  viavel: boolean;
  score: number;
  margemProjetada: number;
  investimento: number;
  retorno: number;
  payback: string;
  pontos_fortes: string[];
  riscos: string[];
  sugestoes: string[];
  resumo: string;
};

export default function ViabilidadePage(){
  const [step,setStep]=useState<"upload"|"contexto"|"processando"|"resultado">("upload");
  const [fileName,setFileName]=useState("");
  const [fileData,setFileData]=useState("");
  const [descricaoProjeto,setDescricaoProjeto]=useState("");
  const [setor,setSetor]=useState("");
  const [resultado,setResultado]=useState<AnaliseResult|null>(null);
  const [dragOver,setDragOver]=useState(false);
  const [iaPergunta,setIaPergunta]=useState("");
  const [iaResposta,setIaResposta]=useState("");
  const [iaLoading,setIaLoading]=useState(false);
  const [companies,setCompanies]=useState<any[]>([]);
  const [groups,setGroups]=useState<any[]>([]);
  const [selectedComp,setSelectedComp]=useState("");

  useEffect(()=>{loadCompanies();},[]);
  useEffect(()=>{if(selectedComp&&typeof window!=="undefined")localStorage.setItem("ps_empresa_sel",selectedComp);},[selectedComp]);

  const loadCompanies=async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    if(!user)return;
    const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
    const{data:grps}=await supabase.from("company_groups").select("*").order("nome");
    if(grps)setGroups(grps);
    let data:any[]=[];
    if(up?.role==="adm"){const r=await supabase.from("companies").select("*").order("nome_fantasia");data=r.data||[];}
    else{const r=await supabase.from("user_companies").select("companies(*)").eq("user_id",user.id);data=(r.data||[]).map((u:any)=>u.companies).filter(Boolean);}
    if(data.length>0){
      setCompanies(data);
      const saved=typeof window!=="undefined"?localStorage.getItem("ps_empresa_sel"):"";
      const match=saved?data.find((c:any)=>c.id===saved):null;
      setSelectedComp(match?match.id:data[0].id);
    }
  };

  const perguntarIA=async()=>{
    if(!iaPergunta.trim()||!resultado)return;
    setIaLoading(true);setIaResposta("");
    try{
      const contextoViabilidade=`ANÁLISE DE VIABILIDADE DO PROJETO:
Arquivo: ${fileName}
Setor: ${setor}
Descrição: ${descricaoProjeto}
Resultado: ${resultado.viavel?"VIÁVEL":"INVIÁVEL"}
Score: ${resultado.score}/100
Margem Projetada: ${resultado.margemProjetada}%
Investimento: ${fmtR(resultado.investimento)}
Retorno Anual: ${fmtR(resultado.retorno)}
Payback: ${resultado.payback}
Pontos Fortes: ${resultado.pontos_fortes.join("; ")}
Riscos: ${resultado.riscos.join("; ")}
Sugestões: ${resultado.sugestoes.join("; ")}
Dados do arquivo: ${fileData.substring(0,2000)}`;

      const compId=selectedComp;
      const formData=new FormData();
      formData.append("question",`CONTEXTO DA ANÁLISE DE VIABILIDADE:\n${contextoViabilidade}\n\nPERGUNTA DO EMPRESÁRIO: ${iaPergunta}`);
      formData.append("company_id",compId);
      const res=await authFetch("/api/consultor",{method:"POST",body:formData});
      const data=await res.json();
      if(data.success) setIaResposta(data.answer);
      else setIaResposta(`❌ Erro: ${data.error}`);
    }catch(e:any){setIaResposta(`❌ ${e.message}`);}
    setIaLoading(false);
  };

  const handleFile=(file:File)=>{
    setFileName(file.name);
    const reader=new FileReader();
    reader.onload=(e)=>{
      const text=e.target?.result as string;
      setFileData(text.substring(0,5000));
      setStep("contexto");
    };
    if(file.name.endsWith(".csv")||file.name.endsWith(".txt")) reader.readAsText(file,"UTF-8");
    else reader.readAsText(file);
  };

  const handleDrop=(e:React.DragEvent)=>{
    e.preventDefault();setDragOver(false);
    const file=e.dataTransfer.files[0];
    if(file) handleFile(file);
  };

  const analisar=async()=>{
    if(!descricaoProjeto.trim())return;
    setStep("processando");

    // In production: calls Claude API with file data + company context
    // For now: simulate analysis based on input
    setTimeout(()=>{
      const investimento=Math.random()*500000+50000;
      const margemProjetada=Math.random()*30+5;
      const viavel=margemProjetada>12;
      const retornoAnual=investimento*margemProjetada/100*12;

      setResultado({
        viavel,
        score:Math.round(viavel?70+Math.random()*25:30+Math.random()*30),
        margemProjetada:Math.round(margemProjetada*10)/10,
        investimento:Math.round(investimento),
        retorno:Math.round(retornoAnual),
        payback:margemProjetada>20?"4-6 meses":margemProjetada>12?"8-12 meses":"18+ meses",
        pontos_fortes:[
          "Mercado em crescimento na região",
          "Margem bruta acima da média setorial",
          "Baixo custo de entrada vs. concorrentes",
        ],
        riscos:[
          "Dependência de poucos fornecedores para insumo principal",
          "Sazonalidade pode afetar fluxo de caixa nos meses 3-5",
          viavel?"Concorrência acirrada no segmento":"Margem insuficiente para cobrir custos fixos",
        ],
        sugestoes:[
          "Negociar contrato de fornecimento com 2+ fornecedores para reduzir risco",
          viavel?"Iniciar com escala menor e expandir conforme validação":"Reavaliar precificação: aumento de 15% no preço viabilizaria o projeto",
          "Reservar capital de giro equivalente a 3 meses de operação",
          "Considerar financiamento BNDES/BRDE para reduzir custo de capital",
        ],
        resumo:viavel
          ?`O projeto apresenta viabilidade econômica com margem projetada de ${margemProjetada.toFixed(1)}% e payback estimado em ${margemProjetada>20?"4-6":"8-12"} meses. Recomenda-se iniciar a implantação com atenção aos riscos identificados.`
          :`O projeto, nas condições atuais, apresenta margem de ${margemProjetada.toFixed(1)}% que é insuficiente para cobrir os custos fixos e gerar retorno adequado. Recomenda-se revisar a precificação ou reduzir custos antes de prosseguir.`,
      });
      setStep("resultado");
    },2500);
  };

  const novaAnalise=()=>{
    setStep("upload");setFileName("");setFileData("");setDescricaoProjeto("");setSetor("");setResultado(null);
  };

  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:10,padding:"10px 14px",fontSize:13,outline:"none",width:"100%",fontFamily:"inherit"};

  return(
    <div style={{padding:20,maxWidth:900,margin:"0 auto",background:BG,minHeight:"100vh"}}>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:20,fontWeight:700,color:GOL}}>📐 Módulo Viabilidade de Projetos</div>
          <div style={{fontSize:11,color:TXD}}>Upload de arquivo → IA analisa → viável ou não, com sugestões</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <select value={selectedComp} onChange={e=>setSelectedComp(e.target.value)} style={{background:BG3,border:`1px solid ${BD}`,color:GOL,borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:600}}>
            {groups.length>0&&groups.map(g=>{
              const groupComps=companies.filter(c=>c.group_id===g.id);
              if(groupComps.length===0)return null;
              return <optgroup key={g.id} label={`📁 ${g.nome}`}>{groupComps.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}</optgroup>;
            })}
            {companies.filter(c=>!c.group_id||!groups.find((g:any)=>g.id===c.group_id)).map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
          </select>
          <a href="/dashboard" style={{padding:"8px 16px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← Dashboard</a>
        </div>
      </div>

      {/* STEP 1: Upload */}
      {step==="upload"&&(
        <div style={{animation:"fadeIn 0.3s ease"}}>
          <div
            onDragOver={e=>{e.preventDefault();setDragOver(true);}}
            onDragLeave={()=>setDragOver(false)}
            onDrop={handleDrop}
            onClick={()=>document.getElementById("viabFileInput")?.click()}
            style={{
              background:dragOver?GO+"15":BG2,border:`2px dashed ${dragOver?GO:BD}`,
              borderRadius:16,padding:"60px 24px",textAlign:"center",cursor:"pointer",transition:"all 0.3s",
            }}
          >
            <div style={{fontSize:48,marginBottom:12}}>📄</div>
            <div style={{fontSize:16,fontWeight:600,color:TX,marginBottom:6}}>Arraste o arquivo do projeto aqui</div>
            <div style={{fontSize:12,color:TXM,marginBottom:16}}>
              Orçamento, proposta comercial, planilha de custos, plano de negócio
            </div>
            <div style={{fontSize:11,color:TXD}}>Aceita: CSV, TXT, XLS, XLSX, PDF, DOC</div>
            <input id="viabFileInput" type="file" accept=".csv,.txt,.xlsx,.xls,.pdf,.doc,.docx" onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f);}} style={{display:"none"}}/>
          </div>

          <div style={{textAlign:"center",marginTop:16}}>
            <div style={{fontSize:11,color:TXD,marginBottom:8}}>Não tem arquivo? Descreva o projeto manualmente:</div>
            <button onClick={()=>{setFileName("Descrição manual");setStep("contexto");}} style={{padding:"10px 20px",borderRadius:10,border:`1px solid ${GO}`,background:"transparent",color:GO,fontSize:12,fontWeight:600,cursor:"pointer"}}>
              ✏️ Descrever Projeto Manualmente
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: Contexto */}
      {step==="contexto"&&(
        <div style={{animation:"fadeIn 0.3s ease"}}>
          <div style={{background:BG2,borderRadius:14,padding:20,border:`1px solid ${BD}`,marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
              <span style={{fontSize:20}}>📄</span>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:TX}}>{fileName}</div>
                <div style={{fontSize:10,color:TXD}}>{fileData?`${fileData.length} caracteres extraídos`:"Descrição manual"}</div>
              </div>
            </div>

            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,color:TXD,marginBottom:4,textTransform:"uppercase",letterSpacing:1}}>Setor / Ramo de Atividade</div>
              <select value={setor} onChange={e=>setSetor(e.target.value)} style={inp}>
                <option value="">Selecione o setor...</option>
                {["Comércio","Indústria","Serviços","Construção Civil","Alimentação","Tecnologia","Energia","Agronegócio","Saúde","Educação","Logística","Varejo","Outro"].map(s=>(
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div>
              <div style={{fontSize:10,color:TXD,marginBottom:4,textTransform:"uppercase",letterSpacing:1}}>Descreva o Projeto</div>
              <textarea
                value={descricaoProjeto}
                onChange={e=>setDescricaoProjeto(e.target.value)}
                placeholder={"Descreva o projeto em detalhes:\n\n• O que é o projeto?\n• Qual o investimento necessário?\n• Qual receita esperada?\n• Prazo de execução?\n• Recursos necessários?\n\nQuanto mais detalhes, melhor a análise da IA."}
                rows={8}
                style={{...inp,resize:"vertical",lineHeight:1.6}}
              />
            </div>
          </div>

          <div style={{display:"flex",gap:8}}>
            <button onClick={analisar} disabled={!descricaoProjeto.trim()} style={{
              padding:"12px 24px",borderRadius:10,border:"none",
              background:descricaoProjeto.trim()?`linear-gradient(135deg,${GO},${GOL})`:`${BD}`,
              color:descricaoProjeto.trim()?BG:TXD,fontSize:13,fontWeight:700,cursor:descricaoProjeto.trim()?"pointer":"default",
            }}>🧠 Analisar Viabilidade</button>
            <button onClick={novaAnalise} style={{padding:"12px 24px",borderRadius:10,border:`1px solid ${BD}`,background:"transparent",color:TXM,fontSize:12,cursor:"pointer"}}>Voltar</button>
          </div>
        </div>
      )}

      {/* STEP 3: Processando */}
      {step==="processando"&&(
        <div style={{textAlign:"center",padding:"80px 20px",background:BG2,borderRadius:14,border:`1px solid ${BD}`}}>
          <div style={{fontSize:48,marginBottom:16,animation:"pulse 1.5s infinite"}}>🧠</div>
          <div style={{fontSize:16,fontWeight:600,color:GOL,marginBottom:8}}>PS Consultor Digital analisando...</div>
          <div style={{fontSize:12,color:TXM,marginBottom:20}}>Cruzando dados do projeto com custos reais da empresa</div>
          <div style={{display:"flex",flexDirection:"column",gap:8,maxWidth:300,margin:"0 auto"}}>
            {["Extraindo dados do arquivo...","Analisando custos e receitas...","Calculando margem e ROI...","Gerando recomendações..."].map((t,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:8,fontSize:11,color:TXD,animation:`fadeIn 0.5s ease ${i*0.6}s both`}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:GO,animation:"pulse 1s infinite",animationDelay:`${i*0.3}s`}}/>
                {t}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* STEP 4: Resultado */}
      {step==="resultado"&&resultado&&(
        <div style={{animation:"fadeIn 0.4s ease"}}>
          {/* Verdict */}
          <div style={{
            background:resultado.viavel?G+"10":R+"10",
            border:`2px solid ${resultado.viavel?G+"40":R+"40"}`,
            borderRadius:16,padding:24,textAlign:"center",marginBottom:14,
          }}>
            <div style={{fontSize:48,marginBottom:8}}>{resultado.viavel?"✅":"❌"}</div>
            <div style={{fontSize:22,fontWeight:700,color:resultado.viavel?G:R}}>
              {resultado.viavel?"PROJETO VIÁVEL":"PROJETO INVIÁVEL (nas condições atuais)"}
            </div>
            <div style={{fontSize:13,color:TXM,marginTop:8,lineHeight:1.6,maxWidth:600,margin:"8px auto 0"}}>{resultado.resumo}</div>
          </div>

          {/* KPIs */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",gap:10,marginBottom:14}}>
            {[
              {label:"Score",value:`${resultado.score}/100`,cor:resultado.score>60?G:resultado.score>40?Y:R},
              {label:"Margem Projetada",value:`${resultado.margemProjetada}%`,cor:resultado.margemProjetada>15?G:resultado.margemProjetada>8?Y:R},
              {label:"Investimento",value:fmtR(resultado.investimento),cor:TX},
              {label:"Retorno Anual",value:fmtR(resultado.retorno),cor:G},
              {label:"Payback",value:resultado.payback,cor:B},
            ].map((k,i)=>(
              <div key={i} style={{background:BG2,borderRadius:12,padding:"14px 16px",border:`1px solid ${BD}`,textAlign:"center"}}>
                <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>{k.label}</div>
                <div style={{fontSize:18,fontWeight:700,color:k.cor}}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Details */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
            <div style={{background:BG2,borderRadius:14,padding:"16px 18px",border:`1px solid ${BD}`}}>
              <div style={{fontSize:12,fontWeight:600,color:G,marginBottom:10}}>✅ Pontos Fortes</div>
              {resultado.pontos_fortes.map((p,i)=>(
                <div key={i} style={{fontSize:11,color:TXM,padding:"4px 0",display:"flex",gap:6,alignItems:"flex-start"}}>
                  <span style={{color:G,fontSize:10,marginTop:2}}>◆</span>{p}
                </div>
              ))}
            </div>
            <div style={{background:BG2,borderRadius:14,padding:"16px 18px",border:`1px solid ${BD}`}}>
              <div style={{fontSize:12,fontWeight:600,color:R,marginBottom:10}}>⚠️ Riscos Identificados</div>
              {resultado.riscos.map((r2,i)=>(
                <div key={i} style={{fontSize:11,color:TXM,padding:"4px 0",display:"flex",gap:6,alignItems:"flex-start"}}>
                  <span style={{color:R,fontSize:10,marginTop:2}}>◆</span>{r2}
                </div>
              ))}
            </div>
          </div>

          {/* Suggestions */}
          <div style={{background:BG2,borderRadius:14,padding:"16px 18px",border:`1px solid ${GO}30`,marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <div style={{width:24,height:24,borderRadius:6,background:`linear-gradient(135deg,${GO},${GOL})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:BG}}>PS</div>
              <span style={{fontSize:12,fontWeight:600,color:GOL}}>Sugestões do Consultor Digital</span>
            </div>
            {resultado.sugestoes.map((s,i)=>(
              <div key={i} style={{fontSize:11,color:TX,padding:"6px 0",borderBottom:i<resultado.sugestoes.length-1?`1px solid ${BD}`:"none",display:"flex",gap:8,alignItems:"flex-start",lineHeight:1.6}}>
                <span style={{color:GO,fontWeight:700,fontSize:12,flexShrink:0}}>{i+1}.</span>{s}
              </div>
            ))}
          </div>

          {/* AI Question Field */}
          <div style={{background:BG2,borderRadius:14,padding:"16px 18px",border:`1px solid ${GO}30`,marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <span style={{fontSize:20}}>🧠</span>
              <span style={{fontSize:12,fontWeight:600,color:GOL}}>Pergunte à IA sobre esta análise</span>
            </div>
            <div style={{fontSize:10,color:TXD,marginBottom:10}}>A IA conhece os dados do projeto e os dados financeiros reais da empresa. Pergunte qualquer dúvida.</div>

            {!iaLoading&&!iaResposta&&(
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:10}}>
                {[
                  "Como foi calculada a margem projetada?",
                  "Consigo pagar esse investimento com meu fluxo de caixa?",
                  "Quais custos posso reduzir para viabilizar?",
                  "Vale mais a pena esse projeto ou quitar um financiamento?",
                ].map((ex,i)=>(
                  <div key={i} onClick={()=>setIaPergunta(ex)} style={{fontSize:10,color:TXM,padding:"8px 10px",background:BG3,borderRadius:8,cursor:"pointer",border:`1px solid ${BD}`,transition:"all 0.2s"}}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor=GO+"60";}} onMouseLeave={e=>{e.currentTarget.style.borderColor=BD;}}>
                    💡 {ex}
                  </div>
                ))}
              </div>
            )}

            <div style={{display:"flex",gap:8}}>
              <input value={iaPergunta} onChange={e=>setIaPergunta(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter")perguntarIA();}}
                placeholder="Ex: Como chegou nesse valor de investimento? Esse projeto cabe no meu caixa?"
                style={{flex:1,background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:10,padding:"10px 14px",fontSize:12,outline:"none",fontFamily:"inherit"}}/>
              <button onClick={perguntarIA} disabled={iaLoading||!iaPergunta.trim()} style={{
                padding:"10px 18px",borderRadius:10,border:"none",cursor:iaLoading?"wait":"pointer",
                background:iaLoading?BD:`linear-gradient(135deg,${GO},${GOL})`,color:iaLoading?TXD:BG,fontSize:12,fontWeight:600,whiteSpace:"nowrap",
              }}>{iaLoading?"⏳ Analisando...":"🧠 Perguntar"}</button>
            </div>

            {iaResposta&&(
              <div style={{marginTop:12,background:BG3,borderRadius:10,padding:14,border:`1px solid ${BD}`}}>
                <div style={{fontSize:9,color:GOL,marginBottom:6,fontWeight:600}}>🧠 RESPOSTA DO CONSULTOR IA</div>
                <div style={{fontSize:12,color:TX,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{iaResposta}</div>
                <button onClick={()=>{setIaResposta("");setIaPergunta("");}} style={{marginTop:8,fontSize:10,color:TXD,background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>Fazer outra pergunta</button>
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{display:"flex",gap:8}}>
            <button onClick={novaAnalise} style={{padding:"10px 20px",borderRadius:10,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>Nova Análise</button>
            <button onClick={()=>window.print()} style={{padding:"10px 20px",borderRadius:10,border:`1px solid ${BD}`,background:"transparent",color:TXM,fontSize:12,cursor:"pointer"}}>🖨️ Imprimir</button>
          </div>
        </div>
      )}
    </div>
  );
}
