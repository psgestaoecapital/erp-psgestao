# Agente PS — Coletor ATAK/Frigosoft

Pacote **genérico** (o mesmo para qualquer frigorífico). O que muda por empresa é só o arquivo **`.env`**,
baixado já preenchido na tela **Industrial → Conectores** do painel PS.

## O que tem no pacote
- `collector.js` — o coletor (não precisa editar).
- `package.json` — dependências (`mssql`).
- `.env` — **você baixa da tela** (por empresa). Contém host/porta/banco/usuário/token; a **senha do SQL
  Server você preenche localmente** (Pilar 2 — a senha nunca sai da rede da empresa).
- `INSTALACAO.md` — passo a passo do TI.

## Resumo (detalhe em INSTALACAO.md)
1. Instale **Node.js 18+**.
2. Extraia numa pasta (ex.: `C:\agente-ps`).
3. Coloque o `.env` baixado na pasta e **preencha `ATAK_SENHA`** (senha do SQL Server). Salve em **ANSI**.
4. `npm install`
5. `node collector.js` (deve conectar, coletar e reportar).
6. Agende no **Agendador de Tarefas** a cada 10 min.
7. Confira no painel: o monitor da empresa acende **verde**.

## Segurança
- A **senha do SQL Server** fica só no `.env` local — nunca trafega para a nuvem PS.
- A identidade do agente é o **AGENTE_TOKEN** (gerado no cadastro). Trate como senha.
- A `SUPABASE_ANON_KEY` é **pública** (não é segredo).
