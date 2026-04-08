"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useSearchParams } from "next/navigation";

const GO="#C6973F",GOL="#E8C872",G="#22C55E",Y="#FACC15",R="#EF4444",
  BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",BD="#2A2822",BD2="#3D3A30",
  TX="#E8E5DC",TXM="#A8A498",TXD="#918C82",ESP="#3D2314",OW="#FAF7F2";

interface WClient{
  id:string;nome:string;cpf_cnpj:string;tipo:string;perfil_risco:string;
  email:string;telefone:string;status:string;aporte_mensal_planejado:number|null;
  patrimonio_declarado:number|null;meta_independencia_financeira:number|null;
  consultor_responsavel:string|null;data_nascimento:string|null;profissao:string|null;
  estado_civil:string|null;nacionalidade:string|null;renda_mensal:number|null;
  investidor_qualificado:boolean;investidor_profissional:boolean;pep:boolean;
  notas:string|null;created_at:string;
}

const EMPTY:Partial<WClient>={
  nome:"",cpf_cnpj:"",tipo:"PF",perfil_risco:"moderado",email:"",telefone:"",
  status:"ativo",aporte_mensal_planejado:null,patrimonio_declarado:null,
  meta_independencia_financeira:null,data_nascimento:null,profissao:"",
  estado_civil:"",nacionalidade:"brasileira",renda_mensal:null,
  investidor_qualificado:false,investidor_profissional:false,pep:false,notas:""
};

const PERFIS=[
  {v:"conservador",l:"Conservador",c:"#3B82F6",d:"Prioriza preservação de capital"},
  {v:"moderado",l:"Moderado",c:"#22C55E",d:"Equilíbrio entre risco e retorno"},
  {v:"arrojado",l:"Arrojado",c:"#F59E0B",d:"Aceita volatilidade por retorno maior"},
  {v:"agressivo",l:"Agressivo",c:"#EF4444",d:"Alta tolerância a risco"},
  {v:"sofisticado",l:"Sofisticado",c:"#A78BFA",d:"Investidor qualificado/profissional"},
];

const ESTADOS_CIVIS=["","solteiro(a)","casado(a) - comunhão parcial","casado(a) - comunhão total","casado(a) - separação total","casado(a) - participação final","união estável","divorciado(a)","viúvo(a)"];

const fmt=(v:number|null)=>v?v>=1e6?`R$ ${(v/1e6).toFixed(2)}M`:v>=1e3?`R$ ${(v/1e3).toFixed(1)}K`:`R$ ${v.toFixed(0)}`:"—";

const maskCPF=(v:string)=>{
  const n=v.replace(/\D/g,"");
  if(n.length<=11) return n.replace(/(\d{3})(\d{3})?(\d{3})?(\d{2})?/,(_,a,b,c,d)=>`${a}${b?"."+b:""}${c?"."+c:""}${d?"-"+d:""}`);
  return n.replace(/(\d{2})(\d{3})?(\d{3})?(\d{4})?(\d{2})?/,(_,a,b,c,d,e)=>`${a}${b?"."+b:""}${c?"."+c:""}${d?"/"+d:""}${e?"-"+e:""}`);
};

const maskPhone=(v:string)=>{
  const n=v.replace(/\D/g,"");
  if(n.length<=10) return n.replace(/(\d{2})(\d{4})?(\d{4})?/,(_,a,b,c)=>`(${a})${b?" "+b:""}${c?"-"+c:""}`);
  return n.replace(/(\d{2})(\d{5})?(\d{4})?/,(_,a,b,c)=>`(${a})${b?" "+b:""}${c?"-"+c:""}`);
};

