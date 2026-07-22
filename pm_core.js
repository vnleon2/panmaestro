// ═══════════════════════════════════════════════════════════
// PM_CORE — PanMaestro v4 (single-file build)
// ═══════════════════════════════════════════════════════════



// ═══════════════════════════════════════════════════════════
// PM_CORE — Librería compartida PanMaestro v4
// Incluida idénticamente en todos los módulos
// ═══════════════════════════════════════════════════════════

const PM_VERSION = '4.0';
const PM_GIST_FILE = 'panmaestro_v4_data.json';
const PM_LOCAL_KEY = 'panmaestro_v4';
let _autoSync = true;
let _pushTimer = null;
let _toastTimer = null;

// Estado global compartido
let G = {};

// ── SEEDS (valores por defecto primera vez) ──────────────
const SEED = {
  version: PM_VERSION,
  tiposPan: [{"id": "P001", "nombre": "Pan Masa madre 1000g", "peso": 1000, "precio": 3000}, {"id": "P002", "nombre": "Golfeado", "peso": 120, "precio": 2000}, {"id": "P003", "nombre": "Pan japonés", "peso": 410, "precio": 1600}, {"id": "P004", "nombre": "Pan chino bandeja", "peso": 400, "precio": 1600}, {"id": "P005", "nombre": "Semi integral", "peso": 1000, "precio": 3000}, {"id": "P006", "nombre": "Roles de canela", "peso": 150, "precio": 2000}, {"id": "P007", "nombre": "Pan de molde masa madre 1.2 k", "peso": 1200, "precio": 3200}, {"id": "P008", "nombre": "Pan piñita", "peso": 280, "precio": 1000}, {"id": "P009", "nombre": "Pan de coco", "peso": 280, "precio": 1000}, {"id": "P010", "nombre": "Pan andino dulce barra", "peso": 450, "precio": 1500}, {"id": "P011", "nombre": "Pan andino bollo de 225g", "peso": 450, "precio": 1500}, {"id": "P012", "nombre": "Pan de semillas 1k", "peso": 1000, "precio": 3200}, {"id": "P013", "nombre": "Pan de masa madre 600g", "peso": 600, "precio": 1800}, {"id": "P014", "nombre": "Pan de semillas 600g", "peso": 600, "precio": 1700}, {"id": "P015", "nombre": "Pan italiano", "peso": 1000, "precio": 3000}, {"id": "P016", "nombre": "Pan en molde chino", "peso": 850, "precio": 2700}, {"id": "P017", "nombre": "Pan dulce 200g", "peso": 200, "precio": 700}, {"id": "P018", "nombre": "Pan mm rústico molde 750g", "peso": 750, "precio": 2300}, {"id": "P020", "nombre": "Pan de mm hogaza 850g", "peso": 800, "precio": 2400}, {"id": "P021", "nombre": "Combo 3 piñitas 1 cracker", "peso": 265, "precio": 1100}, {"id": "P022", "nombre": "Pan de mm con ajo 1 kilo", "peso": 1000, "precio": 3200}, {"id": "P023", "nombre": "Pan de semillas 800g", "peso": 800, "precio": 2600}, {"id": "P024", "nombre": "Piñitas de talvina 210g", "peso": 210, "precio": 900}, {"id": "P025", "nombre": "Baguette canilla mm 250g", "peso": 250, "precio": 550}],
  tiposGalleta: [{"id": "G001", "nombre": "Galleta mantequilla (unidad)", "peso": 10, "precio": 150}, {"id": "G002", "nombre": "Galleta monster chocochip (unidad)", "peso": 200, "precio": 1200}, {"id": "G003", "nombre": "Bolsa galletas mantequilla", "peso": 120, "precio": 2500}, {"id": "G004", "nombre": "Golfeado cuadrado", "peso": 100, "precio": 800}],
  ingredientes: {"Harina Panadera": {"price": 740, "qty": 1000}, "Harina Integral": {"price": 1800, "qty": 1000}, "Aove": {"price": 4400, "qty": 1000}, "Sal": {"price": 1200, "qty": 1000}, "Agua": {"price": 0, "qty": 1000}, "Harina De Centeno": {"price": 4250, "qty": 1000}, "Mm De Centeno 80": {"price": 2361, "qty": 1000}, "Mantequilla": {"price": 5384, "qty": 1000}, "Maicena": {"price": 990, "qty": 1000}, "Azúcar Glass": {"price": 3200, "qty": 2500}, "Azúcar Blanca": {"price": 1515, "qty": 2000}, "Polvo De Hornear": {"price": 730, "qty": 100}, "Vainilla": {"price": 1310, "qty": 120}, "Huevos": {"price": 1300, "qty": 1000}, "Harina Todo Uso": {"price": 950, "qty": 1000}, "Nutella": {"price": 6600, "qty": 1000}, "Azúcar Morena": {"price": 1850, "qty": 2000}, "Gotas De Chocolate": {"price": 8100, "qty": 1000}, "Nueces De Nogal": {"price": 8100, "qty": 1000}, "Horneo 15 Mi": {"price": 60, "qty": 1}, "Levadura": {"price": 610, "qty": 125}, "Panela En Polvo": {"price": 1100, "qty": 400}, "Margarina": {"price": 500, "qty": 1000}, "Queso": {"price": 6000, "qty": 1000}, "Mezcla Base Harina Fórmula": {"price": 0, "qty": 1000}, "Tapa De Dulce Solida": {"price": 960, "qty": 610}, "Canela En Polvo": {"price": 500, "qty": 25}, "Anis Dulce": {"price": 500, "qty": 25}, "Clavo": {"price": 700, "qty": 25}, "Semillas Variadss": {"price": 9000, "qty": 1000}, "Arándanos": {"price": 5000, "qty": 1000}, "Nueces": {"price": 8100, "qty": 1000}, "Miel": {"price": 3500, "qty": 1000}},
  recetas: [{"id": "1774675581501", "code": "R-0001", "name": "Pan tartine 70", "cat": "pan", "totalMass": 1000, "units": 1, "flour": [{"pct": 90, "productName": "Harina Panadera"}, {"pct": 10, "productName": "Harina Integral"}], "other": [{"pct": 20, "productName": "", "manualName": "Masa madre 80"}, {"pct": 70, "productName": "Agua"}, {"pct": 2, "productName": "Sal"}], "notes": ""}, {"id": "1774796724415", "code": "R-0002", "name": "Pan abuela", "cat": "pan", "totalMass": 1000, "units": 1, "flour": [{"pct": 90, "productName": "Harina Panadera"}, {"pct": 10, "productName": "Harina Integral"}], "other": [{"pct": 70, "productName": "Agua"}, {"pct": 2, "productName": "Sal"}, {"pct": 4, "productName": "Aove"}], "notes": ""}, {"id": "1774798108540", "code": "R-0003", "name": "Pan Semintegral", "cat": "pan", "totalMass": 1000, "units": 1, "flour": [{"pct": 50, "productName": "Harina Panadera"}, {"pct": 50, "productName": "Harina Integral"}], "other": [{"pct": 70, "productName": "Agua"}, {"pct": 2.1, "productName": "Sal"}, {"pct": 20, "manualName": "Mm integral 100"}], "notes": ""}, {"id": "1774799103494", "code": "R-0004", "name": "Mm centeno 80", "cat": "masa", "totalMass": 1000, "units": 1, "flour": [{"pct": 100, "productName": "Harina De Centeno"}], "other": [{"pct": 80, "productName": "Agua"}], "notes": ""}, {"id": "1774799594414", "code": "R-0005", "name": "Levain masa joven 1:5:4", "cat": "masa", "totalMass": 200, "units": 1, "flour": [{"pct": 100, "productName": "Harina Panadera"}], "other": [{"pct": 20, "productName": "Mm De Centeno 80"}, {"pct": 80, "productName": "Agua"}], "notes": ""}, {"id": "1775063553064", "code": "R-0006", "name": "Galletas de mantequilla", "cat": "galleta", "totalMass": 1200, "units": 120, "merma": 3, "flour": [{"pct": 100, "productName": "Harina Todo Uso"}], "other": [{"pct": 73.33, "productName": "Mantequilla"}, {"pct": 50, "productName": "Azúcar Glass"}, {"pct": 17.33, "productName": "Huevos"}, {"pct": 1, "productName": "Polvo De Hornear"}, {"pct": 3.33, "productName": "Maicena"}, {"pct": 1.66, "productName": "Vainilla"}], "notes": "Cremar mantequilla con azúcar glass, agregar huevo y vainilla, mezclar secos. Etiqueta 46₡ · Bolsa 85₡"}, {"id": "1775152021034", "code": "R-0007", "name": "Galleta monster chocochip", "cat": "galleta", "totalMass": 2458, "units": 12, "merma": 2, "flour": [{"pct": 100, "productName": "Harina Todo Uso"}], "other": [{"pct": 37.5, "productName": "Azúcar Blanca"}, {"pct": 30, "productName": "Azúcar Morena"}, {"pct": 25, "productName": "Huevos"}, {"pct": 62.5, "productName": "Mantequilla"}, {"pct": 1.33, "productName": "Polvo De Hornear"}, {"pct": 0.8, "productName": "Sal"}, {"pct": 33.33, "productName": "Nueces De Nogal"}, {"pct": 60, "productName": "Gotas De Chocolate"}, {"pct": 41.66, "manualName": "Nutella"}, {"pct": 0.8, "productName": "Vainilla"}], "notes": "Base de costo: Nutella como relleno"}, {"id": "1775349851553", "code": "R-0008", "name": "Golfeados cuadrados", "cat": "pan", "totalMass": 800, "units": 8, "merma": 2, "flour": [{"pct": 100, "productName": "Harina Panadera"}], "other": [{"pct": 50, "productName": "Agua"}, {"pct": 2, "productName": "Levadura"}, {"pct": 1, "productName": "Sal"}, {"pct": 20, "productName": "Azúcar Blanca"}, {"pct": 4, "productName": "Margarina"}, {"pct": 4, "productName": "Panela En Polvo"}, {"pct": 1, "productName": "Anis Dulce"}], "notes": "Melao 120g · Papelon 200g · Queso 232g\nHornear a 180°C"}, {"id": "1775351456083", "code": "R-0009", "name": "Melao de Papelón", "cat": "otro", "totalMass": 312, "units": 6, "merma": 1, "flour": [{"pct": 100, "productName": "Tapa De Dulce Solida"}], "other": [{"pct": 50, "productName": "Agua"}, {"pct": 5, "manualName": "especias"}], "notes": "Preparar un melao"}, {"id": "1775942608603", "code": "R-0010", "name": "Pan Pueblo relleno de semillas", "cat": "pan", "totalMass": 1000, "units": 1, "merma": 3, "flour": [{"pct": 90, "productName": "Harina Panadera"}, {"pct": 10, "productName": "Harina Integral"}], "other": [{"pct": 72, "manualName": "Agua"}, {"pct": 2, "manualName": "Sal"}, {"pct": 20, "manualName": "Levain 1:5:4"}], "notes": "HIDRATACIÓN 72% | Tiempo total: ~20–22h\n1. AUTÓLISIS: Mezclar harinas + 310g agua. Reposar 30–45 min.\n2. MEZCLA: Añadir levain, pellizcos 5 min. Sal + 50g agua. Amasar.\n3. FERMENTACIÓN EN BLOQUE: 4–5h a 24°C con 4 pliegues.\n4. FORMADO: Tensar en boule. Banneton enharinado.\n5. FERMENTACIÓN FRÍA: 12–18h a 4°C.\n6. HORNEADO: Cocotte 250°C. 20min tapado + 20–25min destapado."}, {"id": "rec-arandanos", "code": "R-0011", "name": "Pan de Arándanos", "cat": "pan", "totalMass": 999.5, "units": 1, "flour": [{"pct": 100, "manualName": "harina"}], "other": [{"pct": 70, "manualName": "Agua"}, {"pct": 25, "manualName": "Masa Madre"}, {"pct": 2, "manualName": "Sal"}, {"pct": 4, "manualName": "Miel"}, {"pct": 15, "manualName": "Arándanos"}, {"pct": 15, "manualName": "Nueces"}], "notes": "Hidratación 70% con masa madre 25%"}, {"id": "gm-001", "code": "GM-001", "name": "Pan molde integral semillas", "cat": "pan", "totalMass": 747.6, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina integral"}], "other": [{"pct": 80, "manualName": "Agua"}, {"pct": 1.4, "manualName": "Levadura"}, {"pct": 2, "manualName": "Sal"}, {"pct": 1.5, "manualName": "Azucar morena"}, {"pct": 2, "manualName": "Aove"}]}, {"id": "gm-002", "code": "GM-002", "name": "Receta 1 curso hamb pc deli", "cat": "pan", "totalMass": 1880, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina panadera"}], "other": [{"pct": 45, "manualName": "Agua"}, {"pct": 10, "manualName": "Huevos"}, {"pct": 8, "manualName": "Azucar"}, {"pct": 2, "manualName": "Sal"}, {"pct": 3.5, "manualName": "Vinagre de sidra"}, {"pct": 2.1, "manualName": "Levadura"}, {"pct": 6, "manualName": "Margarina"}, {"pct": 0.1, "manualName": "Topping de ajonjoli"}]}, {"id": "gm-003", "code": "GM-003", "name": "Pan salado curso san diego", "cat": "pan", "totalMass": 832, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 3, "manualName": "Azucar"}, {"pct": 2, "manualName": "Sal"}, {"pct": 1.4, "manualName": "Levadura"}, {"pct": 60, "manualName": "Agua"}]}, {"id": "gm-004", "code": "GM-004", "name": "Panificación dulce curso san diego", "cat": "pan", "totalMass": 3000, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 1.2, "manualName": "Sal"}, {"pct": 10, "manualName": "Azucar"}, {"pct": 38, "manualName": "Agua"}, {"pct": 10, "manualName": "Huevos"}, {"pct": 10, "manualName": "Margarina"}, {"pct": 1.6, "manualName": "Levadura"}]}, {"id": "gm-005", "code": "GM-005", "name": "Pan siciliano tipo pagniotta victor poolish mm", "cat": "masa", "totalMass": 2400, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 85, "manualName": "Harina"}, {"pct": 15, "manualName": "Harina integral"}], "other": [{"pct": 55, "manualName": "Polish"}, {"pct": 56, "manualName": "Agua"}, {"pct": 5, "manualName": "Masa madre 1:4:4"}, {"pct": 2, "manualName": "Aceite oliva"}, {"pct": 2, "manualName": "Sal"}, {"pct": 2, "manualName": "Azucar morena o miel"}]}, {"id": "gm-006", "code": "GM-006", "name": "Pan diario con polish", "cat": "masa", "totalMass": 1400.5, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 133, "manualName": "Polish"}, {"pct": 40, "manualName": "Agua"}, {"pct": 3.19, "manualName": "Sal"}, {"pct": 3, "manualName": "Azucar"}]}, {"id": "gm-007", "code": "GM-007", "name": "Pan alta hidratacion", "cat": "pan", "totalMass": 1450, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina blanca"}, {"pct": 10, "manualName": "Harina integral"}], "other": [{"pct": 80, "manualName": "Agua"}, {"pct": 20, "manualName": "Masa madre"}, {"pct": 2, "manualName": "Sal"}]}, {"id": "gm-008", "code": "GM-008", "name": "Pan lactal japones", "cat": "pan", "totalMass": 896.1, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 93.5, "manualName": "Harina"}], "other": [{"pct": 38.65, "manualName": "TangZong"}, {"pct": 35, "manualName": "Leche liquida"}, {"pct": 11.66, "manualName": "Azucar"}, {"pct": 2, "manualName": "Sal"}, {"pct": 8.33, "manualName": "Huevo"}, {"pct": 8.33, "manualName": "Mantequilla"}, {"pct": 1.66, "manualName": "Levadura"}]}, {"id": "gm-009", "code": "GM-009", "name": "Pan 70% salado autolisis", "cat": "pan", "totalMass": 1300, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 70, "manualName": "Agua"}, {"pct": 1, "manualName": "Levadura"}, {"pct": 2, "manualName": "Sal"}]}, {"id": "gm-010", "code": "GM-010", "name": "Receta biga", "cat": "masa", "totalMass": 1978, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 50, "manualName": "Agua"}, {"pct": 2, "manualName": "Levadura"}]}, {"id": "gm-011", "code": "GM-011", "name": "Tangzhong", "cat": "masa", "totalMass": 200, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 500, "manualName": "Agua"}]}, {"id": "gm-012", "code": "GM-012", "name": "Barras con poolish", "cat": "masa", "totalMass": 1000, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina panadera"}], "other": [{"pct": 86, "manualName": "Poolish"}, {"pct": 0.15, "manualName": "Levadura seca"}, {"pct": 57, "manualName": "Agua"}, {"pct": 2, "manualName": "Sal"}]}, {"id": "gm-013", "code": "GM-013", "name": "Pan tandoor hogaza crujiente", "cat": "pan", "totalMass": 1000, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina blanca"}], "other": [{"pct": 65, "manualName": "Agua"}, {"pct": 5, "manualName": "Yogurt natural"}, {"pct": 1, "manualName": "Sal"}, {"pct": 0.5, "manualName": "Levadura seca"}, {"pct": 1, "manualName": "Azucar"}, {"pct": 3, "manualName": "Aceite o gee"}]}, {"id": "gm-014", "code": "GM-014", "name": "Canilla baguette", "cat": "pan", "totalMass": 905, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 52, "manualName": "Agua"}, {"pct": 20, "manualName": "Masa madre 100% hidratacion"}, {"pct": 3, "manualName": "Azucar"}, {"pct": 2, "manualName": "Sal"}, {"pct": 4, "manualName": "Mantequilla"}]}, {"id": "gm-015", "code": "GM-015", "name": "Pan de leche u mantequilla", "cat": "pan", "totalMass": 750, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 47.05, "manualName": "Leche liquida"}, {"pct": 3.35, "manualName": "Azucar"}, {"pct": 9.41, "manualName": "Mantequilla derretida"}, {"pct": 1.17, "manualName": "Levadura"}, {"pct": 12.23, "manualName": "Huevo"}, {"pct": 2, "manualName": "Sal"}]}, {"id": "gm-016", "code": "GM-016", "name": "Esponja", "cat": "masa", "totalMass": 1000, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 65, "manualName": "Agua"}, {"pct": 1, "manualName": "Levadura"}]}, {"id": "gm-017", "code": "GM-017", "name": "Acema carachera", "cat": "pan", "totalMass": 2099.3, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 4.5, "manualName": "Manteca"}, {"pct": 4.5, "manualName": "Mantequilla"}, {"pct": 15.6, "manualName": "Huevos"}, {"pct": 1, "manualName": "Levadura"}, {"pct": 0.8, "manualName": "Canela"}, {"pct": 0.8, "manualName": "Anís dulce"}, {"pct": 0.4, "manualName": "Nuez  moscada"}, {"pct": 3, "manualName": "Azucar"}, {"pct": 25, "manualName": "Leche liquida"}, {"pct": 25, "manualName": "Papelon disuelto en melao"}, {"pct": 11, "manualName": "Agua para el melao"}, {"pct": 1, "manualName": "Sal"}]}, {"id": "gm-018", "code": "GM-018", "name": "Poolish", "cat": "masa", "totalMass": 594, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 100, "manualName": "Agua"}, {"pct": 0.27, "manualName": "Levadura seca"}]}, {"id": "gm-019", "code": "GM-019", "name": "Pan petropolis", "cat": "pan", "totalMass": 700, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina blanca"}], "other": [{"pct": 12, "manualName": "Azucar"}, {"pct": 2, "manualName": "Sal"}, {"pct": 2, "manualName": "Levadura"}, {"pct": 7, "manualName": "Mantequilla"}, {"pct": 50, "manualName": "Leche tibia"}, {"pct": 10, "manualName": "Huevo"}]}, {"id": "gm-020", "code": "GM-020", "name": "Pan semiintegral con avena escaldada", "cat": "pan", "totalMass": 1000, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 70, "manualName": "Harina de fuerza"}, {"pct": 30, "manualName": "Harina integral"}], "other": [{"pct": 20, "manualName": "Masa madre 100% hid"}, {"pct": 40, "manualName": "Avena escaldada 1:2"}, {"pct": 35.14, "manualName": "Agua"}, {"pct": 2, "manualName": "Sal"}]}, {"id": "gm-021", "code": "GM-021", "name": "Pan de molde suave semiintegral", "cat": "pan", "totalMass": 1200, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 60, "manualName": "Harina panadera"}, {"pct": 40, "manualName": "Harina integral"}], "other": [{"pct": 20, "manualName": "Masa madre 100%"}, {"pct": 40, "manualName": "Agua"}, {"pct": 20, "manualName": "Leche liquida entera"}, {"pct": 10, "manualName": "Avena en hojuelas"}, {"pct": 3, "manualName": "Azucar morena"}, {"pct": 2, "manualName": "Sal"}, {"pct": 6, "manualName": "Margarina sin sal"}, {"pct": 0.2, "manualName": "Levadura"}]}, {"id": "gm-022", "code": "GM-022", "name": "Pan u Campain", "cat": "pan", "totalMass": 1500, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 75, "manualName": "Agua"}, {"pct": 2, "manualName": "Sal"}, {"pct": 25, "manualName": "Masa Madre 100"}]}, {"id": "gm-023", "code": "GM-023", "name": "Pan submarino", "cat": "pan", "totalMass": 2000, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 51.08, "manualName": "Agua"}, {"pct": 2.17, "manualName": "Sal"}, {"pct": 0.68, "manualName": "Levadura"}, {"pct": 10.86, "manualName": "Huevo"}, {"pct": 7.82, "manualName": "Mantequilla"}, {"pct": 3.9, "manualName": "Azucar"}, {"pct": 5.43, "manualName": "Leche en polvo"}]}, {"id": "gm-024", "code": "GM-024", "name": "Pan tartine 70% hidratacion", "cat": "pan", "totalMass": 7500, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 90, "manualName": "Harina blanca(mezcla)"}, {"pct": 10, "manualName": "Harina integral"}], "other": [{"pct": 20, "manualName": "Masa madre 70%"}, {"pct": 2, "manualName": "Sal"}, {"pct": 70, "manualName": "Agua"}]}, {"id": "gm-025", "code": "GM-025", "name": "Pan tartine original", "cat": "pan", "totalMass": 1000, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 90, "manualName": "Harina blanca"}, {"pct": 10, "manualName": "Harina integral"}], "other": [{"pct": 20, "manualName": "Masa madre 80%"}, {"pct": 2, "manualName": "Sal"}, {"pct": 75, "manualName": "Agua"}]}, {"id": "gm-026", "code": "GM-026", "name": "Pan chino con tanzhong verificada", "cat": "pan", "totalMass": 600, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 6.01, "manualName": "Agua"}, {"pct": 0.96, "manualName": "Levadura inst"}, {"pct": 1.5, "manualName": "Sal"}, {"pct": 11, "manualName": "Huevos"}, {"pct": 2.25, "manualName": "Yema de huevo"}, {"pct": 11, "manualName": "Aceite vegetal"}, {"pct": 14.51, "manualName": "Azucar"}, {"pct": 48.49, "manualName": "Tanzong"}]}, {"id": "gm-027", "code": "GM-027", "name": "Paté fermentee", "cat": "pan", "totalMass": 100, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina de fuerza"}], "other": [{"pct": 66.66, "manualName": "Agua"}, {"pct": 0.33, "manualName": "Levadura"}, {"pct": 1.73, "manualName": "Sal"}]}, {"id": "gm-028", "code": "GM-028", "name": "Masa lumpias sumito", "cat": "pan", "totalMass": 250, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina de trigo"}, {"pct": 50, "manualName": "Maicena"}], "other": [{"pct": 200, "manualName": "Agua"}, {"pct": 1, "manualName": "Sal"}, {"pct": 12, "manualName": "Aceite vegetal"}]}, {"id": "gm-029", "code": "GM-029", "name": "Pan de MM siciliano", "cat": "masa", "totalMass": 800, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 90, "manualName": "Harina panificable"}, {"pct": 10, "manualName": "Harina integral"}], "other": [{"pct": 60, "manualName": "Agua"}, {"pct": 20, "manualName": "Masa Madre 60%"}, {"pct": 2, "manualName": "Sal"}, {"pct": 2.6, "manualName": "Aceite de oliva"}, {"pct": 2, "manualName": "Azucar"}, {"pct": 1, "manualName": "Panela"}]}, {"id": "gm-030", "code": "GM-030", "name": "Pan Semi Integral", "cat": "pan", "totalMass": 4000, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 50, "manualName": "Harina Panificable"}, {"pct": 45, "manualName": "Harina integral"}, {"pct": 5, "manualName": "Centeno"}], "other": [{"pct": 80, "manualName": "Agua"}, {"pct": 20, "manualName": "Masa Madre"}, {"pct": 2, "manualName": "Sal"}]}, {"id": "gm-031", "code": "GM-031", "name": "Pan Integral", "cat": "pan", "totalMass": 1430, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 80, "manualName": "Harina integral"}, {"pct": 10, "manualName": "Centeno"}, {"pct": 10, "manualName": "Harina de Espelta"}], "other": [{"pct": 80, "manualName": "Agua"}, {"pct": 20, "manualName": "Masa Madre"}, {"pct": 2, "manualName": "Sal"}]}, {"id": "gm-032", "code": "GM-032", "name": "Pan de Centeno", "cat": "pan", "totalMass": 1000, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina de centeno"}, {"pct": 100, "manualName": "Masa madre centeno"}], "other": [{"pct": 100, "manualName": "Agua"}, {"pct": 8, "manualName": "Miel"}, {"pct": 3, "manualName": "Sal"}]}, {"id": "gm-033", "code": "GM-033", "name": "Baguette", "cat": "pan", "totalMass": 1000, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 85, "manualName": "Harina fuerza"}, {"pct": 15, "manualName": "Sémola fina"}], "other": [{"pct": 75, "manualName": "Agua"}, {"pct": 20, "manualName": "Masa Madre"}, {"pct": 2, "manualName": "Sal"}]}, {"id": "gm-034", "code": "GM-034", "name": "Pizza Básica", "cat": "otro", "totalMass": 1946, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina panificable"}], "other": [{"pct": 62, "manualName": "Agua"}, {"pct": 1, "manualName": "Levadura Fresca"}, {"pct": 2, "manualName": "Sal"}, {"pct": 1, "manualName": "Aceite de Oliva"}]}, {"id": "gm-035", "code": "GM-035", "name": "Pizza Napoletana", "cat": "otro", "totalMass": 1000, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina 00 Italiana"}], "other": [{"pct": 70, "manualName": "Agua"}, {"pct": 2, "manualName": "Levadura fresca"}, {"pct": 3, "manualName": "Sal"}]}, {"id": "gm-036", "code": "GM-036", "name": "Pizza Masa Madre", "cat": "masa", "totalMass": 1000, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina 00 italiana"}], "other": [{"pct": 60, "manualName": "Agua"}, {"pct": 15, "manualName": "Masa Madre"}, {"pct": 2, "manualName": "Sal"}]}, {"id": "gm-037", "code": "GM-037", "name": "Pala Romana", "cat": "otro", "totalMass": 2000, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 80, "manualName": "Harina 00 Italiana"}, {"pct": 20, "manualName": "Harina Manitoba"}], "other": [{"pct": 70, "manualName": "Agua"}, {"pct": 1, "manualName": "Levadura fresca"}, {"pct": 2, "manualName": "Aceita de Oliva"}, {"pct": 2, "manualName": "Sal"}]}, {"id": "gm-038", "code": "GM-038", "name": "Focaccia Masa Madre", "cat": "masa", "totalMass": 1300, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina de fuerza"}], "other": [{"pct": 85, "manualName": "Agua"}, {"pct": 20, "manualName": "Masa madre"}, {"pct": 2, "manualName": "Sal"}]}, {"id": "gm-039", "code": "GM-039", "name": "Pan victor greñado natural", "cat": "pan", "totalMass": 1430, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 60, "manualName": "Agua"}, {"pct": 0.3, "manualName": "Levadura"}, {"pct": 2, "manualName": "Sal"}, {"pct": 2, "manualName": "Azucar morenA"}, {"pct": 10, "manualName": "Masa madre 60%"}]}, {"id": "gm-040", "code": "GM-040", "name": "Pan rustico con masa madre", "cat": "masa", "totalMass": 1430, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 95, "manualName": "Harina"}, {"pct": 5, "manualName": "Harina integral"}], "other": [{"pct": 20, "manualName": "Masa madre"}, {"pct": 65, "manualName": "Agua"}, {"pct": 2, "manualName": "Sal"}, {"pct": 3, "manualName": "Azucar"}, {"pct": 0.25, "manualName": "Levadura"}, {"pct": 0.5, "manualName": "Aceite neutro"}]}, {"id": "gm-041", "code": "GM-041", "name": "Pan de molde", "cat": "pan", "totalMass": 600, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 40, "manualName": "Agua"}, {"pct": 20, "manualName": "Leche"}, {"pct": 9, "manualName": "Mantequilla"}, {"pct": 5, "manualName": "Azucar"}, {"pct": 0.9, "manualName": "Levadura"}, {"pct": 1.8, "manualName": "Sal"}, {"pct": 3.5, "manualName": "Vinagre de sidra"}]}, {"id": "gm-042", "code": "GM-042", "name": "Pan de molde especial", "cat": "pan", "totalMass": 650.1, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina de fuerza"}], "other": [{"pct": 0.94, "manualName": "Levadura instantanea"}, {"pct": 42.35, "manualName": "Leche liquida"}, {"pct": 1.18, "manualName": "Azucar"}, {"pct": 2.35, "manualName": "Sal"}, {"pct": 11.76, "manualName": "Huevo"}, {"pct": 10.59, "manualName": "Aceite de oliva"}, {"pct": 3.5, "manualName": "Vinagre de sidra"}]}, {"id": "gm-043", "code": "GM-043", "name": "Pan siciliano tipo pagniotta victor", "cat": "pan", "totalMass": 2400, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 56, "manualName": "Agua"}, {"pct": 1.5, "manualName": "Levadura  polvo"}, {"pct": 2, "manualName": "Aceite oliva"}, {"pct": 2, "manualName": "Azucar morena"}, {"pct": 2, "manualName": "Sal"}]}, {"id": "gm-044", "code": "GM-044", "name": "Pan turco", "cat": "pan", "totalMass": 1000, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina panadera"}], "other": [{"pct": 2.5, "manualName": "Levadura instantanea"}, {"pct": 80, "manualName": "Agua tibia"}, {"pct": 1.25, "manualName": "Azucar"}, {"pct": 1.25, "manualName": "Sal"}, {"pct": 7.5, "manualName": "Aceite de oliva"}]}, {"id": "gm-045", "code": "GM-045", "name": "Pan campesino venezolano", "cat": "pan", "totalMass": 400, "units": 1, "merma": 0, "notes": "este es el pan clásico\npoco levado en bloque \ny llevar en pieza hasta duplicar \nse puede hacer de 500g cada pan o de 300g", "flour": [{"pct": 100, "manualName": "Harina de fuerza"}], "other": [{"pct": 1, "manualName": "Levadura en polvo"}, {"pct": 50, "manualName": "Agua"}, {"pct": 4, "manualName": "Azucar"}, {"pct": 2, "manualName": "Sal"}, {"pct": 1.5, "manualName": "Aceite neutro u oliva"}, {"pct": 4, "manualName": "Manteca"}]}, {"id": "gm-046", "code": "GM-046", "name": "biga", "cat": "masa", "totalMass": 2078, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina de fuerza"}], "other": [{"pct": 60, "manualName": "Agua"}, {"pct": 0.42, "manualName": "Levadura"}]}, {"id": "gm-047", "code": "GM-047", "name": "Pan campesino 2 masa madre biga", "cat": "masa", "totalMass": 4620, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 63.3, "manualName": "Agua"}, {"pct": 3.33, "manualName": "Azúcar morena"}, {"pct": 1.33, "manualName": "Levadura seca"}, {"pct": 3.71, "manualName": "Sal"}, {"pct": 128.6, "manualName": "Masa madre biga1"}]}, {"id": "gm-048", "code": "GM-048", "name": "Pan frances", "cat": "pan", "totalMass": 738, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 56, "manualName": "Agua"}, {"pct": 1.6, "manualName": "Levadura instantanea"}, {"pct": 5, "manualName": "Azucar"}, {"pct": 2, "manualName": "Sal"}, {"pct": 3, "manualName": "Manteca"}]}, {"id": "gm-049", "code": "GM-049", "name": "Pan molde receta maribel", "cat": "pan", "totalMass": 600, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 2.4, "manualName": "Levadura ins"}, {"pct": 40, "manualName": "Leche liquida"}, {"pct": 10, "manualName": "Azucar"}, {"pct": 2, "manualName": "Sal"}, {"pct": 6, "manualName": "Margarina"}, {"pct": 10, "manualName": "Huevo"}, {"pct": 6, "manualName": "Manteca"}]}, {"id": "gm-050", "code": "GM-050", "name": "Pan dulce colombiano", "cat": "pan", "totalMass": 1000, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 1.33, "manualName": "Levadura"}, {"pct": 33.33, "manualName": "Leche liquida"}, {"pct": 5.56, "manualName": "Agua tibia"}, {"pct": 13.33, "manualName": "Azucar"}, {"pct": 0.89, "manualName": "Sal"}, {"pct": 22.22, "manualName": "Huevo"}, {"pct": 5.56, "manualName": "Margarina"}]}, {"id": "gm-051", "code": "GM-051", "name": "Pan de hamburguesa maribel", "cat": "pan", "totalMass": 500, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 2.4, "manualName": "Levadura"}, {"pct": 40, "manualName": "Agua"}, {"pct": 8, "manualName": "Azucar"}, {"pct": 2, "manualName": "Sal"}, {"pct": 6, "manualName": "Margarina"}, {"pct": 10, "manualName": "Huevo"}, {"pct": 6, "manualName": "Manteca"}]}, {"id": "gm-052", "code": "GM-052", "name": "Pan de abuela rustico masa madre", "cat": "masa", "totalMass": 939, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 0.8, "manualName": "Levadura"}, {"pct": 62.5, "manualName": "Agua"}, {"pct": 2, "manualName": "Sal"}, {"pct": 1, "manualName": "Panela"}, {"pct": 20, "manualName": "Masa madre mm"}, {"pct": 1, "manualName": "Aceite oliva"}, {"pct": 0.5, "manualName": "Condimente"}]}, {"id": "gm-053", "code": "GM-053", "name": "Pan chino generico", "cat": "pan", "totalMass": 600, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 58, "manualName": "Harina"}], "other": [{"pct": 19, "manualName": "Agua"}, {"pct": 0.6, "manualName": "Levadura"}, {"pct": 0.5, "manualName": "Sal"}, {"pct": 6.54, "manualName": "Huevos"}, {"pct": 3.73, "manualName": "Yemas de huevos"}, {"pct": 6.54, "manualName": "Aceite vegetal"}, {"pct": 8.41, "manualName": "Azucar"}]}, {"id": "gm-054", "code": "GM-054", "name": "Pan de jamon masa", "cat": "pan", "totalMass": 650, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina blanca"}], "other": [{"pct": 2, "manualName": "Levadura"}, {"pct": 6, "manualName": "Azucar"}, {"pct": 10, "manualName": "Huevo"}, {"pct": 5, "manualName": "Mantequilla"}, {"pct": 25, "manualName": "Leche liquida"}, {"pct": 1, "manualName": "Sal"}, {"pct": 25, "manualName": "Agua tibia"}]}, {"id": "gm-055", "code": "GM-055", "name": "Pan frances venezolano", "cat": "pan", "totalMass": 700, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 53.3, "manualName": "Agua"}, {"pct": 5, "manualName": "Azucar"}, {"pct": 1.83, "manualName": "Levadura instantánea"}, {"pct": 2, "manualName": "Sal"}, {"pct": 4, "manualName": "Margarina"}]}, {"id": "gm-056", "code": "GM-056", "name": "Pan con paté fermente", "cat": "pan", "totalMass": 750, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 60, "manualName": "Agua"}, {"pct": 22.72, "manualName": "Paté fermentee"}, {"pct": 0.13, "manualName": "Levadura seca"}, {"pct": 1.78, "manualName": "Sal"}]}, {"id": "gm-057", "code": "GM-057", "name": "Panes Franceses venezolanos", "cat": "pan", "totalMass": 830.7, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina planificable"}], "other": [{"pct": 53.3, "manualName": "Agua"}, {"pct": 1.83, "manualName": "Levadura"}, {"pct": 5, "manualName": "Azucar"}, {"pct": 2, "manualName": "Sal"}, {"pct": 4, "manualName": "Mantequilla"}]}, {"id": "gm-058", "code": "GM-058", "name": "Cachitos", "cat": "pan", "totalMass": 972, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 1.4, "manualName": "Levadura seca"}, {"pct": 25, "manualName": "Leche"}, {"pct": 12, "manualName": "Azucar"}, {"pct": 20, "manualName": "Mantequilla"}, {"pct": 10, "manualName": "Huevos"}, {"pct": 1, "manualName": "Sal"}, {"pct": 25, "manualName": "Agua"}]}, {"id": "gm-059", "code": "GM-059", "name": "Chelsea loaf", "cat": "pan", "totalMass": 646.9, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina blanca"}], "other": [{"pct": 29, "manualName": "Leche"}, {"pct": 29, "manualName": "Azucar"}, {"pct": 15, "manualName": "Huevo"}, {"pct": 7.14, "manualName": "Margarina"}, {"pct": 1.43, "manualName": "Sal"}, {"pct": 3.43, "manualName": "Levadura"}]}, {"id": "gm-060", "code": "GM-060", "name": "chulas", "cat": "galleta", "totalMass": 706, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "harina todo uso"}], "other": [{"pct": 3, "manualName": "polvo para hornear"}, {"pct": 0.5, "manualName": "bicarbonato"}, {"pct": 3, "manualName": "leche en polvo"}, {"pct": 25, "manualName": "panela"}, {"pct": 5, "manualName": "agua para mrkao"}, {"pct": 4.2, "manualName": "manteca"}, {"pct": 0.5, "manualName": "canela"}]}, {"id": "gm-061", "code": "GM-061", "name": "Galleta mantequilla pasta seca", "cat": "galleta", "totalMass": 103, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina blanca"}, {"pct": 3.33, "manualName": "Maicena"}], "other": [{"pct": 50, "manualName": "Azúcar Glass"}, {"pct": 17.33, "manualName": "Huevo"}, {"pct": 1, "manualName": "Polvo de Hornear"}, {"pct": 1, "manualName": "Sal"}, {"pct": 1.66, "manualName": "Vainilla"}, {"pct": 73.33, "manualName": "mantequilla"}]}, {"id": "gm-062", "code": "GM-062", "name": "Pan de molde con h integral", "cat": "pan", "totalMass": 650.1, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 90, "manualName": "Harina de fuerza"}, {"pct": 10, "manualName": "Harina Integral"}], "other": [{"pct": 1.44, "manualName": "Levadura instantanea"}, {"pct": 42.35, "manualName": "Leche liquida"}, {"pct": 1.18, "manualName": "Azucar"}, {"pct": 2.35, "manualName": "Sal"}, {"pct": 11.76, "manualName": "Huevo"}, {"pct": 10.59, "manualName": "Mantequilla"}, {"pct": 3.5, "manualName": "Vinagre de sidra"}]}, {"id": "gm-063", "code": "GM-063", "name": "galletas red velvet", "cat": "galleta", "totalMass": 1000, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina De trigo"}, {"pct": 4, "manualName": "Maicena"}], "other": [{"pct": 40, "manualName": "Mantequilla"}, {"pct": 60, "manualName": "Azúcar morena"}, {"pct": 20, "manualName": "Huevo"}, {"pct": 2.4, "manualName": "polvo de hornear"}, {"pct": 2.4, "manualName": "bicarbonato"}, {"pct": 0.4, "manualName": "sal"}, {"pct": 2, "manualName": "colorante rojo"}, {"pct": 12, "manualName": "cacao en polvo"}, {"pct": 63, "manualName": "chispas chocolate blanco"}, {"pct": 40, "manualName": "queso crema"}]}, {"id": "gm-064", "code": "GM-064", "name": "Pan semi integral Azrnza", "cat": "pan", "totalMass": 1000, "units": 1, "merma": 0, "notes": "está receta es un semintegral suave", "flour": [{"pct": 80, "manualName": "Harina de pizza"}, {"pct": 20, "manualName": "Harina integral"}, {"pct": 18, "manualName": "mm de centeno (1:5:5)"}], "other": [{"pct": 2, "manualName": "Sal"}, {"pct": 70, "manualName": "agua"}]}, {"id": "gm-065", "code": "GM-065", "name": "Pan campesino 2 masa madre biga larga fermentacion", "cat": "masa", "totalMass": 4730, "units": 1, "merma": 0, "notes": "este pan se hace con una viga de 24 horas y luego fermentar 24 horas \nla sal se calcula sobre toda la harina por eso es más de 2%\nbaja levadura larga fermentacion ", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 52, "manualName": "Agua"}, {"pct": 4, "manualName": "Azúcar morena"}, {"pct": 0.51, "manualName": "Levadura seca"}, {"pct": 3.71, "manualName": "Sal"}, {"pct": 128.6, "manualName": "Masa madre biga1"}, {"pct": 1.5, "manualName": "aceite"}, {"pct": 4, "manualName": "manteca"}]}, {"id": "gm-066", "code": "GM-066", "name": "biga 50,%", "cat": "masa", "totalMass": 2078.8, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina de fuerza"}], "other": [{"pct": 50, "manualName": "Agua"}, {"pct": 0.04, "manualName": "Levadura"}]}, {"id": "gm-067", "code": "GM-067", "name": "Pan integral mm 66%", "cat": "masa", "totalMass": 700, "units": 1, "merma": 0, "notes": "linaza agregar húmeda... sal  primero y luego aceite 3 plegados luego de bassinage", "flour": [{"pct": 50, "manualName": "harina integral"}, {"pct": 50, "manualName": "harina de pizza"}], "other": [{"pct": 82, "manualName": "agua tibia"}, {"pct": 28, "manualName": "mm 1:2:2"}, {"pct": 2.2, "manualName": "sal"}, {"pct": 4.5, "manualName": "azúcar"}, {"pct": 5, "manualName": "aceite"}, {"pct": 6, "manualName": "linaza molida"}]}, {"id": "gm-068", "code": "GM-068", "name": "Pan campesino 2 polish", "cat": "masa", "totalMass": 470, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 60, "manualName": "Agua"}, {"pct": 4, "manualName": "Azúcar morena"}, {"pct": 1.33, "manualName": "Levadura seca"}, {"pct": 2.1, "manualName": "Sal"}, {"pct": 2, "manualName": "aceite"}, {"pct": 4, "manualName": "manteca"}, {"pct": 20, "manualName": "polish"}]}, {"id": "gm-069", "code": "GM-069", "name": "galletas craqueladas", "cat": "galleta", "totalMass": 870, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina de trigo"}], "other": [{"pct": 160, "manualName": "Azúcar Blanca"}, {"pct": 50, "manualName": "Cacao"}, {"pct": 50, "manualName": "Aceite de girasol"}, {"pct": 55, "manualName": "Huevo"}, {"pct": 15, "manualName": "Vainilla"}, {"pct": 5, "manualName": "Polvo de Hornear"}]}, {"id": "gm-070", "code": "GM-070", "name": "galletas chocochip", "cat": "galleta", "totalMass": 1646, "units": 1, "merma": 0, "notes": "usar colorante rojo en red velvet", "flour": [{"pct": 100, "manualName": "Harina de trigo"}, {"pct": 6, "manualName": "Maicena"}], "other": [{"pct": 46, "manualName": "Mantequilla"}, {"pct": 30, "manualName": "Azúcar blanca"}, {"pct": 30, "manualName": "Azúcar morena"}, {"pct": 24, "manualName": "Huevo"}, {"pct": 12, "manualName": "Cacao"}, {"pct": 6, "manualName": "Vainilla"}, {"pct": 2.4, "manualName": "Polvo de hornear"}, {"pct": 2.4, "manualName": "Bicarbonato de sodio"}, {"pct": 0.4, "manualName": "Sal"}, {"pct": 70, "manualName": "Chispas de chocolate"}]}, {"id": "gm-071", "code": "GM-071", "name": "Pan de Masa Madre", "cat": "masa", "totalMass": 1000, "units": 1, "merma": 0, "notes": "1- Mezclar todos los ingredientes.\n2- Dejar reposar (autólisis) 20–40 minutos.\n3- Amasar hasta lograr una masa lisa y elástica.\n4- Dejar fermentar en bloque durante 5 horas, realizando 2–3 pliegues cada 15 minutos (si es necesario).\n5- Formar directamente (sin preformado).\n6- Llevar a fermentación en frío a 5 °C durante 12–24 horas.\n7- Precalentar horno o dutch oven durante 45 minutos.\n8- Hornear a 250 °C:\n- 20 minutos con vapor\n- 20 minutos sin vapor\n\nQue el gluten esté con Ustedes.", "flour": [{"pct": 90, "manualName": "Harina Panificable"}, {"pct": 10, "manualName": "Harina Integral / Sémola"}], "other": [{"pct": 70, "manualName": "Agua"}, {"pct": 20, "manualName": "Masa Madre"}, {"pct": 2, "manualName": "Sal"}]}, {"id": "gm-072", "code": "GM-072", "name": "Pan de Masa Madre", "cat": "masa", "totalMass": 1000, "units": 1, "merma": 0, "notes": "1- Mezclar todos los ingredientes.\n2- Dejar reposar (autólisis) 20–40 minutos.\n3- Amasar hasta lograr una masa lisa y elástica.\n4- Dejar fermentar en bloque durante 5 horas, realizando 2–3 pliegues cada 15 minutos (si es necesario).\n5- Formar directamente (sin preformado).\n6- Llevar a fermentación en frío a 5 °C durante 12–24 horas.\n7- Precalentar horno o dutch oven durante 45 minutos.\n8- Hornear a 250 °C:\n- 20 minutos con vapor\n- 20 minutos sin vapor\n\nQue el gluten esté con Ustedes.", "flour": [{"pct": 90, "manualName": "Harina Panificable"}, {"pct": 10, "manualName": "Harina Integral / Sémola"}], "other": [{"pct": 70, "manualName": "Agua"}, {"pct": 20, "manualName": "Masa Madre"}, {"pct": 2, "manualName": "Sal"}]}, {"id": "gm-073", "code": "GM-073", "name": "Cachitos", "cat": "pan", "totalMass": 1798, "units": 1, "merma": 0, "notes": "usar otro huevo para barnizar\nhacer 2 bolas de masa cada una extendida a 35cm dividir en 8partes\ncada cachito lleva 1/3de taza de relleno ", "flour": [{"pct": 100, "manualName": "Harina de trigo todo uso"}], "other": [{"pct": 22, "manualName": "Mantequilla"}, {"pct": 1.6, "manualName": "levadura instantanea"}, {"pct": 13, "manualName": "Azúcar Blanca"}, {"pct": 25, "manualName": "Leche liquida"}, {"pct": 25, "manualName": "agua"}, {"pct": 3, "manualName": "sal"}, {"pct": 10, "manualName": "huevo"}, {"pct": 100, "manualName": "Jamon de pierna"}, {"pct": 50, "manualName": "Tocineta ahumada"}, {"pct": 10, "manualName": "mantequilla para barnizar"}]}, {"id": "gm-074", "code": "GM-074", "name": "Pan de tunja", "cat": "pan", "totalMass": 500, "units": 1, "merma": 0, "notes": "la azúcar leche y levadura se hace prefermento\npincelar con huevo y leche\n\neste pan se enrolla de ambos lados y queda con una rajada en el centro ", "flour": [{"pct": 100, "manualName": "harina todo uso"}], "other": [{"pct": 13.8, "manualName": "huevo"}, {"pct": 27.77, "manualName": "azucar"}, {"pct": 1.38, "manualName": "Anis dulce"}, {"pct": 1.38, "manualName": "Canela"}, {"pct": 13.88, "manualName": "Mantequilla"}, {"pct": 41.66, "manualName": "Leche tibia"}, {"pct": 2.22, "manualName": "Levadura seca"}, {"pct": 4.16, "manualName": "Azucar"}, {"pct": 1, "manualName": "sal"}]}, {"id": "gm-075", "code": "GM-075", "name": "Pan Semintegral 425g", "cat": "pan", "totalMass": 500, "units": 1, "merma": 0, "notes": "este es un pan de molde y sale de 425g entra 500 de masa", "flour": [{"pct": 60, "manualName": "Harina de Fuerza"}, {"pct": 40, "manualName": "Harina integral"}], "other": [{"pct": 70, "manualName": "Agua"}, {"pct": 20, "manualName": "MM 1:3:3"}, {"pct": 2, "manualName": "Sal"}, {"pct": 5, "manualName": "Aceite de Oliva"}, {"pct": 5, "manualName": "Miel de caña"}]}, {"id": "gm-076", "code": "GM-076", "name": "Mm   1 3 3", "cat": "masa", "totalMass": 1290, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "harina"}], "other": [{"pct": 100, "manualName": "agua"}, {"pct": 33.3, "manualName": "Starter"}]}, {"id": "gm-077", "code": "GM-077", "name": "Pasta seca venezolana", "cat": "galleta", "totalMass": 807, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "harina todo uso"}, {"pct": 60, "manualName": "fecula de maiz"}], "other": [{"pct": 125, "manualName": "mantequilla sin sal"}, {"pct": 60, "manualName": "azúcar glass"}, {"pct": 55, "manualName": "huevo entero"}, {"pct": 2.5, "manualName": "vainilla"}, {"pct": 1, "manualName": "sal"}]}, {"id": "gm-078", "code": "GM-078", "name": "Pan challah", "cat": "pan", "totalMass": 806.1, "units": 1, "merma": 0, "notes": "pincelar con una clara más agua en cucharada\ntopping de ajonjolí y amapola", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 28.57, "manualName": "Agua"}, {"pct": 1.19, "manualName": "Levadura seca"}, {"pct": 17.18, "manualName": "Azúcar o miel"}, {"pct": 2.38, "manualName": "sal"}, {"pct": 24.76, "manualName": "Huevo entero"}, {"pct": 3.57, "manualName": "yema de huevo"}, {"pct": 14.28, "manualName": "mezcla de aceite"}]}, {"id": "gm-079", "code": "GM-079", "name": "Pan challah (Copia 2)", "cat": "pan", "totalMass": 1220, "units": 1, "merma": 0, "notes": "pincelar con una clara más agua en cucharada\ntopping de ajonjolí blanco y o amapola", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 20.8, "manualName": "Agua"}, {"pct": 0.7, "manualName": "Levadura seca"}, {"pct": 8.3, "manualName": "Azúcar"}, {"pct": 1.4, "manualName": "sal"}, {"pct": 15.3, "manualName": "Huevo entero"}, {"pct": 9, "manualName": "yema de huevo"}, {"pct": 9.7, "manualName": "mezcla de aceite"}, {"pct": 4.2, "manualName": "miel"}]}, {"id": "gm-080", "code": "GM-080", "name": "Pasta Seca Venezolana", "cat": "galleta", "totalMass": 1000, "units": 1, "merma": 0, "notes": "Si se hace con chocolate se usa cobertura de chocolate 250 g por kg de harina", "flour": [{"pct": 100, "manualName": "Harina Panadera"}], "other": [{"pct": 50, "manualName": "Manteca vegetal"}, {"pct": 35, "manualName": "Azucar"}, {"pct": 35, "manualName": "Leche liquida"}, {"pct": 25, "manualName": "Margarina"}, {"pct": 5, "manualName": "Huevo"}, {"pct": 1, "manualName": "Esencia de vainilla y otra"}]}, {"id": "gm-081", "code": "GM-081", "name": "golfeados", "cat": "pan", "totalMass": 3358.1, "units": 1, "merma": 0, "notes": "40 g de relleno queso azúcar panela\nmelao 41 g cada ", "flour": [{"pct": 100, "manualName": "Harina panadera"}], "other": [{"pct": 50, "manualName": "Agua"}, {"pct": 2, "manualName": "Levadura"}, {"pct": 1, "manualName": "sal"}, {"pct": 15, "manualName": "Azúcar blanca"}, {"pct": 4, "manualName": "margarina"}, {"pct": 4, "manualName": "Papelón rallado"}, {"pct": 5, "manualName": "Leche en polvo"}, {"pct": 1, "manualName": "vainilla"}, {"pct": 1, "manualName": "Anis en grano"}, {"pct": 0.5, "manualName": "Canela"}]}, {"id": "gm-082", "code": "GM-082", "name": "Relleno de golfeado", "cat": "otro", "totalMass": 1222, "units": 1, "merma": 0, "notes": "", "flour": [], "other": [{"pct": 200, "manualName": "Queso"}, {"pct": 100, "manualName": "panela rallada"}, {"pct": 100, "manualName": "Azúcar"}, {"pct": 1, "manualName": "Anis"}, {"pct": 1, "manualName": "Canela"}]}, {"id": "gm-083", "code": "GM-083", "name": "Melao de golfeado", "cat": "otro", "totalMass": 1200, "units": 1, "merma": 0, "notes": "", "flour": [], "other": [{"pct": 100, "manualName": "Papelon"}, {"pct": 50, "manualName": "Agua"}, {"pct": 5, "manualName": "Especias"}]}, {"id": "gm-084", "code": "GM-084", "name": "Mm   1: 3: 2.5 (Copia)", "cat": "masa", "totalMass": 400, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "harina"}], "other": [{"pct": 80, "manualName": "agua"}, {"pct": 33.3, "manualName": "Starter"}]}, {"id": "gm-085", "code": "GM-085", "name": "Baguette bertinette", "cat": "pan", "totalMass": 1000, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "harina"}], "other": [{"pct": 72, "manualName": "agua"}, {"pct": 2, "manualName": "sal"}, {"pct": 5, "manualName": "levadura en polvo"}]}, {"id": "gm-086", "code": "GM-086", "name": "Pan dulce", "cat": "pan", "totalMass": 2986.2, "units": 1, "merma": 0, "notes": "barnizar con leche para el horno", "flour": [{"pct": 100, "manualName": "Harina fuerte"}], "other": [{"pct": 30, "manualName": "Azúcar"}, {"pct": 5, "manualName": "Margarina"}, {"pct": 2, "manualName": "Levadura instantanea"}, {"pct": 50, "manualName": "Agua tibia"}, {"pct": 0.6, "manualName": "Sal"}, {"pct": 1, "manualName": "esencia"}]}, {"id": "gm-087", "code": "GM-087", "name": "Masa dulce multiple", "cat": "pan", "totalMass": 1000, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 20, "manualName": "Azúcar"}, {"pct": 50, "manualName": "Agua"}, {"pct": 0.47, "manualName": "sal"}, {"pct": 4, "manualName": "Grasa"}, {"pct": 4, "manualName": "Panela"}]}, {"id": "gm-088", "code": "GM-088", "name": "Prefermento pie frances", "cat": "masa", "totalMass": 201, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "harina"}], "other": [{"pct": 150, "manualName": "agua"}, {"pct": 1.25, "manualName": "Levadura"}]}, {"id": "gm-089", "code": "GM-089", "name": "Roles de canela chica mexicana", "cat": "pan", "totalMass": 1400, "units": 1, "merma": 0, "notes": "relleno 543 g\nbetun. 807g\n\npara 1098g\n\nestirar 46x46\n\nlos roles llevan \ncada uno 37 gramos de relleno y 47 de betún \nse pincelan con doradura", "flour": [{"pct": 100, "manualName": "Harina de fuerza"}], "other": [{"pct": 34.28, "manualName": "Leche Liquida"}, {"pct": 2, "manualName": "levadura instantánea"}, {"pct": 3.42, "manualName": "Leche en polvo"}, {"pct": 14.28, "manualName": "Azúcar"}, {"pct": 1.42, "manualName": "sal"}, {"pct": 14.28, "manualName": "Huevos"}, {"pct": 16.14, "manualName": "mantequilla"}, {"pct": 34.28, "manualName": "tangzon"}]}, {"id": "gm-090", "code": "GM-090", "name": "relleno rol de canela", "cat": "otro", "totalMass": 310, "units": 1, "merma": 0, "notes": "ver en rol para escalar\n\n37 g por rol \n310 g para 8 roles", "flour": [], "other": [{"pct": 100, "manualName": "Mantequilla"}, {"pct": 151.8, "manualName": "Azúcar morena"}, {"pct": 15.09, "manualName": "canela"}, {"pct": 1.8, "manualName": "sal"}]}, {"id": "gm-091", "code": "GM-091", "name": "betun rol de canela", "cat": "otro", "totalMass": 500, "units": 1, "merma": 0, "notes": "ver en receta de rol cantidad para escalarr\n375g para 8 roles", "flour": [], "other": [{"pct": 40, "manualName": "queso crema"}, {"pct": 20, "manualName": "mantequilla"}, {"pct": 20, "manualName": "azucar glass"}, {"pct": 0.42, "manualName": "sal"}, {"pct": 0.83, "manualName": "vainilla"}]}, {"id": "gm-092", "code": "GM-092", "name": "Pan siciliano tipo pagniotta victor poolish mm (Copia)", "cat": "masa", "totalMass": 2400, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 85, "manualName": "Harina"}, {"pct": 15, "manualName": "Harina integral"}], "other": [{"pct": 55, "manualName": "Polish"}, {"pct": 56, "manualName": "Agua"}, {"pct": 5, "manualName": "Masa madre 1:4:4"}, {"pct": 2, "manualName": "Aceite oliva"}, {"pct": 2, "manualName": "Sal"}, {"pct": 2, "manualName": "Azucar morena o miel"}, {"pct": 0.2, "manualName": "Levadura"}]}, {"id": "gm-093", "code": "GM-093", "name": "Biscotti", "cat": "galleta", "totalMass": 754.9, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina todo uso o repostera"}], "other": [{"pct": 46.9, "manualName": "Azucar"}, {"pct": 37.5, "manualName": "Almendras enteras"}, {"pct": 46.8, "manualName": "Huevos"}, {"pct": 3.1, "manualName": "Polvo de hornear"}, {"pct": 1.9, "manualName": "esencia de vainilla"}]}, {"id": "gm-094", "code": "GM-094", "name": "Bollos Suizos", "cat": "pan", "totalMass": 778, "units": 1, "merma": 0, "notes": "bollos de 200g se greñan", "flour": [{"pct": 100, "manualName": "Harina repostera"}], "other": [{"pct": 45.7, "manualName": "leche liquida"}, {"pct": 1.1, "manualName": "Levadura dulce"}, {"pct": 1.1, "manualName": "Sal"}, {"pct": 12.9, "manualName": "Azucar"}, {"pct": 2.9, "manualName": "Miel"}, {"pct": 20, "manualName": "Margarina"}, {"pct": 14.3, "manualName": "Huevo"}, {"pct": 14.3, "manualName": "Huevo topping"}, {"pct": 10, "manualName": "azúcar topping"}]}, {"id": "gm-095", "code": "GM-095", "name": "baguette de chocolates", "cat": "pan", "totalMass": 1000, "units": 1, "merma": 0, "notes": "la autolisis de 1hora\nsus pliegues y dormir en frio \nal día siguiente porcionar levar y hornear\nse le agrega a cada pastón trocitos de chocolate ", "flour": [{"pct": 100, "manualName": "Harina panadera"}], "other": [{"pct": 75, "manualName": "agua"}, {"pct": 20, "manualName": "masa madre"}, {"pct": 2.3, "manualName": "sal"}, {"pct": 4, "manualName": "Cacao en polvo"}, {"pct": 0.15, "manualName": "Levadura en polvo"}]}, {"id": "gm-096", "code": "GM-096", "name": "bollitos dulces de talvina", "cat": "pan", "totalMass": 1000, "units": 1, "merma": 0, "notes": "Especificaciones Técnicas\n​Hidratación Total: Estás cerca del 55-58% (contando el líquido de los huevos, la talvina y la leche). Es una masa firme, ideal para que los bollitos mantengan su forma redonda y no se desparramen.\n​Amasado (Método Indirecto): 1.  Mezcla leche, tapa dulce, huevos, talvina y vainilla.\n2.  Agrega la harina, sal y canela. Amasa hasta que no veas harina seca.\n3.  Descanso (Autólisis): Deja reposar 20 min para que la Facasa Verde absorba la panela.\n4.  Desarrollo de Gluten: Amasa hasta que la masa esté lisa.\n5.  Incorporación de Grasa: Agrega la mantequilla en pomada (blanda) al final. Amasa hasta que la masa la \"sequestre\" por completo y se vea brillante.", "flour": [{"pct": 100, "manualName": "Harina fuerte"}], "other": [{"pct": 40, "manualName": "Leche entera"}, {"pct": 25, "manualName": "Talvina"}, {"pct": 18, "manualName": "Tapa dulce granulada"}, {"pct": 10, "manualName": "mantequilla sin sal"}, {"pct": 10, "manualName": "Huevos"}, {"pct": 1.2, "manualName": "sal"}, {"pct": 0.5, "manualName": "Canela"}]}, {"id": "gm-097", "code": "GM-097", "name": "queque de vainilla", "cat": "galleta", "totalMass": 3300, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "harina fuerte"}], "other": [{"pct": 66.66, "manualName": "azúcar"}, {"pct": 100, "manualName": "mantequill"}, {"pct": 66.66, "manualName": "huevos"}, {"pct": 80, "manualName": "leche"}, {"pct": 3.33, "manualName": "vainilla"}, {"pct": 0.33, "manualName": "sal"}, {"pct": 3.33, "manualName": "Polvo de hornear"}]}, {"id": "gm-098", "code": "GM-098", "name": "Pan rápido de molde", "cat": "pan", "totalMass": 1537.8, "units": 1, "merma": 0, "notes": "este pan lleva 1er levado 1 hora 2do levado 30 min\nse inta molde con aove antes de hornear se pinta con agua horno a 170grados 1 hora\nson 2 panes", "flour": [{"pct": 100, "manualName": "harina"}], "other": [{"pct": 0.88, "manualName": "levadura"}, {"pct": 1.11, "manualName": "Azucar"}, {"pct": 2, "manualName": "sal"}, {"pct": 1.11, "manualName": "aove"}, {"pct": 66.66, "manualName": "agua"}, {"pct": 2, "manualName": "talvina"}, {"pct": 2, "manualName": "Miel"}]}, {"id": "gm-099", "code": "GM-099", "name": "Golfeado Ulises panadero", "cat": "pan", "totalMass": 2622.8, "units": 1, "merma": 0, "notes": "16 golfeados son 500 g de queso y 800g de harina\nse hace la masa y dolo reposa media hora\nen esta. receta la masa va ful de melao con queso\nantes de hornear se mezcla leche con melao y se baña todo con eso\nfaltando 10 min se vuelve a bañar y pintar con melao", "flour": [{"pct": 100, "manualName": "Harina de trigo"}], "other": [{"pct": 35, "manualName": "leche entera"}, {"pct": 16.25, "manualName": "Mantequilla derretida"}, {"pct": 12.5, "manualName": "Huevos"}, {"pct": 3.75, "manualName": "Vainilla"}, {"pct": 1.5, "manualName": "levadura"}, {"pct": 0.6, "manualName": "sal"}, {"pct": 62.5, "manualName": "queso"}, {"pct": 75, "manualName": "Melao preparado de paprlon"}, {"pct": 1, "manualName": "Anis"}, {"pct": 1, "manualName": "Canela"}, {"pct": 18.75, "manualName": "Leche con melao"}]}, {"id": "gm-100", "code": "GM-100", "name": "Galleta con descarte de mn", "cat": "galleta", "totalMass": 1000, "units": 1, "merma": 0, "notes": "Instrucciones paso a paso\n​Mezclar: Batir la mantequilla con el azúcar hasta que esté cremosa. Incorporar el huevo, la vainilla y el descarte de masa madre.\n​Incorporar secos: Añadir la harina, el bicarbonato y la sal. Mezclar hasta obtener una masa homogénea.\n​Reposo: Refrigerar la masa por lo menos 30 minutos, idealmente varias horas o hasta 24 horas para mayor sabor.\n​Hornear: Precalentar el horno a 175°C (350°F). Formar bolitas y hornear durante 10-15 minutos.\n​Consejos para el éxito\n​No las sobre-hornees: Retirarlas cuando los bordes estén dorados pero el centro siga algo suave.\n​Uso del descarte: Puedes usar masa madre que no haya sido alimentada en 1-2 días.\n​Versión Crackers: También puedes hacer galletas saladas estirando la masa muy fina y horneando a 180°C por 8-10 minutos.", "flour": [{"pct": 100, "manualName": "Harina suave"}], "other": [{"pct": 66.66, "manualName": "Mantequilla"}, {"pct": 55.5, "manualName": "Azúcar"}, {"pct": 41.6, "manualName": "Descarte de mm"}, {"pct": 27.7, "manualName": "Huevo"}, {"pct": 2.7, "manualName": "Bicarbonato de sodio"}, {"pct": 2.7, "manualName": "Vainilla"}, {"pct": 1.1, "manualName": "Sal"}]}, {"id": "gm-101", "code": "GM-101", "name": "Pan camaleon 1", "cat": "pan", "totalMass": 1600, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 38, "manualName": "agua"}, {"pct": 30, "manualName": "azúcar"}, {"pct": 1, "manualName": "miel"}, {"pct": 10, "manualName": "mantequilla o manteca de cerdo"}, {"pct": 0.9, "manualName": "vainilla"}, {"pct": 0.9, "manualName": "canela o sarrapia"}, {"pct": 25, "manualName": "talvina"}, {"pct": 5, "manualName": "leche en polvo"}, {"pct": 1, "manualName": "sal"}, {"pct": 1, "manualName": "panela"}, {"pct": 5, "manualName": "huevos ligeramente batidos"}]}, {"id": "gm-102", "code": "GM-102", "name": "Pan camaleon 2", "cat": "pan", "totalMass": 545, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina de Trigo"}], "other": [{"pct": 32.98, "manualName": "agua"}, {"pct": 0.5, "manualName": "sal"}, {"pct": 4.8, "manualName": "huevos"}, {"pct": 7.47, "manualName": "Mantequilla"}, {"pct": 2.5, "manualName": "leche en polvo"}, {"pct": 35.5, "manualName": "azucar"}, {"pct": 1.5, "manualName": "Melao de papelon"}, {"pct": 0.51, "manualName": "papelón rallado"}, {"pct": 0.51, "manualName": "Miel"}, {"pct": 20.1, "manualName": "Talvina"}]}, {"id": "gm-103", "code": "GM-103", "name": "pan sandwich mm", "cat": "pan", "totalMass": 975, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "harina"}], "other": [{"pct": 20, "manualName": "mm joven"}, {"pct": 65, "manualName": "agua"}, {"pct": 4, "manualName": "miel"}, {"pct": 4, "manualName": "Aove"}, {"pct": 2, "manualName": "sal"}]}, {"id": "gm-104", "code": "GM-104", "name": "Pan del dia MM  500g", "cat": "masa", "totalMass": 3902, "units": 1, "merma": 0, "notes": "500 g neto por pieza masa 580", "flour": [{"pct": 90, "manualName": "Harina panadera"}, {"pct": 10, "manualName": "Harina integral"}], "other": [{"pct": 52, "manualName": "agua"}, {"pct": 20, "manualName": "masa madre 1 2 2"}, {"pct": 2, "manualName": "Sal"}]}, {"id": "gm-105", "code": "GM-105", "name": "masa madre 1 2 2.", "cat": "masa", "totalMass": 450, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 100, "manualName": "Agua"}, {"pct": 50, "manualName": "Starter"}]}, {"id": "gm-106", "code": "GM-106", "name": "Pan de coco", "cat": "pan", "totalMass": 1555, "units": 1, "merma": 0, "notes": "si se agrega mejorador es un 3%", "flour": [{"pct": 100, "manualName": "Harina Panadera"}], "other": [{"pct": 30, "manualName": "Azucar"}, {"pct": 5, "manualName": "Margarina"}, {"pct": 2, "manualName": "Levadura seca"}, {"pct": 50, "manualName": "Agua"}, {"pct": 1, "manualName": "Sal"}, {"pct": 15, "manualName": "Coco"}, {"pct": 2, "manualName": "Esencia de Coco"}]}, {"id": "gm-107", "code": "GM-107", "name": "Masa  brioche 1", "cat": "pan", "totalMass": 1000, "units": 1, "merma": 0, "notes": "", "flour": [{"pct": 100, "manualName": "Harina"}], "other": [{"pct": 7.2, "manualName": "Leche tibia"}, {"pct": 62.4, "manualName": "Huevos"}, {"pct": 40, "manualName": "Mantequilla o margarina"}, {"pct": 100, "manualName": "Azucar"}, {"pct": 2.4, "manualName": "Sal"}, {"pct": 1, "manualName": "Levadura dulce seca"}]}, {"id": "gm-108", "code": "GM-108", "name": "Pan molde masa madre aove", "cat": "masa", "totalMass": 970, "units": 1, "merma": 0, "notes": "molde 21x12x12\ncantidad 1134 de masa\nentra a horno casi pasando el molde\n3 battard para formado son 3 bloques\nmanejar más o menos 2.5 horas de fermentación\n\nsi hay plegado y autolisis", "flour": [{"pct": 100, "manualName": "Harina de pan"}], "other": [{"pct": 20, "manualName": "Agua"}, {"pct": 35, "manualName": "Leche"}, {"pct": 20, "manualName": "Masa madre"}, {"pct": 10, "manualName": "Aove"}, {"pct": 6, "manualName": "Azúcar morena"}, {"pct": 2, "manualName": "Sal"}, {"pct": 1, "manualName": "Levadura"}]}, {"id": "gm-109", "code": "GM-109", "name": "Pioneer Pan Masa Madre", "cat": "masa", "totalMass": 1000, "units": 1, "merma": 0, "notes": "este pan se le hacen pliegues pero se va desgasficando cada paso incluso al formar\npasa unos 3 horas en bloque y 3 a 4 en pieza", "flour": [{"pct": 100, "manualName": "harina"}], "other": [{"pct": 65, "manualName": "Agua"}, {"pct": 5, "manualName": "Starter"}, {"pct": 2, "manualName": "Sal"}]}],
  estados: ["Pedido", "En proceso", "Por entregar", "Pagado", "Entregado por pagar", "Colocado en recepción", "Por entregar prepagado", "En recepción pagado"],
  instrucciones: ["Rebanar", "Sin sal", "Bien horneado", "Sin corteza", "Sin rebanar", "Extra horneado"],
  margenDefault: 40,
  planProduccion: {},
  planLibre: {},
  gmRecipes: [],
  recetaPersonalActual: null,
  pedidosPan: [],
  pedidosGalletas: [],
  pedidosCom: [],
  clientesCache: [],
  preciosClienteCache: [],
  gastos: [],
  lastUpdated: '',
  lastUpdatedBy: ''
};

