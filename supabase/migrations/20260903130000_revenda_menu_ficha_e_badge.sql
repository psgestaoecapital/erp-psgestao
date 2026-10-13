-- Revenda de Veículos · tira a Ficha do menu (era 404) + badge honesto (RD-58).
--
-- Problema 1 (404): o módulo revenda_veiculo aponta para /dashboard/revenda/veiculo, mas a tela
--   real é /dashboard/revenda/veiculo/[id]. Sem id, a rota não existe — clicar no menu dá 404.
--   A ficha é DETALHE (alcançada pelo cartão do Pátio, como a ficha de NF-e recebida ou a OS),
--   não item de menu. Solução: legacy=true — o fn_modulos_sidebar_por_area filtra legacy=false,
--   então some do menu; a linha e o vínculo em plan_modules ficam, para o RBAC continuar
--   enxergando a tela. (Auditei: 'legacy' só é usado pelo menu e por funções de cobertura/drift,
--   nunca por gate de acesso — então esconder do menu não bloqueia a ficha.)
--
-- Problema 2 (badge que mente · RD-58): o badge (Pronto/Parcial/Previsto) do menu vem de
--   feature_catalog — módulo SEM features catalogadas cai em 'previsto' por padrão. Pátio, Vendas
--   e a Ficha funcionam (o CEO cadastrou um veículo e viu o custo real), mas tinham 0 features,
--   então o menu dizia "Previsto" numa tela que funciona. Cataloga a feature-núcleo de cada um
--   como 'pronto' — assim o badge diz a verdade.

-- (1) Ficha sai do menu, permanece no catálogo (RBAC/plan_modules intactos)
UPDATE public.module_catalog SET legacy = true WHERE id = 'revenda_veiculo';

-- (2) Badge honesto: feature-núcleo 'pronto' por módulo (o CEO confirmou que estão prontos)
INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto, prioridade)
VALUES
  ('F.revenda_patio.gestao',  'revenda_patio',  'revenda_veiculos',
   'Pátio de veículos', 'Listagem e gestão dos veículos em estoque com custo acumulado por veículo.',
   'pronto', 100, 'alta'),
  ('F.revenda_vendas.registro', 'revenda_vendas', 'revenda_veiculos',
   'Registro de vendas', 'Registro da venda do veículo com recebimentos e eventual troca.',
   'pronto', 100, 'alta'),
  ('F.revenda_veiculo.ficha', 'revenda_veiculo', 'revenda_veiculos',
   'Ficha do veículo', 'Detalhe do veículo: custos, entradas e resultado — aberta pelo cartão do Pátio.',
   'pronto', 100, 'alta')
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  percentual_pronto = EXCLUDED.percentual_pronto,
  titulo = EXCLUDED.titulo,
  descricao_executiva = EXCLUDED.descricao_executiva,
  atualizado_em = now();
