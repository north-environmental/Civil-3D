/**
 * Minimal DXF writer, AutoCAD 2010 format (AC1024), model space only.
 * Units: US survey feet in the site CRS (state plane). Layers follow AIA-style names (SPEC §8).
 * Entities: LWPOLYLINE (with elevation for contours), LINE, TEXT.
 */
import type { Pt } from '../geometry/basic';

export type DxfLayer = { name: string; color: number; linetype?: 'Continuous' | 'DASHED' };

export class DxfWriter {
  private ents: string[] = [];
  private handle = 0x100;
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;
  counts: Record<string, number> = {};

  constructor(private layers: DxfLayer[]) {}

  private h(): string {
    return (this.handle++).toString(16).toUpperCase();
  }
  private extend(p: Pt): void {
    if (p[0] < this.minX) this.minX = p[0];
    if (p[1] < this.minY) this.minY = p[1];
    if (p[0] > this.maxX) this.maxX = p[0];
    if (p[1] > this.maxY) this.maxY = p[1];
  }
  private count(layer: string): void {
    if (!this.layers.some((l) => l.name === layer)) throw new Error(`DXF layer ${layer} is not declared`);
    this.counts[layer] = (this.counts[layer] ?? 0) + 1;
  }
  private n(v: number): string {
    return (Math.round(v * 1000) / 1000).toString();
  }

  polyline(layer: string, pts: Pt[], closed: boolean, elevationFt?: number): void {
    if (pts.length < 2) return;
    this.count(layer);
    const out = ['0', 'LWPOLYLINE', '5', this.h(), '330', '1F', '100', 'AcDbEntity', '8', layer, '100', 'AcDbPolyline', '90', String(pts.length), '70', closed ? '1' : '0', '43', '0'];
    if (elevationFt !== undefined) out.push('38', this.n(elevationFt));
    for (const p of pts) {
      out.push('10', this.n(p[0]), '20', this.n(p[1]));
      this.extend(p);
    }
    this.ents.push(out.join('\n'));
  }
  line(layer: string, a: Pt, b: Pt): void {
    this.count(layer);
    this.ents.push(['0', 'LINE', '5', this.h(), '330', '1F', '100', 'AcDbEntity', '8', layer, '100', 'AcDbLine', '10', this.n(a[0]), '20', this.n(a[1]), '30', '0', '11', this.n(b[0]), '21', this.n(b[1]), '31', '0'].join('\n'));
    this.extend(a);
    this.extend(b);
  }
  text(layer: string, at: Pt, heightFt: number, text: string, rotationDeg = 0): void {
    this.count(layer);
    // DXF text is single-line ASCII; keep it printable.
    const clean = text
      .replace(/[\r\n]+/g, ' ')
      .replace(/×/g, 'x')
      .replace(/[·•]/g, '-')
      .replace(/[–—]/g, '-')
      .replace(/§/g, 'Sec. ')
      .replace(/≥/g, '>=')
      .replace(/≤/g, '<=')
      .replace(/[^\x20-\x7E]/g, '');
    this.ents.push(['0', 'TEXT', '5', this.h(), '330', '1F', '100', 'AcDbEntity', '8', layer, '100', 'AcDbText', '10', this.n(at[0]), '20', this.n(at[1]), '30', '0', '40', this.n(heightFt), '1', clean, '50', this.n(rotationDeg), '7', 'Standard', '100', 'AcDbText'].join('\n'));
    this.extend(at);
  }