// ── INIT ─────────────────────────────────────────────────

function pmInit(moduleName, onReady) {
  // 1. Cargar desde localStorage (rápido, offline)
  const saved = localStorage.getItem(PM_LOCAL_KEY);
  if (saved) {
    try { G = JSON.parse(saved); } catch(e) { G = {}; }
  }
  // Asegurar todas las claves existen
  for (const key of Object.keys(SEED)) {
    if (G[key] === undefined) G[key] = JSON.parse(JSON.stringify(SEED[key]));
  }
  pmSaveLocal();
  // Load autosync preference — default ON
  const savedAutoSync = localStorage.getItem('pm_autosync');
  _autoSync = savedAutoSync === null ? true : savedAutoSync === '1';

  // 2. Si hay token GitHub: arrancar con datos locales, luego sincronizar en background
  if (pmToken() && pmGistId()) {
    if (onReady) onReady(); // Arrancar inmediatamente con localStorage
    setTimeout(() => pmPull(false).then(() => {
      // Refresh active tab after background pull
      const activeTab = document.querySelector('.page.on');
      if (activeTab) {
        const id = activeTab.id;
        try {
          if (id==='pg-dash')     dashRender();
          else if (id==='pg-pedidos')  ppRender();
          else if (id==='pg-galletas') pgRender();
          else if (id==='pg-rep')      repRender();
          else if (id==='pg-prod')     prodRenderConSb();
          else if (id==='pg-costeo')   { _sbCosteoCargar(); }
        } catch(e) {}
      }
    }), 1200);
  } else {
    if (onReady) onReady();
  }
}

