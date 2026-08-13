export const ROOM_COORDINATES: Record<string, { latitude: number; longitude: number }> = {
  "Room 4": { latitude: -33.8688, longitude: 151.2093 }, // Sydney Center coordinates
  "Room 2": { latitude: -33.8690, longitude: 151.2090 },
  "Room 1": { latitude: -33.8670, longitude: 151.2110 },
  "Default": { latitude: -33.8688, longitude: 151.2093 },
};

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth's radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}
