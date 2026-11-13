/**
 * Site model (zod schemas + inferred types). Coordinates: projected CRS, US survey feet.
 * Elevations: feet (NAVD88).
 */
import { z } from 'zod';
import type { Grid } from '../geometry/grid';

export const PtSchema = z.tuple([z.number(), z.number()]);
export const RingSchema = z.array(PtSchema).min(3);

export const CrsSchema = z.object({
  epsg: z.number(),
  name: z.string(),
  units: z.literal('ftUS'),
  proj4: z.string(),
});

export const ProvenanceSchema = z.object({
  layer: z.string(),
  sourceUrl: z.string(),
  fetchedAt: z.string(),
  license: z.string(),
  notes: z.string(),
  synthetic: z.boolean().default(false),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const RoadSchema = z.object({
  id: z.string(),
  name: z.string(),
  ref: z.string().optional(),
  /** state = numbered state route; local = township road. */
  roadClass: z.enum(['state', 'local', 'private', 'other']),
  centerline: z.array(PtSchema).min(2),
  rowWidthFt: z.number().positive(),
  /** True when the ROW width is a class default rather than surveyed/recorded. */
  rowAssumed: z.boolean(),
});
export type Road = z.infer<typeof RoadSchema>;

export const DistrictKindSchema = z.enum(['industrial', 'residential', 'agricultural', 'commercial', 'other']);
export type DistrictKind = z.infer<typeof DistrictKindSchema>;
export const DistrictSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  kind: DistrictKindSchema,
  ring: RingSchema,
});
export type District = z.infer<typeof DistrictSchema>;

export const ConstraintSchema = z.object({
  id: z.string(),
  kind: z.enum(['wetland', 'floodplain', 'steepSlope', 'easement', 'manual']),
  name: z.string(),
  ring: RingSchema,
  /** Additional no-build buffer around the polygon, ft. */
  bufferFt: z.number().min(0).default(0),
  /** informational constraints are drawn but not subtracted from envelopes. */
  informational: z.boolean().default(false),
  source: z.string().default(''),
});
export type Constraint = z.infer<typeof ConstraintSchema>;

export const EdgeClassSchema = z.enum(['front', 'side', 'rear']);
export type EdgeClass = z.infer<typeof EdgeClassSchema>;

export const ParcelEdgeSchema = z.object({
  index: z.number().int(),
  a: PtSchema,
  b: PtSchema,
  lengthFt: z.number(),
  /** Compass direction the edge faces (outward normal), e.g. "N". */
  facing: z.string(),
  edgeClass: EdgeClassSchema,
  roadId: z.string().optional(),
  roadName: z.string().optional(),
  /** District on the far side of this edge (across the street for front edges). */
  adjacentDistrictCode: z.string().optional(),
  adjacentDistrictKind: DistrictKindSchema.optional(),
  abutsResidential: z.boolean(),
  acrossStreetFromResidential: z.boolean(),
  overridden: z.boolean().default(false),
});
export type ParcelEdge = z.infer<typeof ParcelEdgeSchema>;

export const AsBuiltSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['building', 'pavement', 'basin']),
  ring: RingSchema,
  note: z.string().default(''),
});
export type AsBuilt = z.infer<typeof AsBuiltSchema>;

export const TerrainMetaSchema = z.object({
  x0: z.number(),
  y0: z.number(),
  cellFt: z.number().positive(),
  nx: z.number().int().positive(),
  ny: z.number().int().positive(),
  source: z.string(),
  /** True when the terrain is generated (no network) rather than surveyed LiDAR. */
  synthetic: z.boolean(),
  /** True when the DEM was verified to pre-date site construction. */
  preDevelopment: z.boolean(),
  verticalDatum: z.string().default('NAVD88'),
  file: z.string().default('dem.f32'),
});
export type TerrainMeta = z.infer<typeof TerrainMetaSchema>;

export const ImagerySchema = z.object({
  available: z.boolean(),
  /** URL template served by the app, e.g. /api/site/imagery/{z}/{x}/{y}.jpg (Web Mercator XYZ). */
  tileUrl: z.string().optional(),
  minZoom: z.number().optional(),
  maxZoom: z.number().optional(),
  attribution: z.string().default(''),
});

/** The on-disk site fixture (site.json). */
export const SiteFixtureSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  jurisdiction: z.string(),
  crs: CrsSchema,
  synthetic: z.boolean(),
  parcel: z.object({
    id: z.string(),
    pin: z.string().optional(),
    ring: RingSchema,
    /** Area from the record source, when known (ac). */
    recordAreaAc: z.number().optional(),
  }),
  zoningDistrictCode: z.string(),
  /** Road the site address is on (primary frontage). */
  addressRoadName: z.string().optional(),
  roads: z.array(RoadSchema),
  districts: z.array(DistrictSchema),
  constraints: z.array(ConstraintSchema),
  asBuilt: z.array(AsBuiltSchema),
  terrain: TerrainMetaSchema,
  imagery: ImagerySchema,
  provenance: z.array(ProvenanceSchema),
});
export type SiteFixture = z.infer<typeof SiteFixtureSchema>;

/** Runtime site: fixture + DEM grid + derived edge classification. */
export type Site = SiteFixture & {
  areaSf: number;
  edges: ParcelEdge[];
  /** Existing-ground DEM. `data` is a Float32Array and is stored as a binary sidecar, never in JSON. */
  dem: Grid;
};
