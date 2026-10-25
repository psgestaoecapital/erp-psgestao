-- Hub (RD-95): "?" de /dashboard/projetos/instalar-app — Instalar agora, QR, WhatsApp, copiar link e os passos Android/iPhone.
-- Só acrescenta texto de ajuda. Aditiva e idempotente; não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Instalar o app', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/projetos/instalar-app', 'hub', 'publicado'
FROM (VALUES
 ('hub.instalar_app.instalar_agora', 'Instalar agora',
  'Toque no botão e confirme no aviso do navegador. Ele só aparece quando o navegador deste aparelho permite instalar direto (Chrome/Edge).',
  'Coloca o ícone do PS Gestão na tela do aparelho; o app abre em tela cheia, sem barra do navegador.',
  'No celular Android do vendedor: tocar em Instalar agora → Instalar.',
  'Procurar o botão no iPhone: lá ele não existe — siga os passos do Safari.', 10),
 ('hub.instalar_app.qr', 'QR do app',
  'Aponte a câmera do celular que vai receber o app para o QR desta tela.',
  'Abre o PS Gestão no celular já no Funil de Oportunidades; daí é só instalar pelos passos abaixo.',
  'Gestor mostra o QR no computador e o vendedor escaneia com o celular dele.',
  'Escanear com o celular que já tem o app instalado: ele só abre de novo o mesmo app.', 20),
 ('hub.instalar_app.whatsapp', 'Enviar via WhatsApp',
  'Toque e escolha o contato (ou o grupo da equipe) que vai receber o link.',
  'Manda o link do app com os passos de instalação do Android e do iPhone numa mensagem só.',
  'Enviar para o grupo "Vendas campo" para a equipe toda instalar.',
  'Abrir o link pelo navegador interno do WhatsApp no iPhone: abra no Safari para instalar.', 30),
 ('hub.instalar_app.copiar_link', 'Copiar link',
  'Toque para copiar o endereço do app e cole onde quiser (e-mail, SMS, outro aplicativo).',
  'Reserva para quando o QR ou o WhatsApp não servem; o endereço é sempre o oficial do PS Gestão.',
  'Colar o link num e-mail para o vendedor que está viajando.',
  'Copiar o endereço da barra do navegador em vez deste botão: pode ser um endereço de teste que não instala.', 40),
 ('hub.instalar_app.android', 'Passos no Android',
  'Siga os 4 passos no Chrome do celular Android.',
  'Instala o app quando o botão Instalar agora não apareceu.',
  'Chrome → ⋮ → Instalar app → Instalar.',
  'Usar outro navegador (ex.: o do fabricante): alguns não oferecem Instalar app; use o Chrome.', 50),
 ('hub.instalar_app.iphone', 'Passos no iPhone',
  'Siga os 4 passos no Safari do iPhone.',
  'No iPhone a instalação é sempre pelo Safari (Adicionar à Tela de Início).',
  'Safari → Compartilhar → Adicionar à Tela de Início → Adicionar.',
  'Tentar pelo Chrome do iPhone: ele não instala o app corretamente.', 60)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
