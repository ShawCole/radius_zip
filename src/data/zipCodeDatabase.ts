// Auto-generated comprehensive US zip code database
// Generated from 33099 zip codes with full demographic data
// Source: uszips.csv - comprehensive US postal code database

export interface ZipCodeData {
  zipCode: string;
  city: string;
  state: string;
  stateName: string;
  lat: number;
  lng: number;
  population: number;
  density: number;
  countyName: string;
  imprecise: boolean;
  military: boolean;
  timezone: string;
}

export interface DatabaseStats {
  totalZipCodes: number;
  generatedAt: string;
  avgPopulation: number;
  totalPopulation: number;
  states: number;
  counties: number;
}

export interface ZipCodeDatabase {
  zipCodes: ZipCodeData[];
  stats: DatabaseStats;
}

// Load data from JSON file
let cachedData: ZipCodeDatabase | null = null;

export async function loadZipCodeDatabase(): Promise<ZipCodeDatabase> {
  if (cachedData) {
    return cachedData;
  }
  
  const response = await fetch('/data/zipCodeDatabase.json');
  if (!response.ok) {
    throw new Error('Failed to load zip code database');
  }
  
  cachedData = await response.json();
  return cachedData;
}

// Legacy exports for backwards compatibility
export let zipCodeDatabase: ZipCodeData[] = [];
export let databaseStats: DatabaseStats = {
  totalZipCodes: 0,
  generatedAt: '',
  avgPopulation: 0,
  totalPopulation: 0,
  states: 0,
  counties: 0
};

// Initialize data on module load
loadZipCodeDatabase().then(data => {
  zipCodeDatabase = data.zipCodes;
  databaseStats = data.stats;
}).catch(console.error);
