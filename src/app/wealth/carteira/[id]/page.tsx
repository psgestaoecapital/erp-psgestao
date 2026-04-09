"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useParams } from "next/navigation";

const GO="#C6973F",GOL="#E8C872",G="#22C55E",Y="#FACC15",R="#EF4444",
  BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",BD="#2A2822",
  TX="#E8E5DC",TXM="#A8A498",TXD="#918C82",ESP="#3D2314",OW="#FAF7F2";

const CLASSES:{[k:string]:{l:string;c:string;o:number}}={
  acao:{l:"Ações",c:"#3B82F6",o:1},fii:{l:"FIIs",c:"#22C55E",o:2},
  fiagro:{l:"Fiagros",c:"#84CC16",o:3},fi_infra:{l:"FI-Infras",c:"#06B6D4",o:4},
  tesouro:{l:"Tesouro Direto",c:"#F59E0B",o:5},cdb:{l:"CDB",c:"#D97706",o:6},
  lci:{l:"LCI",c:"#B45309",o:7},lca:{l:"LCA",c:"#92400E",o:8},
  debenture:{l:"Debêntures",c:"#8B5CF6",o:9},fundo:{l:"Fundos",c:"#A78BFA",o:10},
  etf:{l:"ETFs",c:"#EC4899",o:11},bdr:{l:"BDRs",c:"#F43F5E",o:12},
  cripto:{l:"Cripto",c:"#FB923C",o:13},outro:{l:"Outros",c:"#6B7280",o:99},
};

const fmt=(v:number)=>v>=1e6?`R$ ${(v/1e6).toFixed(2)}M`:v>=1e3?`R$ ${(v/1e3).toFixed(1)}K`:`R$ ${v.toFixed(2)}`;
const fmtN=(v:number)=>v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtP=(v:number)=>`${v>=0?"+":""}${v.toFixed(2)}%`;

interface Client{id:string;nome:string;cpf_cnpj:string;tipo:string;perfil_risco:string;email:string;telefone:string;patrimonio_declarado:number;meta_independencia_financeira:number;aporte_mensal_planejado:number;status:string;}
interface Asset{id:string;ticker:string;nome:string;classe:string;setor:string;cotacao_atual:number;dy_12m:number;}
interface Position{id:string;client_id:string;asset_id:string;instituicao:string;quantidade:number;preco_medio:number;valor_atual:number;data_primeira_compra:string;proventos_acumulados:number;asset?:Asset;}

const EMPTY_POS={ticker:"",nome:"",classe:"acao",instituicao:"",quantidade:0,preco_medio:0,cotacao_atual:0,data_compra:""};

