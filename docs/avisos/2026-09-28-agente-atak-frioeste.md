# Aviso à Frioeste — Agente PS ATAK (28/09/2026)

**Para:** TI / responsável pelo servidor SERVERFRIOESTE (onde roda o Agente PS ATAK)
**Assunto:** Agente PS ATAK — atualização automática para a versão 2.1.3 e novo jeito de baixar o instalador

Olá,

Estamos reforçando a segurança da plataforma PS Gestão. Duas mudanças no Agente PS ATAK:

1. **Atualização automática para a versão 2.1.3.** O agente instalado no SERVERFRIOESTE se atualiza sozinho,
   como nas versões anteriores. Não é preciso fazer nada. A coleta continua normalmente durante e depois da atualização.

2. **Nova instalação só pelo link gerado no sistema.** A partir de agora, o instalador do agente não fica mais
   em um endereço público. Para instalar em uma máquina nova, ou reinstalar, entre em
   **PS Gestão → Industrial → Conectores → "Gerar instalador"**. O sistema gera o pacote (.zip) na hora, com um
   link válido por 10 minutos. Links diretos antigos para o arquivo `agente-atak.exe` deixam de funcionar.

A senha do SQL Server continua só na máquina de vocês: ela nunca vai para a PS.

Qualquer dúvida, é só abrir um chamado no sistema.

Equipe PS Gestão
