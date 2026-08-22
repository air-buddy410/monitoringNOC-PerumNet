export type FiberGeoNodeType = "OTB" | "CLOSURE" | "MS" | "ODP";

export interface FiberGeoNode {
  jenis: FiberGeoNodeType;
  id: string;
  code: string;
  name: string | null;
  latitude: number;
  longitude: number;
}

export interface FiberGeoLine {
  id: string;
  code: string;
  category: string;
  lengthM: number | null;
  /** GeoJSON order: [longitude, latitude]. */
  koordinat: [[number, number], [number, number]];
  dari: { jenis: FiberGeoNodeType; code: string };
  ke: { jenis: FiberGeoNodeType; code: string };
  coreTerpakai: number;
  coreTotal: number;
}

export interface FiberGeoResponse {
  simpul: FiberGeoNode[];
  garis: FiberGeoLine[];
  tanpaGeometri: Array<{
    id: string;
    code: string;
    category: string;
    alasan: string;
  }>;
  ringkas: {
    kabelAktif: number;
    tergambar: number;
    tanpaGeometri: number;
  };
}
