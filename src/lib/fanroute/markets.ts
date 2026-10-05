// Touring markets Fanroute can route through. Coordinates are city centres and
// populations are approximate metro sizes in millions, used only to estimate a
// show's ceiling; fan affinity itself always comes from Qloo.

export type Region = "north-america" | "europe";

export interface Market {
  id: string;
  name: string;
  query: string; // locality name Qloo resolves with filter.location.query
  country: string;
  region: Region;
  lat: number;
  lon: number;
  metroMillions: number;
}

const m = (
  id: string,
  name: string,
  country: string,
  region: Region,
  lat: number,
  lon: number,
  metroMillions: number,
  query = name,
): Market => ({ id, name, query, country, region, lat, lon, metroMillions });

export const MARKETS: Market[] = [
  m("nyc", "New York", "US", "north-america", 40.7128, -74.006, 19.5, "New York City"),
  m("la", "Los Angeles", "US", "north-america", 34.0522, -118.2437, 12.8),
  m("chi", "Chicago", "US", "north-america", 41.8781, -87.6298, 9.3),
  m("dal", "Dallas", "US", "north-america", 32.7767, -96.797, 8.1),
  m("hou", "Houston", "US", "north-america", 29.7604, -95.3698, 7.5),
  m("dc", "Washington", "US", "north-america", 38.9072, -77.0369, 6.3, "Washington, D.C."),
  m("phl", "Philadelphia", "US", "north-america", 39.9526, -75.1652, 6.2),
  m("atl", "Atlanta", "US", "north-america", 33.749, -84.388, 6.3),
  m("mia", "Miami", "US", "north-america", 25.7617, -80.1918, 6.1),
  m("bos", "Boston", "US", "north-america", 42.3601, -71.0589, 4.9),
  m("phx", "Phoenix", "US", "north-america", 33.4484, -112.074, 5.0),
  m("sf", "San Francisco", "US", "north-america", 37.7749, -122.4194, 4.6),
  m("det", "Detroit", "US", "north-america", 42.3314, -83.0458, 4.3),
  m("sea", "Seattle", "US", "north-america", 47.6062, -122.3321, 4.0),
  m("msp", "Minneapolis", "US", "north-america", 44.9778, -93.265, 3.7),
  m("sd", "San Diego", "US", "north-america", 32.7157, -117.1611, 3.3),
  m("tpa", "Tampa", "US", "north-america", 27.9506, -82.4572, 3.3),
  m("den", "Denver", "US", "north-america", 39.7392, -104.9903, 3.0),
  m("bal", "Baltimore", "US", "north-america", 39.2904, -76.6122, 2.8),
  m("stl", "St. Louis", "US", "north-america", 38.627, -90.1994, 2.8),
  m("orl", "Orlando", "US", "north-america", 28.5383, -81.3792, 2.8),
  m("clt", "Charlotte", "US", "north-america", 35.2271, -80.8431, 2.8),
  m("sat", "San Antonio", "US", "north-america", 29.4241, -98.4936, 2.6),
  m("pdx", "Portland", "US", "north-america", 45.5152, -122.6784, 2.5, "Portland, Oregon"),
  m("aus", "Austin", "US", "north-america", 30.2672, -97.7431, 2.5),
  m("sac", "Sacramento", "US", "north-america", 38.5816, -121.4944, 2.4),
  m("pit", "Pittsburgh", "US", "north-america", 40.4406, -79.9959, 2.4),
  m("lv", "Las Vegas", "US", "north-america", 36.1699, -115.1398, 2.3),
  m("cin", "Cincinnati", "US", "north-america", 39.1031, -84.512, 2.3),
  m("kc", "Kansas City", "US", "north-america", 39.0997, -94.5786, 2.2),
  m("cmh", "Columbus", "US", "north-america", 39.9612, -82.9988, 2.2, "Columbus, Ohio"),
  m("ind", "Indianapolis", "US", "north-america", 39.7684, -86.1581, 2.1),
  m("cle", "Cleveland", "US", "north-america", 41.4993, -81.6944, 2.1),
  m("rdu", "Raleigh", "US", "north-america", 35.7796, -78.6382, 2.1),
  m("nash", "Nashville", "US", "north-america", 36.1627, -86.7816, 2.0),
  m("mke", "Milwaukee", "US", "north-america", 43.0389, -87.9065, 1.6),
  m("okc", "Oklahoma City", "US", "north-america", 35.4676, -97.5164, 1.4),
  m("ric", "Richmond", "US", "north-america", 37.5407, -77.436, 1.3, "Richmond, Virginia"),
  m("slc", "Salt Lake City", "US", "north-america", 40.7608, -111.891, 1.3),
  m("lou", "Louisville", "US", "north-america", 38.2527, -85.7585, 1.3),
  m("mem", "Memphis", "US", "north-america", 35.1495, -90.049, 1.3),
  m("bhm", "Birmingham", "US", "north-america", 33.5186, -86.8104, 1.1, "Birmingham, Alabama"),
  m("tus", "Tucson", "US", "north-america", 32.2226, -110.9747, 1.1),
  m("nola", "New Orleans", "US", "north-america", 29.9511, -90.0715, 1.0),
  m("oma", "Omaha", "US", "north-america", 41.2565, -95.9345, 1.0),
  m("abq", "Albuquerque", "US", "north-america", 35.0844, -106.6504, 0.9),
  m("boi", "Boise", "US", "north-america", 43.615, -116.2023, 0.8),
  m("msn", "Madison", "US", "north-america", 43.0731, -89.4012, 0.7, "Madison, Wisconsin"),
  m("avl", "Asheville", "US", "north-america", 35.5951, -82.5515, 0.5),
  m("tor", "Toronto", "CA", "north-america", 43.6532, -79.3832, 6.7),
  m("mtl", "Montreal", "CA", "north-america", 45.5017, -73.5673, 4.3),
  m("van", "Vancouver", "CA", "north-america", 49.2827, -123.1207, 2.6),

  m("lon", "London", "GB", "europe", 51.5074, -0.1278, 9.6),
  m("man", "Manchester", "GB", "europe", 53.4808, -2.2426, 2.9),
  m("bhx", "Birmingham", "GB", "europe", 52.4862, -1.8904, 2.9, "Birmingham, England"),
  m("lds", "Leeds", "GB", "europe", 53.8008, -1.5491, 1.9),
  m("gla", "Glasgow", "GB", "europe", 55.8642, -4.2518, 1.8),
  m("brs", "Bristol", "GB", "europe", 51.4545, -2.5879, 0.7),
  m("dub", "Dublin", "IE", "europe", 53.3498, -6.2603, 1.5),
  m("par", "Paris", "FR", "europe", 48.8566, 2.3522, 11.1),
  m("ams", "Amsterdam", "NL", "europe", 52.3676, 4.9041, 2.5),
  m("bru", "Brussels", "BE", "europe", 50.8503, 4.3517, 2.1),
  m("ber", "Berlin", "DE", "europe", 52.52, 13.405, 3.6),
  m("ham", "Hamburg", "DE", "europe", 53.5511, 9.9937, 1.9),
  m("cgn", "Cologne", "DE", "europe", 50.9375, 6.9603, 1.1),
  m("muc", "Munich", "DE", "europe", 48.1351, 11.582, 1.5),
  m("cph", "Copenhagen", "DK", "europe", 55.6761, 12.5683, 1.4),
  m("sto", "Stockholm", "SE", "europe", 59.3293, 18.0686, 1.7),
  m("osl", "Oslo", "NO", "europe", 59.9139, 10.7522, 1.1),
  m("bcn", "Barcelona", "ES", "europe", 41.3874, 2.1686, 5.6),
  m("mad", "Madrid", "ES", "europe", 40.4168, -3.7038, 6.7),
  m("lis", "Lisbon", "PT", "europe", 38.7223, -9.1393, 2.9),
  m("mil", "Milan", "IT", "europe", 45.4642, 9.19, 3.2),
  m("vie", "Vienna", "AT", "europe", 48.2082, 16.3738, 1.9),
  m("prg", "Prague", "CZ", "europe", 50.0755, 14.4378, 1.3),
  m("waw", "Warsaw", "PL", "europe", 52.2297, 21.0122, 1.8),
  m("zrh", "Zurich", "CH", "europe", 47.3769, 8.5417, 1.4),
];

export const MARKETS_BY_ID = new Map(MARKETS.map((market) => [market.id, market]));

// Bounding polygons (WKT, lon lat) used for region-wide locality heatmaps.
export const REGION_WKT: Record<Region, string> = {
  "north-america": "POLYGON((-125 24,-66 24,-66 50,-125 50,-125 24))",
  europe: "POLYGON((-11 35,25 35,25 61,-11 61,-11 35))",
};

export function marketsIn(region: Region): Market[] {
  return MARKETS.filter((market) => market.region === region);
}

export function findMarket(text: string): Market | undefined {
  const needle = text.trim().toLowerCase();
  return (
    MARKETS_BY_ID.get(needle) ??
    MARKETS.find((market) => market.name.toLowerCase() === needle) ??
    MARKETS.find((market) => market.query.toLowerCase() === needle) ??
    MARKETS.find((market) => needle.startsWith(market.name.toLowerCase()))
  );
}
