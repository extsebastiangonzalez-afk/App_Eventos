# Extrae (solo lectura) las partes XML necesarias de los Master para las pruebas locales.
# Nunca extrae la hoja "Control". Uso: python -I tests/dump_master_xml.py <carpeta_destino_vacia>
import zipfile, sys, os
B="G:/.shortcut-targets-by-id/1PnIjeF9jZRT5wM_yLKfPurxgz9DehHl4/VENTAS/SELL-OUT/"
out=sys.argv[1]
want={"EAN MASTER Master.xlsx":("ean",["xl/workbook.xml","xl/_rels/workbook.xml.rels","xl/sharedStrings.xml","xl/worksheets/sheet2.xml"]),
      "PDV MASTER Master.xlsx":("pdv",["xl/workbook.xml","xl/_rels/workbook.xml.rels","xl/sharedStrings.xml","xl/worksheets/sheet2.xml","xl/worksheets/sheet3.xml","xl/worksheets/sheet10.xml"])}
for f,(p,names) in want.items():
    z=zipfile.ZipFile(B+f)   # opened read-only
    for n in names:
        open(os.path.join(out,p+"__"+n.replace("/","_")),"wb").write(z.read(n))
print(sorted(os.listdir(out)))
