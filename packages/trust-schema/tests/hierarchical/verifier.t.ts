import { Endpoint } from "@ndn/endpoint";
import { Certificate, EcPrivateKey, PrivateKey, PublicKey, RsaPrivateKey, ValidityPeriod } from "@ndn/keychain";
import { Component, Data, digestSigning, NameLike, Verifier } from "@ndn/packet";
import { PrefixRegShorter } from "@ndn/repo";
import { makeRepoProducer } from "@ndn/repo/test-fixture/data-store";

import { HierarchicalVerifier, pattern as P, TrustSchema, TrustSchemaPolicy, TrustSchemaVerifier } from "../..";

afterEach(Endpoint.deleteDefaultForwarder);

interface Row {
  makeVerifier: (ctx: IContext) => Verifier;
}

interface IContext extends Context {}

class Context {
  public name0: NameLike = "/root";
  public opts0: Partial<Certificate.SelfSignOptions> = {};
  public pvt0!: PrivateKey;
  public pub0!: PublicKey;
  public cert0!: Certificate;
  public name1: NameLike = "/root/site";
  public opts1: Partial<Certificate.IssueOptions> = {};
  public pvt1!: PrivateKey;
  public pub1!: PublicKey;
  public cert1!: Certificate;
  public name2: NameLike = "/root/site/group/user";
  public opts2: Partial<Certificate.IssueOptions> = {};
  public pvt2!: PrivateKey;
  public pub2!: PublicKey;
  public cert2!: Certificate;
  public dataName: NameLike = "/root/site/group/user/path/data";
  public data!: Data;

  constructor(opts: Partial<IContext> = {}) {
    Object.assign(this, opts);
  }

  public async execute({ makeVerifier }: Row, f: (verifier: Verifier, data: Data) => Promise<void>) {
    await this.makeCert0();
    await this.makeCert1();
    await this.makeCert2();
    await this.makeData();
    const certProducer = await makeRepoProducer([this.cert1.data, this.cert2.data],
      { reg: PrefixRegShorter(4) });
    const verifier = makeVerifier(this);
    try {
      await f(verifier, this.data);
    } finally {
      certProducer.close();
    }
  }

  protected async makeCert0() {
    [this.pvt0, this.pub0] = await EcPrivateKey.generate(this.name0, "P-384");
    this.cert0 = await Certificate.selfSign({
      privateKey: this.pvt0,
      publicKey: this.pub0,
      ...this.opts0,
    });
  }

  protected async makeCert1() {
    [this.pvt1, this.pub1] = await RsaPrivateKey.generate(this.name1, 1024);
    this.cert1 = await Certificate.issue({
      publicKey: this.pub1,
      issuerPrivateKey: this.pvt0,
      validity: ValidityPeriod.daysFromNow(2),
      issuerId: Component.from("H"),
      ...this.opts1,
    });
  }

  protected async makeCert2() {
    [this.pvt2, this.pub2] = await EcPrivateKey.generate(this.name2, "P-256");
    this.cert2 = await Certificate.issue({
      publicKey: this.pub2,
      issuerPrivateKey: this.pvt1,
      validity: ValidityPeriod.daysFromNow(1),
      issuerId: Component.from("H"),
      ...this.opts2,
    });
  }

  protected async makeData() {
    this.data = new Data(this.dataName, Uint8Array.of(0xC0, 0xC1));
    await this.pvt2.sign(this.data);
  }
}

const hPolicy = new TrustSchemaPolicy();
hPolicy.addPattern("packet", new P.ConcatPattern([
  new P.VariablePattern("prefix", { minComps: 0, maxComps: Infinity }),
  new P.VariablePattern("suffix", { minComps: 0, maxComps: Infinity }),
]));
hPolicy.addPattern("signer", new P.ConcatPattern([
  new P.VariablePattern("prefix", { minComps: 0, maxComps: Infinity }),
  new P.CertNamePattern(),
]));
hPolicy.addRule("packet", "signer");

const TABLE: Row[] = [
  {
    makeVerifier(ctx: IContext) {
      return new HierarchicalVerifier({ trustAnchors: [ctx.cert0] });
    },
  },
  {
    makeVerifier(ctx: IContext) {
      return new TrustSchemaVerifier({ schema: new TrustSchema(hPolicy, [ctx.cert0]) });
    },
  },
];

test.each(TABLE)("success %#", async (row) => {
  const ctx = new Context();
  await ctx.execute(row, async (verifier, data) => {
    await expect(verifier.verify(data)).resolves.toBeUndefined();
  });
});

test.each(TABLE)("data non-hierarchical %#", async (row) => {
  const ctx = new Context({
    dataName: "/data",
  });
  await ctx.execute(row, async (verifier, data) => {
    await expect(verifier.verify(data)).rejects.toThrow();
  });
});

test.each(TABLE)("cert non-hierarchical %#", async (row) => {
  const ctx = new Context({
    name1: "/root/other-site",
  });
  await ctx.execute(row, async (verifier, data) => {
    await expect(verifier.verify(data)).rejects.toThrow();
  });
});

test.each(TABLE)("bad signature %#", async (row) => {
  const [fakePvt1] = await RsaPrivateKey.generate("/root/site", 1024);
  const ctx = new Context({
    name1: fakePvt1.name,
    opts2: {
      issuerPrivateKey: fakePvt1,
    },
  });
  await ctx.execute(row, async (verifier, data) => {
    await expect(verifier.verify(data)).rejects.toThrow(/bad/);
  });
});

test.each(TABLE)("root expired %#", async (row) => {
  const now = Date.now();
  const ctx = new Context({
    opts0: {
      validity: new ValidityPeriod(now - 5 * 86400000, now - 2 * 86400000),
    },
  });
  await ctx.execute(row, async (verifier, data) => {
    await expect(verifier.verify(data)).rejects.toThrow(/expired/);
  });
});

test.each(TABLE)("cert expired %#", async (row) => {
  const now = Date.now();
  const ctx = new Context({
    opts2: {
      validity: new ValidityPeriod(now - 5 * 86400000, now - 2 * 86400000),
    },
  });
  await ctx.execute(row, async (verifier, data) => {
    await expect(verifier.verify(data)).rejects.toThrow(/expired/);
  });
});

test.each(TABLE)("no KeyLocator %#", async (row) => {
  const ctx = new (class extends Context {
    public async makeData() {
      await super.makeData();
      await digestSigning.sign(this.data);
    }
  })();
  await ctx.execute(row, async (verifier, data) => {
    await expect(verifier.verify(data)).rejects.toThrow(/KeyLocator/);
  });
});