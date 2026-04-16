'use client'
import React from 'react'
import Link from 'next/link'

const C={bg:'#0F0F0F',card:'#1A1410',card2:'#1E1E1B',border:'#2A2822',gold:'#C8941A',goldL:'#E8C872',text:'#FAF7F2',muted:'#B0AB9F',dim:'#918C82',green:'#22C55E',blue:'#3B82F6'}

export default function PrivacidadePage(){
  return(
    <div style={{minHeight:'100vh',background:C.bg,color:C.text,fontFamily:"'Helvetica',sans-serif"}}>
      <header style={{background:C.card,borderBottom:`1px solid ${C.border}`,padding:'16px 24px',position:'sticky',top:0,zIndex:10}}>
        <div style={{maxWidth:900,margin:'0 auto',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <Link href="/" style={{display:'flex',alignItems:'center',gap:12,textDecoration:'none',color:C.gold}}>
            <div style={{fontSize:24,fontWeight:900,letterSpacing:'0.05em'}}>PS<span style={{color:C.goldL}}>G</span></div>
            <div style={{fontSize:10,letterSpacing:'0.2em',color:C.goldL}}>PS GESTÃO &amp; CAPITAL</div>
          </Link>
          <Link href="/" style={{color:C.muted,fontSize:12,textDecoration:'none'}}>← Voltar</Link>
        </div>
      </header>

      <div style={{maxWidth:900,margin:'0 auto',padding:'40px 24px'}}>
        <div style={{textAlign:'center',marginBottom:40,paddingBottom:24,borderBottom:`2px solid ${C.gold}`}}>
          <div style={{fontSize:11,letterSpacing:'0.3em',color:C.gold,marginBottom:10}}>PLATAFORMA ERP PS GESTÃO</div>
          <h1 style={{fontSize:32,fontWeight:700,color:C.goldL,margin:'0 0 8px'}}>Política de Privacidade</h1>
          <div style={{fontSize:13,color:C.muted,marginTop:6}}>e Proteção de Dados Pessoais</div>
          <div style={{fontSize:11,color:C.dim,marginTop:10}}>
            Data de publicação: 04/04/2026 · Última atualização: 15/04/2026 · Versão 1.1
          </div>
        </div>

        <div style={{fontSize:13,lineHeight:1.8,color:C.text}}>
          <Section n="1" titulo="INTRODUÇÃO E COMPROMISSO">
            <p>A <strong>PS Gestão e Capital LTDA</strong>, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº <strong>60.866.510/0001-78</strong>, com sede em São Miguel do Oeste, Estado de Santa Catarina, doravante denominada &quot;CONTROLADORA&quot;, apresenta esta Política de Privacidade e Proteção de Dados Pessoais (&quot;Política&quot;) em conformidade com as seguintes normas legais:</p>
            <div style={{background:C.card,borderRadius:8,padding:'14px 18px',margin:'14px 0',borderLeft:`4px solid ${C.gold}`}}>
              <div style={{margin:'6px 0'}}><strong style={{color:C.gold}}>Lei nº 13.709/2018</strong> — Lei Geral de Proteção de Dados Pessoais (LGPD)</div>
              <div style={{margin:'6px 0'}}><strong style={{color:C.gold}}>Lei nº 12.965/2014</strong> — Marco Civil da Internet</div>
              <div style={{margin:'6px 0'}}><strong style={{color:C.gold}}>Decreto nº 8.771/2016</strong> — Regulamentação do Marco Civil da Internet</div>
              <div style={{margin:'6px 0'}}><strong style={{color:C.gold}}>Lei nº 8.078/1990</strong> — Código de Defesa do Consumidor (CDC)</div>
              <div style={{margin:'6px 0'}}><strong style={{color:C.gold}}>Lei nº 10.406/2002</strong> — Código Civil Brasileiro</div>
              <div style={{margin:'6px 0'}}><strong style={{color:C.gold}}>Resoluções da ANPD</strong> — Autoridade Nacional de Proteção de Dados</div>
            </div>
            <p>Esta Política tem como objetivo informar de forma clara e transparente como coletamos, utilizamos, armazenamos, compartilhamos e protegemos os dados pessoais e dados financeiros dos usuários (&quot;TITULARES&quot;) que utilizam a plataforma ERP PS Gestão (&quot;PLATAFORMA&quot;), acessível pelo endereço <strong style={{color:C.gold}}>erp-psgestao.vercel.app</strong>.</p>
          </Section>

          <Section n="2" titulo="DEFINIÇÕES">
            <p>Para os fins desta Política, consideram-se:</p>
            <DefCard termo="Dado Pessoal" desc="Informação relacionada a pessoa natural identificada ou identificável (art. 5º, I, LGPD)."/>
            <DefCard termo="Dado Pessoal Sensível" desc="Dado pessoal sobre origem racial ou étnica, convicção religiosa, opinião política, filiação sindical, dados referentes à saúde, vida sexual, dado genético ou biométrico (art. 5º, II, LGPD)."/>
            <DefCard termo="Dado Financeiro" desc="Informação relativa a faturamento, despesas, contas a pagar e receber, fluxo de caixa, balanço patrimonial, DRE e demais informações contábil-financeiras das empresas clientes."/>
            <DefCard termo="Tratamento" desc="Toda operação realizada com dados pessoais, como coleta, produção, recepção, classificação, utilização, acesso, reprodução, transmissão, distribuição, processamento, arquivamento, armazenamento, eliminação, avaliação (art. 5º, X, LGPD)."/>
            <DefCard termo="Controlador" desc="PS Gestão e Capital LTDA, a quem competem as decisões referentes ao tratamento de dados pessoais (art. 5º, VI, LGPD)."/>
            <DefCard termo="Operador" desc="Pessoa natural ou jurídica que realiza o tratamento de dados pessoais em nome do controlador (art. 5º, VII, LGPD)."/>
            <DefCard termo="Encarregado (DPO)" desc="Pessoa indicada pelo controlador para atuar como canal de comunicação entre o controlador, os titulares dos dados e a Autoridade Nacional de Proteção de Dados (art. 5º, VIII, LGPD)."/>
            <DefCard termo="Inteligência Artificial (IA)" desc="Sistema de classificação automática e análise de dados utilizado na Plataforma, fornecido por provedores terceiros (Anthropic Claude API), que processa dados financeiros agregados para geração de relatórios, classificação contábil e detecção de anomalias."/>
          </Section>

          <Section n="3" titulo="DADOS COLETADOS">
            <Sub titulo="3.1 Dados Pessoais do Usuário">
              <p>Coletamos os seguintes dados pessoais dos usuários cadastrados na Plataforma:</p>
              <DataItem titulo="Dados de identificação" desc="Nome completo, endereço de e-mail, telefone."/>
              <DataItem titulo="Dados de autenticação" desc="Credenciais de acesso (senha criptografada), tokens de sessão, endereço IP, dispositivo utilizado."/>
              <DataItem titulo="Dados de navegação" desc="Logs de acesso, módulos utilizados, horário e duração da sessão, ações realizadas (audit log)."/>
            </Sub>
            <Sub titulo="3.2 Dados Financeiros das Empresas Clientes">
              <p>Através de integrações autorizadas com sistemas de gestão (Omie, Nibo, ContaAzul e outros), coletamos:</p>
              <DataItem titulo="Dados contábeis" desc="Contas a pagar, contas a receber, categorias contábeis, plano de contas."/>
              <DataItem titulo="Dados de clientes e fornecedores" desc="Razão social, CNPJ/CPF, nome fantasia, dados de contato comercial."/>
              <DataItem titulo="Dados de documentos fiscais" desc="Números de notas fiscais, valores, datas de emissão e vencimento."/>
              <DataItem titulo="Dados bancários" desc="Extratos (via OFX/CSV), conciliação, saldos."/>
              <DataItem titulo="Dados patrimoniais" desc="Balanço patrimonial, financiamentos, investimentos."/>
            </Sub>
            <Sub titulo="3.3 Dados Não Coletados">
              <div style={{background:'#0F3D2A',border:`1px solid ${C.green}40`,borderRadius:8,padding:'14px 18px',margin:'10px 0'}}>
                <strong style={{color:C.green}}>A Plataforma NÃO coleta:</strong> dados biométricos, dados de saúde, dados de menores de 18 anos, senhas de sistemas terceiros (apenas tokens de API autorizados), dados de cartão de crédito ou débito do usuário.
              </div>
            </Sub>
          </Section>

          <Section n="4" titulo="BASES LEGAIS PARA TRATAMENTO (Art. 7º, LGPD)">
            <p>O tratamento de dados pessoais e financeiros pela Plataforma fundamenta-se nas seguintes bases legais:</p>
            <BasesTable/>
          </Section>

          <Section n="5" titulo="USO DE INTELIGÊNCIA ARTIFICIAL">
            <Sub titulo="5.1 Descrição do Processamento">
              <p>A Plataforma utiliza Inteligência Artificial (IA) fornecida por provedores terceiros para as seguintes finalidades:</p>
              <DataItem titulo="Classificação contábil automática" desc="Sugestão de categorias DRE para lançamentos financeiros sem classificação."/>
              <DataItem titulo="Análise anti-fraude" desc="Detecção de anomalias em lançamentos (score de 0 a 100 pontos, 11 camadas de verificação)."/>
              <DataItem titulo="Geração de relatórios gerenciais" desc="Síntese e análise de indicadores financeiros."/>
              <DataItem titulo="Resumo executivo" desc="Geração de insights e recomendações baseados nos dados financeiros."/>
            </Sub>
            <Sub titulo="5.2 Dados Enviados à IA">
              <p>Os dados enviados ao provedor de IA são EXCLUSIVAMENTE dados financeiros agregados e anonimizados na medida do possível, incluindo: tipo de lançamento (pagar/receber), valor, data, categoria atual, nome do cliente/fornecedor e observações do lançamento.</p>
              <div style={{background:'#3D1A1A',border:`1px solid #EF4444`+'40',borderRadius:8,padding:'14px 18px',margin:'10px 0'}}>
                <strong style={{color:'#EF4444'}}>NÃO são enviados:</strong> CPF/CNPJ de pessoas físicas, dados bancários (agência/conta), senhas ou tokens de acesso.
              </div>
            </Sub>
            <Sub titulo="5.3 Provedor de IA e Segurança">
              <p>O provedor atual de IA é a <strong>Anthropic, Inc.</strong> (San Francisco, EUA), através da API Claude. De acordo com a política de dados da Anthropic:</p>
              <DataItem titulo="Não treinamento" desc="Dados enviados via API comercial NÃO são utilizados para treinamento dos modelos de IA."/>
              <DataItem titulo="Não retenção" desc="Os dados são processados em tempo real e NÃO são retidos após o processamento, exceto por período mínimo para fins de segurança e abuso (máximo 30 dias)."/>
              <DataItem titulo="Transferência internacional" desc="Os dados são temporariamente processados em servidores nos EUA, em conformidade com o Capítulo V da LGPD (Transferência Internacional de Dados), com base no art. 33, II, alínea 'b' (cláusulas contratuais específicas)."/>
            </Sub>
            <Sub titulo="5.4 Direito de Recusa">
              <p>O Titular pode solicitar que seus dados NÃO sejam processados por IA, mantendo apenas o processamento manual. Neste caso, funcionalidades automáticas como classificação IA e relatórios com análise serão desabilitadas para a empresa do Titular.</p>
            </Sub>
          </Section>

          <Section n="6" titulo="ARMAZENAMENTO E SEGURANÇA">
            <Sub titulo="6.1 Infraestrutura">
              <DataItem titulo="Banco de dados" desc="Supabase (PostgreSQL gerenciado), com servidores na região da América do Sul (São Paulo/SP), em conformidade com a LGPD."/>
              <DataItem titulo="Aplicação" desc="Vercel (CDN global com edge functions), com dados sensíveis processados exclusivamente no backend (serverless)."/>
              <DataItem titulo="Código-fonte" desc="GitHub (repositório privado), com controle de acesso restrito."/>
            </Sub>
            <Sub titulo="6.2 Medidas Técnicas de Segurança">
              <p>A Plataforma implementa as seguintes medidas de segurança, em conformidade com o art. 46 da LGPD:</p>
              <DataItem titulo="Criptografia" desc="Todas as comunicações utilizam TLS/SSL (HTTPS). Senhas armazenadas com hash bcrypt."/>
              <DataItem titulo="Autenticação" desc="Sistema de autenticação via Supabase Auth com tokens JWT, timeout de sessão configurável (padrão 30 minutos)."/>
              <DataItem titulo="Controle de acesso" desc="Sistema de permissões por nível (administrador, sócio, financeiro, operador, visualizador), com mapa de permissões por módulo."/>
              <DataItem titulo="Audit log" desc="Registro de todas as ações do usuário (login, acesso a módulos, alterações) com IP, dispositivo e horário."/>
              <DataItem titulo="Restrição de horário" desc="Controle de acesso por horário e dias da semana, configurável por perfil."/>
              <DataItem titulo="Sessões ativas" desc="Monitoramento de sessões simultâneas com possibilidade de revogação."/>
              <DataItem titulo="Proteção de APIs" desc="Rotas protegidas com middleware de autenticação (withAuth), headers de segurança (X-Frame-Options, Content-Security-Policy, HSTS)."/>
              <DataItem titulo="Variáveis de ambiente" desc="Chaves de API e credenciais armazenadas exclusivamente em variáveis de ambiente do servidor, nunca expostas no código-fonte."/>
            </Sub>
            <Sub titulo="6.3 Período de Retenção">
              <p>Os dados serão armazenados pelo período necessário ao cumprimento das finalidades descritas nesta Política, observados os seguintes prazos mínimos legais:</p>
              <DataItem titulo="Dados contábeis e fiscais" desc="5 (cinco) anos, conforme art. 195, parágrafo único, do CTN e art. 37 da Lei nº 9.430/96."/>
              <DataItem titulo="Registros de acesso à aplicação" desc="6 (seis) meses, conforme art. 15 do Marco Civil da Internet."/>
              <DataItem titulo="Dados pessoais gerais" desc="Até a revogação do consentimento ou término do contrato, o que ocorrer por último."/>
            </Sub>
          </Section>

          <Section n="7" titulo="COMPARTILHAMENTO DE DADOS">
            <p>Os dados dos Titulares poderão ser compartilhados EXCLUSIVAMENTE com:</p>
            <DataItem titulo="Provedores de infraestrutura" desc="Supabase (banco de dados), Vercel (hospedagem), GitHub (código) — na qualidade de operadores, conforme contratos de processamento de dados."/>
            <DataItem titulo="Provedores de IA" desc="Anthropic (classificação e análise) — conforme descrito na Seção 5."/>
            <DataItem titulo="Integradores autorizados" desc="Omie, Nibo, ContaAzul — para sincronização de dados financeiros, mediante autorização expressa do Titular via API key/OAuth."/>
            <DataItem titulo="Autoridades legais" desc="Quando exigido por lei, decisão judicial ou regulamentação da ANPD."/>
            <div style={{background:'#0F3D2A',border:`1px solid ${C.green}40`,borderRadius:8,padding:'14px 18px',margin:'14px 0'}}>
              <strong style={{color:C.green}}>A Plataforma NÃO vende, aluga ou comercializa dados pessoais ou financeiros de seus usuários ou clientes para terceiros, em nenhuma hipótese.</strong>
            </div>
          </Section>

          <Section n="8" titulo="DIREITOS DO TITULAR (Art. 18, LGPD)">
            <p>O Titular dos dados pessoais tem direito a obter do Controlador, a qualquer tempo, mediante requisição:</p>
            <DireitoItem n="I" t="Confirmação" d="da existência de tratamento de seus dados"/>
            <DireitoItem n="II" t="Acesso" d="aos dados pessoais mantidos pela Plataforma"/>
            <DireitoItem n="III" t="Correção" d="de dados incompletos, inexatos ou desatualizados"/>
            <DireitoItem n="IV" t="Anonimização, bloqueio ou eliminação" d="de dados desnecessários, excessivos ou tratados em desconformidade"/>
            <DireitoItem n="V" t="Portabilidade" d="dos dados a outro fornecedor de serviço ou produto"/>
            <DireitoItem n="VI" t="Eliminação" d="dos dados pessoais tratados com base no consentimento"/>
            <DireitoItem n="VII" t="Informação" d="sobre entidades públicas e privadas com as quais o Controlador realizou uso compartilhado de dados"/>
            <DireitoItem n="VIII" t="Informação" d="sobre a possibilidade de não fornecer consentimento e sobre as consequências da negativa"/>
            <DireitoItem n="IX" t="Revogação" d="do consentimento, a qualquer tempo"/>
            <div style={{background:C.card,borderRadius:8,padding:'16px 20px',margin:'14px 0',borderLeft:`4px solid ${C.gold}`}}>
              <div style={{fontSize:12,color:C.muted,marginBottom:8}}>Para exercer seus direitos, envie solicitação para:</div>
              <div style={{fontSize:13}}>
                <strong style={{color:C.gold}}>E-mail do DPO:</strong> <a href="mailto:paravizi-salvi@gpconsultoriadeinvestimentos.com" style={{color:C.goldL,textDecoration:'none'}}>paravizi-salvi@gpconsultoriadeinvestimentos.com</a>
              </div>
              <div style={{fontSize:11,color:C.dim,marginTop:8}}>Prazo de resposta: 15 (quinze) dias, conforme art. 18, §4º, da LGPD.</div>
            </div>
          </Section>

          <Section n="9" titulo="INCIDENTES DE SEGURANÇA">
            <p>Em caso de incidente de segurança que possa acarretar risco ou dano relevante aos Titulares, a Controladora comunicará, em prazo razoável, conforme art. 48 da LGPD:</p>
            <ItemLista letra="a">A Autoridade Nacional de Proteção de Dados (ANPD);</ItemLista>
            <ItemLista letra="b">Os Titulares afetados.</ItemLista>
            <p>A comunicação conterá a descrição da natureza dos dados afetados, as medidas técnicas e de segurança adotadas, os riscos relacionados ao incidente e as medidas que foram ou serão adotadas para reverter ou mitigar os efeitos do incidente.</p>
          </Section>

          <Section n="10" titulo="COOKIES E TECNOLOGIAS DE RASTREAMENTO">
            <p>A Plataforma utiliza cookies estritamente necessários para o funcionamento do sistema de autenticação (sessão de login). <strong style={{color:C.goldL}}>NÃO utiliza cookies de rastreamento, publicidade ou análise comportamental de terceiros.</strong></p>
          </Section>

          <Section n="11" titulo="ALTERAÇÕES DESTA POLÍTICA">
            <p>Esta Política poderá ser atualizada a qualquer tempo para refletir alterações na legislação aplicável, nas práticas de tratamento de dados ou nas funcionalidades da Plataforma. O Titular será notificado sobre alterações substanciais através do e-mail cadastrado ou aviso na Plataforma.</p>
          </Section>

          <Section n="12" titulo="ENCARREGADO DE DADOS (DPO)">
            <div style={{background:`linear-gradient(135deg,${C.card},${C.card2})`,border:`1px solid ${C.gold}`,borderRadius:12,padding:'20px 24px',margin:'14px 0'}}>
              <div style={{fontSize:10,letterSpacing:'0.2em',color:C.gold,marginBottom:12}}>ENCARREGADO DE PROTEÇÃO DE DADOS</div>
              <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:'8px 16px',fontSize:13}}>
                <div style={{color:C.dim}}>Nome:</div><div style={{fontWeight:600}}>Gilberto Paravizi</div>
                <div style={{color:C.dim}}>E-mail:</div><div><a href="mailto:paravizi-salvi@gpconsultoriadeinvestimentos.com" style={{color:C.goldL,textDecoration:'none'}}>paravizi-salvi@gpconsultoriadeinvestimentos.com</a></div>
                <div style={{color:C.dim}}>Telefone:</div><div>(49) 99902-3142</div>
                <div style={{color:C.dim}}>Endereço:</div><div>São Miguel do Oeste/SC</div>
              </div>
            </div>
          </Section>
        </div>

        <footer style={{marginTop:40,paddingTop:24,borderTop:`1px solid ${C.border}`,textAlign:'center',fontSize:10,color:C.dim}}>
          PS Gestão e Capital LTDA · CNPJ 60.866.510/0001-78 · São Miguel do Oeste/SC<br/>
          <Link href="/termos" style={{color:C.gold,textDecoration:'none',margin:'0 8px'}}>Termos de Uso</Link>·
          <a href="mailto:paravizi-salvi@gpconsultoriadeinvestimentos.com" style={{color:C.gold,textDecoration:'none',marginLeft:8}}>Contato DPO</a>
        </footer>
      </div>
    </div>
  )
}

