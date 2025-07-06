
import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Copy, MapPin } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ZipCodeData {
  zipCode: string;
  lat: number;
  lng: number;
}

const MapContainer = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapboxToken, setMapboxToken] = useState('');
  const [seedZipCode, setSeedZipCode] = useState('');
  const [radius, setRadius] = useState([10]);
  const [foundZipCodes, setFoundZipCodes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  // Mock zip code data - in a real app, this would come from an API
  const mockZipCodes: ZipCodeData[] = [
    { zipCode: '10001', lat: 40.7505, lng: -73.9934 },
    { zipCode: '10002', lat: 40.7157, lng: -73.9862 },
    { zipCode: '10003', lat: 40.7314, lng: -73.9870 },
    { zipCode: '10004', lat: 40.6892, lng: -74.0167 },
    { zipCode: '10005', lat: 40.7061, lng: -74.0087 },
    { zipCode: '90210', lat: 34.0901, lng: -118.4065 },
    { zipCode: '90211', lat: 34.0839, lng: -118.4006 },
    { zipCode: '90212', lat: 34.1030, lng: -118.4010 },
  ];

  // Mock function to get coordinates for a zip code
  const getZipCodeCoordinates = (zipCode: string): { lat: number; lng: number } | null => {
    const found = mockZipCodes.find(z => z.zipCode === zipCode);
    return found ? { lat: found.lat, lng: found.lng } : null;
  };

  // Calculate distance between two points in miles
  const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  useEffect(() => {
    if (!mapContainer.current || !mapboxToken) return;

    mapboxgl.accessToken = mapboxToken;
    
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-95.7129, 37.0902], // Center of US
      zoom: 4
    });

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    return () => {
      map.current?.remove();
    };
  }, [mapboxToken]);

  const handleSearch = async () => {
    if (!seedZipCode || !mapboxToken || !map.current) {
      toast({
        title: "Missing Information",
        description: "Please enter a Mapbox token and zip code.",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);
    
    try {
      const coordinates = getZipCodeCoordinates(seedZipCode);
      
      if (!coordinates) {
        toast({
          title: "Zip Code Not Found",
          description: "The entered zip code could not be located.",
          variant: "destructive"
        });
        setIsLoading(false);
        return;
      }

      // Center map on the zip code
      map.current.flyTo({
        center: [coordinates.lng, coordinates.lat],
        zoom: 10,
        duration: 2000
      });

      // Clear existing layers and features
      if (map.current.getSource('radius-circle')) {
        map.current.removeLayer('radius-circle-fill');
        map.current.removeLayer('radius-circle-stroke');
        map.current.removeSource('radius-circle');
      }

      // Create radius circle
      const radiusInMiles = radius[0];
      const radiusInMeters = radiusInMiles * 1609.34;
      
      // Create circle using turf-like calculation
      const createCircle = (center: [number, number], radiusInMeters: number, points: number = 64) => {
        const coords = [];
        for (let i = 0; i < points; i++) {
          const angle = (i * 360) / points;
          const dx = radiusInMeters / 111320 * Math.cos(angle * Math.PI / 180);
          const dy = radiusInMeters / 110540;
          coords.push([
            center[0] + dx / Math.cos(center[1] * Math.PI / 180),
            center[1] + dy
          ]);
        }
        coords.push(coords[0]); // Close the circle
        return coords;
      };

      const circleCoords = createCircle([coordinates.lng, coordinates.lat], radiusInMeters);

      // Add circle to map
      map.current.addSource('radius-circle', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [circleCoords]
          }
        }
      });

      map.current.addLayer({
        id: 'radius-circle-fill',
        type: 'fill',
        source: 'radius-circle',
        paint: {
          'fill-color': '#3b82f6',
          'fill-opacity': 0.1
        }
      });

      map.current.addLayer({
        id: 'radius-circle-stroke',
        type: 'line',
        source: 'radius-circle',
        paint: {
          'line-color': '#3b82f6',
          'line-width': 2,
          'line-opacity': 0.8
        }
      });

      // Find zip codes within radius
      const zipCodesInRadius = mockZipCodes.filter(zipData => {
        const distance = calculateDistance(
          coordinates.lat, coordinates.lng,
          zipData.lat, zipData.lng
        );
        return distance <= radiusInMiles;
      });

      setFoundZipCodes(zipCodesInRadius.map(z => z.zipCode));
      
      toast({
        title: "Search Complete",
        description: `Found ${zipCodesInRadius.length} zip codes within ${radiusInMiles} miles.`
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
              Mapbox Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="mapbox-token">Mapbox Public Token</Label>
              <Input
                id="mapbox-token"
                type="password"
                placeholder="Enter your Mapbox public token"
                value={mapboxToken}
                onChange={(e) => setMapboxToken(e.target.value)}
                className="mt-1"
              />
              <p className="text-sm text-gray-500 mt-2">
                Get your token from{' '}
                <a href="https://mapbox.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  mapbox.com
                </a>
              </p>
            </div>
            <Button onClick={() => {}} className="w-full">
              Continue
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-gray-50">
      {/* Sidebar */}
      <div className="w-80 bg-white shadow-lg flex flex-col">
        <div className="p-6 border-b">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Zip Code Radius Tool</h1>
          <p className="text-gray-600 text-sm">Find zip codes within a specified radius</p>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <Label htmlFor="seed-zip">Seed Zip Code</Label>
            <Input
              id="seed-zip"
              placeholder="Enter zip code (e.g., 10001)"
              value={seedZipCode}
              onChange={(e) => setSeedZipCode(e.target.value)}
              className="mt-1"
            />
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

          <Button 
            onClick={handleSearch} 
            disabled={isLoading || !seedZipCode}
            className="w-full"
          >
            {isLoading ? 'Searching...' : 'Search'}
          </Button>
        </div>

        {foundZipCodes.length > 0 && (
          <div className="flex-1 p-6 pt-0">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Found Zip Codes ({foundZipCodes.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-gray-50 p-3 rounded-md mb-3 max-h-40 overflow-y-auto">
                  <p className="text-sm font-mono break-all">
                    {foundZipCodes.join(', ')}
                  </p>
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
      <div className="flex-1 relative">
        <div ref={mapContainer} className="absolute inset-0" />
      </div>
    </div>
  );
};

export default MapContainer;
