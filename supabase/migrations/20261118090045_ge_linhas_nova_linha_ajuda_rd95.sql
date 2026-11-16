-- RD-95 · Linhas de negócio (/dashboard/linhas-negocio): a ação "+ Nova linha" na lista da página
-- principal era o único atalho sem "?" (o "⚙ Configurar" do topo, "Editar" e "Remover" já têm).
-- Este arquivo só adiciona a chave de ajuda da ação, fechando a cobertura RD-95 da tela.
-- ADITIVO e idempotente (ON CONFLICT DO NOTHING). Nenhum dado de cliente tocado.
-- RD-52: arquivo em supabase/migrations + PR (faixa desenvolvedor_4_g :45, acima da main).

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('ge.linhas.nova_linha','/dashboard/linhas-negocio','Linhas de negócio','Nova linha','Ação (botão). Abre a tela de configuração para você criar uma nova linha de negócio.','Atalho para começar uma nova linha sem sair desta visão; a criação em si é feita na tela de configuração.','Criar a linha "Locação" quando a empresa passa a ter esse tipo de receita.','Criar linhas demais ou muito parecidas: comece pelas grandes áreas que você quer comparar (ex.: Serviços × Produtos).','ge',9,'publicado')
ON CONFLICT (chave) DO NOTHING;
