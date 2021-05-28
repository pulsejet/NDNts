import * as TestTransport from "@ndn/l3face/test-fixture/transport";
import * as dgram from "dgram";
import { collect } from "streaming-iterables";

import { udp_helper, UdpTransport } from "..";

describe.each([
  { family: 4, address: "127.0.0.1" },
  { family: 6, address: "::1" },
] as Array<{ family: 4|6; address: string }>)("unicast %p", ({ family, address }) => {
  let server: dgram.Socket;
  let serverPort: number;
  const clientPorts = new Set<number>();

  beforeEach(async () => {
    server = dgram.createSocket({
      type: `udp${family}` as dgram.SocketType,
      reuseAddr: true,
    });
    serverPort = await new Promise<number>((r) =>
      server.bind({ address }, () => r(server.address().port)));
    server.on("message", (msg, { port }) => {
      for (const clientPort of clientPorts) {
        if (port === clientPort) {
          continue;
        }
        server.send(msg, clientPort);
      }
    });
  });

  afterEach(() => {
    clientPorts.clear();
    return new Promise<void>((r) => server.close(r));
  });

  test("pair", async () => {
    const [tA, tB] = await Promise.all([
      UdpTransport.connect(address, serverPort),
      UdpTransport.connect({ family, host: "localhost", port: serverPort, bind: { address } }),
    ]);
    clientPorts.add(tA.laddr.port);
    clientPorts.add(tB.laddr.port);

    expect(tA.raddr.port).toBe(serverPort);
    expect(tA.toString()).toMatch(/^UDP\(/);
    TestTransport.check(await TestTransport.execute(tA, tB));
  });

  test("RX error", async () => {
    const transport = await UdpTransport.connect({
      port: serverPort,
      host: "localhost",
      family,
    });
    setTimeout(() => server.send(Uint8Array.of(0xF0, 0x01), transport.laddr.port), 200); // incomplete TLV ignored
    await Promise.all([
      expect(collect(transport.rx)).resolves.toHaveLength(0),
      // eslint-disable-next-line require-yield
      transport.tx((async function*() {
        await new Promise((r) => setTimeout(r, 400));
      })()),
    ]);
  });
});

describe("multicast", () => {
  const intfs = udp_helper.listMulticastIntfs();
  if (intfs.length === 0) {
    // eslint-disable-next-line jest/no-disabled-tests
    test.skip("no multicast interface", () => undefined);
    return;
  }

  const opts: udp_helper.MulticastOptions = {
    intf: intfs[0]!,
    group: "224.0.0.254", // https://tools.ietf.org/html/rfc4727#section-2.4.2
    port: 56363,
    multicastTtl: 0,
    multicastLoopback: true,
  };

  test("loopback", async () => {
    const tA = await UdpTransport.multicast(opts);
    const tB = await UdpTransport.multicast(opts);
    expect(tA.toString()).toMatch(/^UDPm\(/);
    TestTransport.check(await TestTransport.execute(tA, tB));
  });

  test("creates", async () => {
    const faces = await UdpTransport.createMulticastFaces({}, opts);
    expect(faces).toHaveLength(intfs.length);
    for (const face of faces) {
      face.close();
    }
  });
});
