/** Canvas palettes (CAD-like). Kept in JS because canvas cannot read CSS variables cheaply. */
export type Palette = {
  bg: string;
  grid: string;
  gridMajor: string;
  text: string;
  textDim: string;
  halo: string;
  parcel: string;
  road: string;
  roadEdge: string;
  roadLabel: string;
  setback: string;
  envelopeFill: string;
  building: string;
  buildingStroke: string;
  truck: string;
  apron: string;
  car: string;
  stripe: string;
  landscape: string;
  basin: string;
  basinStroke: string;
  wetland: string;
  flood: string;
  constraint: string;
  asBuilt: string;
  contourMinor: string;
  contourIndex: string;
  propMinor: string;
  propIndex: string;
  selection: string;
  wall: string;
  truckNet: string;
  carNet: string;
  ada: string;
  district: Record<string, string>;
};

export const DARK: Palette = {
  bg: '#111418',
  grid: '#191e25',
  gridMajor: '#212833',
  text: '#d7dde5',
  textDim: '#8793a1',
  halo: 'rgba(17,20,24,0.85)',
  parcel: '#ffffff',
  road: '#262c35',
  roadEdge: '#3a424e',
  roadLabel: '#aab4c0',
  setback: '#e8a33d',
  envelopeFill: 'rgba(232,163,61,0.05)',
  building: '#c9ced6',
  buildingStroke: '#f2f4f7',
  truck: '#474d56',
  apron: '#5a6069',
  car: '#6a717b',
  stripe: 'rgba(235,238,242,0.55)',
  landscape: '#4f7a56',
  basin: 'rgba(47,111,176,0.55)',
  basinStroke: '#5fa0e0',
  wetland: 'rgba(63,182,168,0.28)',
  flood: 'rgba(80,140,220,0.18)',
  constraint: '#3fb6a8',
  asBuilt: '#d67ad2',
  contourMinor: 'rgba(150,126,94,0.62)',
  contourIndex: 'rgba(176,146,106,0.85)',
  propMinor: 'rgba(230,225,214,0.5)',
  propIndex: 'rgba(245,240,228,0.95)',
  selection: '#4cc2ff',
  wall: '#ff5d5d',
  truckNet: '#e0823d',
  carNet: '#5cc8a0',
  ada: '#4c8dff',
  district: { residential: '#d9b46a', agricultural: '#7fae6a', commercial: '#d77b6f', industrial: '#9b8cc4', other: '#8793a1' },
};

export const LIGHT: Palette = {
  ...DARK,
  bg: '#f4f5f7',
  grid: '#e9ebee',
  gridMajor: '#dcdfe4',
  text: '#1c2128',
  textDim: '#5d6875',
  halo: 'rgba(244,245,247,0.88)',
  parcel: '#111418',
  road: '#d9dce1',
  roadEdge: '#b9bec6',
  roadLabel: '#4a5461',
  setback: '#b8730f',
  envelopeFill: 'rgba(184,115,15,0.05)',
  building: '#8f97a3',
  buildingStroke: '#2a2f37',
  truck: '#b3b8c0',
  apron: '#c6cad1',
  car: '#cfd3d9',
  stripe: 'rgba(40,46,54,0.45)',
  landscape: '#8dbb92',
  contourMinor: 'rgba(122,96,62,0.4)',
  contourIndex: 'rgba(122,96,62,0.85)',
  propMinor: 'rgba(40,46,54,0.45)',
  propIndex: 'rgba(20,24,30,0.9)',
};
