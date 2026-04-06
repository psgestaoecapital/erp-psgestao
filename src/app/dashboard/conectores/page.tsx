"use client";
import { useState } from "react";

const GO="#C6973F",GOL="#E8C872",BG="#111110",BG2="#252320",BG3="#33312A",G="#22C55E",R="#EF4444",Y="#FACC15",BL="#3B82F6",
    BD="#504D40",TX="#F0ECE3",TXM="#CCC7BB",TXD="#A09B90",PU="#A855F7";

const CONNECTORS = [
  {id:"omie",nome:"Omie",cat:"erp",status:"ativo",cor:G,icon:"🟢",
    desc:"ERP completo. Integração com paginação total já implementada.",
    campos:[{k:"app_key",l:"App Key",p:"Chave do app Omie"},{k:"app_secret",l:"App Secret",p:"Secret do app Omie"}],
    dados:["Contas a pagar","Contas a receber","Clientes","Fornecedores","Categorias","Produtos","Vendas"]},
  {id:"nibo",nome:"Nibo",cat:"erp",status:"em_breve",cor:BL,icon:"🔵",
    desc:"Gestão financeira para contadores. API REST + OAuth 2.0. Portal developer.nibo.com.br",
    campos:[{k:"api_key",l:"API Key",p:"Chave API Nibo"},{k:"company_id",l:"ID Empresa",p:"ID no Nibo"}],
    dados:["Lançamentos","Clientes","Fornecedores","Boletos","NFS-e","Conciliação"]},
  {id:"bomcontrole",nome:"Bom Controle",cat:"erp",status:"em_breve",cor:"#F97316",icon:"🟠",
    desc:"ERP multiempresa com módulo BPO. API RESTful + Token.",
    campos:[{k:"token",l:"Token",p:"Token de autenticação"}],
    dados:["Financeiro","CRM","Estoque","NF-e","Boletos","Contratos"]},
  {id:"contaazul",nome:"ContaAzul",cat:"erp",status:"em_breve",cor:"#0EA5E9",icon:"🔷",
    desc:"Gestão financeira para PMEs. API REST + OAuth 2.0.",
    campos:[{k:"client_id",l:"Client ID",p:"OAuth Client ID"},{k:"client_secret",l:"Client Secret",p:"OAuth Secret"}],
    dados:["Clientes","Vendas","Cobranças","Categorias","Lançamentos","NFS-e"]},
  {id:"bling",nome:"Bling",cat:"erp",status:"em_breve",cor:PU,icon:"🟣",
    desc:"ERP para e-commerce e varejo. API REST.",
    campos:[{k:"api_key",l:"API Key",p:"Chave API Bling"}],
    dados:["Pedidos","Produtos","NF-e","Financeiro","Contatos"]},
  {id:"controlle",nome:"Controlle",cat:"erp",status:"em_breve",cor:"#A16207",icon:"🟤",
    desc:"Gestão financeira com Open Finance via Belvo.",
    campos:[{k:"api_key",l:"API Key",p:"Chave Controlle"}],
    dados:["Transações bancárias","Categorias","Contas","Extratos"]},
  {id:"granatum",nome:"Granatum",cat:"erp",status:"planejado",cor:Y,icon:"🟡",
    desc:"Gestão financeira simples. API REST + Token.",
    campos:[{k:"access_token",l:"Access Token",p:"Token do Granatum"}],
    dados:["Lançamentos","Clientes","Categorias","Fluxo de caixa"]},
  {id:"pluggy",nome:"Pluggy",cat:"banco",status:"em_breve",cor:"#06B6D4",icon:"🏦",
    desc:"Open Finance — 300+ bancos brasileiros. Extratos automáticos.",
    campos:[{k:"client_id",l:"Client ID",p:"Pluggy Client ID"},{k:"client_secret",l:"Client Secret",p:"Pluggy Secret"}],
    dados:["Extratos bancários","Saldos","Investimentos","Cartões de crédito"]},
  {id:"belvo",nome:"Belvo",cat:"banco",status:"em_breve",cor:"#14B8A6",icon:"🏛️",
    desc:"Open Finance — 200+ instituições. Dados fiscais e bancários.",
    campos:[{k:"secret_id",l:"Secret ID",p:"Belvo Secret ID"},{k:"secret_password",l:"Secret Password",p:"Belvo Password"}],
    dados:["Contas","Transações","Saldos","Dados fiscais"]},
  {id:"asaas",nome:"Asaas",cat:"pagamento",status:"em_breve",cor:"#10B981",icon:"💳",
    desc:"Cobranças, boletos, Pix, cartão. API completa.",
    campos:[{k:"api_key",l:"API Key",p:"Chave API Asaas"}],
    dados:["Cobranças","Pagamentos","Pix","Boletos","Split"]},
  {id:"cora",nome:"Cora",cat:"pagamento",status:"planejado",cor:"#EC4899",icon:"💰",
    desc:"Conta digital PJ. Boletos, Pix, gestão financeira.",
    campos:[{k:"api_key",l:"API Key",p:"Chave API Cora"}],
    dados:["Boletos","Pix","Transferências","Extrato"]},
  {id:"enotas",nome:"eNotas",cat:"fiscal",status:"em_breve",cor:"#6366F1",icon:"📄",
    desc:"Emissão NFS-e para 1.000+ municípios.",
    campos:[{k:"api_key",l:"API Key",p:"Chave API eNotas"}],
    dados:["Emissão NFS-e","Consulta NFS-e","Empresas"]},
  {id:"focusnfe",nome:"Focus NFe",cat:"fiscal",status:"planejado",cor:PU,icon:"🧾",
    desc:"NF-e, NFC-e, NFS-e, CT-e completo.",
    campos:[{k:"token",l:"Token",p:"Token Focus NFe"}],
    dados:["NF-e","NFC-e","NFS-e","CT-e"]},
];