function pmSaveLocal() {
  localStorage.setItem(PM_LOCAL_KEY, JSON.stringify(G));
}

function pmSave(moduleName) {
  G.lastUpdated = new Date().toISOString();
  G.lastUpdatedBy = moduleName || 'sistema';
  pmSaveLocal();
  // Auto-push: if token exists and autosync is on (default), push after 3s debounce
  if (pmToken() && pmGistId() && _autoSync) {
    clearTimeout(_pushTimer);
    _pushTimer = setTimeout(() => {
      pmPush(false).then(() => {
        localStorage.setItem('pm_last_save', new Date().toLocaleString('es-CR'));
      });
    }, 3000);
  }
}

async function pmPull(showFeedback=true) {
  const token = pmToken();
  const gistId = pmGistId();
  if (!token || !gistId) {
    if (showFeedback) pmToast('Configurá token y Gist ID en Maestros','err');
    return;
  }
  pmSyncStatus('⏳','Sincronizando...','descargando datos');
  try {
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const file = data.files[PM_GIST_FILE];
    if (!file) throw new Error('Archivo no encontrado en el Gist');
    const remote = JSON.parse(file.content);
    // Merge strategy:
    // 1. Remote data always wins for keys it has
    // 2. Keep local G values for keys remote doesn't have
    // 3. Never overwrite with SEED defaults during pull
    for (const key of Object.keys(remote)) {
      G[key] = remote[key];
    }
    // Restaurar flag si el Gist trae gmRecipes con datos
    if (Array.isArray(remote.gmRecipes) && remote.gmRecipes.length > 0) {
      G.gmRecipesLoaded = true;
    }
    // Ensure structural keys exist (but don't overwrite remote data)
    const structKeys = ['tiposPan','tiposGalleta','estados','instrucciones',
                        'pedidosPan','pedidosGalletas','pedidosCom','gastos','planProduccion','planLibre'];
    for (const key of structKeys) {
      if (G[key] === undefined) {
        G[key] = Array.isArray(SEED[key]) ? [] : (typeof SEED[key]==='object' ? {} : SEED[key]);
      }
    }
    pmSaveLocal();
    pmSyncStatus('✅','Sincronizado',`Última actualización: ${new Date().toLocaleString('es-CR')}`);
    if (showFeedback) pmToast('Datos cargados desde GitHub ✓');
  } catch(e) {
    pmSyncStatus('❌','Error de sincronización', e.message);
    if (showFeedback) pmToast('Error al cargar: ' + e.message, 'err');
  }
}