function Section({n,titulo,children}:{n:string;titulo:string;children:React.ReactNode}){
  return(
    <section style={{marginBottom:32}}>
      <h2 style={{fontSize:18,fontWeight:700,color:C.gold,margin:'24px 0 14px',paddingBottom:8,borderBottom:`1px solid ${C.border}`}}>
        <span style={{color:C.goldL,marginRight:10}}>{n}.</span>{titulo}
      </h2>
      {children}
    </section>
  )
}

function Sub({titulo,children}:{titulo:string;children:React.ReactNode}){
  return(
    <div style={{marginBottom:16}}>
      <h3 style={{fontSize:14,fontWeight:700,color:C.goldL,margin:'18px 0 8px'}}>{titulo}</h3>
      {children}
    </div>
  )
}

function ItemLista({letra,children}:{letra:string;children:React.ReactNode}){
  return(
    <p style={{marginLeft:20,position:'relative',padding:'4px 0'}}>
      <span style={{color:C.gold,fontWeight:700,marginRight:8}}>{letra})</span>{children}
    </p>
  )
}

function DefCard({termo,desc}:{termo:string;desc:string}){
  return(
    <div style={{background:C.card,borderRadius:6,padding:'10px 14px',margin:'6px 0',borderLeft:`3px solid ${C.gold}80`}}>
      <span style={{color:C.gold,fontWeight:700}}>{termo}:</span> <span style={{color:C.muted}}>{desc}</span>
    </div>
  )
}

