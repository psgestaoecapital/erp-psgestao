-- PDCA Hub · /dashboard/projetos/visitas (caixa e10ef43c): "?" do registro de campo no card da visita (RD-95).
-- Só textos de ajuda (erp_ajuda_campo, tabela global de catálogo). Nenhum dado de cliente é tocado (RD-55).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Visitas técnicas', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/visitas', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.visitas.registro_local', 'Local da visita (GPS)', 'Na obra, com o celular, clique em "📍 Registrar local agora" e permita a localização. Com o local gravado, o card mostra "ver no mapa".', 'Prova que a visita aconteceu no endereço da obra e leva quem for executar direto ao local pelo mapa.', 'Vendedor chega na rua das Flores 120, clica em "Registrar local agora" e o card passa a mostrar "local registrado · ver no mapa".', 'Registrar o local do escritório: a posição gravada é a do aparelho na hora do clique, então faça isso na obra.', 10),
 ('projetos.visitas.fotos_arquivos', 'Fotos e arquivos da visita', 'Clique em "📷 Fotos e arquivos" para abrir o painel da visita: tire a foto ou escolha o arquivo e escreva a observação de cada um (ex.: "parede com infiltração").', 'Guarda o registro de campo junto da visita: quem monta o orçamento vê as fotos, as medidas e as observações sem pedir de novo ao vendedor. O número mostra quantos arquivos a visita já tem.', 'Foto da fachada com a observação "acesso só pela lateral" e o croqui da cozinha em PDF.', 'Mandar as fotos por mensagem e não anexar aqui: o orçamento sai sem o registro de campo e a informação se perde.', 11)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;

UPDATE public.erp_ajuda_campo
   SET exemplo = '"Gerar o orçamento desta visita" numa visita realizada sem orçamento: use o botão "+ Gerar orçamento desta visita" do próprio card.',
       versao = versao + 1, atualizado_em = now()
 WHERE chave = 'projetos.visitas.proximo_passo';