async function pmPush(showFeedback=true) {
  const token = pmToken();
  const gistId = pmGistId();
  if (!token || !gistId) {
    if (showFeedback) pmToast('Configurá token y Gist ID en Maestros','err');
    return;
  }
  pmSyncStatus('⏳','Guardando...','subiendo datos');
  try {
    // Push only operational data — not SEED defaults (ingredientes, gmRecipes base data)
    // This keeps the Gist lean and prevents overwriting with SEED on pull
    const pushData = {
      version:        G.version,
      lastUpdated:    G.lastUpdated,
      lastUpdatedBy:  G.lastUpdatedBy,
      tiposPan:       G.tiposPan       || [],
      tiposGalleta:   G.tiposGalleta   || [],
      estados:        G.estados        || [],
      instrucciones:  G.instrucciones  || [],
      ingredientes:   G.ingredientes   || {},
      recetas:        G.recetas        || [],
      planProduccion: G.planProduccion || {},
      planLibre:      G.planLibre      || {},
      pedidosPan:     G.pedidosPan     || [],
      pedidosGalletas:G.pedidosGalletas|| [],
      pedidosCom:     G.pedidosCom     || [],
      gastos:         G.gastos         || [],
    };
    // Include gmRecipes only if user explicitly loaded them (not the SEED default)
    if (G.gmRecipesLoaded) pushData.gmRecipes = G.gmRecipes;
    const body = { files: { [PM_GIST_FILE]: { content: JSON.stringify(pushData, null, 2) } } };
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pmSyncStatus('✅','Guardado',`${new Date().toLocaleString('es-CR')}`);
    if (showFeedback) pmToast('Datos guardados en GitHub ✓');
  } catch(e) {
    pmSyncStatus('❌','Error al guardar', e.message);
    if (showFeedback) pmToast('Error al guardar: ' + e.message, 'err');
  }
}


