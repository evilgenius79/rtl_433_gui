// ICAO airline telephony prefixes -> operator names (common subset).
export const AIRLINES = {
  AAL: 'American', ACA: 'Air Canada', AEE: 'Aegean', AFL: 'Aeroflot', AFR: 'Air France',
  AIC: 'Air India', ANA: 'All Nippon', ANZ: 'Air New Zealand', ASA: 'Alaska', ASL: 'ASL Ireland',
  AUA: 'Austrian', AVA: 'Avianca', AZA: 'ITA Airways', AZU: 'Azul', BAW: 'British Airways',
  BCS: 'DHL (EAT)', BEL: 'Brussels', BOX: 'AeroLogic', CAL: 'China Airlines', CCA: 'Air China',
  CES: 'China Eastern', CFG: 'Condor', CLX: 'Cargolux', CMP: 'Copa', CPA: 'Cathay Pacific',
  CSN: 'China Southern', DAL: 'Delta', DLH: 'Lufthansa', EIN: 'Aer Lingus', EJU: 'easyJet Europe',
  ELY: 'El Al', ETD: 'Etihad', ETH: 'Ethiopian', EVA: 'EVA Air', EWG: 'Eurowings',
  EXS: 'Jet2', EZY: 'easyJet', FDX: 'FedEx', FIN: 'Finnair', FRA: 'Frontier',
  GEC: 'Lufthansa Cargo', GLO: 'Gol', GTI: 'Atlas Air', IBE: 'Iberia', ICE: 'Icelandair',
  JAL: 'Japan Airlines', JBU: 'JetBlue', JST: 'Jetstar', KAL: 'Korean Air', KLM: 'KLM',
  LOT: 'LOT Polish', MSR: 'Egyptair', NAX: 'Norwegian', NKS: 'Spirit', PAL: 'Philippine',
  PIA: 'PIA', QFA: 'Qantas', QTR: 'Qatar', RCH: 'US Air Mobility', ROU: 'Air Canada Rouge',
  RPA: 'Republic', RYR: 'Ryanair', SAS: 'SAS', SHT: 'BA Shuttle', SIA: 'Singapore',
  SKW: 'SkyWest', SWA: 'Southwest', SWR: 'Swiss', TAP: 'TAP Portugal', THY: 'Turkish',
  TOM: 'TUI', TRA: 'Transavia', UAE: 'Emirates', UAL: 'United', UPS: 'UPS',
  VIR: 'Virgin Atlantic', VLG: 'Vueling', VOI: 'Volaris', WJA: 'WestJet', WZZ: 'Wizz Air',
};

export function airlineOf(callsign) {
  if (!callsign || callsign.length < 3) return null;
  return AIRLINES[callsign.slice(0, 3).toUpperCase()] || null;
}