function DataItem({titulo,desc}:{titulo:string;desc:string}){
  return(
    <div style={{padding:'8px 0 8px 18px',borderLeft:`2px solid ${C.gold}30`,marginLeft:8,marginBottom:4}}>
      <span style={{color:C.goldL,fontWeight:600}}>{titulo}:</span> <span style={{color:C.muted}}>{desc}</span>
    </div>
  )
}

function DireitoItem({n,t,d}:{n:string;t:string;d:string}){
  return(
    <div style={{display:'flex',alignItems:'flex-start',gap:12,padding:'8px 14px',background:C.card,margin:'6px 0',borderRadius:6,borderLeft:`3px solid ${C.gold}`}}>
      <span style={{color:C.gold,fontWeight:700,minWidth:35}}>{n}.</span>
      <div><strong style={{color:C.goldL}}>{t}</strong> {d}</div>
    </div>
  )
}

function BasesTable(){
  const rows=[
    {b:'Execução de contrato (art. 7º, V)',f:'Prestação dos serviços de BPO Financeiro e ERP',d:'Dados financeiros, contábeis e cadastrais'},
    {b:'Consentimento (art. 7º, I)',f:'Processamento por Inteligência Artificial (classificação, relatórios, anti-fraude)',d:'Dados financeiros enviados à API de IA'},
    {b:'Legítimo interesse (art. 7º, IX)',f:'Melhoria contínua da Plataforma, análise de uso, suporte técnico',d:'Dados de navegação e logs'},
    {b:'Obrigação legal (art. 7º, II)',f:'Cumprimento de obrigações fiscais, contábeis e regulatórias',d:'Dados contábeis e fiscais'},
    {b:'Exercício regular de direitos (art. 7º, VI)',f:'Defesa em processos judiciais ou administrativos',d:'Logs de auditoria e registros de acesso'},
  ]
  return(
    <div style={{overflowX:'auto',margin:'14px 0'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:11,minWidth:600}}>
        <thead>
          <tr style={{background:C.card2,borderBottom:`2px solid ${C.gold}`}}>
            <th style={{padding:'10px 12px',textAlign:'left',color:C.gold,fontWeight:700}}>BASE LEGAL</th>
            <th style={{padding:'10px 12px',textAlign:'left',color:C.gold,fontWeight:700}}>FINALIDADE</th>
            <th style={{padding:'10px 12px',textAlign:'left',color:C.gold,fontWeight:700}}>DADOS ENVOLVIDOS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r,i)=>(
            <tr key={i} style={{background:i%2?C.card:'transparent',borderBottom:`1px solid ${C.border}`}}>
              <td style={{padding:'10px 12px',fontWeight:600,color:C.goldL,verticalAlign:'top'}}>{r.b}</td>
              <td style={{padding:'10px 12px',color:C.text,verticalAlign:'top'}}>{r.f}</td>
              <td style={{padding:'10px 12px',color:C.muted,verticalAlign:'top'}}>{r.d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
