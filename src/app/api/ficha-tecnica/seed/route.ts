import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';

const supabaseUrl = 'https://horsymhsinqcimflrtjo.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvcnN5bWhzaW5xY2ltZmxydGpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyODE0MjYsImV4cCI6MjA5MDg1NzQyNn0.s2GbtX69F0HtH_uhbBt3cnV8opXPJEdDQlolkhir1Mo';

// ══════════════════════════════════════════════════════════
// CATÁLOGO BASE DE MATERIAIS — 35 ITENS
// ══════════════════════════════════════════════════════════
const MATERIAIS = [
  {cod:"PL-ST-1250",nome:"Placa Standard (ST) 1200x2400x12,5mm",un:"un",preco:28.50,grupo:"Placas"},
  {cod:"PL-ST-0950",nome:"Placa Standard (ST) 1200x2400x9,5mm",un:"un",preco:24.80,grupo:"Placas"},
  {cod:"PL-RU-1250",nome:"Placa Resistente Umidade (RU) 1200x2400x12,5mm",un:"un",preco:38.90,grupo:"Placas"},
  {cod:"PL-RF-1250",nome:"Placa Resistente Fogo (RF) 1200x2400x12,5mm",un:"un",preco:42.50,grupo:"Placas"},
  {cod:"PL-RF-1550",nome:"Placa Resistente Fogo (RF) 1200x2400x15mm",un:"un",preco:55.00,grupo:"Placas"},
  {cod:"PL-CIM-1000",nome:"Placa Cimentícia 1200x2400x10mm",un:"un",preco:62.00,grupo:"Placas"},
  {cod:"PL-MOD-625",nome:"Placa Mineral Modular 625x625x14mm",un:"un",preco:14.80,grupo:"Placas"},
  {cod:"PL-MOD-625A",nome:"Placa Mineral Acústica 625x625x15mm",un:"un",preco:22.50,grupo:"Placas"},
  {cod:"MO-48",nome:"Montante 48x3000mm #0.50",un:"m",preco:4.20,grupo:"Perfis"},
  {cod:"MO-70",nome:"Montante 70x3000mm #0.50",un:"m",preco:5.10,grupo:"Perfis"},
  {cod:"MO-90",nome:"Montante 90x3000mm #0.50",un:"m",preco:6.30,grupo:"Perfis"},
  {cod:"GU-48",nome:"Guia 48x3000mm #0.50",un:"m",preco:3.90,grupo:"Perfis"},
  {cod:"GU-70",nome:"Guia 70x3000mm #0.50",un:"m",preco:4.50,grupo:"Perfis"},
  {cod:"GU-90",nome:"Guia 90x3000mm #0.50",un:"m",preco:5.40,grupo:"Perfis"},
  {cod:"CN-F530",nome:"Canaleta F530 (forro primário/secundário)",un:"m",preco:6.20,grupo:"Perfis"},
  {cod:"TP-24P",nome:"Perfil T Principal 24mm x 3660mm",un:"m",preco:7.50,grupo:"Perfis"},
  {cod:"TP-24S",nome:"Perfil T Secundário 24mm x 1250mm",un:"m",preco:4.20,grupo:"Perfis"},
  {cod:"TP-24T",nome:"Perfil T Terciário 24mm x 625mm",un:"m",preco:2.80,grupo:"Perfis"},
  {cod:"CT-2419",nome:"Cantoneira de Parede 24x19mm x 3000mm",un:"m",preco:3.20,grupo:"Perfis"},
  {cod:"PA-TA-2525",nome:"Parafuso TA 3,5x25mm (placa-perfil)",un:"un",preco:0.04,grupo:"Fixação"},
  {cod:"PA-TA-3535",nome:"Parafuso TA 3,5x35mm (2ª placa)",un:"un",preco:0.05,grupo:"Fixação"},
  {cod:"PA-TA-4545",nome:"Parafuso TA 3,5x45mm (3ª placa)",un:"un",preco:0.06,grupo:"Fixação"},
  {cod:"PA-PA-1342",nome:"Parafuso PA 4,2x13mm (perfil-perfil)",un:"un",preco:0.05,grupo:"Fixação"},
  {cod:"BU-S6",nome:"Bucha S6 + parafuso sextavado",un:"un",preco:0.45,grupo:"Fixação"},
  {cod:"PR-ACO",nome:"Prego de aço p/ concreto 27mm",un:"un",preco:0.60,grupo:"Fixação"},
  {cod:"FI-PAP-50",nome:"Fita de Papel Microperfurada 50mm x 150m",un:"m",preco:0.28,grupo:"Acabamento"},
  {cod:"FI-TEL-50",nome:"Fita Telada Adesiva 50mm x 90m",un:"m",preco:0.45,grupo:"Acabamento"},
  {cod:"MA-JUN-PO",nome:"Massa para Juntas (pó) — saco 5kg",un:"kg",preco:4.80,grupo:"Acabamento"},
  {cod:"MA-JUN-PA",nome:"Massa para Juntas Pronta — balde 15kg",un:"kg",preco:6.20,grupo:"Acabamento"},
  {cod:"BA-50",nome:"Banda Acústica Adesiva 50mm x 30m",un:"m",preco:1.20,grupo:"Isolamento"},
  {cod:"BA-70",nome:"Banda Acústica Adesiva 70mm x 30m",un:"m",preco:1.40,grupo:"Isolamento"},
  {cod:"LA-VID-50",nome:"Lã de Vidro 50mm — rolo 12m²",un:"m²",preco:12.50,grupo:"Isolamento"},
  {cod:"LA-ROC-50",nome:"Lã de Rocha 50mm — painel 1,20x0,60m",un:"m²",preco:18.90,grupo:"Isolamento"},
  {cod:"PE-REG",nome:"Pendural Regulável c/ tirante 500mm",un:"un",preco:3.50,grupo:"Suspensão"},
  {cod:"AR-G18",nome:"Arame Galvanizado #18",un:"m",preco:0.30,grupo:"Suspensão"},
  {cod:"RB-4012",nome:"Rebite Pop 4,0x12mm",un:"un",preco:0.08,grupo:"Fixação"},
  {cod:"SI-ACET",nome:"Silicone Acético — tubo 280ml",un:"m",preco:2.80,grupo:"Acabamento"},
  {cod:"PR-SEL",nome:"Primer Selador p/ gesso",un:"L",preco:8.50,grupo:"Acabamento"},
];

