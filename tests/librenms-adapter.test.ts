// Test fungsi adapter per-endpoint: path yang dipanggil & pembacaan payload.
// fetch di-mock penuh — tidak ada klaim keberhasilan terhadap server nyata.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchActiveAlerts,
  fetchDeviceCpuUsage,
  fetchDeviceEventlog,
  fetchDeviceGraphPng,
  fetchDeviceHealthClasses,
  fetchDeviceMemUsage,
  fetchHealthSensors,
  fetchDeviceLinks,
  fetchDevicePorts,
  fetchDevices,
} from "@/server/librenms";

type RouteMap = Record<string, unknown>;

/** Mock fetch yang menjawab per-path (setelah prefix /api/v0). */
function stubRoutes(routes: RouteMap) {
  const mock = vi.fn<
    (input: string | URL, init?: RequestInit) => Promise<Response>
  >(async (input) => {
    const url = String(input);
    const path = url.split("/api/v0")[1] ?? url;
    const hit = Object.entries(routes).find(([route]) => path === route);
    if (!hit) throw new Error(`route tidak ter-mock: ${path}`);
    return {
      ok: true,
      status: 200,
      json: async () => hit[1],
      arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  vi.stubEnv("LIBRENMS_URL", "https://nms.example.test");
  vi.stubEnv("LIBRENMS_TOKEN", "tkn");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fetchDevices", () => {
  it("memanggil /devices?type=all dan membaca kunci devices", async () => {
    stubRoutes({
      "/devices?type=all": {
        status: "ok",
        devices: [{ device_id: 1, hostname: "core-menteng-01", status: 1 }],
      },
    });
    const devices = await fetchDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0].hostname).toBe("core-menteng-01");
  });

  it("payload tanpa kunci devices → array kosong (bukan crash)", async () => {
    stubRoutes({ "/devices?type=all": { status: "ok" } });
    expect(await fetchDevices()).toEqual([]);
  });
});

describe("fetchActiveAlerts", () => {
  it("menggabungkan alert state=1 (aktif) dan state=2 (acknowledged)", async () => {
    stubRoutes({
      "/alerts?state=1": { alerts: [{ id: 1, device_id: 7, state: 1 }] },
      "/alerts?state=2": { alerts: [{ id: 2, device_id: 8, state: 2 }] },
    });
    const alerts = await fetchActiveAlerts();
    expect(alerts.map((alert) => alert.id)).toEqual([1, 2]);
  });
});

describe("fetchDevicePorts", () => {
  it("meminta kolom rate lewat parameter columns", async () => {
    const mock = stubRoutes({});
    mock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ports: [{ port_id: 1, ifName: "ether1" }] }),
    } as unknown as Response);

    const ports = await fetchDevicePorts(3);
    expect(ports[0].ifName).toBe("ether1");
    const url = String(mock.mock.calls[0][0]);
    expect(url).toContain("/devices/3/ports?columns=");
    expect(decodeURIComponent(url)).toContain("ifInOctets_rate");
    expect(decodeURIComponent(url)).toContain("ifOutOctets_rate");
  });
});

describe("fetchDeviceCpuUsage (health device_processor)", () => {
  // Payload di bawah disalin dari LibreNMS produksi 22 Agustus 2026,
  // `/devices/2/health/device_processor/36`. Bentuk sebelumnya di tes ini
  // memakai `sensor_current` — field yang TIDAK ADA pada kelas processor.
  // Tesnya lolos, kodenya salah, dan keduanya sepakat: CPU selalu null sejak
  // LibreNMS tersambung. Jangan ganti payload ini dengan yang "lebih rapi".
  it("membaca processor_usage, bukan sensor_current", async () => {
    stubRoutes({
      "/devices/5/health/device_processor": {
        graphs: [{ sensor_id: 11 }, { sensor_id: 12 }],
      },
      "/devices/5/health/device_processor/11": {
        graphs: [
          { processor_id: 11, processor_descr: "Processor", processor_usage: 30 },
        ],
      },
      "/devices/5/health/device_processor/12": {
        graphs: [
          { processor_id: 12, processor_descr: "Processor", processor_usage: 50 },
        ],
      },
    });
    expect(await fetchDeviceCpuUsage(5)).toBe(40);
  });

  it("device tanpa sensor processor → null (bukan angka palsu)", async () => {
    stubRoutes({ "/devices/5/health/device_processor": { graphs: [] } });
    expect(await fetchDeviceCpuUsage(5)).toBeNull();
  });

  it("sensor_current tetap dipakai sebagai cadangan bila field khususnya absen", async () => {
    stubRoutes({
      "/devices/5/health/device_processor": { graphs: [{ sensor_id: 11 }] },
      "/devices/5/health/device_processor/11": {
        graphs: [{ sensor_id: 11, sensor_current: 62 }],
      },
    });
    expect(await fetchDeviceCpuUsage(5)).toBe(62);
  });
});

describe("fetchDeviceMemUsage (health device_mempool)", () => {
  it("membaca mempool_perc, bukan sensor_current", async () => {
    // `/devices/2/health/device_mempool/9` di produksi: mempool_perc 13,
    // dan tidak ada `sensor_current` sama sekali di baris itu.
    stubRoutes({
      "/devices/5/health/device_mempool": { graphs: [{ sensor_id: 9 }] },
      "/devices/5/health/device_mempool/9": {
        graphs: [
          {
            mempool_id: 9,
            mempool_descr: "main memory",
            mempool_perc: 13,
            mempool_used: 2182414336,
            mempool_total: 17079205888,
          },
        ],
      },
    });
    expect(await fetchDeviceMemUsage(5)).toBe(13);
  });
});

