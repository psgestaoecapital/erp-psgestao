-- App de vendas no celular (CEO 12/11): item de menu + "?" RD-95 (tarefa 735b5f8a).
-- Aditiva e idempotente. Sem dado de cliente. Reusa o componente <InstalarApp> e as RPCs
-- fn_app_instalacao_* já existentes (RD-26/RD-52): aqui só o menu e as chaves de ajuda.

-- 1) Item de menu "App de vendas (celular)" na seção COMERCIAL (mesmo grupo/subgrupo do Painel).
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, is_shared, so_ps, descricao)
SELECT gen_random_uuid(), 'App de vendas (celular)', 'industrial', 'comercial', 'Smartphone',
       '/dashboard/comercial/instalar-app', 195, true, true, false,
       'Instale o painel de vendas no celular por QR code — suas vendas na palma da mão.'
WHERE NOT EXISTS (SELECT 1 FROM public.module_catalog WHERE rota = '/dashboard/comercial/instalar-app');

-- 2) Chaves de ajuda "?" (RD-95) das ações da tela de instalação + do botão "No celular" do painel.
INSERT INTO public.erp_ajuda_campo (chave, rota, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum) VALUES
 ('comercial.instalar_app.instalar_agora', '/dashboard/comercial/instalar-app', 'Instalar app',
  'Botão — não se preenche.', 'Instala o PS Gestão como app no seu celular (Android/computador). No iPhone, use os passos do Safari.',
  'Toque e confirme "Instalar".', 'No iPhone o botão não aparece: use Compartilhar › Adicionar à Tela de Início.'),
 ('comercial.instalar_app.qr', '/dashboard/comercial/instalar-app', 'QR code',
  'Imagem — não se preenche.', 'Aponte a câmera do celular para o QR e abra o painel de vendas direto no aparelho.',
  'Câmera do celular sobre o QR → tocar no link.', 'QR embaçado: aumente o brilho da tela ou aproxime a câmera.'),
 ('comercial.instalar_app.whatsapp', '/dashboard/comercial/instalar-app', 'Enviar pelo WhatsApp',
  'Botão — não se preenche.', 'Manda o link do painel para o seu WhatsApp (ou de um vendedor) para abrir no celular.',
  'Toque e escolha a conversa.', 'Sem WhatsApp Web/app: use "Copiar link" e cole onde quiser.'),
 ('comercial.instalar_app.copiar_link', '/dashboard/comercial/instalar-app', 'Copiar link',
  'Botão — não se preenche.', 'Copia o endereço do painel para você colar onde quiser (e-mail, mensagem).',
  'Toque e cole no destino.', 'Alguns navegadores bloqueiam copiar: selecione o link e copie à mão.'),
 ('comercial.instalar_app.link', '/dashboard/comercial/instalar-app', 'Link do app',
  'Endereço — não se preenche.', 'É o endereço estável do app; sempre abre a versão oficial, nunca um host de teste.',
  'app oficial do PS Gestão.', 'Não use um link com .vercel.app aleatório: pode ser uma versão congelada.'),
 ('comercial.instalar_app.versao', '/dashboard/comercial/instalar-app', 'Versão',
  'Indicador — não se preenche.', 'Mostra a versão do app que está rodando, para conferir se está atualizada.',
  'ex.: 2026.11.12', 'Versão antiga após atualização: feche e reabra o app, ou limpe o cache.'),
 ('comercial.instalar_app.instalacoes', '/dashboard/comercial/instalar-app', 'Pessoas que já instalaram',
  'Indicador — não se preenche.', 'Quantas pessoas da sua empresa já instalaram o app de vendas no celular.',
  'ex.: 7 pessoas instalaram.', 'Conta por empresa: só aparece quem instalou pela tela desta empresa.'),
 ('com.painel.app_celular', '/dashboard/comercial/meu-painel', 'No celular',
  'Botão — não se preenche.', 'Abre a tela com o QR code e o passo a passo para usar o painel de vendas no celular.',
  'Toque e escaneie o QR com o celular.', 'Nada acontece: verifique sua conexão e tente de novo.')
ON CONFLICT (chave) DO NOTHING;