function pmToken() { return localStorage.getItem('pm_gist_token') || ''; }
function pmGistId() { return localStorage.getItem('pm_gist_id') || ''; }

function pmSyncDisconnect() {
  if (!confirm('¿Desconectar de GitHub? Los datos locales se mantienen.')) return;
  localStorage.removeItem('pm_gist_token');
  localStorage.removeItem('pm_gist_id');
  pmSyncUIRefresh();
  pmToast('Desconectado de GitHub');
}

function pmSyncStatus(icon, text, sub) {
  // Update status inside the rendered panel
  const el = document.getElementById('sync-status-line');
  if (el) el.innerHTML = `<span style="font-size:20px">${icon}</span>
    <div style="flex:1"><div style="font-weight:600">${text}</div>
    ${sub?`<div style="font-size:11px;color:var(--cream2)">${sub}</div>`:''}</div>`;
}

function pmSyncUIRefresh() {
  const el = document.getElementById('sync-estado-render');
  if (!el) return;
  const token  = pmToken();
  const gistId = pmGistId();
  const last   = localStorage.getItem('pm_last_save') || '';

  if (!token) {
    // NOT CONNECTED
    el.innerHTML = `
      <p style="font-size:13px;color:var(--cream2);margin-bottom:14px;line-height:1.6">
        Conectá tu GitHub Gist para guardar y sincronizar datos entre dispositivos.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <button class="btn btn-gold" onclick="syncMostrarForm()">⚙️ Configurar token</button>
        <button class="btn btn-out btn-sm" onclick="document.getElementById('sync-instr').style.display='block'">¿Cómo obtener el token?</button>
      </div>
      <div id="sync-form-inline" style="display:none;margin-top:12px;padding:12px;background:var(--bg3);border:1px solid var(--border);border-radius:8px">
        <label style="font-size:12px;color:var(--cream2);display:block;margin-bottom:6px">Token (empieza con ghp_...)</label>
        <input type="password" id="sync-token-input" placeholder="ghp_xxxxxxxxxxxx" autocomplete="off"
          style="width:100%;padding:8px 12px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream);font-size:13px;margin-bottom:10px">
        <div style="display:flex;gap:8px">
          <button class="btn btn-gold" onclick="syncDoConnect()">✓ Conectar</button>
          <button class="btn btn-out" onclick="document.getElementById('sync-form-inline').style.display='none'">Cancelar</button>
        </div>
      </div>`;
  } else {
    // CONNECTED
    el.innerHTML = `
      <div id="sync-status-line" style="display:flex;align-items:center;gap:12px;margin-bottom:14px;padding:10px;background:rgba(74,144,96,.1);border:1px solid rgba(74,144,96,.3);border-radius:8px">
        <span style="font-size:24px">✅</span>
        <div style="flex:1">
          <div style="font-weight:600;color:var(--cream)">Conectado a GitHub Gist</div>
          <div style="font-size:11px;color:var(--cream2)">${last ? 'Último guardado: ' + last : 'Sin sincronizar aún'}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <button class="btn btn-gold" onclick="syncGuardar()">⬆ Guardar en nube</button>
        <button class="btn btn-out" onclick="syncCargar()">⬇ Cargar desde nube</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding-top:10px;border-top:1px solid var(--border)">
        <label style="font-size:12px;display:flex;align-items:center;gap:5px;cursor:pointer">
          <input type="checkbox" id="pm-auto-toggle" onchange="pmAutoToggle(this.checked)" ${_autoSync?'checked':''}> Auto-guardado al modificar
        </label>
        <button class="btn btn-out btn-sm" onclick="syncMostrarForm()">✏️ Cambiar token</button>
        <button class="btn btn-red btn-sm" onclick="pmSyncDisconnect()">✕ Desconectar</button>
      </div>
      <div id="sync-form-inline" style="display:none;margin-top:12px;padding:12px;background:var(--bg3);border:1px solid var(--border);border-radius:8px">
        <label style="font-size:12px;color:var(--cream2);display:block;margin-bottom:6px">Nuevo token (ghp_...)</label>
        <input type="password" id="sync-token-input" placeholder="ghp_xxxxxxxxxxxx" autocomplete="off"
          style="width:100%;padding:8px 12px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream);font-size:13px;margin-bottom:10px">
        <div style="display:flex;gap:8px">
          <button class="btn btn-gold" onclick="syncDoConnect()">✓ Conectar</button>
          <button class="btn btn-out" onclick="document.getElementById('sync-form-inline').style.display='none'">Cancelar</button>
        </div>
      </div>`;
  }
}

