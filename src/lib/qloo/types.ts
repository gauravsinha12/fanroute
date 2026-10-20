// Shapes returned by the Qloo API. The API documents only part of each
// response, so everything outside the identifying fields is optional and the
// parsers in api.ts read it defensively.

export type EntityType =
  | "urn:entity:artist"
  | "urn:entity:brand"
  | "urn:entity:destination"
  | "urn:entity:place"
  | "urn:entity:podcast"
  | "urn:entity:tv_show"
  | "urn:entity:movie"
  | "urn:entity:book"
  | "urn:entity:person"
  | "urn:entity:video_game";

export interface QlooTag {
  id: string;
  name: string;
  type?: string;
  parents?: { type: string }[];
}

export interface QlooEntity {
  entity_id: string;
  name: string;
  subtype?: string;
  type?: string;
  /** /search and /entities give a list of types instead of type/subtype. */
  types?: string[];
  popularity?: number;
  disambiguation?: string;
  /** WKT outline, returned for localities when a heatmap uses output.heatmap.boundary. */
  boundary?: string;
  location?: { lat?: number; lon?: number; lng?: number; geohash?: string };
  properties?: {
    description?: string;
    short_description?: string;
    address?: string;
    image?: { url?: string };
    geocode?: {
      name?: string;
      admin1_region?: string;
      admin2_region?: string;
      country_code?: string;
    };
    business_rating?: number;
    price_level?: number;
    websites?: string[];
    keywords?: { name: string; count?: number }[];
    [key: string]: unknown;
  };
  tags?: QlooTag[];
  query?: {
    affinity?: number;
    affinity_rank?: number;
    distance?: number;
    measurements?: Record<string, number>;
    [key: string]: unknown;
  };
  external?: Record<string, unknown>;
}

export interface QlooHeatmapPoint {
  location: { latitude: number; longitude: number; geohash?: string };
  name?: string;
  entity_id?: string;
  query: { affinity?: number; affinity_rank?: number; popularity?: number };
}

export interface QlooDemographics {
  entity_id: string;
  query: {
    age?: Record<string, number>;
    gender?: Record<string, number>;
  };
}

export interface QlooTrendPoint {
  date: string;
  population_percentile?: number;
  population_rank?: number | string;
  population_rank_velocity?: number;
  velocity_fold_change?: number;
  population_percent_delta?: number;
}

export interface QlooResponse {
  success?: boolean;
  results?: {
    entities?: QlooEntity[];
    heatmap?: QlooHeatmapPoint[];
    demographics?: QlooDemographics[];
    trending?: QlooTrendPoint[];
    tags?: QlooTag[];
    [key: string]: unknown;
  };
  query?: Record<string, unknown>;
  duration?: number;
}

export type QlooParams = Record<string, string | number | boolean | string[] | undefined>;
