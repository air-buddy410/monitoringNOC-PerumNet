// Test transformasi murni impor aset LibreNMS → tabel assets.
// HTTP & DB tidak disentuh — cukup logic pemetaan & rencana idempoten.

import { describe, expect, it } from "vitest";
import {
  assetIdFromDeviceId,
  buildAssetFromDevice,
  inferNetworkRole,
  planAssetImport,
  vendorFromOs,
} from "../scripts/librenms-asset-import-lib.mjs";

describe("assetIdFromDeviceId", () => {
  it("menghasilkan ID deterministik lnms-<device_id>", () => {
    expect(assetIdFromDeviceId(7)).toBe("lnms-7");
    expect(assetIdFromDeviceId(7)).toBe(assetIdFromDeviceId(7));
  });
});

describe("vendorFromOs", () => {
  it("memetakan OS yang dikenal", () => {
    expect(vendorFromOs("routeros")).toBe("MikroTik");
    expect(vendorFromOs("zxa10")).toBe("ZTE");
    expect(vendorFromOs("ruijie")).toBe("Ruijie");
  });

  it("fallback Unknown untuk OS tak dikenal / kosong", () => {
    expect(vendorFromOs("vendor-aneh")).toBe("Unknown");
    expect(vendorFromOs(null)).toBe("Unknown");
    expect(vendorFromOs("")).toBe("Unknown");
  });
});

describe("inferNetworkRole", () => {
  it("OLT dari OS ZTE zxa10", () => {
    expect(inferNetworkRole({ os: "zxa10" })).toBe("olt");
  });

  it("server dari tipe/OS server", () => {
    expect(inferNetworkRole({ os: "debian" })).toBe("server");
    expect(inferNetworkRole({ os: "linux" })).toBe("server");
  });

  it("routerOS → distribution, sisanya access", () => {
    expect(inferNetworkRole({ os: "routeros" })).toBe("distribution");
    expect(inferNetworkRole({ os: "ruijie" })).toBe("access");
    expect(inferNetworkRole({ os: null })).toBe("access");
  });
});

describe("buildAssetFromDevice", () => {
  const device = {
    device_id: 3,
    hostname: "core-menteng-01",
    sysName: "core-menteng-01",
    ip: "10.0.0.1",
    overwrite_ip: "10.0.0.10",
    os: "routeros",
    hardware: "CCR2004-16G-2S+",
    serial: "SER123",
    location: "POP Menteng",
    lat: -6.19,
    lng: 106.83,
    type: "network",
  };

  it("memetakan metadata device ke kolom assets", () => {
    const row = buildAssetFromDevice(device);
    expect(row).toEqual({
      librenms_device_id: 3,
      hostname: "core-menteng-01",
      display_name: "core-menteng-01",
      management_ip: "10.0.0.10",
      vendor: "MikroTik",
      os: "routeros",
      model: "CCR2004-16G-2S+",
      serial_number: "SER123",
      site: "POP Menteng",
      location: "POP Menteng",
      latitude: -6.19,
      longitude: 106.83,
      tags: [],
      network_role: "distribution",
    });
  });

  it("management_ip fallback ke ip lalu hostname", () => {
    const noOverwrite = { ...device, overwrite_ip: null };
    expect(buildAssetFromDevice(noOverwrite)?.management_ip).toBe("10.0.0.1");
    const noIp = { ...device, ip: null, overwrite_ip: null };
    expect(buildAssetFromDevice(noIp)?.management_ip).toBe("core-menteng-01");
  });

  it("site fallback 'Unassigned' tanpa lokasi", () => {
    expect(buildAssetFromDevice({ ...device, location: null })?.site).toBe("Unassigned");
  });

  it("null bila hostname & sysName kosong", () => {
    expect(buildAssetFromDevice({ ...device, hostname: "", sysName: "" })).toBeNull();
  });
});

describe("planAssetImport", () => {
  const devices = [
    { device_id: 1, hostname: "core-1", sysName: "core-1", ip: "10.1.0.1", os: "routeros" },
    { device_id: 2, hostname: "olt-1", sysName: "olt-1", ip: "10.2.0.1", os: "zxa10" },
    { device_id: 3, hostname: "agg-1", sysName: "agg-1", ip: "10.3.0.1", os: "ruijie" },
  ];

  it("semua baru → toInsert, tanpa update/unchanged", () => {
    const plan = planAssetImport(devices, new Map(), new Map());
    expect(plan.toInsert.map((item) => item.assetId)).toEqual(["lnms-1", "lnms-2", "lnms-3"]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.unchanged).toEqual([]);
    expect(plan.warnings).toEqual([]);
  });

  it("aset existing identik → unchanged", () => {
    const existing = new Map();
    existing.set("lnms-1", { ...buildAssetFromDevice(devices[0]), asset_id: "lnms-1" });
    const plan = planAssetImport([devices[0]], existing, new Map([[1, "lnms-1"]]));
    expect(plan.unchanged).toEqual(["lnms-1"]);
    expect(plan.toInsert).toEqual([]);
  });

  it("perubahan nilai → toUpdate dengan daftar field", () => {
    const row = buildAssetFromDevice(devices[0]);
    const existing = new Map([[ "lnms-1", { ...row, asset_id: "lnms-1", display_name: "nama-lama" } ]]);
    const plan = planAssetImport([devices[0]], existing, new Map([[1, "lnms-1"]]));
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0].changes).toHaveProperty("display_name");
  });

  it("librenms_device_id dipakai aset lain → dilewati dengan warning", () => {
    const existing = new Map([[ "lnms-99", { asset_id: "lnms-99", librenms_device_id: 2 } ]]);
    const plan = planAssetImport([devices[1]], existing, new Map([[2, "lnms-99"]]));
    expect(plan.toInsert).toEqual([]);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain("lnms-99");
  });

  it("device tanpa identitas → warning, bukan crash", () => {
    const plan = planAssetImport([{ device_id: 5, hostname: "", sysName: "" }], new Map(), new Map());
    expect(plan.toInsert).toEqual([]);
    expect(plan.warnings).toHaveLength(1);
  });
});