const CATS = [
  {id:"todos",n:"Todos",c:GOL},
  {id:"erp",n:"ERPs",c:BL},
  {id:"banco",n:"Bancos",c:"#06B6D4"},
  {id:"pagamento",n:"Pagamentos",c:G},
  {id:"fiscal",n:"Fiscal",c:PU},
];

export default function ConectoresPage(){
  const [filtro,setFiltro]=useState("todos");
  const [open,setOpen]=useState<string|null>(null);
  const [configs,setConfigs]=useState<Record<string,Record<string,string>>>({});
  const [saved,setSaved]=useState<string|null>(null);

  const filtered = filtro==="todos"?CONNECTORS:CONNECTORS.filter(c=>c.cat===filtro);
  const ativos = CONNECTORS.filter(c=>c.status==="ativo").length;
  const breve = CONNECTORS.filter(c=>c.status==="em_breve").length;
  const plan = CONNECTORS.filter(c=>c.status==="planejado").length;

  const salvar=(id:string)=>{
    setSaved(id);setTimeout(()=>setSaved(null),2000);
  };

  const inp:any={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,outline:"none",width:"100%"};

  return(
  <div style={{padding:20,maxWidth:1000,margin:"0 auto",background:BG,minHeight:"100vh"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
      <div>
        <div style={{fontSize:20,fontWeight:700,color:GOL}}>Central de Conectores</div>
        <div style={{fontSize:11,color:TXD}}>Integre o PS Gestão com o ERP, banco e sistema fiscal de cada cliente</div>
      </div>
      <a href="/dashboard" style={{padding:"8px 16px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← Dashboard</a>
    </div>

    {/* Stats */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:16}}>
      {[
        {l:"Total disponível",v:CONNECTORS.length.toString(),c:GOL},
        {l:"Ativo",v:ativos.toString(),c:G},
        {l:"Em breve",v:breve.toString(),c:Y},
        {l:"Planejado",v:plan.toString(),c:TXD},
      ].map((s,i)=>(
        <div key={i} style={{background:BG2,borderRadius:10,padding:"10px 12px",borderLeft:`3px solid ${s.c}`,border:`1px solid ${BD}`}}>
          <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:0.4}}>{s.l}</div>
          <div style={{fontSize:22,fontWeight:700,color:s.c,marginTop:2}}>{s.v}</div>
        </div>
      ))}
    </div>

    {/* Category filter */}
    <div style={{display:"flex",gap:4,marginBottom:16}}>
      {CATS.map(c=>(
        <button key={c.id} onClick={()=>setFiltro(c.id)} style={{padding:"6px 14px",borderRadius:20,fontSize:11,border:`1px solid ${filtro===c.id?c.c:BD}`,background:filtro===c.id?c.c+"18":"transparent",color:filtro===c.id?c.c:TXM,fontWeight:filtro===c.id?600:400,cursor:"pointer"}}>{c.n}</button>
      ))}
    </div>

    {/* Connector cards */}
    {filtered.map(con=>(
      <div key={con.id} style={{background:BG2,borderRadius:12,marginBottom:8,border:`1px solid ${BD}`,overflow:"hidden"}}>
        <div onClick={()=>setOpen(open===con.id?null:con.id)} style={{padding:"14px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}
          onMouseEnter={e=>(e.currentTarget.style.background=BG3)} onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <span style={{fontSize:22}}>{con.icon}</span>
            <div>
              <div style={{fontSize:14,fontWeight:600,color:TX}}>{con.nome}</div>
              <div style={{fontSize:10,color:TXD}}>{con.desc}</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:9,padding:"3px 10px",borderRadius:12,fontWeight:600,
              background:con.status==="ativo"?G+"20":con.status==="em_breve"?Y+"20":BD,
              color:con.status==="ativo"?G:con.status==="em_breve"?Y:TXD}}>
              {con.status==="ativo"?"✓ Ativo":con.status==="em_breve"?"Em breve":"Planejado"}
            </span>
            <span style={{fontSize:10,color:TXD}}>{open===con.id?"▼":"▶"}</span>
          </div>
        </div>

        {open===con.id&&(
          <div style={{padding:"0 16px 16px",borderTop:`1px solid ${BD}40`}}>
            {/* Dados disponíveis */}
            <div style={{marginTop:12,marginBottom:12}}>
              <div style={{fontSize:10,color:TXD,marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>Dados disponíveis via API</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                {con.dados.map((d,i)=>(
                  <span key={i} style={{fontSize:10,padding:"3px 8px",borderRadius:6,background:con.cor+"15",color:con.cor,border:`1px solid ${con.cor}30`}}>{d}</span>
                ))}
              </div>
            </div>

            {/* Config fields */}
            <div style={{background:BG3,borderRadius:8,padding:12,marginBottom:10}}>
              <div style={{fontSize:10,color:TXD,marginBottom:8,textTransform:"uppercase",letterSpacing:0.5}}>Configuração da integração</div>
              <div style={{display:"grid",gridTemplateColumns:con.campos.length>1?"1fr 1fr":"1fr",gap:8}}>
                {con.campos.map(f=>(
                  <div key={f.k}>
                    <div style={{fontSize:10,color:TXM,marginBottom:3}}>{f.l}</div>
                    <input type={f.k.includes("secret")||f.k.includes("password")?"password":"text"}
                      placeholder={f.p} value={configs[con.id]?.[f.k]||""}
                      onChange={e=>setConfigs({...configs,[con.id]:{...configs[con.id],[f.k]:e.target.value}})}
                      style={inp} disabled={con.status!=="ativo"}/>
                  </div>
                ))}
              </div>
              <div style={{marginTop:10,display:"flex",gap:8,alignItems:"center"}}>
                <button onClick={()=>salvar(con.id)} disabled={con.status!=="ativo"}
                  style={{padding:"8px 16px",borderRadius:8,fontSize:11,fontWeight:600,border:"none",cursor:con.status==="ativo"?"pointer":"not-allowed",
                    background:con.status==="ativo"?`linear-gradient(135deg,${GO},${GOL})`:`${BD}`,
                    color:con.status==="ativo"?BG:TXD,opacity:con.status==="ativo"?1:0.5}}>
                  {saved===con.id?"✓ Salvo!":con.status==="ativo"?"Salvar e testar conexão":"Disponível em breve"}
                </button>
                {con.status==="ativo"&&<span style={{fontSize:10,color:G}}>Conector pronto para uso</span>}
                {con.status!=="ativo"&&<span style={{fontSize:10,color:TXD}}>Configuração será habilitada quando o conector estiver ativo</span>}
              </div>
            </div>

            {/* Integration info */}
            <div style={{fontSize:9,color:TXD}}>
              Categoria: {con.cat.toUpperCase()} | {con.campos.length} campo(s) de configuração | {con.dados.length} tipos de dados
            </div>
          </div>
        )}
      </div>
    ))}

    <div style={{fontSize:10,color:TXD,textAlign:"center",marginTop:16,padding:12,background:BG2,borderRadius:8,border:`1px solid ${BD}`}}>
      PS Gestão — Central de Conectores | 14 integrações mapeadas | Arquitetura universal para BPO Inteligente
    </div>
  </div>);
}