function syncMostrarForm() {
  const f = document.getElementById('sync-form-inline');
  if (f) { f.style.display = 'block'; const t=document.getElementById('sync-token-input'); if(t) t.focus(); }
}

function syncGuardar() {
  pmPush(true).then(() => {
    localStorage.setItem('pm_last_save', new Date().toLocaleString('es-CR'));
    pmSyncUIRefresh();
  });
}

function syncCargar() {
  pmPull(true).then(() => {
    onDataLoaded();
    pmSyncUIRefresh();
  });
}

async function syncDoConnect() {
  const input = document.getElementById('sync-token-input');
  const token = input ? input.value.trim() : '';
  if (!token || !token.startsWith('ghp_')) {
    pmToast('El token debe empezar con ghp_', 'err'); return;
  }
  pmToast('Conectando...'); 
  try {
    const res = await fetch('https://api.github.com/gists', {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
    });
    if (!res.ok) throw new Error('Token inválido (HTTP ' + res.status + ')');
    const gists = await res.json();
    let gistId = '';
    const existing = gists.find(g => g.files && g.files[PM_GIST_FILE]);
    if (existing) {
      gistId = existing.id;
    } else {
      const cr = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ description:'PanMaestro backup', public:false, files:{ [PM_GIST_FILE]:{ content:JSON.stringify({version:PM_VERSION}) } } })
      });
      if (!cr.ok) throw new Error('No se pudo crear el Gist');
      gistId = (await cr.json()).id;
    }
    localStorage.setItem('pm_gist_token', token);
    localStorage.setItem('pm_gist_id', gistId);
    pmSyncUIRefresh();
    await pmPull(false);
    pmToast('☁️ Conectado ✓ — datos cargados');
  } catch(e) {
    pmToast('Error: ' + e.message, 'err');
  }
}

