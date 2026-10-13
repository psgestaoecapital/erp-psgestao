#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gerador da PLANILHA PADRÃO PS · MIGRAÇÃO DE ESTOQUE (contextos 9c43a93d / cf980ce1).
Fonte única do layout: qualquer mudança no modelo é mudança AQUI. Roda com openpyxl e
grava public/modelos/MODELO_migracao_estoque_PS.xlsx.

    python3 scripts/modelos/gerar_modelo_estoque_ps.py

Abas: Estoque (dados), Conferência (totais que batem com a importação), Instruções, Listas.
As chaves técnicas (linha 4 da aba Estoque) são o CONTRATO com o importador
(src/app/dashboard/.../estoque/importar): há teste que abre este xlsx e compara.
"""
import os
from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter

# ── Cores PS ──────────────────────────────────────────────────────────────────
ESPRESSO = "3D2314"   # título / cabeçalho opcional
DOURADO  = "C8941A"   # cabeçalho obrigatório
OFFWHITE = "FAF7F2"   # faixas de ajuda
AMARELO  = "FFF4CC"   # células a digitar (Conferência)
AZUL     = "0000FF"   # texto das células a digitar
CINZA    = "9C8E80"

FONT = "Arial"
DATA_INI, DATA_FIM = 5, 5005   # linha 5 (exemplo) até 5005

# chave | rótulo | obrigatória | número_fmt (None=texto/geral) | é_texto | descrição | no_sistema_antigo
COLS = [
    ("codigo", "Código", True, None, True,
     "Código único do produto (SKU).", "o código/SKU do produto no cadastro."),
    ("nome", "Descrição", True, None, False,
     "Descrição do produto.", "a descrição/nome do produto."),
    ("unidade", "Unidade", False, None, False,
     "Unidade de medida (UN, KG, CX...).", "a unidade de venda/estoque."),
    ("estoque_atual", "Quantidade em estoque", True, "#,##0.###;[Red]-#,##0.###;0", False,
     "Saldo atual. Pode ser NEGATIVO (o sistema aceita e marca).", "o saldo/quantidade em estoque hoje."),
    ("custo_medio", "Custo médio unitário (R$)", False, "#,##0.00", False,
     "Custo médio de reposição por unidade.", "o custo médio / preço de custo."),
    ("preco_venda", "Preço de venda (R$)", False, "#,##0.00", False,
     "Preço de venda por unidade.", "o preço de venda/tabela."),
    ("ncm", "NCM", False, None, True,
     "NCM (8 dígitos). Preserva zeros à esquerda.", "o NCM do produto (fiscal)."),
    ("codigo_barras", "Código de barras (GTIN/EAN)", False, None, True,
     "GTIN/EAN. Texto, preserva zeros.", "o código de barras (EAN/GTIN)."),
    ("codigo_original", "Código original / do fornecedor", False, None, True,
     "Código do fabricante/fornecedor (referência).", "o código original / de referência."),
    ("fornecedor_padrao_nome", "Fornecedor", False, None, False,
     "Nome do fornecedor padrão (texto; será casado ou criado).", "o fornecedor principal do item."),
    ("categoria", "Categoria / grupo", False, None, False,
     "Categoria/grupo do produto.", "o grupo/categoria/família."),
    ("marca", "Marca", False, None, False,
     "Marca/fabricante.", "a marca do produto."),
    ("estoque_minimo", "Estoque mínimo", False, "#,##0.###", False,
     "Ponto de reposição (opcional).", "o estoque mínimo, se houver."),
    ("localizacao", "Localização", False, None, False,
     "Prateleira/endereço no depósito.", "a localização física, se houver."),
    ("tipo_item_sped", "Tipo do item (SPED)", False, None, True,
     "Código SPED 00–10/99 (vazio = 00 · revenda). Ver aba Listas.", "o tipo do item p/ o SPED, se houver."),
    ("origem", "Origem da mercadoria", False, None, True,
     "Origem ICMS 0–8 (vazio = 0 · nacional). Ver aba Listas.", "a origem da mercadoria (fiscal), se houver."),
    ("cest", "CEST", False, None, True,
     "CEST (7 dígitos), quando aplicável. Texto.", "o CEST, se o produto tiver ST."),
]
NCOL = len(COLS)  # 17 (A..Q)

SPED = [
    ("00", "Mercadoria para revenda"), ("01", "Matéria-prima"), ("02", "Embalagem"),
    ("03", "Produto em processo"), ("04", "Produto acabado"), ("05", "Subproduto"),
    ("06", "Produto intermediário"), ("07", "Material de uso e consumo"),
    ("08", "Ativo imobilizado"), ("09", "Serviços"), ("10", "Outros insumos"),
    ("99", "Outras"),
]
ORIGEM = [
    ("0", "Nacional"), ("1", "Estrangeira · importação direta"),
    ("2", "Estrangeira · adquirida no mercado interno"),
    ("3", "Nacional · conteúdo de importação > 40%"),
    ("4", "Nacional · processos produtivos básicos"),
    ("5", "Nacional · conteúdo de importação <= 40%"),
    ("6", "Estrangeira · importação direta, sem similar nacional"),
    ("7", "Estrangeira · mercado interno, sem similar nacional"),
    ("8", "Nacional · conteúdo de importação > 70%"),
]
UNIDADES = ["UN", "PC", "CX", "KG", "G", "L", "ML", "M", "M2", "M3", "PAR", "DZ", "FD", "SC", "ROLO", "KIT"]

EXEMPLO = {
    "codigo": "EXEMPLO-001", "nome": "Produto de exemplo — APAGUE esta linha", "unidade": "UN",
    "estoque_atual": 10, "custo_medio": 12.50, "preco_venda": 24.90, "ncm": "84713012",
    "codigo_barras": "7891234567895", "codigo_original": "FORN-9988", "fornecedor_padrao_nome": "Fornecedor Exemplo Ltda",
    "categoria": "Geral", "marca": "Marca X", "estoque_minimo": 5, "localizacao": "A1-P3",
    "tipo_item_sped": "00", "origem": "0", "cest": "",
}


def _title_font(sz=13, color=ESPRESSO, bold=True, italic=False):
    return Font(name=FONT, size=sz, color=color, bold=bold, italic=italic)


def build():
    wb = Workbook()
    _aba_estoque(wb, wb.active)
    _aba_conferencia(wb.create_sheet("Conferência"))
    _aba_instrucoes(wb.create_sheet("Instruções"))
    _aba_listas(wb.create_sheet("Listas"))
    return wb


def _aba_estoque(wb, ws):
    ws.title = "Estoque"
    last = get_column_letter(NCOL)  # Q
    # linha 1 · título mesclado
    ws.merge_cells(f"A1:{last}1")
    c = ws["A1"]; c.value = "PLANILHA PADRÃO PS · MIGRAÇÃO DE ESTOQUE"
    c.font = _title_font(14, ESPRESSO); c.alignment = Alignment(horizontal="left", vertical="center")
    c.fill = PatternFill("solid", fgColor=OFFWHITE); ws.row_dimensions[1].height = 24
    # linha 2 · instrução mesclada
    ws.merge_cells(f"A2:{last}2")
    c = ws["A2"]
    c.value = ("Cole os dados A PARTIR DA LINHA 5 (apague a linha de EXEMPLO). Só Código, Descrição e "
               "Quantidade são obrigatórios (colunas douradas *). Não altere as linhas 3 e 4.")
    c.font = Font(name=FONT, size=10, color=ESPRESSO); c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
    c.fill = PatternFill("solid", fgColor=OFFWHITE); ws.row_dimensions[2].height = 28

    dourado_fill = PatternFill("solid", fgColor=DOURADO)
    espresso_fill = PatternFill("solid", fgColor=ESPRESSO)
    thin = Side(style="thin", color="D9CBB8"); border = Border(left=thin, right=thin, top=thin, bottom=thin)

    for i, (chave, rotulo, obrig, fmt, is_text, desc, antigo) in enumerate(COLS):
        col = get_column_letter(i + 1)
        # linha 3 · rótulo humano (obrigatório: " *" + dourado; opcional: espresso)
        h = ws[f"{col}3"]
        h.value = rotulo + (" *" if obrig else "")
        h.font = Font(name=FONT, size=10, bold=True, color=("3D2314" if obrig else "FFFFFF"))
        h.fill = dourado_fill if obrig else espresso_fill
        h.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        h.border = border
        h.comment = Comment(f"{desc}\nNo sistema antigo: {antigo}", "PS Gestão")
        # linha 4 · chave técnica (CONTRATO com o importador) — itálico cinza
        k = ws[f"{col}4"]
        k.value = chave
        k.font = Font(name=FONT, size=9, italic=True, color=CINZA)
        k.alignment = Alignment(horizontal="center")
        # linha 5 · exemplo (cinza itálico)
        e = ws[f"{col}5"]
        e.value = EXEMPLO[chave]
        e.font = Font(name=FONT, size=10, italic=True, color=CINZA)
        # formatos por coluna (aplica na faixa de dados)
        for r in range(DATA_INI, DATA_FIM + 1):
            cell = ws[f"{col}{r}"]
            if fmt:
                cell.number_format = fmt
            elif is_text:
                cell.number_format = "@"
        # largura
        ws.column_dimensions[col].width = max(12, min(30, len(rotulo) + 4))

    ws.row_dimensions[3].height = 30
    ws.freeze_panes = "C5"
    ws.auto_filter.ref = f"A4:{last}{DATA_FIM}"

    # validações
    lst_o = DataValidation(type="list", formula1="=Listas!$A$4:$A$15", allow_blank=True)
    lst_p = DataValidation(type="list", formula1="=Listas!$D$4:$D$12", allow_blank=True)
    dec_d = DataValidation(type="decimal", operator="between", formula1="-1000000000", formula2="1000000000", allow_blank=True)
    dec_m = DataValidation(type="decimal", operator="greaterThanOrEqual", formula1="0", allow_blank=True)
    dec_e = DataValidation(type="decimal", operator="greaterThanOrEqual", formula1="0", allow_blank=True,
                           error="Custo não pode ser negativo.", errorTitle="Valor inválido")
    dec_f = DataValidation(type="decimal", operator="greaterThanOrEqual", formula1="0", allow_blank=True,
                           error="Preço não pode ser negativo.", errorTitle="Valor inválido")
    for dv in (lst_o, lst_p, dec_d, dec_m, dec_e, dec_f):
        ws.add_data_validation(dv)
    colmap = {c[0]: get_column_letter(i + 1) for i, c in enumerate(COLS)}
    faixa = lambda col: f"{col}{DATA_INI}:{col}{DATA_FIM}"
    lst_o.add(faixa(colmap["tipo_item_sped"]))
    lst_p.add(faixa(colmap["origem"]))
    dec_d.add(faixa(colmap["estoque_atual"]))
    dec_m.add(faixa(colmap["estoque_minimo"]))
    dec_e.add(faixa(colmap["custo_medio"]))
    dec_f.add(faixa(colmap["preco_venda"]))


def _aba_conferencia(ws):
    A = "Estoque!$A$5:$A$5005"; D = "Estoque!$D$5:$D$5005"; E = "Estoque!$E$5:$E$5005"
    crit = f'{A},"<>EXEMPLO-001",{A},"<>"'
    ws.merge_cells("A1:D1")
    c = ws["A1"]; c.value = "CONFERÊNCIA — compare com o seu sistema antigo antes de importar"
    c.font = _title_font(12, ESPRESSO); c.fill = PatternFill("solid", fgColor=OFFWHITE)
    ws.merge_cells("A2:D2")
    c = ws["A2"]; c.value = ('Digite os números do sistema antigo na coluna amarela. "Situação" acusa OK ou DIFERENTE. '
                             'Estes 8 indicadores são exatamente os que a importação vai mostrar.')
    c.font = Font(name=FONT, size=10, color=ESPRESSO); c.alignment = Alignment(wrap_text=True, vertical="center")
    c.fill = PatternFill("solid", fgColor=OFFWHITE); ws.row_dimensions[2].height = 28

    hdr = ["Indicador", "Nesta planilha", "No sistema antigo (digite)", "Situação"]
    dfill = PatternFill("solid", fgColor=DOURADO)
    for j, t in enumerate(hdr):
        cell = ws.cell(row=4, column=j + 1, value=t)
        cell.font = Font(name=FONT, size=10, bold=True, color="3D2314")
        cell.fill = dfill
        cell.alignment = Alignment(horizontal="center", wrap_text=True)

    linhas = [
        ("Quantidade de itens", f"=COUNTIFS({crit})"),
        ("Soma das quantidades (líquida)", f"=SUMIFS({D},{crit})"),
        ("Itens com saldo positivo", f'=COUNTIFS({D},">0",{crit})'),
        ("Itens zerados ou vazios", "=B5-B7-B9"),
        ("Itens com saldo NEGATIVO", f'=COUNTIFS({D},"<0",{crit})'),
        ("Soma dos custos unitários", f"=SUMIFS({E},{crit})"),
        ("Valor do estoque líquido (qtd × custo)",
         f'=SUMPRODUCT(({A}<>"EXEMPLO-001")*({A}<>""),{D},{E})'),
        ("Códigos repetidos (precisa ser 0)",
         f'=SUMPRODUCT(({A}<>"")*(COUNTIF({A},{A})>1))'),
    ]
    money = {6, 10, 11}  # linhas com R$ (índice de linha planilha)
    amarelo = PatternFill("solid", fgColor=AMARELO)
    for k, (rot, formula) in enumerate(linhas):
        r = 5 + k
        ws.cell(row=r, column=1, value=rot).font = Font(name=FONT, size=10)
        b = ws.cell(row=r, column=2, value=formula); b.font = Font(name=FONT, size=10, bold=True)
        if r in money or r in (6,):
            b.number_format = "#,##0.00"
        # C = digitar (amarelo, azul), exceto a linha de repetidos (12) que é "—"
        cc = ws.cell(row=r, column=3)
        if r == 12:
            cc.value = "—"; cc.font = Font(name=FONT, size=10, color=CINZA); cc.alignment = Alignment(horizontal="center")
        else:
            cc.fill = amarelo; cc.font = Font(name=FONT, size=10, color=AZUL)
            if r in money:
                cc.number_format = "#,##0.00"
        # D = situação
        d = ws.cell(row=r, column=4)
        if r == 12:
            d.value = '=IF(B12=0,"OK","CORRIGIR: há códigos repetidos")'
        else:
            d.value = f'=IF(C{r}="","—",IF(ABS(B{r}-C{r})<0.005,"OK","DIFERENTE"))'
        d.font = Font(name=FONT, size=10, bold=True); d.alignment = Alignment(horizontal="center")
    for col, w in (("A", 38), ("B", 18), ("C", 24), ("D", 30)):
        ws.column_dimensions[col].width = w


def _aba_instrucoes(ws):
    ws.merge_cells("A1:E1")
    c = ws["A1"]; c.value = "COMO MIGRAR SEU ESTOQUE — 7 passos"
    c.font = _title_font(13, ESPRESSO); c.fill = PatternFill("solid", fgColor=OFFWHITE)
    passos = [
        "1) No sistema antigo, gere um relatório de POSIÇÃO DE ESTOQUE (código, descrição, quantidade, custo).",
        "2) Cole os dados na aba \"Estoque\" A PARTIR DA LINHA 5. Não mexa nas linhas 3 e 4.",
        "3) Apague a linha de EXEMPLO (EXEMPLO-001).",
        "4) Confira na aba \"Conferência\": digite os números do sistema antigo e veja se dá OK.",
        "5) No sistema, vá em Estoque › Importar planilha (ou Cadastros › Produtos › Importar) e envie o arquivo.",
        "6) Saldos NEGATIVOS são aceitos e marcados; CÓDIGOS REPETIDOS são recusados (corrija e reenvie).",
        "7) Reimportar o mesmo arquivo NÃO duplica: o sistema ajusta só a diferença de saldo.",
    ]
    r = 3
    for p in passos:
        cell = ws.cell(row=r, column=1, value=p); cell.font = Font(name=FONT, size=11)
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=5)
        cell.alignment = Alignment(wrap_text=True, vertical="center"); ws.row_dimensions[r].height = 22
        r += 1
    r += 1
    hdr = ["Coluna", "Obrigatória", "O que colocar", "Onde achar no sistema antigo", "Exemplo"]
    dfill = PatternFill("solid", fgColor=DOURADO)
    for j, t in enumerate(hdr):
        cell = ws.cell(row=r, column=j + 1, value=t)
        cell.font = Font(name=FONT, size=10, bold=True, color="3D2314"); cell.fill = dfill
        cell.alignment = Alignment(horizontal="center", wrap_text=True)
    r += 1
    for (chave, rotulo, obrig, fmt, is_text, desc, antigo) in COLS:
        ws.cell(row=r, column=1, value=rotulo).font = Font(name=FONT, size=10)
        ws.cell(row=r, column=2, value=("Sim" if obrig else "Não")).font = Font(name=FONT, size=10)
        ws.cell(row=r, column=3, value=desc).font = Font(name=FONT, size=10)
        ws.cell(row=r, column=4, value=antigo).font = Font(name=FONT, size=10)
        ws.cell(row=r, column=5, value=str(EXEMPLO[chave])).font = Font(name=FONT, size=10)
        r += 1
    for col, w in (("A", 26), ("B", 12), ("C", 44), ("D", 40), ("E", 22)):
        ws.column_dimensions[col].width = w


def _aba_listas(ws):
    ws["A3"] = "Tipo do item (SPED · Bloco 0200)"; ws["A3"].font = _title_font(11, ESPRESSO)
    ws["D3"] = "Origem da mercadoria (ICMS)"; ws["D3"].font = _title_font(11, ESPRESSO)
    ws["G3"] = "Unidades comuns"; ws["G3"].font = _title_font(11, ESPRESSO)
    for i, (cod, sig) in enumerate(SPED):        # A4:B15
        ws.cell(row=4 + i, column=1, value=cod).number_format = "@"
        ws.cell(row=4 + i, column=2, value=sig)
    for i, (cod, sig) in enumerate(ORIGEM):       # D4:E12
        ws.cell(row=4 + i, column=4, value=cod).number_format = "@"
        ws.cell(row=4 + i, column=5, value=sig)
    for i, u in enumerate(UNIDADES):              # G4:G19
        ws.cell(row=4 + i, column=7, value=u).number_format = "@"
    for col, w in (("A", 8), ("B", 34), ("D", 8), ("E", 44), ("G", 12)):
        ws.column_dimensions[col].width = w


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.abspath(os.path.join(here, "..", "..", "public", "modelos", "MODELO_migracao_estoque_PS.xlsx"))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    wb = build()
    wb.save(out)
    print("gravado:", out)


if __name__ == "__main__":
    main()
