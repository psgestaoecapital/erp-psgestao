# Ajuda de campo — o "?" padrão (RD-95)

Componente: `src/components/ajuda/AjudaCampo.tsx` (o mesmo da Mão de obra). Textos no banco: `erp_ajuda_campo`,
editáveis sem deploy (`/dashboard/admin/ajuda-curadoria`).

## Uso
```tsx
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";

<label>
  Horas por dia <AjudaCampo chave="projetos.mao_obra.ficha.horas" />
  <input type="number" />
</label>
```
- `chave`: `vertical.tela.grupo.campo` (minúsculas, `_`, ao menos dois pontos). É única no banco.
- `rota` (opcional): rota da tela cujos textos carregar; padrão = rota atual. Uma busca por tela, compartilhada pelos "?".
- Também vale `ajuda="chave"` no `<Campo>` do Hub.

## O cartão (quatro blocos fixos, linguagem do usuário)
O que preencher · Para que serve no cálculo · Exemplo · Erro comum (+ "Ver mais" com o artigo da Central de Ajuda).
Abre junto do "?" no computador e sobe de baixo (bottom sheet) no celular; não sai da tela. Cada abertura vira registro em
`erp_ajuda_uso`.

## Texto novo
Migration com `INSERT … INTO erp_ajuda_campo (chave, rota, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)`
(modelo: `supabase/migrations/20261007130010_prod_ajuda_campo_cadastro_fluxo.sql`), `ON CONFLICT (chave) DO UPDATE`.
Vale para campo, coluna editável, filtro, indicador e ação.

## Travas e medição
- Gate `check-ajuda-campo-pr`: tela/componente NOVO sem "?" reprova; ALTERADO não pode aumentar o número de campos sem "?".
- Gate `check-ajuda-campo`: Hub/P&M — campo sem "?" e chave inexistente no banco reprovam.
- Relatório de cobertura por vertical: `npm run relatorio:ajuda-campo` (`-- --json` para máquina).