  toString(): string {
    const L: string[] = [];
    const p = (...v: (string | number)[]) => L.push(...v.map(String));
    const ext = Number.isFinite(this.minX) ? [this.minX, this.minY, this.maxX, this.maxY] : [0, 0, 100, 100];
    const cx = (ext[0] + ext[2]) / 2;
    const cy = (ext[1] + ext[3]) / 2;
    const height = Math.max(100, (ext[3] - ext[1]) * 1.1);

    p(0, 'SECTION', 2, 'HEADER');
    p(9, '$ACADVER', 1, 'AC1024');
    p(9, '$DWGCODEPAGE', 3, 'ANSI_1252');
    p(9, '$INSBASE', 10, 0, 20, 0, 30, 0);
    p(9, '$EXTMIN', 10, this.n(ext[0]), 20, this.n(ext[1]), 30, 0);
    p(9, '$EXTMAX', 10, this.n(ext[2]), 20, this.n(ext[3]), 30, 0);
    p(9, '$INSUNITS', 70, 2); // 2 = feet
    p(9, '$MEASUREMENT', 70, 0); // imperial
    p(9, '$LUNITS', 70, 2, 9, '$LUPREC', 70, 2);
    p(9, '$HANDSEED', 5, (this.handle + 0x100).toString(16).toUpperCase());
    p(0, 'ENDSEC');

    p(0, 'SECTION', 2, 'CLASSES', 0, 'ENDSEC');

    p(0, 'SECTION', 2, 'TABLES');
    // VPORT
    p(0, 'TABLE', 2, 'VPORT', 5, 8, 330, 0, 100, 'AcDbSymbolTable', 70, 1);
    p(0, 'VPORT', 5, 29, 330, 8, 100, 'AcDbSymbolTableRecord', 100, 'AcDbViewportTableRecord', 2, '*ACTIVE', 70, 0);
    p(10, 0, 20, 0, 11, 1, 21, 1, 12, this.n(cx), 22, this.n(cy), 13, 0, 23, 0, 14, 10, 24, 10, 15, 10, 25, 10, 16, 0, 26, 0, 36, 1, 17, 0, 27, 0, 37, 0);
    p(40, this.n(height), 41, 1.6, 42, 50, 43, 0, 44, 0, 50, 0, 51, 0, 71, 0, 72, 100, 73, 1, 74, 3, 75, 0, 76, 0, 77, 0, 78, 0);
    p(0, 'ENDTAB');
    // LTYPE
    p(0, 'TABLE', 2, 'LTYPE', 5, 5, 330, 0, 100, 'AcDbSymbolTable', 70, 4);
    p(0, 'LTYPE', 5, 14, 330, 5, 100, 'AcDbSymbolTableRecord', 100, 'AcDbLinetypeTableRecord', 2, 'ByBlock', 70, 0, 3, '', 72, 65, 73, 0, 40, 0);
    p(0, 'LTYPE', 5, 15, 330, 5, 100, 'AcDbSymbolTableRecord', 100, 'AcDbLinetypeTableRecord', 2, 'ByLayer', 70, 0, 3, '', 72, 65, 73, 0, 40, 0);
    p(0, 'LTYPE', 5, 16, 330, 5, 100, 'AcDbSymbolTableRecord', 100, 'AcDbLinetypeTableRecord', 2, 'Continuous', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, 0);
    p(0, 'LTYPE', 5, 17, 330, 5, 100, 'AcDbSymbolTableRecord', 100, 'AcDbLinetypeTableRecord', 2, 'DASHED', 70, 0, 3, 'Dashed __ __ __', 72, 65, 73, 2, 40, 30, 49, 20, 74, 0, 49, -10, 74, 0);
    p(0, 'ENDTAB');
    // LAYER
    p(0, 'TABLE', 2, 'LAYER', 5, 2, 330, 0, 100, 'AcDbSymbolTable', 70, this.layers.length + 1);
    p(0, 'LAYER', 5, 10, 330, 2, 100, 'AcDbSymbolTableRecord', 100, 'AcDbLayerTableRecord', 2, '0', 70, 0, 62, 7, 6, 'Continuous', 370, -3, 390, 'F');
    this.layers.forEach((l, i) => {
      p(0, 'LAYER', 5, (0x40 + i).toString(16).toUpperCase(), 330, 2, 100, 'AcDbSymbolTableRecord', 100, 'AcDbLayerTableRecord', 2, l.name, 70, 0, 62, l.color, 6, l.linetype ?? 'Continuous', 370, -3, 390, 'F');
    });
    p(0, 'ENDTAB');
    // STYLE
    p(0, 'TABLE', 2, 'STYLE', 5, 3, 330, 0, 100, 'AcDbSymbolTable', 70, 1);
    p(0, 'STYLE', 5, 11, 330, 3, 100, 'AcDbSymbolTableRecord', 100, 'AcDbTextStyleTableRecord', 2, 'Standard', 70, 0, 40, 0, 41, 1, 50, 0, 71, 0, 42, 2.5, 3, 'txt', 4, '');
    p(0, 'ENDTAB');
    p(0, 'TABLE', 2, 'VIEW', 5, 6, 330, 0, 100, 'AcDbSymbolTable', 70, 0, 0, 'ENDTAB');
    p(0, 'TABLE', 2, 'UCS', 5, 7, 330, 0, 100, 'AcDbSymbolTable', 70, 0, 0, 'ENDTAB');
    p(0, 'TABLE', 2, 'APPID', 5, 9, 330, 0, 100, 'AcDbSymbolTable', 70, 1);
    p(0, 'APPID', 5, 12, 330, 9, 100, 'AcDbSymbolTableRecord', 100, 'AcDbRegAppTableRecord', 2, 'ACAD', 70, 0);
    p(0, 'ENDTAB');
    p(0, 'TABLE', 2, 'DIMSTYLE', 5, 'A', 330, 0, 100, 'AcDbSymbolTable', 70, 1, 100, 'AcDbDimStyleTable');
    p(0, 'DIMSTYLE', 105, 27, 330, 'A', 100, 'AcDbSymbolTableRecord', 100, 'AcDbDimStyleTableRecord', 2, 'Standard', 70, 0);
    p(0, 'ENDTAB');
    p(0, 'TABLE', 2, 'BLOCK_RECORD', 5, 1, 330, 0, 100, 'AcDbSymbolTable', 70, 2);
    p(0, 'BLOCK_RECORD', 5, '1F', 330, 1, 100, 'AcDbSymbolTableRecord', 100, 'AcDbBlockTableRecord', 2, '*Model_Space', 340, 0);
    p(0, 'BLOCK_RECORD', 5, '1B', 330, 1, 100, 'AcDbSymbolTableRecord', 100, 'AcDbBlockTableRecord', 2, '*Paper_Space', 340, 0);
    p(0, 'ENDTAB');
    p(0, 'ENDSEC');

    p(0, 'SECTION', 2, 'BLOCKS');
    p(0, 'BLOCK', 5, 20, 330, '1F', 100, 'AcDbEntity', 8, '0', 100, 'AcDbBlockBegin', 2, '*Model_Space', 70, 0, 10, 0, 20, 0, 30, 0, 3, '*Model_Space', 1, '');
    p(0, 'ENDBLK', 5, 21, 330, '1F', 100, 'AcDbEntity', 8, '0', 100, 'AcDbBlockEnd');
    p(0, 'BLOCK', 5, '1C', 330, '1B', 100, 'AcDbEntity', 67, 1, 8, '0', 100, 'AcDbBlockBegin', 2, '*Paper_Space', 70, 0, 10, 0, 20, 0, 30, 0, 3, '*Paper_Space', 1, '');
    p(0, 'ENDBLK', 5, '1D', 330, '1B', 100, 'AcDbEntity', 67, 1, 8, '0', 100, 'AcDbBlockEnd');
    p(0, 'ENDSEC');

    p(0, 'SECTION', 2, 'ENTITIES');
    L.push(...this.ents);
    p(0, 'ENDSEC');

    p(0, 'SECTION', 2, 'OBJECTS');
    p(0, 'DICTIONARY', 5, 'C', 330, 0, 100, 'AcDbDictionary', 281, 1, 3, 'ACAD_GROUP', 350, 'D');
    p(0, 'DICTIONARY', 5, 'D', 330, 'C', 100, 'AcDbDictionary', 281, 1);
    p(0, 'ENDSEC');
    p(0, 'EOF');
    return L.join('\n') + '\n';
  }
}

/** AIA-style layers used by the export (SPEC §8), with AutoCAD color indexes. */
export const DXF_LAYERS: DxfLayer[] = [
  { name: 'C-PROP', color: 7 },
  { name: 'C-SETB', color: 40, linetype: 'DASHED' },
  { name: 'C-BLDG', color: 7 },
  { name: 'C-TRCK', color: 30 },
  { name: 'C-ROAD', color: 9 },
  { name: 'C-ROAD-EXST', color: 8 },
  { name: 'C-PKNG', color: 9 },
  { name: 'C-PKNG-STRP', color: 8 },
  { name: 'C-STRM-BSIN', color: 5 },
  { name: 'C-WETL', color: 132 },
  { name: 'C-LSCP', color: 94 },
  { name: 'C-WALL', color: 1 },
  { name: 'C-TOPO-EXST-MINR', color: 37 },
  { name: 'C-TOPO-EXST-MAJR', color: 34 },
  { name: 'C-TOPO-PROP-MINR', color: 253 },
  { name: 'C-TOPO-PROP-MAJR', color: 7 },
  { name: 'C-ANNO', color: 2 },
];
