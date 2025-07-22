import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Copy, MapPin } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { loadZipCodeDatabase, type ZipCodeData, type DatabaseStats } from '@/data/zipCodeDatabase.ts';

const MapContainer = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const mapRefs = useRef<(HTMLDivElement | null)[]>([]);
  const maps = useRef<(mapboxgl.Map | null)[]>([]);
  const [mapboxToken] = useState(import.meta.env.VITE_MAPBOX_TOKEN || 'pk.eyJ1Ijoic2hhd2NvbGUiLCJhIjoiY21jcm95bzhnMHR4aDJqcTB5bm8zZTVhYSJ9.5t0L7sw1yXB8erVH-Lbg');
  const [seedZipCodes, setSeedZipCodes] = useState('');
  const [radius, setRadius] = useState([10]);
  const [foundZipCodes, setFoundZipCodes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [seedCoordinates, setSeedCoordinates] = useState<Array<{ zipCode: string; lat: number; lng: number }>>([]);
  const [mapSplit, setMapSplit] = useState<{
    useSingleMap: boolean;
    angle?: number;
    splitPercentage?: number;
    distance: number;
    clusters?: Array<Array<{ zipCode: string; lat: number; lng: number }>>;
  } | null>(null);
  const [forceViewportMode, setForceViewportMode] = useState<'auto' | 'single' | 'split'>('auto');
  const [zipCodeDatabase, setZipCodeDatabase] = useState<ZipCodeData[]>([]);
  const [databaseStats, setDatabaseStats] = useState<DatabaseStats>({
    totalZipCodes: 0,
    generatedAt: '',
    avgPopulation: 0,
    totalPopulation: 0,
    states: 0,
    counties: 0
  });
  const { toast } = useToast();

  // Load zip code database on component mount
  useEffect(() => {
    const loadDatabase = async () => {
      try {
        const data = await loadZipCodeDatabase();
        setZipCodeDatabase(data.zipCodes);
        setDatabaseStats(data.stats);
      } catch (error) {
        console.error('Failed to load zip code database:', error);
        toast({
          title: "Database Error",
          description: "Failed to load zip code database. Please refresh the page.",
          variant: "destructive"
        });
      }
    };

    loadDatabase();
  }, [toast]);

  // Helper function to cluster nearby seeds
  const clusterNearbySeeds = (seeds: Array<{ zipCode: string; lat: number; lng: number }>, maxDistance: number) => {
    const clusters: Array<Array<{ zipCode: string; lat: number; lng: number }>> = [];
    const used = new Set<number>();

    for (let i = 0; i < seeds.length; i++) {
      if (used.has(i)) continue;

      const cluster = [seeds[i]];
      used.add(i);

      // Find all other seeds within maxDistance of any seed in this cluster
      let changed = true;
      while (changed) {
        changed = false;
        for (let j = 0; j < seeds.length; j++) {
          if (used.has(j)) continue;

          // Check if this seed is close to any seed in the current cluster
          const isClose = cluster.some(clusterSeed => {
            const distance = calculateDistance(
              seeds[j].lat, seeds[j].lng,
              clusterSeed.lat, clusterSeed.lng
            );
            return distance <= maxDistance;
          });

          if (isClose) {
            cluster.push(seeds[j]);
            used.add(j);
            changed = true;
          }
        }
      }

      clusters.push(cluster);
    }

    return clusters;
  };

  // Helper function to get maximum distance within a cluster
  const getMaxDistanceInCluster = (cluster: Array<{ zipCode: string; lat: number; lng: number }>) => {
    let maxDistance = 0;
    for (let i = 0; i < cluster.length; i++) {
      for (let j = i + 1; j < cluster.length; j++) {
        const distance = calculateDistance(
          cluster[i].lat, cluster[i].lng,
          cluster[j].lat, cluster[j].lng
        );
        maxDistance = Math.max(maxDistance, distance);
      }
    }
    return maxDistance;
  };

  // Helper function to get the center point of a cluster
  const getClusterCenter = (cluster: Array<{ zipCode: string; lat: number; lng: number }>) => {
    const avgLat = cluster.reduce((sum, seed) => sum + seed.lat, 0) / cluster.length;
    const avgLng = cluster.reduce((sum, seed) => sum + seed.lng, 0) / cluster.length;
    return { lat: avgLat, lng: avgLng };
  };

  // Calculate the split line for multiple viewports
  const calculateViewportSplit = (seeds: Array<{ zipCode: string; lat: number; lng: number }>, overrideMode?: 'auto' | 'single' | 'split') => {
    if (seeds.length === 0) return null;

    // Use override mode if provided, otherwise use state
    const currentMode = overrideMode || forceViewportMode;

    // Handle single seed case
    if (seeds.length === 1) {
      return { useSingleMap: true, distance: 0 };
    }

    // Handle multiple seeds case
    if (seeds.length > 2) {
      // For 3+ seeds, check if user wants single map
      if (currentMode === 'single') {
        return { useSingleMap: true, distance: 0 };
      }

      // For auto mode with 3+ seeds, use intelligent clustering
      if (currentMode === 'auto') {
        // Cluster seeds that are within 30 miles of each other
        const clusters = clusterNearbySeeds(seeds, 30);

        // If all seeds form one cluster, use single map
        if (clusters.length === 1) {
          const maxDistance = getMaxDistanceInCluster(clusters[0]);
          return { useSingleMap: true, distance: maxDistance };
        }

        // If exactly 2 clusters, use split view
        if (clusters.length === 2) {
          // Calculate distance between cluster centers for display
          const center1 = getClusterCenter(clusters[0]);
          const center2 = getClusterCenter(clusters[1]);
          const distance = calculateDistance(center1.lat, center1.lng, center2.lat, center2.lng);

          return {
            useSingleMap: false,
            angle: 0, // Will be calculated if needed
            splitPercentage: 50,
            distance,
            clusters // Pass clusters for rendering
          };
        }
      }

      // Otherwise use grid view (no split calculation needed)
      return { useSingleMap: false, distance: 0 };
    }

    // Handle exactly 2 seeds
    const [seed1, seed2] = seeds;
    const distance = calculateDistance(seed1.lat, seed1.lng, seed2.lat, seed2.lng);

    // Check manual override first
    if (currentMode === 'single') {
      return { useSingleMap: true, distance };
    }

    if (currentMode === 'split') {
      const dx = seed2.lng - seed1.lng;
      const dy = seed2.lat - seed1.lat;

      // Calculate angle of line between seeds
      const angle = Math.atan2(dy, dx);

      // Perpendicular angle (rotate 90 degrees)
      const perpAngle = angle + Math.PI / 2;

      // Convert to degrees for CSS transform
      const angleDegrees = (perpAngle * 180) / Math.PI;

      return {
        useSingleMap: false,
        angle: angleDegrees,
        splitPercentage: 50, // Split in half
        distance
      };
    }

    // Auto mode - use distance-based logic
    if (distance < 30) {
      return { useSingleMap: true, distance };
    }

    const dx = seed2.lng - seed1.lng;
    const dy = seed2.lat - seed1.lat;

    // Calculate angle of line between seeds
    const angle = Math.atan2(dy, dx);

    // Perpendicular angle (rotate 90 degrees)
    const perpAngle = angle + Math.PI / 2;

    // Convert to degrees for CSS transform
    const angleDegrees = (perpAngle * 180) / Math.PI;

    return {
      useSingleMap: false,
      angle: angleDegrees,
      splitPercentage: 50, // Split in half
      distance
    };
  };

  // Initialize maps for clusters (intelligent split viewport)
  const initializeClusterMaps = (clusters: Array<Array<{ zipCode: string; lat: number; lng: number }>>) => {
    // Clean up existing maps safely
    maps.current.forEach(map => {
      if (map && typeof map.remove === 'function') {
        try {
          map.remove();
        } catch (error) {
          console.warn('Error removing map:', error);
        }
      }
    });
    maps.current = [];

    clusters.forEach((cluster, clusterIndex) => {
      const container = mapRefs.current[clusterIndex];
      if (!container || !mapboxToken) return;

      // Calculate center of cluster
      const clusterCenter = getClusterCenter(cluster);

      const newMap = new mapboxgl.Map({
        container: container,
        style: 'mapbox://styles/mapbox/light-v11',
        center: [clusterCenter.lng, clusterCenter.lat],
        zoom: 9 // Initial zoom, will be adjusted after visualization
      });

      newMap.addControl(new mapboxgl.NavigationControl(), 'top-right');
      maps.current[clusterIndex] = newMap;

      // Add labels for all seeds in this cluster
      newMap.on('load', () => {
        const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

        cluster.forEach((seed, seedIndex) => {
          const colorIndex = (clusterIndex * 4 + seedIndex) % colors.length;
          const color = colors[colorIndex];

          newMap.addSource(`cluster-${clusterIndex}-seed-${seedIndex}`, {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: { zipCode: seed.zipCode },
              geometry: {
                type: 'Point',
                coordinates: [seed.lng, seed.lat]
              }
            }
          });

          newMap.addLayer({
            id: `cluster-${clusterIndex}-label-${seedIndex}`,
            type: 'symbol',
            source: `cluster-${clusterIndex}-seed-${seedIndex}`,
            layout: {
              'text-field': ['get', 'zipCode'],
              'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
              'text-size': 14,
              'text-offset': [0, 0],
              'text-anchor': 'center'
            },
            paint: {
              'text-color': color,
              'text-halo-color': '#ffffff',
              'text-halo-width': 2
            }
          });
        });
      });
    });
  };

  // Initialize maps for each seed (split viewport)
  const initializeMaps = (seeds: Array<{ zipCode: string; lat: number; lng: number }>) => {
    // Clean up existing maps safely
    maps.current.forEach(map => {
      if (map && typeof map.remove === 'function') {
        try {
          map.remove();
        } catch (error) {
          console.warn('Error removing map:', error);
        }
      }
    });
    maps.current = [];

    seeds.forEach((seed, index) => {
      const container = mapRefs.current[index];
      if (!container || !mapboxToken) return;

      const newMap = new mapboxgl.Map({
        container: container,
        style: 'mapbox://styles/mapbox/light-v11',
        center: [seed.lng, seed.lat],
        zoom: 9 // Initial zoom, will be adjusted after visualization
      });

      newMap.addControl(new mapboxgl.NavigationControl(), 'top-right');
      maps.current[index] = newMap;

      // Add seed label only (no large marker dot)
      newMap.on('load', () => {
        const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
        const color = colors[index % colors.length];

        newMap.addSource(`seed-marker-${index}`, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: { zipCode: seed.zipCode },
            geometry: {
              type: 'Point',
              coordinates: [seed.lng, seed.lat]
            }
          }
        });

        newMap.addLayer({
          id: `seed-label-${index}`,
          type: 'symbol',
          source: `seed-marker-${index}`,
          layout: {
            'text-field': ['get', 'zipCode'],
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-size': 14,
            'text-offset': [0, 0],
            'text-anchor': 'center'
          },
          paint: {
            'text-color': color,
            'text-halo-color': '#ffffff',
            'text-halo-width': 2
          }
        });
      });
    });
  };

  // Calculate appropriate zoom level and bounds to show all circles completely
  const calculateMapBounds = (seeds: Array<{ zipCode: string; lat: number; lng: number }>, radiusInMiles: number) => {
    if (seeds.length === 0) return null;

    // Convert radius from miles to degrees (approximate)
    const radiusInDegrees = radiusInMiles / 69; // Rough conversion: 1 degree ≈ 69 miles

    // Find the bounding box that includes all circles
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    seeds.forEach(seed => {
      // Each circle extends radius in all directions from the seed
      minLat = Math.min(minLat, seed.lat - radiusInDegrees);
      maxLat = Math.max(maxLat, seed.lat + radiusInDegrees);
      minLng = Math.min(minLng, seed.lng - radiusInDegrees);
      maxLng = Math.max(maxLng, seed.lng + radiusInDegrees);
    });

    // Add some padding (10% of the range)
    const latRange = maxLat - minLat;
    const lngRange = maxLng - minLng;
    const padding = 0.1;

    return {
      bounds: [
        [minLng - lngRange * padding, minLat - latRange * padding], // Southwest
        [maxLng + lngRange * padding, maxLat + latRange * padding]  // Northeast
      ],
      center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2]
    };
  };

  // Initialize single map for close seeds
  const initializeSingleMap = (seeds: Array<{ zipCode: string; lat: number; lng: number }>) => {
    // Clean up existing maps safely
    maps.current.forEach(map => {
      if (map && typeof map.remove === 'function') {
        try {
          map.remove();
        } catch (error) {
          console.warn('Error removing map:', error);
        }
      }
    });
    maps.current = [];

    const container = mapRefs.current[0];
    if (!container || !mapboxToken) return;

    // Calculate center point and appropriate zoom
    const avgLat = seeds.reduce((sum, seed) => sum + seed.lat, 0) / seeds.length;
    const avgLng = seeds.reduce((sum, seed) => sum + seed.lng, 0) / seeds.length;

    const newMap = new mapboxgl.Map({
      container: container,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [avgLng, avgLat],
      zoom: 9 // Initial zoom, will be adjusted after visualization
    });

    newMap.addControl(new mapboxgl.NavigationControl(), 'top-right');
    maps.current[0] = newMap;

    // Add labels for all seeds (no large marker dots)
    newMap.on('load', () => {
      const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

      seeds.forEach((seed, index) => {
        const color = colors[index % colors.length];

        newMap.addSource(`seed-marker-${index}`, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: { zipCode: seed.zipCode },
            geometry: {
              type: 'Point',
              coordinates: [seed.lng, seed.lat]
            }
          }
        });

        newMap.addLayer({
          id: `seed-label-${index}`,
          type: 'symbol',
          source: `seed-marker-${index}`,
          layout: {
            'text-field': ['get', 'zipCode'],
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-size': 14,
            'text-offset': [0, 0],
            'text-anchor': 'center'
          },
          paint: {
            'text-color': color,
            'text-halo-color': '#ffffff',
            'text-halo-width': 2
          }
        });
      });
    });
  };

  // Initialize default map centered on US
  const initializeDefaultMap = () => {
    // Clean up existing maps safely
    maps.current.forEach(map => {
      if (map && typeof map.remove === 'function') {
        try {
          map.remove();
        } catch (error) {
          console.warn('Error removing map:', error);
        }
      }
    });
    maps.current = [];

    const container = mapRefs.current[0];
    if (!container || !mapboxToken) return;

    const newMap = new mapboxgl.Map({
      container: container,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-98.5795, 39.8283], // Center of US
      zoom: 4
    });

    newMap.addControl(new mapboxgl.NavigationControl(), 'top-right');
    maps.current[0] = newMap;
  };

  // Function to get coordinates for a zip code using Mapbox Geocoding API
  const getZipCodeCoordinates = async (zipCode: string): Promise<{ lat: number; lng: number } | null> => {
    // First try to find coordinates in local database
    const localResult = zipCodeDatabase.find(z => z.zipCode === zipCode);
    if (localResult) {
      return { lat: localResult.lat, lng: localResult.lng };
    }

    // If not found locally, fall back to Mapbox API
    try {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(zipCode)}.json?access_token=${mapboxToken}&types=postcode&country=US`
      );

      if (!response.ok) {
        throw new Error('Geocoding request failed');
      }

      const data = await response.json();

      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center;
        return { lat, lng };
      }

      return null;
    } catch (error) {
      console.error('Error geocoding zip code:', error);
      return null;
    }
  };

  // Calculate distance between two points in miles
  const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Update map to fit all radius circles completely
  const fitMapToCircles = (seeds: Array<{ zipCode: string; lat: number; lng: number }>, radiusInMiles: number) => {
    if (seeds.length === 0) return;

    const bounds = calculateMapBounds(seeds, radiusInMiles);
    if (!bounds) return;

    console.log(`Fitting map to show all circles for radius: ${radiusInMiles} miles`);
    const split = calculateViewportSplit(seeds);

    if (split && split.useSingleMap) {
      // Single map - fit to show all circles
      const mapInstance = maps.current[0];
      if (mapInstance && mapInstance.isStyleLoaded()) {
        console.log(`Single map: fitting bounds`, bounds.bounds);
        mapInstance.fitBounds(bounds.bounds as [[number, number], [number, number]], {
          padding: 50,
          duration: 800,
          essential: true
        });
      } else if (mapInstance) {
        // If map isn't loaded yet, wait and try again
        mapInstance.on('styledata', () => fitMapToCircles(seeds, radiusInMiles));
      }
    } else {
      // Multiple maps - fit each to its seeds/cluster
      const split = calculateViewportSplit(seeds);

      if (split && split.clusters && split.clusters.length === 2) {
        // Cluster-based split view - fit each map to its cluster
        maps.current.forEach((mapInstance, clusterIndex) => {
          if (mapInstance && mapInstance.isStyleLoaded() && split.clusters![clusterIndex]) {
            const clusterSeeds = split.clusters![clusterIndex];
            const clusterBounds = calculateMapBounds(clusterSeeds, radiusInMiles);
            if (clusterBounds) {
              console.log(`Cluster ${clusterIndex}: fitting bounds for ${clusterSeeds.map(s => s.zipCode).join(', ')}`, clusterBounds.bounds);
              mapInstance.fitBounds(clusterBounds.bounds as [[number, number], [number, number]], {
                padding: 30,
                duration: 800,
                essential: true
              });
            }
          } else if (mapInstance) {
            mapInstance.on('styledata', () => fitMapToCircles(seeds, radiusInMiles));
          }
        });
      } else {
        // Individual seed maps - fit each to its individual circle
        maps.current.forEach((mapInstance, index) => {
          if (mapInstance && mapInstance.isStyleLoaded() && seeds[index]) {
            const individualBounds = calculateMapBounds([seeds[index]], radiusInMiles);
            if (individualBounds) {
              console.log(`Map ${index}: fitting bounds for ${seeds[index].zipCode}`, individualBounds.bounds);
              mapInstance.fitBounds(individualBounds.bounds as [[number, number], [number, number]], {
                padding: 30,
                duration: 800,
                essential: true
              });
            }
          } else if (mapInstance) {
            // If map isn't loaded yet, wait and try again
            mapInstance.on('styledata', () => fitMapToCircles(seeds, radiusInMiles));
          }
        });
      }
    }
  };

  // Add radius visualization and found zip codes to map(s)
  const addRadiusVisualization = (seeds: Array<{ zipCode: string; lat: number; lng: number }>, radiusInMiles: number, foundZips: Array<ZipCodeData>) => {
    const radiusInKm = radiusInMiles * 1.60934;
    const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

    // Create circle using proper geographic calculation
    const createCircle = (center: [number, number], radiusInKm: number, points: number = 64) => {
      const coords = [];
      const earthRadius = 6371; // Earth's radius in km

      for (let i = 0; i < points; i++) {
        const angle = (i * 360) / points * Math.PI / 180;

        // Convert to radians
        const lat1 = center[1] * Math.PI / 180;
        const lng1 = center[0] * Math.PI / 180;

        // Calculate new position
        const lat2 = Math.asin(
          Math.sin(lat1) * Math.cos(radiusInKm / earthRadius) +
          Math.cos(lat1) * Math.sin(radiusInKm / earthRadius) * Math.cos(angle)
        );

        const lng2 = lng1 + Math.atan2(
          Math.sin(angle) * Math.sin(radiusInKm / earthRadius) * Math.cos(lat1),
          Math.cos(radiusInKm / earthRadius) - Math.sin(lat1) * Math.sin(lat2)
        );

        coords.push([lng2 * 180 / Math.PI, lat2 * 180 / Math.PI]);
      }
      coords.push(coords[0]); // Close the circle
      return coords;
    };

    maps.current.forEach((mapInstance, mapIndex) => {
      if (!mapInstance) return;

      // Remove existing visualization layers
      const layersToRemove = ['radius-circles', 'zip-markers', 'zip-labels'];
      layersToRemove.forEach(layerId => {
        if (mapInstance.getLayer(layerId)) {
          mapInstance.removeLayer(layerId);
        }
      });
      const sourcesToRemove = ['radius-circles', 'zip-markers'];
      sourcesToRemove.forEach(sourceId => {
        if (mapInstance.getSource(sourceId)) {
          mapInstance.removeSource(sourceId);
        }
      });

      // Add radius circles for all seeds
      const circleFeatures = seeds.map((seed, index) => {
        const color = colors[index % colors.length];
        const circleCoords = createCircle([seed.lng, seed.lat], radiusInKm);

        return {
          type: 'Feature' as const,
          properties: {
            seedZip: seed.zipCode,
            color: color,
            seedIndex: index
          },
          geometry: {
            type: 'Polygon' as const,
            coordinates: [circleCoords]
          }
        };
      });

      mapInstance.addSource('radius-circles', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: circleFeatures
        }
      });

      mapInstance.addLayer({
        id: 'radius-circles',
        type: 'line',
        source: 'radius-circles',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
          'line-opacity': 0.8
        }
      });

      // Add found zip code markers
      if (foundZips.length > 0) {
        const zipMarkers = {
          type: 'FeatureCollection' as const,
          features: foundZips.map(zipData => ({
            type: 'Feature' as const,
            properties: {
              zipCode: zipData.zipCode,
              population: zipData.population
            },
            geometry: {
              type: 'Point' as const,
              coordinates: [zipData.lng, zipData.lat]
            }
          }))
        };

        mapInstance.addSource('zip-markers', {
          type: 'geojson',
          data: zipMarkers
        });

        mapInstance.addLayer({
          id: 'zip-markers',
          type: 'circle',
          source: 'zip-markers',
          paint: {
            'circle-radius': 4,
            'circle-color': '#ef4444',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1,
            'circle-opacity': 0.8
          }
        });

        mapInstance.addLayer({
          id: 'zip-labels',
          type: 'symbol',
          source: 'zip-markers',
          layout: {
            'text-field': ['get', 'zipCode'],
            'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
            'text-size': 8,
            'text-offset': [0, 1.2],
            'text-anchor': 'top'
          },
          paint: {
            'text-color': '#1f2937',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1
          }
        });
      }
    });
  };

  // Handle viewport mode changes
  const handleViewportModeChange = (newMode: 'auto' | 'single' | 'split') => {
    setForceViewportMode(newMode);

    // Re-initialize maps if we have seed coordinates
    if (seedCoordinates.length > 0) {
      // Pass the new mode directly to avoid state update timing issues
      const split = calculateViewportSplit(seedCoordinates, newMode);
      setMapSplit(split);

      setTimeout(() => {
        if (split && split.useSingleMap) {
          initializeSingleMap(seedCoordinates);
        } else if (split && split.clusters && split.clusters.length === 2) {
          // Use cluster-based split view for 2 clusters
          initializeClusterMaps(split.clusters);
        } else {
          // Use individual maps for each seed (grid view or regular split)
          initializeMaps(seedCoordinates);
        }

        // Re-add visualization if we have found zip codes
        if (foundZipCodes.length > 0) {
          const zipCodesInRadius = foundZipCodes.map(zipCode =>
            zipCodeDatabase.find(z => z.zipCode === zipCode)!
          ).filter(Boolean);

          setTimeout(() => {
            addRadiusVisualization(seedCoordinates, radius[0], zipCodesInRadius);
            // Fit map to show all circles immediately after adding visualization
            fitMapToCircles(seedCoordinates, radius[0]);
          }, 300);
        }
      }, 50);
    } else {
      // If no seeds, just initialize default map
      setTimeout(() => {
        initializeDefaultMap();
      }, 100);
    }
  };

  useEffect(() => {
    if (!mapboxToken) return;
    mapboxgl.accessToken = mapboxToken;

    // Use the comprehensive database instead of hardcoded entries - log once
    console.log(`📊 Using comprehensive database with ${databaseStats.totalZipCodes} zip codes covering ${databaseStats.states} states`);

    // Only initialize default map when there are no seeds and no existing maps
    if (seedCoordinates.length === 0 && maps.current.length === 0) {
      initializeDefaultMap();
    }

    return () => {
      maps.current.forEach(map => {
        if (map && typeof map.remove === 'function') {
          try {
            map.remove();
          } catch (error) {
            console.warn('Error removing map in cleanup:', error);
          }
        }
      });
      maps.current = [];
    };
  }, [mapboxToken]);

  // Note: Zoom updates are now only triggered by Search button and viewport mode changes
  // The radius slider itself does not change zoom - only affects the search results

  const handleSearch = async () => {
    if (!seedZipCodes.trim() || !mapboxToken) {
      toast({
        title: "Missing Information",
        description: "Please enter at least one zip code.",
        variant: "destructive"
      });
      return;
    }

    if (zipCodeDatabase.length === 0) {
      toast({
        title: "Database Loading",
        description: "Zip code database is still loading. Please wait a moment and try again.",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);

    try {
      // Parse multiple zip codes
      const zipCodeList = seedZipCodes.split(',').map(zip => zip.trim()).filter(zip => zip.length > 0);

      if (zipCodeList.length === 0) {
        toast({
          title: "Invalid Input",
          description: "Please enter valid zip codes separated by commas.",
          variant: "destructive"
        });
        setIsLoading(false);
        return;
      }

      // Get coordinates for all seed zip codes
      const newSeedCoordinates = [];
      for (const zipCode of zipCodeList) {
        const coords = await getZipCodeCoordinates(zipCode);
        if (coords) {
          newSeedCoordinates.push({ zipCode, ...coords });
        } else {
          toast({
            title: "Zip Code Not Found",
            description: `Zip code ${zipCode} could not be located. Continuing with others...`,
            variant: "destructive"
          });
        }
      }

      if (newSeedCoordinates.length === 0) {
        toast({
          title: "No Valid Zip Codes",
          description: "None of the entered zip codes could be located.",
          variant: "destructive"
        });
        setIsLoading(false);
        return;
      }

      // Update seed coordinates state
      setSeedCoordinates(newSeedCoordinates);

      // Calculate viewport split for 2 seeds
      const split = calculateViewportSplit(newSeedCoordinates);
      setMapSplit(split);

      // Find zip codes within radius of each seed
      const radiusInMiles = radius[0];
      const allFoundZipCodes = new Set<string>();
      const zipCodeDetails = new Map<string, ZipCodeData>();

      newSeedCoordinates.forEach(seedCoord => {
        const zipCodesForThisSeed = zipCodeDatabase.filter(zipData => {
          const distance = calculateDistance(
            seedCoord.lat, seedCoord.lng,
            zipData.lat, zipData.lng
          );
          return distance <= radiusInMiles;
        });

        zipCodesForThisSeed.forEach(zipData => {
          allFoundZipCodes.add(zipData.zipCode);
          zipCodeDetails.set(zipData.zipCode, zipData);
        });
      });

      // Convert to array for further processing
      const zipCodesInRadius = Array.from(allFoundZipCodes).map(zipCode => zipCodeDetails.get(zipCode)!);

      setFoundZipCodes(zipCodesInRadius.map(z => z.zipCode));

      // Initialize maps based on distance between seeds
      setTimeout(() => {
        if (split && split.useSingleMap) {
          initializeSingleMap(newSeedCoordinates);
        } else if (split && split.clusters && split.clusters.length === 2) {
          // Use cluster-based split view for 2 clusters
          initializeClusterMaps(split.clusters);
        } else {
          // Use individual maps for each seed (grid view or regular split)
          initializeMaps(newSeedCoordinates);
        }

        // Add radius visualization after maps are loaded
        setTimeout(() => {
          addRadiusVisualization(newSeedCoordinates, radiusInMiles, zipCodesInRadius);
          // Fit map to show all circles immediately after adding visualization
          fitMapToCircles(newSeedCoordinates, radiusInMiles);
        }, 300);
      }, 50);

      // Calculate total population of found zip codes
      const totalPopulation = zipCodesInRadius.reduce((sum, zip) => sum + zip.population, 0);

      toast({
        title: "Search Complete!",
        description: `Found ${zipCodesInRadius.length} zip codes within ${radiusInMiles} miles of ${newSeedCoordinates.length} seed${newSeedCoordinates.length > 1 ? 's' : ''} (${totalPopulation.toLocaleString()} people)`,
      });

    } catch (error) {
      console.error('Search error:', error);
      toast({
        title: "Search Error",
        description: "An error occurred while searching. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const copyZipCodes = () => {
    const zipCodeString = foundZipCodes.join(', ');
    navigator.clipboard.writeText(zipCodeString).then(() => {
      toast({
        title: "Copied!",
        description: "Zip codes copied to clipboard."
      });
    });
  };

  if (!mapboxToken) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Mapbox Configuration Error
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-gray-600">
                Mapbox token is not configured. Please check your environment variables.
              </p>
              <p className="text-xs text-gray-500 mt-2">
                Make sure VITE_MAPBOX_TOKEN is set in your .env file.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <div className="w-80 bg-white shadow-lg flex flex-col h-full overflow-y-auto">
        <div className="p-6 border-b">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Zip Code Radius Tool</h1>
          <p className="text-gray-600 text-sm">Find ALL zip codes within a radius of one or more seed locations</p>
          <p className="text-gray-500 text-xs mt-1">
            Comprehensive database: {databaseStats.totalZipCodes.toLocaleString()} zip codes across {databaseStats.states} states
          </p>
          <p className="text-gray-500 text-xs">
            Population: {databaseStats.totalPopulation.toLocaleString()} people
          </p>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <Label htmlFor="seed-zips">Seed Zip Codes</Label>
            <Input
              id="seed-zips"
              placeholder="Enter zip codes separated by commas (e.g., 10001, 60601, 90210)"
              value={seedZipCodes}
              onChange={(e) => setSeedZipCodes(e.target.value)}
              className="mt-1"
            />
            <p className="text-xs text-gray-500 mt-1">
              Multiple seeds: NYC (10001), Chicago (60601), LA (90210) or single: Miami (33101)
            </p>
          </div>

          <div>
            <Label>Radius: {radius[0]} miles</Label>
            <Slider
              value={radius}
              onValueChange={setRadius}
              max={50}
              min={1}
              step={1}
              className="mt-2"
            />
          </div>

          <div>
            <Label>Viewport Mode</Label>
            <RadioGroup
              value={forceViewportMode}
              onValueChange={handleViewportModeChange}
              className="mt-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="auto" id="auto" />
                <Label htmlFor="auto" className="text-sm">Auto (distance-based)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="single" id="single" />
                <Label htmlFor="single" className="text-sm">Single Map</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="split" id="split" />
                <Label htmlFor="split" className="text-sm">Split View</Label>
              </div>
            </RadioGroup>
            <p className="text-xs text-gray-500 mt-1">
              {forceViewportMode === 'auto' ? 'Split view for seeds >30 miles apart' :
                forceViewportMode === 'single' ? 'Always use single combined map' :
                  'Always use split territorial view'}
            </p>
          </div>

          <Button
            onClick={handleSearch}
            disabled={isLoading || !seedZipCodes.trim()}
            className="w-full"
          >
            {isLoading ? 'Searching all zip codes...' : 'Search'}
          </Button>
        </div>

        {foundZipCodes.length > 0 && (
          <div className="p-6 pt-0">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Found Zip Codes ({foundZipCodes.length})</CardTitle>
                <p className="text-sm text-gray-600">
                  Seeds: {seedZipCodes} | Total Population: {zipCodeDatabase.filter(z => foundZipCodes.includes(z.zipCode)).reduce((sum, z) => sum + z.population, 0).toLocaleString()}
                </p>
              </CardHeader>
              <CardContent>
                <div className="bg-gray-50 px-2 py-2 rounded-md mb-3 max-h-40 overflow-y-auto">
                  <div className="text-sm font-mono whitespace-pre-line min-w-fit">
                    {foundZipCodes.map((zipCode, index) => {
                      const isLastInGroup = (index + 1) % 4 === 0;
                      const isLastOverall = index === foundZipCodes.length - 1;

                      return (
                        <span key={zipCode}>
                          {zipCode}
                          {!isLastOverall && ', '}
                          {isLastInGroup && !isLastOverall && '\n'}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Population Summary */}
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3 mb-3">
                  <div className="text-sm font-semibold text-blue-900 mb-1">Population Summary</div>
                  <div className="text-sm text-blue-800">
                    Total Population: <span className="font-bold">
                      {zipCodeDatabase.filter(z => foundZipCodes.includes(z.zipCode)).reduce((sum, z) => sum + z.population, 0).toLocaleString()}
                    </span> people
                  </div>
                  <div className="text-xs text-blue-600 mt-1">
                    Average per zip: {Math.round(zipCodeDatabase.filter(z => foundZipCodes.includes(z.zipCode)).reduce((sum, z) => sum + z.population, 0) / foundZipCodes.length).toLocaleString()} people
                  </div>
                </div>

                <Button
                  onClick={copyZipCodes}
                  variant="outline"
                  size="sm"
                  className="w-full"
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy to Clipboard
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Map */}
      <div className="flex-1 relative h-full overflow-hidden">
        {seedCoordinates.length === 0 ? (
          // Default map view with instructional overlay
          <div className="absolute inset-0">
            <div
              ref={el => mapRefs.current[0] = el}
              className="absolute inset-0"
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center bg-white bg-opacity-90 p-6 rounded-lg shadow-lg">
                <MapPin className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 font-medium mb-2">Enter zip codes to see territorial map views</p>
                <p className="text-gray-500 text-sm">Use the sidebar to add seed locations and search for zip codes</p>
              </div>
            </div>
          </div>
        ) : mapSplit?.useSingleMap ? (
          // Single map view for any number of seeds
          <div className="absolute inset-0">
            <div
              ref={el => mapRefs.current[0] = el}
              className="absolute inset-0"
            />
            <div className="absolute top-4 left-4 bg-white bg-opacity-90 px-3 py-2 rounded-md shadow-sm">
              <div className="text-sm">
                <div className="font-medium mb-1">
                  {seedCoordinates.length === 1 ? 'Single Seed' :
                    seedCoordinates.length === 2 ? `Close Seeds (${mapSplit.distance.toFixed(1)} miles apart)` :
                      'Multiple Seeds - Single Map'}
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  {seedCoordinates.map((seed, index) => {
                    const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
                    const color = colors[index % colors.length];
                    return (
                      <div key={seed.zipCode} className="flex items-center gap-1">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                        <span>{seed.zipCode}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : (mapSplit && !mapSplit.useSingleMap && ((seedCoordinates.length === 2) || (mapSplit.clusters && mapSplit.clusters.length === 2))) ? (
          // Two seeds far apart OR two clusters - split view
          <div className="absolute inset-0">
            {/* Map containers */}
            <div className="absolute inset-0 flex">
              <div className="flex-1 relative">
                <div
                  ref={el => mapRefs.current[0] = el}
                  className="absolute inset-0"
                />
                <div className="absolute top-4 left-4 bg-white bg-opacity-90 px-3 py-2 rounded-md shadow-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-blue-500 rounded-full" />
                    <span className="font-medium">
                      {mapSplit?.clusters ?
                        mapSplit.clusters[0]?.map(s => s.zipCode).join(', ') :
                        seedCoordinates[0]?.zipCode}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex-1 relative">
                <div
                  ref={el => mapRefs.current[1] = el}
                  className="absolute inset-0"
                />
                <div className="absolute top-4 right-4 bg-white bg-opacity-90 px-3 py-2 rounded-md shadow-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-red-500 rounded-full" />
                    <span className="font-medium">
                      {mapSplit?.clusters ?
                        mapSplit.clusters[1]?.map(s => s.zipCode).join(', ') :
                        seedCoordinates[1]?.zipCode}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          // Multiple seeds - grid view
          <div className="absolute inset-0 grid grid-cols-2 gap-1">
            {seedCoordinates.map((seed, index) => (
              <div key={seed.zipCode} className="relative">
                <div
                  ref={el => mapRefs.current[index] = el}
                  className="absolute inset-0"
                />
                <div className="absolute top-2 left-2 bg-white bg-opacity-90 px-2 py-1 rounded text-sm">
                  <div className="flex items-center gap-1">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: ['#3b82f6', '#ef4444', '#10b981', '#f59e0b'][index % 4] }}
                    />
                    <span className="font-medium">{seed.zipCode}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MapContainer;
