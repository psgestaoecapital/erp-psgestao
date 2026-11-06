-- PDCA Hub · /dashboard/projetos/instalar-app — fecha o termômetro MENU (CEO 27/10: "tela pronta
-- tem que estar no menu oficial"). A tela passa na jornada e no visual (aud8 95), é alcançável pela
-- aba COMERCIAL do Hub, mas NÃO estava registrada em module_catalog (provado no dado: 0 linhas para
-- essa rota). Esta migration ADITIVA insere a linha oficial, no mesmo padrão da /dashboard/projetos/
-- desempenho (grupo hub, subgrupo projetos_comercial). Idempotente (ON CONFLICT no id).
INSERT INTO public.module_catalog
  (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, is_shared, descricao)
VALUES (
  'projetos_instalar_app',
  'Instalar app',
  'hub',
  'projetos_comercial',
  'Smartphone',
  '/dashboard/projetos/instalar-app',
  130,
  true,
  true,
  'Instalar o app no celular (PWA): instalar direto, QR Code, compartilhar no WhatsApp, copiar link e ver a versão.'
)
ON CONFLICT (id) DO NOTHING;
