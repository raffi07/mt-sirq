export type ChargingStations = {
  chargingStationId: string;
  chargingStationName: string;
  totalChargingSpots: number;
  maxReserveSpots: number;
  active: boolean;
};

export type ChargingFlowsRequest = {
  licensePlate: string;
  chargingStationId: string;
};

export type EstablishedChargingFlowRequest = ChargingFlowsRequest & {
  chargerId: string;
  licensePlate: string;
  chargingStationId: string;
};

export type Session = {
  sessionId: string;
  licensePlate: string;
  chargingStationId: string;
  chargerId: string;
  arrivalTimestamp: string;
  spotAssignmentTimestamp: string;
  chargerCheckinTimestamp: string;
  startChargeTimestamp: string;
  endChargeTimestamp: string;
  departureTimestamp: string;
};