#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PROVA do MODELO_migracao_estoque_PS.xlsx (contexto 9c43a93d). Duas verificações independentes:

  (A) ESTRUTURAL — abre o arquivo ENTREGUE e confere que as fórmulas da aba "Conferência" (B5:B12,
      D5:D12, C12) são EXATAMENTE as da especificação. É o que garante que a planilha calcula o que
      o importador vai mostrar (mesmos 8 indicadores).
  (B) NUMÉRICA — gera dados sintéticos no formato da FCR (positivos, zerados, NEGATIVOS, custo médio,
      códigos "001" e "1") e calcula os 8 indicadores em Python (a mesma semântica das fórmulas),
      imprimindo os totais que a aba Conferência mostrará para esses dados.

    python3 scripts/modelos/prova_modelo_estoque_ps.py

Sai 0 só se a verificação estrutural bater 100%. (LibreOffice não carrega xlsx neste sandbox; a
recalculação viva foi validada pelo Eng. Chefe na FCR: 436·9133·54·361·21·336925,07·555037,85·0.)
"""
import os
import sys
from openpyxl import load_workbook

HERE = os.path.dirname(os.path.abspath(__file__))
MODELO = os.path.abspath(os.path.join(HERE, "..", "..", "public", "modelos", "MODELO_migracao_estoque_PS.xlsx"))

A = "Estoque!$A$5:$A$5005"; D = "Estoque!$D$5:$D$5005"; E = "Estoque!$E$5:$E$5005"
CRIT = f'{A},"<>EXEMPLO-001",{A},"<>"'
B_ESPERADO = {
    5:  f"=COUNTIFS({CRIT})",
    6:  f"=SUMIFS({D},{CRIT})",
    7:  f'=COUNTIFS({D},">0",{CRIT})',
    8:  "=B5-B7-B9",
    9:  f'=COUNTIFS({D},"<0",{CRIT})',
    10: f"=SUMIFS({E},{CRIT})",
    11: f'=SUMPRODUCT(({A}<>"EXEMPLO-001")*({A}<>""),{D},{E})',
    12: f'=SUMPRODUCT(({A}<>"")*(COUNTIF({A},{A})>1))',
}
D_ESPERADO = {r: f'=IF(C{r}="","—",IF(ABS(B{r}-C{r})<0.005,"OK","DIFERENTE"))' for r in range(5, 12)}
D_ESPERADO[12] = '=IF(B12=0,"OK","CORRIGIR: há códigos repetidos")'


def verificar_estrutura():
    wb = load_workbook(MODELO)
    assert wb.sheetnames[0] == "Estoque", f"1ª aba deve ser Estoque, veio {wb.sheetnames}"
    for nome in ("Estoque", "Conferência", "Instruções", "Listas"):
        assert nome in wb.sheetnames, f"aba faltando: {nome}"
    est = wb["Estoque"]
    chaves = [est.cell(row=4, column=c).value for c in range(1, 18)]
    esperado_chaves = ["codigo","nome","unidade","estoque_atual","custo_medio","preco_venda","ncm",
                       "codigo_barras","codigo_original","fornecedor_padrao_nome","categoria","marca",
                       "estoque_minimo","localizacao","tipo_item_sped","origem","cest"]
    assert chaves == esperado_chaves, f"chaves técnicas (linha 4) divergem:\n  got={chaves}\n  exp={esperado_chaves}"
    conf = wb["Conferência"]
    falhas = []
    for r, exp in B_ESPERADO.items():
        got = conf.cell(row=r, column=2).value
        if got != exp:
            falhas.append(f"  B{r}\n    got={got}\n    exp={exp}")
    for r, exp in D_ESPERADO.items():
        got = conf.cell(row=r, column=4).value
        if got != exp:
            falhas.append(f"  D{r}\n    got={got}\n    exp={exp}")
    if conf.cell(row=12, column=3).value != "—":
        falhas.append("  C12 deveria ser '—'")
    return chaves, falhas


# ── (B) dados sintéticos no formato da FCR e os 8 indicadores ────────────────────────────────────
def gerar_dados():
    dados = []; especiais = ["001", "1"]
    def add(cod, qtd, custo):
        dados.append({"codigo": cod, "estoque_atual": qtd, "custo_medio": custo})
    for i in range(361):
        cod = especiais[i] if i < len(especiais) else f"SKU-{i:04d}"
        add(cod, (i % 37) + 1, round(1.00 + (i % 50) * 0.37, 2))
    for i in range(54):
        add(f"ZER-{i:04d}", 0, round(2.00 + (i % 10) * 0.5, 2))
    for i in range(21):
        add(f"NEG-{i:04d}", -((i % 5) + 1), round(3.00 + (i % 7) * 0.25, 2))
    return dados


def indicadores(dados):
    qs = [d["estoque_atual"] for d in dados]; cs = [d["custo_medio"] for d in dados]
    itens = len(dados)
    positivos = sum(1 for q in qs if q > 0); negativos = sum(1 for q in qs if q < 0)
    return {
        "itens": itens,
        "soma_qtd": round(sum(qs), 3),
        "positivos": positivos,
        "zerados": itens - positivos - negativos,
        "negativos": negativos,
        "soma_custo": round(sum(cs), 2),
        "valor_liquido": round(sum(d["estoque_atual"] * d["custo_medio"] for d in dados), 2),
        "repetidos": (0 if itens == len(set(d["codigo"] for d in dados)) else 1),
    }


def main():
    if not os.path.exists(MODELO):
        print("modelo não existe; rode gerar_modelo_estoque_ps.py antes", file=sys.stderr); sys.exit(2)
    chaves, falhas = verificar_estrutura()
    print("(A) ESTRUTURAL — chaves técnicas (linha 4):", ",".join(chaves))
    if falhas:
        print("FÓRMULAS DA CONFERÊNCIA DIVERGEM DA SPEC:\n" + "\n".join(falhas), file=sys.stderr); sys.exit(1)
    print("(A) ESTRUTURAL OK — as 8 fórmulas B5:B12, as situações D5:D12 e C12 batem com a spec.\n")

    dados = gerar_dados(); ind = indicadores(dados)
    print("(B) NUMÉRICA — dados sintéticos formato FCR (436 itens: 361 positivos, 54 zerados, 21 negativos;")
    print("    inclui códigos '001' e '1'). Totais que a aba Conferência mostrará para esses dados:")
    for k, v in ind.items():
        print(f"    {k:14s} = {v}")
    print("\nPROVA OK.")


if __name__ == "__main__":
    main()