describe("fetchDeviceEventlog", () => {
  it("menerima kunci logs maupun events", async () => {
    stubRoutes({
      "/logs/eventlog/7?limit=10": { logs: [{ event_id: 1, message: "ifDown" }] },
    });
    expect((await fetchDeviceEventlog(7, 10))[0].message).toBe("ifDown");

    stubRoutes({
      "/logs/eventlog/7?limit=10": { events: [{ event_id: 2, message: "ifUp" }] },
    });
    expect((await fetchDeviceEventlog(7, 10))[0].message).toBe("ifUp");
  });
});

describe("fetchDeviceHealthClasses", () => {
  it("/devices/{id}/health adalah KATALOG kelas, bukan daftar sensor", async () => {
    // Ini yang benar-benar dikirim LibreNMS. Tidak ada `sensor_class`, tidak
    // ada `sensor_current`. Tes lama di sini menstub sensor lengkap di path
    // ini — payload yang tidak pernah ada — sehingga penyaring
    // `sensor_class === "temperature"` di `sensorsToTemperature()` terlihat
    // benar padahal tidak pernah cocok sekali pun terhadap server sungguhan.
    stubRoutes({
      "/devices/7/health": {
        graphs: [
          { desc: "Temperature", name: "device_temperature" },
          { desc: "Processors", name: "device_processor" },
        ],
      },
    });
    const kelas = await fetchDeviceHealthClasses(7);
    expect(kelas.map((k) => k.name)).toEqual([
      "device_temperature",
      "device_processor",
    ]);
    expect(kelas[0]).not.toHaveProperty("sensor_current");
  });
});

describe("fetchHealthSensors", () => {
  it("dua langkah: daftar sensor_id lalu barisnya, lengkap dengan sensor_current", async () => {
    const mock = stubRoutes({
      "/devices/7/health/device_temperature": {
        graphs: [{ sensor_id: 76 }, { sensor_id: 77 }],
      },
      "/devices/7/health/device_temperature/76": {
        graphs: [{ sensor_id: 76, sensor_class: "temperature", sensor_descr: "temperature", sensor_current: 45 }],
      },
      "/devices/7/health/device_temperature/77": {
        graphs: [{ sensor_id: 77, sensor_class: "temperature", sensor_descr: "cpu-temperature", sensor_current: 53 }],
      },
    });
    const sensors = await fetchHealthSensors(7, "device_temperature");
    expect(sensors.map((s) => s.sensor_current)).toEqual([45, 53]);
    expect(sensors.every((s) => s.sensor_class === "temperature")).toBe(true);
    // 1 permintaan daftar + 1 per sensor.
    expect(mock.mock.calls).toHaveLength(3);
  });

  it("device tanpa sensor kelas itu → array kosong, tanpa permintaan susulan", async () => {
    const mock = stubRoutes({
      "/devices/7/health/device_temperature": { graphs: [] },
    });
    expect(await fetchHealthSensors(7, "device_temperature")).toEqual([]);
    expect(mock.mock.calls).toHaveLength(1);
  });

  it("maksSensor membatasi jumlah permintaan susulan", async () => {
    // Satu router produksi punya 8 sensor suhu; sebuah OLT bisa jauh lebih
    // banyak sensor dbm. Batas ini yang menjaga API tidak dibanjiri.
    const mock = stubRoutes({
      "/devices/7/health/device_temperature": {
        graphs: [{ sensor_id: 1 }, { sensor_id: 2 }, { sensor_id: 3 }],
      },
      "/devices/7/health/device_temperature/1": {
        graphs: [{ sensor_id: 1, sensor_class: "temperature", sensor_current: 40 }],
      },
      "/devices/7/health/device_temperature/2": {
        graphs: [{ sensor_id: 2, sensor_class: "temperature", sensor_current: 41 }],
      },
    });
    expect(await fetchHealthSensors(7, "device_temperature", 2)).toHaveLength(2);
    expect(mock.mock.calls).toHaveLength(3);
  });
});

describe("fetchDeviceLinks", () => {
  it("membaca /devices/{id}/links", async () => {
    const mock = stubRoutes({
      "/devices/3/links": {
        links: [{ id: 1, local_device_id: 3, remote_device_id: 9, active: 1 }],
      },
    });
    const links = await fetchDeviceLinks(3);
    expect(links[0].remote_device_id).toBe(9);
    expect(String(mock.mock.calls[0][0])).toContain("/devices/3/links");
  });
});

describe("fetchDeviceGraphPng", () => {
  it("meneruskan rentang waktu sebagai query dan mengembalikan Buffer", async () => {
    const mock = stubRoutes({});
    mock.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
    } as unknown as Response);

    const png = await fetchDeviceGraphPng(7, "device_bits", {
      from: "-1d",
      width: 800,
    });
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png[0]).toBe(137);
    const url = String(mock.mock.calls[0][0]);
    expect(url).toContain("/devices/7/device_bits?from=-1d&width=800");
    // Header Accept JSON tidak dikirim untuk permintaan binary.
    const init = mock.mock.calls[0][1];
    expect((init?.headers as Record<string, string>).Accept).toBeUndefined();
  });
});