export default function CarteiraPage(){
  const params=useParams();
  const clientId=params?.id as string;
  const [client,setClient]=useState<Client|null>(null);
  const [positions,setPositions]=useState<Position[]>([]);
  const [assets,setAssets]=useState<Asset[]>([]);
  const [loading,setLoading]=useState(true);
  const [tab,setTab]=useState<"resumo"|"ativos"|"operacoes">("resumo");
  const [showAdd,setShowAdd]=useState(false);
  const [addForm,setAddForm]=useState({...EMPTY_POS});
  const [saving,setSaving]=useState(false);
  const [msg,setMsg]=useState<{t:string;ok:boolean}|null>(null);

  const load=useCallback(async()=>{
    if(!clientId) return;
    setLoading(true);
    const [{data:cl},{data:pos},{data:ast}]=await Promise.all([
      supabase.from("wealth_clients").select("*").eq("id",clientId).single(),
      supabase.from("wealth_positions").select("*").eq("client_id",clientId),
      supabase.from("wealth_assets").select("*"),
    ]);
    setClient(cl);
    setAssets(ast||[]);
    const enriched=(pos||[]).map((p:any)=>({...p,asset:(ast||[]).find((a:any)=>a.id===p.asset_id)}));
    setPositions(enriched);
    setLoading(false);
  },[clientId]);

  useEffect(()=>{load();},[load]);

  // Cálculos
  const totalAtual=positions.reduce((s,p)=>{
    const cot=p.asset?.cotacao_atual||0;
    const val=cot>0?p.quantidade*cot:(p.valor_atual||p.quantidade*p.preco_medio);
    return s+val;
  },0);
  const totalCusto=positions.reduce((s,p)=>s+p.quantidade*p.preco_medio,0);
  const retornoTotal=totalCusto>0?((totalAtual/totalCusto)-1)*100:0;
  const retornoRS=totalAtual-totalCusto;
  const totalProventos=positions.reduce((s,p)=>s+(p.proventos_acumulados||0),0);

  // Composição por classe
  const compClasse=new Map<string,{valor:number;custo:number;count:number}>();
  positions.forEach(p=>{
    const cl=p.asset?.classe||"outro";
    const cot=p.asset?.cotacao_atual||0;
    const val=cot>0?p.quantidade*cot:(p.valor_atual||p.quantidade*p.preco_medio);
    const cur=compClasse.get(cl)||{valor:0,custo:0,count:0};
    cur.valor+=val;cur.custo+=p.quantidade*p.preco_medio;cur.count++;
    compClasse.set(cl,cur);
  });
  const compArr=Array.from(compClasse.entries()).map(([k,v])=>({
    classe:k,label:CLASSES[k]?.l||k,color:CLASSES[k]?.c||"#6B7280",
    valor:v.valor,custo:v.custo,count:v.count,
    peso:totalAtual>0?(v.valor/totalAtual)*100:0,
    retorno:v.custo>0?((v.valor/v.custo)-1)*100:0,
  })).sort((a,b)=>b.valor-a.valor);

  // Posições enriquecidas com cálculos
  const posEnriched=positions.map(p=>{
    const cot=p.asset?.cotacao_atual||0;
    const valAtual=cot>0?p.quantidade*cot:(p.valor_atual||p.quantidade*p.preco_medio);
    const custo=p.quantidade*p.preco_medio;
    return{
      ...p,valAtual,custo,
      retornoRS:valAtual-custo,
      retornoP:custo>0?((valAtual/custo)-1)*100:0,
      peso:totalAtual>0?(valAtual/totalAtual)*100:0,
    };
  }).sort((a,b)=>b.valAtual-a.valAtual);

  // Salvar posição
  const addPosition=async()=>{
    if(!addForm.ticker.trim()||addForm.quantidade<=0||addForm.preco_medio<=0){
      setMsg({t:"Preencha ticker, quantidade e preço médio",ok:false});return;
    }
    setSaving(true);setMsg(null);
    try{
      // 1. Buscar ou criar ativo
      let assetId:string;
      const ticker=addForm.ticker.trim().toUpperCase();
      const{data:existing}=await supabase.from("wealth_assets").select("id").eq("ticker",ticker).single();
      if(existing){
        assetId=existing.id;
        if(addForm.cotacao_atual>0){
          await supabase.from("wealth_assets").update({cotacao_atual:addForm.cotacao_atual,cotacao_atualizada_em:new Date().toISOString()}).eq("id",assetId);
        }
      }else{
        const{data:newAsset,error}=await supabase.from("wealth_assets").insert({
          ticker,nome:addForm.nome.trim()||ticker,classe:addForm.classe,
          cotacao_atual:addForm.cotacao_atual||null,cotacao_atualizada_em:addForm.cotacao_atual?new Date().toISOString():null,
        }).select("id").single();
        if(error) throw error;
        assetId=newAsset.id;
      }
      // 2. Verificar se já tem posição nesse ativo
      const{data:existPos}=await supabase.from("wealth_positions").select("id,quantidade,preco_medio").eq("client_id",clientId).eq("asset_id",assetId).single();
      if(existPos){
        // Calcular novo preço médio
        const qtdTotal=existPos.quantidade+addForm.quantidade;
        const custoTotal=(existPos.quantidade*existPos.preco_medio)+(addForm.quantidade*addForm.preco_medio);
        const novoPM=custoTotal/qtdTotal;
        await supabase.from("wealth_positions").update({
          quantidade:qtdTotal,preco_medio:novoPM,
          data_ultima_operacao:addForm.data_compra||new Date().toISOString().split("T")[0],
          updated_at:new Date().toISOString(),
        }).eq("id",existPos.id);
      }else{
        // 3. Criar posição
        await supabase.from("wealth_positions").insert({
          client_id:clientId,asset_id:assetId,
          instituicao:addForm.instituicao.trim()||null,
          quantidade:addForm.quantidade,preco_medio:addForm.preco_medio,
          data_primeira_compra:addForm.data_compra||null,
          data_ultima_operacao:addForm.data_compra||null,
        });
      }
      // 4. Registrar transação
      await supabase.from("wealth_transactions").insert({
        client_id:clientId,asset_id:assetId,tipo:"compra",
        data:addForm.data_compra||new Date().toISOString().split("T")[0],
        quantidade:addForm.quantidade,preco_unitario:addForm.preco_medio,
        valor_total:addForm.quantidade*addForm.preco_medio,
        instituicao:addForm.instituicao.trim()||null,fonte:"manual",
      });
      setMsg({t:`${ticker} adicionado com sucesso!`,ok:true});
      setAddForm({...EMPTY_POS});
      await load();
      setTimeout(()=>setShowAdd(false),800);
    }catch(e:any){
      setMsg({t:e.message||"Erro ao salvar",ok:false});
    }
    setSaving(false);
  };

  const deletePosition=async(id:string,ticker:string)=>{
    if(!confirm(`Remover posição de ${ticker}?`)) return;
    await supabase.from("wealth_positions").delete().eq("id",id);
    await load();
  };

  const inputStyle:React.CSSProperties={width:"100%",padding:"8px 10px",borderRadius:6,border:`1px solid ${BD}`,background:BG3,color:TX,fontSize:12,outline:"none",boxSizing:"border-box"};

  const KPI=({label,value,detail,color}:{label:string;value:string;detail?:string;color?:string})=>(
    <div style={{background:`linear-gradient(135deg,${BG2},${BG3})`,borderRadius:10,padding:"12px 14px",borderLeft:`3px solid ${color||GO}`,border:`1px solid ${BD}`,flex:1,minWidth:130}}>
      <div style={{fontSize:9,color:TXD,letterSpacing:.7,textTransform:"uppercase",fontWeight:500}}>{label}</div>
      <div style={{fontSize:18,fontWeight:700,color:color||GOL,marginTop:3}}>{value}</div>
      {detail&&<div style={{fontSize:10,color:TXD,marginTop:2}}>{detail}</div>}
    </div>
  );

  if(loading) return <div style={{display:"flex",justifyContent:"center",alignItems:"center",minHeight:"60vh",color:TXM}}><div style={{fontSize:12}}>Carregando carteira...</div></div>;
  if(!client) return <div style={{textAlign:"center",padding:40,color:R}}>Cliente não encontrado</div>;

  const perfilC=({conservador:"#3B82F6",moderado:"#22C55E",arrojado:"#F59E0B",agressivo:"#EF4444",sofisticado:"#A78BFA"} as any)[client.perfil_risco]||GO;

  return(
    <div>
      {/* CLIENT HEADER */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
        <div style={{display:"flex",gap:14,alignItems:"center"}}>
          <div style={{width:48,height:48,borderRadius:12,background:`linear-gradient(135deg,${ESP},${GO})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:700,color:OW}}>
            {client.nome.charAt(0)}
          </div>
          <div>
            <div style={{fontSize:18,fontWeight:700,color:TX}}>{client.nome}</div>
            <div style={{display:"flex",gap:8,marginTop:4,alignItems:"center"}}>
              <span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:`${perfilC}15`,color:perfilC,fontWeight:500,textTransform:"capitalize"}}>{client.perfil_risco}</span>
              <span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:client.tipo==="PF"?"#3B82F615":"#8B5CF615",color:client.tipo==="PF"?"#60A5FA":"#A78BFA"}}>{client.tipo}</span>
              <span style={{fontSize:10,color:TXD}}>{client.email}</span>
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setShowAdd(true)} style={{padding:"8px 16px",borderRadius:8,background:`linear-gradient(135deg,${ESP},${GO})`,color:OW,fontSize:11,fontWeight:600,border:"none",cursor:"pointer"}}>+ Adicionar Posição</button>
          <a href="/wealth/clientes" style={{padding:"8px 16px",borderRadius:8,border:`1px solid ${BD}`,color:TXM,fontSize:11,textDecoration:"none"}}>← Voltar</a>
        </div>
      </div>

      {/* KPIs */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
        <KPI label="Patrimônio atual" value={fmt(totalAtual)}/>
        <KPI label="Custo total" value={fmt(totalCusto)} detail={`${positions.length} posições`}/>
        <KPI label="Retorno total" value={fmtP(retornoTotal)} color={retornoTotal>=0?G:R} detail={`R$ ${fmtN(retornoRS)}`}/>
        <KPI label="Proventos acum." value={fmt(totalProventos)} color={totalProventos>0?G:TXD}/>
        {client.meta_independencia_financeira&&<KPI label="Meta renda passiva" value={fmt(client.meta_independencia_financeira)} detail="mensal"/>}
      </div>

      {/* TABS */}
      <div style={{display:"flex",gap:4,marginBottom:16}}>
        {([["resumo","Resumo"],["ativos","Posições"],["operacoes","Operações"]] as const).map(([id,label])=>(
          <button key={id} onClick={()=>setTab(id)} style={{
            padding:"7px 14px",borderRadius:8,border:`1px solid ${tab===id?GO+"60":BD}`,
            background:tab===id?`${GO}15`:"transparent",color:tab===id?GOL:TXM,
            fontSize:11,fontWeight:tab===id?600:400,cursor:"pointer"
          }}>{label}</button>
        ))}
      </div>

      {/* TAB: Resumo */}
      {tab==="resumo"&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          {/* Composição por classe */}
          <div style={{background:BG2,borderRadius:12,padding:16,border:`1px solid ${BD}`}}>
            <div style={{fontSize:12,fontWeight:600,color:GOL,marginBottom:12}}>Composição por Classe</div>
            {compArr.length===0?(
              <div style={{textAlign:"center",padding:20,color:TXD,fontSize:11}}>Adicione posições para ver a composição</div>
            ):(
              <div>
                {/* Barra horizontal empilhada */}
                <div style={{display:"flex",borderRadius:6,overflow:"hidden",height:24,marginBottom:12}}>
                  {compArr.map(c=>(
                    <div key={c.classe} title={`${c.label}: ${c.peso.toFixed(1)}%`} style={{width:`${c.peso}%`,background:c.color,minWidth:c.peso>2?0:2,transition:"width .5s"}}/>
                  ))}
                </div>
                {/* Legenda */}
                {compArr.map(c=>(
                  <div key={c.classe} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:`0.5px solid ${BD}40`}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:10,height:10,borderRadius:3,background:c.color,flexShrink:0}}/>
                      <span style={{fontSize:12,color:TX}}>{c.label}</span>
                      <span style={{fontSize:10,color:TXD}}>({c.count})</span>
                    </div>
                    <div style={{display:"flex",gap:12,alignItems:"center"}}>
                      <span style={{fontSize:12,fontWeight:600,color:TX}}>{fmt(c.valor)}</span>
                      <span style={{fontSize:11,color:c.retorno>=0?G:R,fontWeight:500,minWidth:50,textAlign:"right"}}>{fmtP(c.retorno)}</span>
                      <span style={{fontSize:11,color:GOL,fontWeight:600,minWidth:40,textAlign:"right"}}>{c.peso.toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Maiores posições */}
          <div style={{background:BG2,borderRadius:12,padding:16,border:`1px solid ${BD}`}}>
            <div style={{fontSize:12,fontWeight:600,color:GOL,marginBottom:12}}>Maiores Posições</div>
            {posEnriched.slice(0,8).map(p=>(
              <div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:`0.5px solid ${BD}40`}}>
                <div>
                  <span style={{fontSize:12,fontWeight:600,color:TX}}>{p.asset?.ticker||"—"}</span>
                  <span style={{fontSize:10,color:TXD,marginLeft:6}}>{p.asset?.nome||""}</span>
                </div>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <span style={{fontSize:12,fontWeight:600,color:TX}}>{fmt(p.valAtual)}</span>
                  <span style={{fontSize:11,color:p.retornoP>=0?G:R,fontWeight:500,minWidth:55,textAlign:"right"}}>{fmtP(p.retornoP)}</span>
                </div>
              </div>
            ))}
            {posEnriched.length===0&&<div style={{textAlign:"center",padding:20,color:TXD,fontSize:11}}>Nenhuma posição</div>}
          </div>
        </div>
      )}

      {/* TAB: Posições */}
      {tab==="ativos"&&(
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead>
              <tr style={{borderBottom:`1px solid ${BD}`}}>
                {["Ativo","Classe","Instituição","Qtd","PM","Cotação","Valor Atual","Retorno R$","Retorno %","Peso",""].map(h=>(
                  <th key={h} style={{padding:"8px 10px",textAlign:h==="Qtd"||h==="PM"||h==="Cotação"||h==="Valor Atual"||h==="Retorno R$"||h==="Retorno %"||h==="Peso"?"right":"left",fontSize:9,color:TXD,fontWeight:500,letterSpacing:.5,textTransform:"uppercase"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {posEnriched.map(p=>{
                const cl=CLASSES[p.asset?.classe||"outro"];
                return(
                  <tr key={p.id} style={{borderBottom:`0.5px solid ${BD}40`}}>
                    <td style={{padding:"8px 10px"}}>
                      <div style={{fontSize:12,fontWeight:600,color:TX}}>{p.asset?.ticker||"—"}</div>
                      <div style={{fontSize:9,color:TXD,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.asset?.nome}</div>
                    </td>
                    <td style={{padding:"8px 10px"}}><span style={{fontSize:9,padding:"2px 6px",borderRadius:3,background:`${cl?.c||"#666"}15`,color:cl?.c||"#999"}}>{cl?.l||p.asset?.classe}</span></td>
                    <td style={{padding:"8px 10px",fontSize:11,color:TXM}}>{p.instituicao||"—"}</td>
                    <td style={{padding:"8px 10px",fontSize:11,color:TX,textAlign:"right"}}>{fmtN(p.quantidade)}</td>
                    <td style={{padding:"8px 10px",fontSize:11,color:TXM,textAlign:"right"}}>R$ {fmtN(p.preco_medio)}</td>
                    <td style={{padding:"8px 10px",fontSize:11,color:p.asset?.cotacao_atual?TX:TXD,textAlign:"right"}}>{p.asset?.cotacao_atual?`R$ ${fmtN(p.asset.cotacao_atual)}`:"—"}</td>
                    <td style={{padding:"8px 10px",fontSize:12,fontWeight:600,color:GOL,textAlign:"right"}}>{fmt(p.valAtual)}</td>
                    <td style={{padding:"8px 10px",fontSize:11,fontWeight:500,color:p.retornoRS>=0?G:R,textAlign:"right"}}>R$ {fmtN(p.retornoRS)}</td>
                    <td style={{padding:"8px 10px",fontSize:11,fontWeight:600,color:p.retornoP>=0?G:R,textAlign:"right"}}>{fmtP(p.retornoP)}</td>
                    <td style={{padding:"8px 10px",fontSize:11,color:GOL,fontWeight:600,textAlign:"right"}}>{p.peso.toFixed(1)}%</td>
                    <td style={{padding:"8px 10px"}}>
                      <button onClick={()=>deletePosition(p.id,p.asset?.ticker||"")} style={{fontSize:9,color:R,background:`${R}10`,border:`1px solid ${R}20`,borderRadius:4,padding:"2px 6px",cursor:"pointer"}}>✕</button>
                    </td>
                  </tr>
                );
              })}
              {posEnriched.length===0&&(
                <tr><td colSpan={11} style={{padding:24,textAlign:"center",color:TXD,fontSize:12}}>Nenhuma posição. Clique em "+ Adicionar Posição" para começar.</td></tr>
              )}
            </tbody>
          </table>
          {posEnriched.length>0&&(
            <div style={{display:"flex",justifyContent:"flex-end",padding:"10px 14px",borderTop:`1px solid ${BD}`,gap:20}}>
              <span style={{fontSize:11,color:TXM}}>Total: <strong style={{color:GOL}}>{fmt(totalAtual)}</strong></span>
              <span style={{fontSize:11,color:retornoTotal>=0?G:R,fontWeight:600}}>{fmtP(retornoTotal)}</span>
            </div>
          )}
        </div>
      )}

      {/* TAB: Operações */}
      {tab==="operacoes"&&(
        <div style={{background:BG2,borderRadius:12,padding:24,border:`1px solid ${BD}`,textAlign:"center"}}>
          <div style={{fontSize:28,marginBottom:8}}>📋</div>
          <div style={{fontSize:14,fontWeight:600,color:TX}}>Histórico de Operações</div>
          <div style={{fontSize:12,color:TXD,marginTop:4}}>As transações registradas ao adicionar posições ficam salvas aqui. Histórico completo com filtros será ativado na próxima versão.</div>
        </div>
      )}

      {/* MODAL: Adicionar Posição */}
      {showAdd&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={e=>{if(e.target===e.currentTarget)setShowAdd(false);}}>
          <div style={{background:BG2,borderRadius:14,width:"100%",maxWidth:500,border:`1px solid ${GO}40`,boxShadow:"0 8px 40px rgba(0,0,0,.6)"}}>
            <div style={{padding:"16px 20px",borderBottom:`1px solid ${BD}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:14,fontWeight:700,color:GOL}}>Adicionar Posição</div>
              <button onClick={()=>setShowAdd(false)} style={{background:"none",border:"none",color:TXM,fontSize:18,cursor:"pointer"}}>✕</button>
            </div>
            <div style={{padding:20,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div>
                <label style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:.5}}>Ticker *</label>
                <input value={addForm.ticker} onChange={e=>setAddForm({...addForm,ticker:e.target.value.toUpperCase()})} style={inputStyle} placeholder="Ex: PETR4, HGLG11"/>
              </div>
              <div>
                <label style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:.5}}>Nome do ativo</label>
                <input value={addForm.nome} onChange={e=>setAddForm({...addForm,nome:e.target.value})} style={inputStyle} placeholder="Petrobras PN"/>
              </div>
              <div>
                <label style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:.5}}>Classe *</label>
                <select value={addForm.classe} onChange={e=>setAddForm({...addForm,classe:e.target.value})} style={{...inputStyle,appearance:"none" as any}}>
                  {Object.entries(CLASSES).sort((a,b)=>a[1].o-b[1].o).map(([k,v])=>(
                    <option key={k} value={k}>{v.l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:.5}}>Instituição</label>
                <input value={addForm.instituicao} onChange={e=>setAddForm({...addForm,instituicao:e.target.value})} style={inputStyle} placeholder="XP, BTG, BB..."/>
              </div>
              <div>
                <label style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:.5}}>Quantidade *</label>
                <input value={addForm.quantidade||""} onChange={e=>setAddForm({...addForm,quantidade:Number(e.target.value)||0})} style={inputStyle} type="number" placeholder="0"/>
              </div>
              <div>
                <label style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:.5}}>Preço médio (R$) *</label>
                <input value={addForm.preco_medio||""} onChange={e=>setAddForm({...addForm,preco_medio:Number(e.target.value)||0})} style={inputStyle} type="number" step="0.01" placeholder="0,00"/>
              </div>
              <div>
                <label style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:.5}}>Cotação atual (R$)</label>
                <input value={addForm.cotacao_atual||""} onChange={e=>setAddForm({...addForm,cotacao_atual:Number(e.target.value)||0})} style={inputStyle} type="number" step="0.01" placeholder="0,00"/>
              </div>
              <div>
                <label style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:.5}}>Data da compra</label>
                <input value={addForm.data_compra} onChange={e=>setAddForm({...addForm,data_compra:e.target.value})} style={inputStyle} type="date"/>
              </div>
              {addForm.quantidade>0&&addForm.preco_medio>0&&(
                <div style={{gridColumn:"span 2",background:`${GO}10`,borderRadius:8,padding:"8px 12px",border:`1px solid ${GO}20`}}>
                  <span style={{fontSize:11,color:TXM}}>Custo total: </span>
                  <span style={{fontSize:13,fontWeight:700,color:GOL}}>R$ {fmtN(addForm.quantidade*addForm.preco_medio)}</span>
                  {addForm.cotacao_atual>0&&(
                    <>
                      <span style={{fontSize:11,color:TXM,marginLeft:16}}>Valor atual: </span>
                      <span style={{fontSize:13,fontWeight:700,color:TX}}>R$ {fmtN(addForm.quantidade*addForm.cotacao_atual)}</span>
                      <span style={{fontSize:11,fontWeight:600,marginLeft:8,color:addForm.cotacao_atual>=addForm.preco_medio?G:R}}>
                        {fmtP(((addForm.cotacao_atual/addForm.preco_medio)-1)*100)}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
            {msg&&<div style={{margin:"0 20px",padding:"8px 12px",borderRadius:6,background:msg.ok?`${G}15`:`${R}15`,border:`1px solid ${msg.ok?G:R}30`,fontSize:11,color:msg.ok?G:R}}>{msg.t}</div>}
            <div style={{padding:"12px 20px 16px",display:"flex",justifyContent:"flex-end",gap:8}}>
              <button onClick={()=>setShowAdd(false)} style={{padding:"8px 16px",borderRadius:6,border:`1px solid ${BD}`,background:"transparent",color:TXM,fontSize:11,cursor:"pointer"}}>Cancelar</button>
              <button onClick={addPosition} disabled={saving} style={{padding:"8px 20px",borderRadius:6,border:"none",background:saving?"#555":`linear-gradient(135deg,${ESP},${GO})`,color:OW,fontSize:12,fontWeight:600,cursor:saving?"not-allowed":"pointer"}}>{saving?"Salvando...":"Adicionar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
