# @ndn/sync

This package is part of [NDNts](https://yoursunny.com/p/NDNts/), Named Data Networking libraries for the modern web.

This package contains dataset synchronization and pubsub protocols, including:

* [PSync - FullSync](https://github.com/named-data/PSync)
  * complete unit test
* [PSync - PartialSync](https://github.com/named-data/PSync)
  * simple unit test
  * application nack handling is incomplete
* [syncps - Pubsub](https://github.com/pollere/DNMP-v2/tree/main/syncps)
  * simple unit test
  * note: current implementation is compatible with DNMP-v2 syncps, not DCT syncps
* [StateVectorSync](https://named-data.github.io/StateVectorSync/Specification.html), revision 2021-12-15
  * complete unit test
  * core synchronization logic only, does not deal with Data fetching
* [SVS-PS](https://named-data.github.io/StateVectorSync/PubSubSpec.html), revision 2023-05-19
  * simple unit test

Most of these protocol implementations are parameterized.
Certain algorithm settings (e.g. hashtable size) and encoding details (e.g. endianness) are extracted from the core logic and put into `Parameters` structures.
Each protocol has at least a set of *compat* parameters that is consistent with the reference implementation, validated in [sync-interop](../../integ/sync-interop/).
In the future, there would be alternative parameter sets optimized for the modern web (e.g. smaller code bundle size), but incompatible with the reference implementation.
