# @ndn/nfdmgmt

This package is part of [NDNts](https://yoursunny.com/p/NDNts/), Named Data Networking libraries for the modern web.

This package enables interaction with [NDN-DPDK high-speed forwarder](https://github.com/usnistgov/ndn-dpdk).
It can create faces for the NDNts application, and perform prefix registrations.

NDN-DPDK forwarder should be configured as follows:

* Management listener on TCP.
* Socket faces enabled.

Currently, there are several limitations using this package:

* Data plane uses UDP transport, which does not deliver the best performance.
* Prefix registration replaces a FIB entry, and does not preserve other prefix registrations on the same prefix.
* If the application crashes, the face would not be closed on NDN-DPDK side.

```ts
import { createFace } from "@ndn/dpdkmgmt";

// other imports for examples
import { Endpoint } from "@ndn/endpoint";
import { Forwarder } from "@ndn/fw";
import { Name, Interest, Data } from "@ndn/packet";
import { fromUtf8, toUtf8 } from "@ndn/tlv";
import { strict as assert } from "assert";
(async () => {

const localHost = process.env.DEMO_DPDKMGMT_LOCAL;
const host = process.env.DEMO_DPDKMGMT_FW;
if (!localHost || !host) {
  console.log(`
To run @ndn/dpdkmgmt demo, set the following environment variables:
DEMO_DPDKMGMT_FW= IP address of NDN-DPDK forwarder
DEMO_DPDKMGMT_LOCAL= IP address to reach local host from NDN-DPDK forwarder
`);
  return;
}

// Create two forwarders, one as consumer and one as producer.
const fwC = Forwarder.create();
const fwP = Forwarder.create();

// Connect to NDN-DPDK.
const uplinkC = await createFace({
  fw: fwC,
  localHost,
  host,
});
uplinkC.addRoute(new Name("/"));
const uplinkP = await createFace({
  fw: fwP,
  localHost,
  host,
});
console.log(`uplinkC=${uplinkC}`, `uplinkP=${uplinkP}`);

// Start a producer.
const producer = new Endpoint({ fw: fwP }).produce("/P",
  async () => {
    console.log("producing");
    return new Data("/P", Data.FreshnessPeriod(1000), toUtf8("NDNts + NDN-DPDK"));
  });
await new Promise((r) => setTimeout(r, 500));

// Start a consumer, fetching Data from the producer via NFD.
const data = await new Endpoint({ fw: fwC }).consume(
  new Interest("/P", Interest.MustBeFresh),
);
const payloadText = fromUtf8(data.content);
console.log("received", `${data.name} ${payloadText}`);
assert.equal(payloadText, "NDNts + NDN-DPDK");

// Close faces.
producer.close();
await new Promise((r) => setTimeout(r, 500));
uplinkC.close();
uplinkP.close();
})();
```