function pmAutoToggle(val) {
  _autoSync = val;
  localStorage.setItem('pm_autosync', val ? '1' : '0');
  pmToast(val ? 'Auto-guardado activado ✓' : '⚠ Auto-guardado desactivado — guardá manualmente');
}

function pmExport() {
  const blob = new Blob([JSON.stringify(G, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'panmaestro_backup_' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  pmToast('Backup descargado ✓');
}

function pmImport(input) {
  const file = input.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      Object.assign(G, data);
      pmSaveLocal();
      pmToast('Datos importados ✓');
      if (typeof onDataLoaded === 'function') onDataLoaded();
    } catch { pmToast('Error al leer el archivo', 'err'); }
  };
  r.readAsText(file);
}

function pmHoy() {
  // FIX SESIÓN 1 (E1): antes usaba new Date().toISOString().slice(0,10),
  // que convierte a UTC. Costa Rica es UTC-6, así que entre las 6:00pm
  // y medianoche hora local, toISOString() ya reportaba la fecha del
  // día siguiente. Se arma la fecha con getFullYear/getMonth/getDate,
  // que sí respetan la hora local del navegador.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function pmMoney(n) { return '₡' + Number(n||0).toLocaleString('es-CR'); }

// Escapa texto libre antes de insertarlo en innerHTML (nombres de cliente,
// notas, instrucciones, observaciones, etc.). Úsese en TODO texto que no
// haya sido escrito por el código mismo — cualquier dato que venga de un
// formulario (staff o cliente externo) o de Supabase debe pasar por acá
// antes de ir a un template literal que se asigna a innerHTML.
function pmEsc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// FIX D3: selector de método de pago — valores EXACTOS que acepta el
// constraint ventas_metodo_pago_check en Supabase (confirmado por SQL):
// 'efectivo' | 'sinpe' | 'transferencia' | 'otro'. No agregar otros
// valores acá sin antes confirmar que el constraint los acepta.
function pmMetodoPagoOpts(selected='efectivo') {
  const opts = [
    ['efectivo','Efectivo'], ['sinpe','SINPE'],
    ['transferencia','Transferencia'], ['otro','Otro']
  ];
  return opts.map(([v,label]) =>
    `<option value="${v}"${v===selected?' selected':''}>${label}</option>`).join('');
}

const DIAS   = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const MESES  = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const DIAS_L = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const MESES_L= ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

function pmFmtDate(d) {
  const x = new Date(d + 'T12:00:00');
  return `${DIAS[x.getDay()]} ${x.getDate()} ${MESES[x.getMonth()]}`;
}

function pmFmtDateShort(d) {
  if (!d) return '';
  const x = new Date(d + 'T12:00:00');
  return `${x.getDate()}/${x.getMonth()+1}`;
}

function pmId() { return Date.now() + Math.floor(Math.random()*1000); }


function pmBadge(st) {
  const idx = (G.estados||[]).indexOf(st);
  const cls = idx >= 0 ? `b${Math.min(idx,7)}` : 'b0';
  return `<span class="badge ${cls}">${st||'Pedido'}</span>`;
}

function pmGetPan(id) { return (G.tiposPan||[]).find(p => p.id === id); }
function pmGetGall(id) { return (G.tiposGalleta||[]).find(p => p.id === id); }

function pmNombrePan(id) { return pmGetPan(id)?.nombre || id; }
function pmNombreGall(id) { return pmGetGall(id)?.nombre || id; }

function pmPrecioPan(id) { return pmGetPan(id)?.precio || 0; }
function pmPrecioGall(id) { return pmGetGall(id)?.precio || 0; }

function pmTotalPan(ped) {
  return (ped.lineas||[]).reduce((s,l) => s + pmPrecioPan(l.pid) * (l.cant||1), 0);
}

function pmTotalGall(ped) {
  return (ped.lineas||[]).reduce((s,l) => s + pmPrecioGall(l.pid) * (l.cant||1), 0);
}

function pmTotalCom(ped) {
  // Punto 7 del plan de auditoría: si la línea ya trae el precio capturado
  // al momento del pedido (l.precio — como hacen ahora los pedidos
  // comerciales local-first), se usa ese directo. Antes esta función
  // siempre recalculaba desde el precio de catálogo actual + % de
  // descuento, lo que perdía precisión con clientes que tienen un precio
  // especial PLANO (no un % de descuento) — quedaba como respaldo para
  // líneas viejas que no traigan l.precio.
  return (ped.lineas||[]).reduce((s,l) => {
    if (l.precio != null) return s + l.precio * (l.cant||1);
    return s + pmPrecioPan(l.pid) * (1-(l.desc||0)/100) * (l.cant||1);
  }, 0);
}

function pmCostoReceta(r, targetMass, _visited, _cache) {
  // SESIÓN 11 — optimización: cachear por código+masa dentro de un mismo
  // repintado (cvMaestroRender/recRender llaman esto para cada receta, y
  // cada una puede recalcular las mismas sub-recetas una y otra vez).
  _cache = _cache || new Map();
  const _cacheKey = r.code ? (r.code + '|' + (targetMass || '')) : null;
  if (_cacheKey && _cache.has(_cacheKey)) return _cache.get(_cacheKey);

  // SESIÓN 11 fix crítico de estabilidad: si una receta se referencia a sí
  // misma (directa o indirectamente) como sub-receta/relleno, esto entraba
  // en recursión infinita y colgaba el navegador — la lista de Costeo se
  // veía "desaparecer" hasta forzar recarga. Ahora se corta el ciclo.
  _visited = _visited || new Set();
  if (r.code && _visited.has(r.code)) {
    console.warn('[pmCostoReceta] Ciclo detectado en receta', r.code, '— se corta la recursión');
    return { lines: [], total: 0, totalMerma: 0, perUnit: 0, mass: targetMass || r.totalMass || 1000, flourW: 0, units: r.units || 1 };
  }
  if (r.code) _visited = new Set([..._visited, r.code]);

  // Baker's percentage logic — guarded against division by zero and NaN
  const baseFlourPct = (r.flour||[]).reduce((a,i) => a + (parseFloat(i.pct)||0), 0);
  const otherPct     = (r.other||[]).reduce((a,i) => a + (parseFloat(i.pct)||0), 0);
  const subsPct      = (r.subrecs||[]).reduce((a,s) => s.gFijos > 0 ? 0 : (parseFloat(s.pct)||0) + a, 0);
  const totalPct     = baseFlourPct + otherPct + subsPct;

  // Guard: if no percentages defined, use totalMass as mass and flourW=1 to avoid NaN
  const baseMass = r.totalMass || 1000;
  const refMass  = targetMass || baseMass;

  let flourW;
  if (totalPct > 0) {
    flourW = refMass * 100 / totalPct;
  } else if (baseFlourPct === 0 && (r.flour||[]).length === 0) {
    // No flour defined — treat entire mass as base (e.g. pure sub-recipe)
    flourW = refMass;
  } else {
    flourW = refMass; // fallback
  }

  const mass = totalPct > 0 ? flourW * totalPct / 100 : refMass;

  let total = 0;
  const lines = [];

  // Flour ingredients
  for (const ing of (r.flour||[])) {
    const pct  = parseFloat(ing.pct)||0;
    const g    = flourW * pct / 100;
    // Fix rename: si la línea resuelve por ingredientId (o por nombre
    // exacto), mostrar el nombre ACTUAL del maestro — no el que quedó
    // guardado en la receta cuando se agregó la línea. Así renombrar un
    // ingrediente no deja nombres viejos "congelados" en las recetas.
    const i    = _sbResolveIng(ing);
    const name = i?.nombre || ing.productName || ing.manualName || '';
    const cpg  = i && i.price && i.qty ? i.price/i.qty : 0;
    const cost = cpg * g;
    total += cost;
    lines.push({ name, pct, g, cost, flour: true });
  }

  // Other ingredients (baker's % relative to flourW)
  for (const ing of (r.other||[])) {
    const pct  = parseFloat(ing.pct)||0;
    const g    = flourW * pct / 100;
    const i    = _sbResolveIng(ing);
    const name = i?.nombre || ing.productName || ing.manualName || '';
    const cpg  = i && i.price && i.qty ? i.price/i.qty : 0;
    const cost = cpg * g;
    total += cost;
    lines.push({ name, pct, g, cost, flour: false });
  }

  // Sub-recipes (baker's % relative to flourW, or fixed grams)
  for (const sub of (r.subrecs||[])) {
    // SESIÓN 11 fix: resolver SOLO por código (estable entre dispositivos).
    // Se quitó el respaldo al id local viejo — podía "coincidir" con el id
    // de OTRA receta distinta (colisión) y calcular costo mal, en silencio.
    // Mejor no resolver nada que resolver a la receta equivocada.
    const ref = (_sbRecLista()||[]).find(x => x.code === sub.recId);
    if (!ref) continue;
    let subMass = 0;
    if (sub.gFijos > 0) {
      subMass = sub.gFijos;             // absolute grams — does not scale
    } else if (sub.pct > 0) {
      subMass = flourW * sub.pct / 100; // baker's % relative to flour
    }
    if (subMass <= 0) continue;
    const subCost  = pmCostoReceta(ref, subMass, _visited, _cache);
    const subLabel = sub.label || ref.name;
    total += subCost.totalMerma;
    lines.push({ name: '🔗 ' + subLabel, pct: sub.pct||0, g: subMass, cost: subCost.totalMerma, flour: false, isSub: true });
  }

  // Addons: rellenos y coberturas — g por unidad × costo/g, NOT baker's %
  // Their grams DO sum to the total product weight (a golfeado IS masa + relleno)
  // FIX SESIÓN 2 (B1): el costo de addons se acumula en un acumulador
  // APARTE (addonCostTotal), NO en `total`. Antes se sumaba a `total` y
  // luego `total` completo (masa + addons) se multiplicaba por
  // (1 + merma/100) de la receta padre — así un addon (que ya trae su
  // propia merma incluida en `ca.totalMerma`) recibía la merma del padre
  // encima, inflando el costo de cualquier receta con relleno/cobertura.
  let addonMassTotal = 0;
  let addonCostTotal = 0;
  for (const addon of (r.addons||[])) {
    // SESIÓN 11 fix: resolver SOLO por código — mismo motivo que sub-recetas
    const ref = (_sbRecLista()||[]).find(x => x.code === addon.recId);
    if (!ref || !addon.gPorUnidad) continue;
    const units_r  = r.units || 1;
    const totalG   = addon.gPorUnidad * units_r;
    const ca       = pmCostoReceta(ref, totalG, _visited, _cache);
    const label    = addon.label || (addon.tipo === 'cobertura' ? '🍫 ' : '🍯 ') + ref.name;
    addonCostTotal += ca.totalMerma;
    addonMassTotal += totalG;
    lines.push({
      name: label, pct: 0, g: totalG,
      cost: ca.totalMerma, flour: false, isSub: false, isAddon: true,
      gPorUnidad: addon.gPorUnidad, tipo: addon.tipo
    });
  }

  const merma      = r.merma || 0;
  const massTotal  = mass + addonMassTotal; // full product weight including addons
  // Only masa ingredients (flour+other+subrecs, acumulados en `total`) get
  // merma aplicada; los addons ya están a su peso final y se suman después,
  // sin merma adicional.
  const totalMerma = total * (1 + merma / 100) + addonCostTotal;
  const units      = r.units || 1;
  const perUnit    = units > 0 ? totalMerma / units : 0;

  // Safety: replace any NaN/Infinity with 0
  const safe = v => (isFinite(v) && !isNaN(v)) ? v : 0;
  const _result = {
    lines,
    total:       safe(total),
    totalMerma:  safe(totalMerma),
    perUnit:     safe(perUnit),
    mass:        safe(massTotal),
    flourW:      safe(flourW),
    units
  };
  if (_cacheKey) _cache.set(_cacheKey, _result);
  return _result;
}

function pmToast(msg, type='ok') {
  const t = document.getElementById('pm-toast');
  if (!t) { console.warn('[pmToast] elemento #pm-toast no encontrado —', msg); return; }
  t.textContent = msg;
  t.className = 'pm-toast show ' + type;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.className = 'pm-toast'; }, 2600);
}