// ══════════════════════════════════════════════════════════
// 50 FICHAS TÉCNICAS — TIPOLOGIAS COMPLETAS
// ══════════════════════════════════════════════════════════
const FICHAS: {cod:string;nome:string;cat:string;mo:number;ind:number;imp:number;mk:number;itens:{cod:string;qtd:number}[]}[] = [
  // ───── PAREDES DRYWALL ─────
  {cod:"FT-PAR-001",nome:"Parede Simples ST 73mm (1xST+M48)",cat:"parede",mo:35,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-1250",qtd:2.10},{cod:"MO-48",qtd:2.80},{cod:"GU-48",qtd:0.80},{cod:"PA-TA-2525",qtd:24},{cod:"PA-PA-1342",qtd:4},{cod:"FI-PAP-50",qtd:2.50},{cod:"MA-JUN-PO",qtd:0.50},{cod:"BA-50",qtd:0.80},{cod:"BU-S6",qtd:1.60}]},
  {cod:"FT-PAR-002",nome:"Parede Simples ST 95mm (1xST+M70)",cat:"parede",mo:36,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-1250",qtd:2.10},{cod:"MO-70",qtd:2.80},{cod:"GU-70",qtd:0.80},{cod:"PA-TA-2525",qtd:24},{cod:"PA-PA-1342",qtd:4},{cod:"FI-PAP-50",qtd:2.50},{cod:"MA-JUN-PO",qtd:0.50},{cod:"BA-70",qtd:0.80},{cod:"BU-S6",qtd:1.60}]},
  {cod:"FT-PAR-003",nome:"Parede Simples ST 115mm (1xST+M90)",cat:"parede",mo:38,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-1250",qtd:2.10},{cod:"MO-90",qtd:2.80},{cod:"GU-90",qtd:0.80},{cod:"PA-TA-2525",qtd:24},{cod:"PA-PA-1342",qtd:4},{cod:"FI-PAP-50",qtd:2.50},{cod:"MA-JUN-PO",qtd:0.50},{cod:"BA-70",qtd:0.80},{cod:"BU-S6",qtd:1.60}]},
  {cod:"FT-PAR-004",nome:"Parede Dupla ST 98mm (2xST+M48)",cat:"parede",mo:48,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-1250",qtd:4.20},{cod:"MO-48",qtd:2.80},{cod:"GU-48",qtd:0.80},{cod:"PA-TA-2525",qtd:24},{cod:"PA-TA-3535",qtd:24},{cod:"PA-PA-1342",qtd:4},{cod:"FI-PAP-50",qtd:5.00},{cod:"MA-JUN-PO",qtd:0.80},{cod:"BA-50",qtd:0.80},{cod:"BU-S6",qtd:1.60}]},
  {cod:"FT-PAR-005",nome:"Parede Dupla ST 120mm (2xST+M70)",cat:"parede",mo:50,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-1250",qtd:4.20},{cod:"MO-70",qtd:2.80},{cod:"GU-70",qtd:0.80},{cod:"PA-TA-2525",qtd:24},{cod:"PA-TA-3535",qtd:24},{cod:"PA-PA-1342",qtd:4},{cod:"FI-PAP-50",qtd:5.00},{cod:"MA-JUN-PO",qtd:0.80},{cod:"BA-70",qtd:0.80},{cod:"BU-S6",qtd:1.60}]},
  {cod:"FT-PAR-006",nome:"Parede Dupla ST+Lã 98mm (2xST+M48+Lã50)",cat:"parede",mo:52,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-1250",qtd:4.20},{cod:"MO-48",qtd:2.80},{cod:"GU-48",qtd:0.80},{cod:"PA-TA-2525",qtd:24},{cod:"PA-TA-3535",qtd:24},{cod:"PA-PA-1342",qtd:4},{cod:"FI-PAP-50",qtd:5.00},{cod:"MA-JUN-PO",qtd:0.80},{cod:"LA-VID-50",qtd:1.05},{cod:"BA-50",qtd:0.80},{cod:"BU-S6",qtd:1.60}]},
  {cod:"FT-PAR-007",nome:"Parede Dupla ST+Lã Rocha 120mm (2xST+M70+LR50)",cat:"parede",mo:55,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-1250",qtd:4.20},{cod:"MO-70",qtd:2.80},{cod:"GU-70",qtd:0.80},{cod:"PA-TA-2525",qtd:24},{cod:"PA-TA-3535",qtd:24},{cod:"PA-PA-1342",qtd:4},{cod:"FI-PAP-50",qtd:5.00},{cod:"MA-JUN-PO",qtd:0.80},{cod:"LA-ROC-50",qtd:1.05},{cod:"BA-70",qtd:0.80},{cod:"BU-S6",qtd:1.60}]},
  {cod:"FT-PAR-008",nome:"Parede Área Úmida RU 73mm (1xRU+M48)",cat:"parede",mo:38,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-RU-1250",qtd:2.10},{cod:"MO-48",qtd:2.80},{cod:"GU-48",qtd:0.80},{cod:"PA-TA-2525",qtd:24},{cod:"PA-PA-1342",qtd:4},{cod:"FI-PAP-50",qtd:2.50},{cod:"MA-JUN-PO",qtd:0.50},{cod:"BA-50",qtd:0.80},{cod:"BU-S6",qtd:1.60},{cod:"SI-ACET",qtd:0.50}]},
  {cod:"FT-PAR-009",nome:"Parede Área Úmida RU Dupla 98mm (2xRU+M48)",cat:"parede",mo:52,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-RU-1250",qtd:4.20},{cod:"MO-48",qtd:2.80},{cod:"GU-48",qtd:0.80},{cod:"PA-TA-2525",qtd:24},{cod:"PA-TA-3535",qtd:24},{cod:"PA-PA-1342",qtd:4},{cod:"FI-PAP-50",qtd:5.00},{cod:"MA-JUN-PO",qtd:0.80},{cod:"BA-50",qtd:0.80},{cod:"BU-S6",qtd:1.60},{cod:"SI-ACET",qtd:0.50}]},
  {cod:"FT-PAR-010",nome:"Parede Corta-Fogo RF 73mm (1xRF12,5+M48)",cat:"parede",mo:40,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-RF-1250",qtd:2.10},{cod:"MO-48",qtd:2.80},{cod:"GU-48",qtd:0.80},{cod:"PA-TA-2525",qtd:24},{cod:"PA-PA-1342",qtd:4},{cod:"FI-PAP-50",qtd:2.50},{cod:"MA-JUN-PO",qtd:0.50},{cod:"BA-50",qtd:0.80},{cod:"BU-S6",qtd:1.60}]},
  {cod:"FT-PAR-011",nome:"Parede Corta-Fogo RF Dupla 98mm (2xRF12,5+M48)",cat:"parede",mo:56,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-RF-1250",qtd:4.20},{cod:"MO-48",qtd:2.80},{cod:"GU-48",qtd:0.80},{cod:"PA-TA-2525",qtd:24},{cod:"PA-TA-3535",qtd:24},{cod:"PA-PA-1342",qtd:4},{cod:"FI-PAP-50",qtd:5.00},{cod:"MA-JUN-PO",qtd:0.80},{cod:"LA-ROC-50",qtd:1.05},{cod:"BA-50",qtd:0.80},{cod:"BU-S6",qtd:1.60}]},
  {cod:"FT-PAR-012",nome:"Parede Corta-Fogo RF 15mm Dupla (2xRF15+M48+LR)",cat:"parede",mo:60,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-RF-1550",qtd:4.20},{cod:"MO-48",qtd:2.80},{cod:"GU-48",qtd:0.80},{cod:"PA-TA-2525",qtd:24},{cod:"PA-TA-4545",qtd:24},{cod:"PA-PA-1342",qtd:4},{cod:"FI-PAP-50",qtd:5.00},{cod:"MA-JUN-PO",qtd:0.80},{cod:"LA-ROC-50",qtd:1.05},{cod:"BA-50",qtd:0.80},{cod:"BU-S6",qtd:1.60}]},
  {cod:"FT-PAR-013",nome:"Parede Shaft 73mm (1xST+M48 — acesso)",cat:"parede",mo:42,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-1250",qtd:1.05},{cod:"MO-48",qtd:2.80},{cod:"GU-48",qtd:0.80},{cod:"PA-TA-2525",qtd:12},{cod:"PA-PA-1342",qtd:4},{cod:"FI-PAP-50",qtd:1.20},{cod:"MA-JUN-PO",qtd:0.30},{cod:"BA-50",qtd:0.80},{cod:"BU-S6",qtd:1.60}]},
  {cod:"FT-PAR-014",nome:"Parede Shaft Dupla 98mm (2xST+M48+Lã)",cat:"parede",mo:55,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-1250",qtd:2.10},{cod:"MO-48",qtd:2.80},{cod:"GU-48",qtd:0.80},{cod:"PA-TA-2525",qtd:24},{cod:"PA-PA-1342",qtd:4},{cod:"FI-PAP-50",qtd:2.50},{cod:"MA-JUN-PO",qtd:0.50},{cod:"LA-VID-50",qtd:1.05},{cod:"BA-50",qtd:0.80},{cod:"BU-S6",qtd:1.60}]},
  {cod:"FT-PAR-015",nome:"Parede ST 9,5mm Simples (econômica)",cat:"parede",mo:32,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-0950",qtd:2.10},{cod:"MO-48",qtd:2.80},{cod:"GU-48",qtd:0.80},{cod:"PA-TA-2525",qtd:20},{cod:"PA-PA-1342",qtd:4},{cod:"FI-PAP-50",qtd:2.50},{cod:"MA-JUN-PO",qtd:0.50},{cod:"BA-50",qtd:0.80},{cod:"BU-S6",qtd:1.60}]},
  // Revestimento sobre alvenaria
  {cod:"FT-PAR-016",nome:"Revestimento ST s/ alvenaria (1 lado colado)",cat:"revestimento",mo:22,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-1250",qtd:1.05},{cod:"MA-JUN-PA",qtd:1.50},{cod:"FI-PAP-50",qtd:1.20},{cod:"MA-JUN-PO",qtd:0.30}]},
  {cod:"FT-PAR-017",nome:"Revestimento RU s/ alvenaria (área úmida colado)",cat:"revestimento",mo:24,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-RU-1250",qtd:1.05},{cod:"MA-JUN-PA",qtd:1.50},{cod:"FI-PAP-50",qtd:1.20},{cod:"MA-JUN-PO",qtd:0.30},{cod:"SI-ACET",qtd:0.30}]},
  {cod:"FT-PAR-018",nome:"Revestimento ST s/ alvenaria (estruturado c/ perfil)",cat:"revestimento",mo:30,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-1250",qtd:1.05},{cod:"MO-48",qtd:2.80},{cod:"GU-48",qtd:0.80},{cod:"PA-TA-2525",qtd:12},{cod:"PA-PA-1342",qtd:4},{cod:"FI-PAP-50",qtd:1.20},{cod:"MA-JUN-PO",qtd:0.30},{cod:"BU-S6",qtd:1.60}]},
  {cod:"FT-PAR-019",nome:"Revestimento Cimentício Externo (fachada)",cat:"revestimento",mo:45,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-CIM-1000",qtd:1.05},{cod:"MO-48",qtd:2.80},{cod:"GU-48",qtd:0.80},{cod:"PA-TA-2525",qtd:16},{cod:"PA-PA-1342",qtd:4},{cod:"FI-TEL-50",qtd:2.50},{cod:"MA-JUN-PA",qtd:0.80},{cod:"BU-S6",qtd:2.00}]},
  {cod:"FT-PAR-020",nome:"Parede Acústica Premium (2xST+M70+2xLR+BA)",cat:"parede",mo:65,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-1250",qtd:4.20},{cod:"MO-70",qtd:2.80},{cod:"GU-70",qtd:0.80},{cod:"PA-TA-2525",qtd:24},{cod:"PA-TA-3535",qtd:24},{cod:"PA-PA-1342",qtd:6},{cod:"FI-PAP-50",qtd:5.00},{cod:"MA-JUN-PO",qtd:0.80},{cod:"LA-ROC-50",qtd:2.10},{cod:"BA-70",qtd:1.60},{cod:"BU-S6",qtd:1.60}]},
  // ───── FORROS ─────
  {cod:"FT-FOR-001",nome:"Forro Tabicado ST 12,5mm",cat:"forro",mo:30,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-1250",qtd:1.05},{cod:"CN-F530",qtd:4.33},{cod:"PE-REG",qtd:1.00},{cod:"AR-G18",qtd:1.50},{cod:"PA-TA-2525",qtd:12},{cod:"FI-PAP-50",qtd:2.00},{cod:"MA-JUN-PO",qtd:0.40},{cod:"PR-ACO",qtd:1.00}]},
  {cod:"FT-FOR-002",nome:"Forro Tabicado ST 9,5mm",cat:"forro",mo:28,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-0950",qtd:1.05},{cod:"CN-F530",qtd:4.33},{cod:"PE-REG",qtd:1.00},{cod:"AR-G18",qtd:1.50},{cod:"PA-TA-2525",qtd:10},{cod:"FI-PAP-50",qtd:2.00},{cod:"MA-JUN-PO",qtd:0.40},{cod:"PR-ACO",qtd:1.00}]},
  {cod:"FT-FOR-003",nome:"Forro Tabicado RU (área úmida)",cat:"forro",mo:32,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-RU-1250",qtd:1.05},{cod:"CN-F530",qtd:4.33},{cod:"PE-REG",qtd:1.00},{cod:"AR-G18",qtd:1.50},{cod:"PA-TA-2525",qtd:12},{cod:"FI-PAP-50",qtd:2.00},{cod:"MA-JUN-PO",qtd:0.40},{cod:"PR-ACO",qtd:1.00}]},
  {cod:"FT-FOR-004",nome:"Forro Tabicado RF (corta-fogo)",cat:"forro",mo:34,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-RF-1250",qtd:1.05},{cod:"CN-F530",qtd:4.33},{cod:"PE-REG",qtd:1.00},{cod:"AR-G18",qtd:1.50},{cod:"PA-TA-2525",qtd:12},{cod:"FI-PAP-50",qtd:2.00},{cod:"MA-JUN-PO",qtd:0.40},{cod:"PR-ACO",qtd:1.00}]},
  {cod:"FT-FOR-005",nome:"Forro Tabicado Duplo (2xST acústico)",cat:"forro",mo:42,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-1250",qtd:2.10},{cod:"CN-F530",qtd:4.33},{cod:"PE-REG",qtd:1.00},{cod:"AR-G18",qtd:1.50},{cod:"PA-TA-2525",qtd:12},{cod:"PA-TA-3535",qtd:12},{cod:"FI-PAP-50",qtd:4.00},{cod:"MA-JUN-PO",qtd:0.60},{cod:"LA-VID-50",qtd:1.05},{cod:"PR-ACO",qtd:1.00}]},
  {cod:"FT-FOR-006",nome:"Forro Tabicado c/ Lã de Vidro (térmico)",cat:"forro",mo:35,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-1250",qtd:1.05},{cod:"CN-F530",qtd:4.33},{cod:"PE-REG",qtd:1.00},{cod:"AR-G18",qtd:1.50},{cod:"PA-TA-2525",qtd:12},{cod:"FI-PAP-50",qtd:2.00},{cod:"MA-JUN-PO",qtd:0.40},{cod:"LA-VID-50",qtd:1.05},{cod:"PR-ACO",qtd:1.00}]},
  {cod:"FT-FOR-007",nome:"Forro Estruturado ST (perfil montante)",cat:"forro",mo:38,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-1250",qtd:1.05},{cod:"MO-48",qtd:2.50},{cod:"GU-48",qtd:0.80},{cod:"PE-REG",qtd:1.20},{cod:"AR-G18",qtd:1.80},{cod:"PA-TA-2525",qtd:12},{cod:"PA-PA-1342",qtd:4},{cod:"FI-PAP-50",qtd:2.00},{cod:"MA-JUN-PO",qtd:0.40},{cod:"PR-ACO",qtd:1.20}]},
  {cod:"FT-FOR-008",nome:"Forro Modular Mineral 625x625mm",cat:"forro",mo:22,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-MOD-625",qtd:2.56},{cod:"TP-24P",qtd:0.84},{cod:"TP-24S",qtd:1.68},{cod:"TP-24T",qtd:1.68},{cod:"CT-2419",qtd:0.40},{cod:"PE-REG",qtd:1.00},{cod:"AR-G18",qtd:1.50},{cod:"PR-ACO",qtd:1.00},{cod:"RB-4012",qtd:2}]},
  {cod:"FT-FOR-009",nome:"Forro Modular Acústico 625x625mm",cat:"forro",mo:24,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-MOD-625A",qtd:2.56},{cod:"TP-24P",qtd:0.84},{cod:"TP-24S",qtd:1.68},{cod:"TP-24T",qtd:1.68},{cod:"CT-2419",qtd:0.40},{cod:"PE-REG",qtd:1.00},{cod:"AR-G18",qtd:1.50},{cod:"PR-ACO",qtd:1.00},{cod:"RB-4012",qtd:2}]},
  {cod:"FT-FOR-010",nome:"Forro Modular c/ Lã (térmico-acústico)",cat:"forro",mo:28,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-MOD-625",qtd:2.56},{cod:"TP-24P",qtd:0.84},{cod:"TP-24S",qtd:1.68},{cod:"TP-24T",qtd:1.68},{cod:"CT-2419",qtd:0.40},{cod:"PE-REG",qtd:1.00},{cod:"AR-G18",qtd:1.50},{cod:"LA-VID-50",qtd:1.05},{cod:"PR-ACO",qtd:1.00},{cod:"RB-4012",qtd:2}]},
  // ───── ESPECIAIS ─────
  {cod:"FT-ESP-001",nome:"Sanca Aberta (tabeira) — metro linear",cat:"forro",mo:45,ind:15,imp:8.65,mk:35,itens:[
    {cod:"PL-ST-1250",qtd:0.80},{cod:"MO-48",qtd:1.50},{cod:"GU-48",qtd:0.60},{cod:"PA-TA-2525",qtd:10},{cod:"PA-PA-1342",qtd:3},{cod:"FI-PAP-50",qtd:2.00},{cod:"MA-JUN-PO",qtd:0.50},{cod:"PR-ACO",qtd:0.80}]},
  {cod:"FT-ESP-002",nome:"Sanca Fechada (iluminação indireta) — ml",cat:"forro",mo:55,ind:15,imp:8.65,mk:35,itens:[
    {cod:"PL-ST-1250",qtd:1.20},{cod:"MO-48",qtd:2.00},{cod:"GU-48",qtd:0.80},{cod:"PA-TA-2525",qtd:14},{cod:"PA-PA-1342",qtd:4},{cod:"FI-PAP-50",qtd:3.00},{cod:"MA-JUN-PO",qtd:0.60},{cod:"PR-ACO",qtd:1.00}]},
  {cod:"FT-ESP-003",nome:"Nicho em Drywall (por unidade)",cat:"outro",mo:60,ind:15,imp:8.65,mk:35,itens:[
    {cod:"PL-ST-1250",qtd:0.50},{cod:"MO-48",qtd:1.00},{cod:"GU-48",qtd:0.40},{cod:"PA-TA-2525",qtd:8},{cod:"FI-PAP-50",qtd:1.50},{cod:"MA-JUN-PO",qtd:0.40},{cod:"FI-TEL-50",qtd:0.60}]},
  {cod:"FT-ESP-004",nome:"Cortineiro em Drywall — metro linear",cat:"forro",mo:40,ind:15,imp:8.65,mk:35,itens:[
    {cod:"PL-ST-1250",qtd:0.60},{cod:"MO-48",qtd:1.20},{cod:"GU-48",qtd:0.40},{cod:"PA-TA-2525",qtd:8},{cod:"PA-PA-1342",qtd:2},{cod:"FI-PAP-50",qtd:1.50},{cod:"MA-JUN-PO",qtd:0.30}]},
  {cod:"FT-ESP-005",nome:"Rebaixo/Degrau em Forro — metro linear",cat:"forro",mo:50,ind:15,imp:8.65,mk:35,itens:[
    {cod:"PL-ST-1250",qtd:0.70},{cod:"MO-48",qtd:1.50},{cod:"GU-48",qtd:0.50},{cod:"CN-F530",qtd:1.00},{cod:"PA-TA-2525",qtd:10},{cod:"PA-PA-1342",qtd:3},{cod:"FI-PAP-50",qtd:2.50},{cod:"MA-JUN-PO",qtd:0.50},{cod:"PR-ACO",qtd:0.50}]},
  {cod:"FT-ESP-006",nome:"Fechamento de Shaft Vertical — m²",cat:"parede",mo:38,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-1250",qtd:1.05},{cod:"MO-48",qtd:3.00},{cod:"GU-48",qtd:1.00},{cod:"PA-TA-2525",qtd:14},{cod:"PA-PA-1342",qtd:4},{cod:"FI-PAP-50",qtd:1.50},{cod:"MA-JUN-PO",qtd:0.30},{cod:"BA-50",qtd:1.00},{cod:"BU-S6",qtd:2.00}]},
  {cod:"FT-ESP-007",nome:"Parede Curva (raio > 1m) — m²",cat:"parede",mo:75,ind:15,imp:8.65,mk:40,itens:[
    {cod:"PL-ST-0950",qtd:2.30},{cod:"MO-48",qtd:4.00},{cod:"GU-48",qtd:1.50},{cod:"PA-TA-2525",qtd:28},{cod:"PA-PA-1342",qtd:6},{cod:"FI-PAP-50",qtd:3.00},{cod:"MA-JUN-PO",qtd:0.60},{cod:"BA-50",qtd:1.00},{cod:"BU-S6",qtd:2.00}]},
  {cod:"FT-ESP-008",nome:"Divisória Sanitária (box WC) — por módulo",cat:"divisoria",mo:65,ind:15,imp:8.65,mk:35,itens:[
    {cod:"PL-RU-1250",qtd:3.00},{cod:"MO-48",qtd:4.00},{cod:"GU-48",qtd:1.50},{cod:"PA-TA-2525",qtd:30},{cod:"PA-PA-1342",qtd:6},{cod:"FI-PAP-50",qtd:4.00},{cod:"MA-JUN-PO",qtd:0.80},{cod:"SI-ACET",qtd:1.50},{cod:"BU-S6",qtd:3.00}]},
  // ───── COMPLEMENTARES ─────
  {cod:"FT-COM-001",nome:"Tratamento de Junta (só massa e fita) — m²",cat:"outro",mo:12,ind:15,imp:8.65,mk:30,itens:[
    {cod:"FI-PAP-50",qtd:2.50},{cod:"MA-JUN-PO",qtd:0.50}]},
  {cod:"FT-COM-002",nome:"Aplicação de Primer Selador — m²",cat:"outro",mo:5,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PR-SEL",qtd:0.15}]},
  {cod:"FT-COM-003",nome:"Reforço p/ TV/Ar-Cond (chapa OSB) — por ponto",cat:"outro",mo:25,ind:15,imp:8.65,mk:30,itens:[
    {cod:"MO-48",qtd:0.80},{cod:"PA-PA-1342",qtd:4},{cod:"PA-TA-2525",qtd:6}]},
  {cod:"FT-COM-004",nome:"Abertura/Reforço p/ Porta — por vão",cat:"outro",mo:30,ind:15,imp:8.65,mk:30,itens:[
    {cod:"MO-48",qtd:3.00},{cod:"GU-48",qtd:2.00},{cod:"PA-PA-1342",qtd:8},{cod:"PA-TA-2525",qtd:8}]},
  {cod:"FT-COM-005",nome:"Instalação de Tabeira Simples — ml",cat:"forro",mo:18,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-1250",qtd:0.30},{cod:"GU-48",qtd:0.40},{cod:"PA-TA-2525",qtd:4},{cod:"FI-PAP-50",qtd:0.80},{cod:"MA-JUN-PO",qtd:0.20}]},
  // ───── PAREDES ADICIONAIS ─────
  {cod:"FT-PAR-021",nome:"Parede Tripla ST 123mm (3xST+M48)",cat:"parede",mo:65,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-1250",qtd:6.30},{cod:"MO-48",qtd:2.80},{cod:"GU-48",qtd:0.80},{cod:"PA-TA-2525",qtd:24},{cod:"PA-TA-3535",qtd:24},{cod:"PA-TA-4545",qtd:24},{cod:"PA-PA-1342",qtd:4},{cod:"FI-PAP-50",qtd:7.50},{cod:"MA-JUN-PO",qtd:1.20},{cod:"BA-50",qtd:0.80},{cod:"BU-S6",qtd:1.60}]},
  {cod:"FT-PAR-022",nome:"Parede Mista ST+RU (banheiro 1 lado úmido)",cat:"parede",mo:45,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-1250",qtd:1.05},{cod:"PL-RU-1250",qtd:1.05},{cod:"MO-48",qtd:2.80},{cod:"GU-48",qtd:0.80},{cod:"PA-TA-2525",qtd:24},{cod:"PA-PA-1342",qtd:4},{cod:"FI-PAP-50",qtd:2.50},{cod:"MA-JUN-PO",qtd:0.50},{cod:"BA-50",qtd:0.80},{cod:"BU-S6",qtd:1.60},{cod:"SI-ACET",qtd:0.30}]},
  {cod:"FT-PAR-023",nome:"Parede Blindada RF+LR (escape/escada)",cat:"parede",mo:70,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-RF-1550",qtd:4.20},{cod:"MO-70",qtd:2.80},{cod:"GU-70",qtd:0.80},{cod:"PA-TA-2525",qtd:24},{cod:"PA-TA-4545",qtd:24},{cod:"PA-PA-1342",qtd:6},{cod:"FI-PAP-50",qtd:5.00},{cod:"MA-JUN-PO",qtd:0.80},{cod:"LA-ROC-50",qtd:2.10},{cod:"BA-70",qtd:1.60},{cod:"BU-S6",qtd:2.00}]},
  // More forros
  {cod:"FT-FOR-011",nome:"Forro Tabicado Decorativo (junta seca)",cat:"forro",mo:35,ind:15,imp:8.65,mk:35,itens:[
    {cod:"PL-ST-1250",qtd:1.05},{cod:"CN-F530",qtd:4.33},{cod:"PE-REG",qtd:1.00},{cod:"AR-G18",qtd:1.50},{cod:"PA-TA-2525",qtd:12},{cod:"PR-ACO",qtd:1.00}]},
  {cod:"FT-FOR-012",nome:"Forro Tabicado Embutido (entre vigas)",cat:"forro",mo:40,ind:15,imp:8.65,mk:30,itens:[
    {cod:"PL-ST-1250",qtd:1.05},{cod:"CN-F530",qtd:4.33},{cod:"PE-REG",qtd:1.50},{cod:"AR-G18",qtd:2.00},{cod:"PA-TA-2525",qtd:12},{cod:"FI-PAP-50",qtd:2.50},{cod:"MA-JUN-PO",qtd:0.40},{cod:"CT-2419",qtd:0.80},{cod:"PR-ACO",qtd:1.50}]},
];

export async function POST(req: NextRequest) {
  try {
    const { company_id } = await req.json();
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Build material lookup
    const matMap: Record<string, typeof MATERIAIS[0]> = {};
    for (const m of MATERIAIS) matMap[m.cod] = m;

    let fichaCount = 0;
    let itemCount = 0;

    for (const ft of FICHAS) {
      // Check if already exists
      const { data: existing } = await supabase.from("fichas_tecnicas")
        .select("id").eq("company_id", company_id).eq("nome", ft.nome).limit(1);
      if (existing && existing.length > 0) continue;

      const { data: ficha } = await supabase.from("fichas_tecnicas").insert({
        company_id, nome: ft.nome, codigo: ft.cod, categoria: ft.cat, unidade: "m²",
        mao_obra_direta: ft.mo, custos_indiretos_pct: ft.ind,
        impostos_pct: ft.imp, markup_pct: ft.mk,
      }).select().single();

      if (ficha) {
        fichaCount++;
        for (let i = 0; i < ft.itens.length; i++) {
          const it = ft.itens[i];
          const mat = matMap[it.cod];
          if (!mat) continue;
          await supabase.from("ficha_itens").insert({
            ficha_id: ficha.id, ordem: i + 1,
            codigo: it.cod, nome: mat.nome, unidade: mat.un,
            quantidade: it.qtd, preco_unitario: mat.preco,
            fornecedor: mat.grupo,
          });
          itemCount++;
        }
      }
    }

    return NextResponse.json({ success: true, fichas_criadas: fichaCount, itens_criados: itemCount, total_fichas: FICHAS.length, total_materiais: MATERIAIS.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