export default function WealthClientes(){
  const searchParams=useSearchParams();
  const [clients,setClients]=useState<WClient[]>([]);
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState("");
  const [filterStatus,setFilterStatus]=useState("todos");
  const [filterPerfil,setFilterPerfil]=useState("todos");
  const [showForm,setShowForm]=useState(searchParams?.get("novo")==="1");
  const [editId,setEditId]=useState<string|null>(null);
  const [form,setForm]=useState<Partial<WClient>>({...EMPTY});
  const [saving,setSaving]=useState(false);
  const [msg,setMsg]=useState<{t:string;ok:boolean}|null>(null);
  const [formTab,setFormTab]=useState<"dados"|"financeiro"|"perfil"|"notas">("dados");

  const load=useCallback(async()=>{
    setLoading(true);
    const{data}=await supabase.from("wealth_clients").select("*").order("nome");
    setClients(data||[]);
    setLoading(false);
  },[]);

  useEffect(()=>{load();},[load]);

  const filtered=clients.filter(c=>{
    if(filterStatus!=="todos"&&c.status!==filterStatus) return false;
    if(filterPerfil!=="todos"&&c.perfil_risco!==filterPerfil) return false;
    if(search){
      const s=search.toLowerCase();
      return c.nome.toLowerCase().includes(s)||c.cpf_cnpj.includes(s)||(c.email||"").toLowerCase().includes(s);
    }
    return true;
  });

  const openNew=()=>{setEditId(null);setForm({...EMPTY});setFormTab("dados");setShowForm(true);setMsg(null);};
  const openEdit=(c:WClient)=>{setEditId(c.id);setForm({...c});setFormTab("dados");setShowForm(true);setMsg(null);};
  const close=()=>{setShowForm(false);setEditId(null);setForm({...EMPTY});};

  const save=async()=>{
    if(!form.nome?.trim()){setMsg({t:"Nome é obrigatório",ok:false});return;}
    if(!form.cpf_cnpj?.trim()){setMsg({t:"CPF/CNPJ é obrigatório",ok:false});return;}
    setSaving(true);setMsg(null);
    try{
      const payload={
        nome:form.nome?.trim(),cpf_cnpj:form.cpf_cnpj?.replace(/\D/g,""),tipo:form.tipo,
        perfil_risco:form.perfil_risco,email:form.email?.trim()||null,
        telefone:form.telefone?.trim()||null,status:form.status,
        aporte_mensal_planejado:form.aporte_mensal_planejado||null,
        patrimonio_declarado:form.patrimonio_declarado||null,
        meta_independencia_financeira:form.meta_independencia_financeira||null,
        data_nascimento:form.data_nascimento||null,profissao:form.profissao?.trim()||null,
        estado_civil:form.estado_civil||null,nacionalidade:form.nacionalidade?.trim()||"brasileira",
        renda_mensal:form.renda_mensal||null,
        investidor_qualificado:form.investidor_qualificado||false,
        investidor_profissional:form.investidor_profissional||false,
        pep:form.pep||false,notas:form.notas?.trim()||null,
        updated_at:new Date().toISOString(),
      };
      if(editId){
        const{error}=await supabase.from("wealth_clients").update(payload).eq("id",editId);
        if(error) throw error;
        setMsg({t:"Cliente atualizado com sucesso",ok:true});
      }else{
        const{error}=await supabase.from("wealth_clients").insert(payload);
        if(error){
          if(error.message.includes("duplicate")) setMsg({t:"CPF/CNPJ já cadastrado",ok:false});
          else throw error;
          setSaving(false);return;
        }
        setMsg({t:"Cliente cadastrado com sucesso!",ok:true});
      }
      await load();
      setTimeout(()=>close(),1200);
    }catch(e:any){
      setMsg({t:e.message||"Erro ao salvar",ok:false});
    }
    setSaving(false);
  };

  const deleteClient=async(id:string,nome:string)=>{
    if(!confirm(`Excluir cliente "${nome}"? Esta ação não pode ser desfeita.`)) return;
    await supabase.from("wealth_clients").delete().eq("id",id);
    await load();
  };

  const F=({label,children,span}:{label:string;children:React.ReactNode;span?:number})=>(
    <div style={{gridColumn:span?`span ${span}`:"span 1"}}>
      <label style={{fontSize:10,color:TXD,letterSpacing:.5,textTransform:"uppercase",fontWeight:500,display:"block",marginBottom:4}}>{label}</label>
      {children}
    </div>
  );

  const inputStyle:React.CSSProperties={
    width:"100%",padding:"9px 12px",borderRadius:8,border:`1px solid ${BD}`,
    background:BG3,color:TX,fontSize:13,outline:"none",boxSizing:"border-box",
  };
  const selectStyle:React.CSSProperties={...inputStyle,appearance:"none" as any,cursor:"pointer"};

  const perfilColor=PERFIS.find(p=>p.v===form.perfil_risco)?.c||GO;

  if(loading) return(
    <div style={{display:"flex",justifyContent:"center",alignItems:"center",minHeight:"60vh",color:TXM}}>
      <div style={{fontSize:12,letterSpacing:1}}>Carregando clientes...</div>
    </div>
  );

  return(
    <div>
      {/* HEADER */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div>
          <div style={{fontSize:18,fontWeight:700,color:TX}}>Clientes de Investimento</div>
          <div style={{fontSize:11,color:TXD,marginTop:2}}>{clients.length} cadastrados · {clients.filter(c=>c.status==="ativo").length} ativos</div>
        </div>
        <button onClick={openNew} style={{
          padding:"10px 20px",borderRadius:8,background:`linear-gradient(135deg,${ESP},${GO})`,
          color:OW,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",letterSpacing:.3
        }}>+ Novo Cliente</button>
      </div>

      {/* FILTROS */}
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por nome, CPF ou email..."
          style={{...inputStyle,maxWidth:300,background:BG2}}/>
        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{...selectStyle,maxWidth:140,background:BG2}}>
          <option value="todos">Todos status</option>
          <option value="ativo">Ativos</option>
          <option value="inativo">Inativos</option>
          <option value="prospecto">Prospectos</option>
        </select>
        <select value={filterPerfil} onChange={e=>setFilterPerfil(e.target.value)} style={{...selectStyle,maxWidth:160,background:BG2}}>
          <option value="todos">Todos perfis</option>
          {PERFIS.map(p=><option key={p.v} value={p.v}>{p.l}</option>)}
        </select>
        <div style={{flex:1}}/>
        <div style={{fontSize:11,color:TXD}}>{filtered.length} resultado{filtered.length!==1?"s":""}</div>
      </div>

      {/* LISTA */}
      <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr style={{borderBottom:`1px solid ${BD}`}}>
              {["Cliente","CPF/CNPJ","Tipo","Perfil","Status","Patrimônio","Ações"].map(h=>(
                <th key={h} style={{padding:"10px 14px",textAlign:"left",fontSize:10,color:TXD,fontWeight:500,letterSpacing:.5,textTransform:"uppercase"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(c=>{
              const pc=PERFIS.find(p=>p.v===c.perfil_risco);
              return(
                <tr key={c.id} style={{borderBottom:`0.5px solid ${BD}40`}}>
                  <td style={{padding:"10px 14px",cursor:"pointer"}} onClick={()=>window.location.href=`/wealth/carteira/${c.id}`}>
                    <div style={{fontSize:13,fontWeight:600,color:TX}}>{c.nome}</div>
                    <div style={{fontSize:10,color:TXD}}>{c.email||c.telefone||"—"}</div>
                  </td>
                  <td style={{padding:"10px 14px",fontSize:11,color:TXM,fontFamily:"monospace"}}>{maskCPF(c.cpf_cnpj)}</td>
                  <td style={{padding:"10px 14px"}}>
                    <span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:c.tipo==="PF"?"#3B82F615":"#8B5CF615",color:c.tipo==="PF"?"#60A5FA":"#A78BFA",fontWeight:500}}>{c.tipo}</span>
                  </td>
                  <td style={{padding:"10px 14px"}}>
                    <span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:`${pc?.c||GO}15`,color:pc?.c||GO,fontWeight:500,textTransform:"capitalize"}}>{c.perfil_risco}</span>
                  </td>
                  <td style={{padding:"10px 14px"}}>
                    <span style={{fontSize:10,padding:"2px 8px",borderRadius:4,
                      background:c.status==="ativo"?`${G}15`:c.status==="prospecto"?`${Y}15`:`${R}15`,
                      color:c.status==="ativo"?G:c.status==="prospecto"?Y:R,fontWeight:500
                    }}>{c.status}</span>
                  </td>
                  <td style={{padding:"10px 14px",fontSize:12,fontWeight:600,color:GOL}}>{fmt(c.patrimonio_declarado)}</td>
                  <td style={{padding:"10px 14px"}}>
                    <div style={{display:"flex",gap:6}}>
                      <button onClick={()=>openEdit(c)} style={{fontSize:10,color:GOL,background:`${GO}15`,border:`1px solid ${GO}30`,borderRadius:6,padding:"4px 10px",cursor:"pointer"}}>Editar</button>
                      <button onClick={()=>window.location.href=`/wealth/carteira/${c.id}`} style={{fontSize:10,color:"#60A5FA",background:"#3B82F615",border:"1px solid #3B82F630",borderRadius:6,padding:"4px 10px",cursor:"pointer"}}>Carteira</button>
                      <button onClick={()=>deleteClient(c.id,c.nome)} style={{fontSize:10,color:R,background:`${R}10`,border:`1px solid ${R}20`,borderRadius:6,padding:"4px 10px",cursor:"pointer"}}>✕</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length===0&&(
              <tr><td colSpan={7} style={{padding:32,textAlign:"center",color:TXD,fontSize:12}}>
                {clients.length===0?"Nenhum cliente cadastrado. Clique em '+ Novo Cliente' para começar.":"Nenhum resultado para os filtros aplicados."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* MODAL FORMULÁRIO */}
      {showForm&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={e=>{if(e.target===e.currentTarget)close();}}>
          <div style={{background:BG2,borderRadius:16,width:"100%",maxWidth:680,maxHeight:"90vh",overflowY:"auto",border:`1px solid ${GO}40`,boxShadow:"0 8px 40px rgba(0,0,0,.6)"}}>
            {/* FORM HEADER */}
            <div style={{padding:"20px 24px 0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:16,fontWeight:700,color:GOL}}>{editId?"Editar Cliente":"Novo Cliente"}</div>
                <div style={{fontSize:11,color:TXD,marginTop:2}}>Preencha os dados do investidor</div>
              </div>
              <button onClick={close} style={{background:"none",border:"none",color:TXM,fontSize:20,cursor:"pointer"}}>✕</button>
            </div>

            {/* FORM TABS */}
            <div style={{display:"flex",gap:4,padding:"16px 24px 0"}}>
              {([["dados","Dados Pessoais"],["financeiro","Dados Financeiros"],["perfil","Perfil de Risco"],["notas","Observações"]] as const).map(([id,label])=>(
                <button key={id} onClick={()=>setFormTab(id)} style={{
                  padding:"6px 14px",borderRadius:6,border:`1px solid ${formTab===id?GO+"60":BD}`,
                  background:formTab===id?`${GO}15`:"transparent",color:formTab===id?GOL:TXM,
                  fontSize:11,fontWeight:formTab===id?600:400,cursor:"pointer"
                }}>{label}</button>
              ))}
            </div>

            {/* FORM BODY */}
            <div style={{padding:"16px 24px 24px"}}>

              {/* TAB: Dados Pessoais */}
              {formTab==="dados"&&(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <F label="Nome completo *" span={2}>
                    <input value={form.nome||""} onChange={e=>setForm({...form,nome:e.target.value})} style={inputStyle} placeholder="Nome do cliente"/>
                  </F>
                  <F label="CPF / CNPJ *">
                    <input value={maskCPF(form.cpf_cnpj||"")} onChange={e=>setForm({...form,cpf_cnpj:e.target.value.replace(/\D/g,"")})} style={inputStyle} placeholder="000.000.000-00" maxLength={18}/>
                  </F>
                  <F label="Tipo">
                    <div style={{display:"flex",gap:8}}>
                      {["PF","PJ"].map(t=>(
                        <button key={t} onClick={()=>setForm({...form,tipo:t})} style={{
                          flex:1,padding:"9px 0",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer",
                          border:`1px solid ${form.tipo===t?GO:BD}`,
                          background:form.tipo===t?`${GO}20`:"transparent",
                          color:form.tipo===t?GOL:TXM
                        }}>{t==="PF"?"Pessoa Física":"Pessoa Jurídica"}</button>
                      ))}
                    </div>
                  </F>
                  <F label="Email">
                    <input value={form.email||""} onChange={e=>setForm({...form,email:e.target.value})} style={inputStyle} placeholder="email@exemplo.com" type="email"/>
                  </F>
                  <F label="Telefone / WhatsApp">
                    <input value={maskPhone(form.telefone||"")} onChange={e=>setForm({...form,telefone:e.target.value.replace(/\D/g,"")})} style={inputStyle} placeholder="(49) 99999-0000" maxLength={15}/>
                  </F>
                  <F label="Data de nascimento">
                    <input value={form.data_nascimento||""} onChange={e=>setForm({...form,data_nascimento:e.target.value})} style={inputStyle} type="date"/>
                  </F>
                  <F label="Profissão">
                    <input value={form.profissao||""} onChange={e=>setForm({...form,profissao:e.target.value})} style={inputStyle} placeholder="Ex: Empresário"/>
                  </F>
                  <F label="Estado civil">
                    <select value={form.estado_civil||""} onChange={e=>setForm({...form,estado_civil:e.target.value})} style={selectStyle}>
                      {ESTADOS_CIVIS.map(e=><option key={e} value={e}>{e||"Selecionar..."}</option>)}
                    </select>
                  </F>
                  <F label="Nacionalidade">
                    <input value={form.nacionalidade||""} onChange={e=>setForm({...form,nacionalidade:e.target.value})} style={inputStyle} placeholder="brasileira"/>
                  </F>
                  <F label="Status">
                    <select value={form.status||"ativo"} onChange={e=>setForm({...form,status:e.target.value})} style={selectStyle}>
                      <option value="ativo">Ativo</option>
                      <option value="prospecto">Prospecto</option>
                      <option value="inativo">Inativo</option>
                    </select>
                  </F>
                </div>
              )}

              {/* TAB: Dados Financeiros */}
              {formTab==="financeiro"&&(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <F label="Renda mensal (R$)">
                    <input value={form.renda_mensal||""} onChange={e=>setForm({...form,renda_mensal:Number(e.target.value)||null})} style={inputStyle} type="number" placeholder="0,00"/>
                  </F>
                  <F label="Patrimônio declarado (R$)">
                    <input value={form.patrimonio_declarado||""} onChange={e=>setForm({...form,patrimonio_declarado:Number(e.target.value)||null})} style={inputStyle} type="number" placeholder="0,00"/>
                  </F>
                  <F label="Aporte mensal planejado (R$)">
                    <input value={form.aporte_mensal_planejado||""} onChange={e=>setForm({...form,aporte_mensal_planejado:Number(e.target.value)||null})} style={inputStyle} type="number" placeholder="0,00"/>
                  </F>
                  <F label="Meta renda passiva mensal (R$)">
                    <input value={form.meta_independencia_financeira||""} onChange={e=>setForm({...form,meta_independencia_financeira:Number(e.target.value)||null})} style={inputStyle} type="number" placeholder="0,00"/>
                  </F>
                  <F label="Classificação CVM" span={2}>
                    <div style={{display:"flex",gap:8,marginTop:4}}>
                      <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:TXM,cursor:"pointer"}}>
                        <input type="checkbox" checked={form.investidor_qualificado||false} onChange={e=>setForm({...form,investidor_qualificado:e.target.checked})}/>
                        Investidor Qualificado (≥ R$ 1M)
                      </label>
                      <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:TXM,cursor:"pointer"}}>
                        <input type="checkbox" checked={form.investidor_profissional||false} onChange={e=>setForm({...form,investidor_profissional:e.target.checked})}/>
                        Investidor Profissional (≥ R$ 10M)
                      </label>
                    </div>
                  </F>
                  <F label="Pessoa Exposta Politicamente (PEP)" span={2}>
                    <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:form.pep?R:TXM,cursor:"pointer",marginTop:4}}>
                      <input type="checkbox" checked={form.pep||false} onChange={e=>setForm({...form,pep:e.target.checked})}/>
                      {form.pep?"SIM — Este cliente é PEP (monitoramento obrigatório COAF)":"Não é PEP"}
                    </label>
                  </F>
                </div>
              )}

              {/* TAB: Perfil de Risco */}
              {formTab==="perfil"&&(
                <div>
                  <div style={{fontSize:12,color:TXM,marginBottom:16}}>Selecione o perfil de risco do investidor. Isso define a alocação alvo e os limites de rebalanceamento.</div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {PERFIS.map(p=>(
                      <button key={p.v} onClick={()=>setForm({...form,perfil_risco:p.v})} style={{
                        display:"flex",alignItems:"center",gap:14,padding:"14px 16px",borderRadius:10,
                        border:`1px solid ${form.perfil_risco===p.v?p.c+"80":BD}`,
                        background:form.perfil_risco===p.v?`${p.c}15`:"transparent",
                        cursor:"pointer",textAlign:"left"
                      }}>
                        <div style={{width:36,height:36,borderRadius:8,background:`${p.c}25`,border:`2px solid ${form.perfil_risco===p.v?p.c:p.c+"40"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:p.c,flexShrink:0}}>
                          {form.perfil_risco===p.v?"✓":""}
                        </div>
                        <div>
                          <div style={{fontSize:14,fontWeight:600,color:form.perfil_risco===p.v?p.c:TX}}>{p.l}</div>
                          <div style={{fontSize:11,color:TXD,marginTop:2}}>{p.d}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB: Notas */}
              {formTab==="notas"&&(
                <div>
                  <F label="Observações sobre o cliente" span={2}>
                    <textarea value={form.notas||""} onChange={e=>setForm({...form,notas:e.target.value})} rows={8}
                      style={{...inputStyle,resize:"vertical",lineHeight:1.5}}
                      placeholder="Notas internas sobre o cliente, objetivos, restrições, contexto familiar, preferências de comunicação..."/>
                  </F>
                  <div style={{fontSize:10,color:TXD,marginTop:8}}>Estas notas são visíveis apenas para consultores e administradores.</div>
                </div>
              )}

              {/* MSG */}
              {msg&&(
                <div style={{marginTop:16,padding:"10px 14px",borderRadius:8,background:msg.ok?`${G}15`:`${R}15`,border:`1px solid ${msg.ok?G:R}30`,fontSize:12,color:msg.ok?G:R}}>
                  {msg.t}
                </div>
              )}

              {/* ACTIONS */}
              <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginTop:20,paddingTop:16,borderTop:`1px solid ${BD}`}}>
                <button onClick={close} style={{padding:"10px 20px",borderRadius:8,border:`1px solid ${BD}`,background:"transparent",color:TXM,fontSize:12,cursor:"pointer"}}>Cancelar</button>
                <button onClick={save} disabled={saving} style={{
                  padding:"10px 24px",borderRadius:8,border:"none",
                  background:saving?"#555":`linear-gradient(135deg,${ESP},${GO})`,
                  color:OW,fontSize:13,fontWeight:600,cursor:saving?"not-allowed":"pointer",
                  opacity:saving?.7:1
                }}>{saving?"Salvando...":editId?"Salvar Alterações":"Cadastrar Cliente"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