function mOpen(id) { document.getElementById(id).classList.add('open'); }
function mClose(id) { document.getElementById(id).classList.remove('open'); }

// ── Punto 5 del plan de auditoría — optimistic locking ──────────
// "Pantalla clásica" de conflicto: se llama cuando, al guardar, se
// detecta que el registro cambió en Supabase después de que se abrió
// para editar (otro dispositivo/pestaña/persona lo tocó primero).
// Reutilizable: cada llamador pasa su propio mensaje y qué hacer en
// cada botón — este helper solo maneja el modal en sí.
function pmMostrarConflicto(mensaje, onRecargar, onSobrescribir) {
  document.getElementById('m-conflicto-msg').textContent = mensaje;
  const btnRecargar = document.getElementById('m-conflicto-recargar');
  const btnSobrescribir = document.getElementById('m-conflicto-sobrescribir');
  // Reasignar onclick (no addEventListener) para no ir acumulando
  // handlers viejos de conflictos anteriores en la misma sesión.
  btnRecargar.onclick = () => { mClose('m-conflicto'); onRecargar && onRecargar(); };
  btnSobrescribir.onclick = () => { mClose('m-conflicto'); onSobrescribir && onSobrescribir(); };
  mOpen('m-conflicto');
}

function toggleBody(id) {
  const b = document.getElementById('pb-' + id);
  if (b) b.classList.toggle('open');
}
