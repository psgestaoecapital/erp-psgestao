# PS Agente ATAK — instalação em 3 passos

> Guia de 1 página para o TI do cliente (o Jian). Este é o conteúdo do `LEIA-ME.pdf` que vai
> dentro do `.zip` gerado pela tela (botão "Gerar instalador"). Nenhum arquivo pra editar,
> sem Node, sem `.env`. **A senha do SQL fica só nesta máquina — nunca vai pra PS.**

## O que você recebeu (no `.zip`)
- **`agente-atak.exe`** — o coletor (não precisa instalar Node).
- **`config.json`** — já vem com o endereço da PS e o **token desta empresa** (não mexa).
- **`instalar.bat`** — instala o serviço com 1 duplo-clique.
- **`LEIA-ME.pdf`** — este guia.

## Passo a passo
1. **Copie a pasta** do instalador para o **servidor** (o mesmo que enxerga o SQL Server, rede 20.x).
2. **Duplo-clique em `instalar.bat`.** (Se o Windows pedir, confirme "Executar como administrador".)
3. Quando aparecer **"Digite a senha do usuário de LEITURA do SQL Server"**, digite a senha e **Enter**.
   - A senha é **gravada criptografada** aqui na máquina (`cred.dat`, DPAPI do Windows) e **não é enviada pra PS**.

Pronto. Em ~1 minuto a tela da PS acende **verde** (conectou). Se acender **vermelho**, a mensagem diz o porquê
em português: **rede** (não alcança o host), **senha** (credencial inválida) ou **banco** (sem acesso).

## Depois (não precisa mexer)
- O serviço **"PS Agente ATAK"** roda sozinho, reinicia com a máquina e **coleta a cada ~15 min**.
- **Trocou de servidor/host?** A PS ajusta na tela — **você não toca na máquina**. O agente pega no próximo ciclo.

## Comandos úteis (opcional, prompt na pasta do `.exe`)
- `agente-atak.exe --testar` — testa a conexão agora (SELECT 1) e mostra o resultado.
- `agente-atak.exe --set-senha` — troca a senha local (se o usuário de leitura mudar).
- `agente-atak.exe --desinstalar-servico` — remove o serviço.

## Log
- `agente.log` (ao lado do `.exe`) registra cada ciclo e qualquer erro, em português.
