# One Piece security status

This package is not ready for untrusted multiplayer or production release.

The frontend previously passed its encryption private key to `encryptDeck` and
used the first half of that key as its shuffle seed. Both paths are removed.
Neither game definition registers `encryptDeck`; the exported function remains
an offline helper for local cryptographic tests. The encryption phase cannot
complete until a validated public-payload protocol and client-side preparation
are implemented.

Shuffle seeds now come from independent 32-byte Web Crypto randomness. The
frontend commits SHA-256 of the lowercase hex seed, matching the game verifier,
and retains the seed in a component-local ref until reveal. It does not generate
a replacement reveal if a resumed client has lost its committed seed. Durable
recovery is not implemented.

These changes prevent the identified key submissions; they do not establish
fair shuffling, malicious-host resistance or full gameplay. Remaining work
includes actor binding throughout the main game wrappers, proof validation and secure
recovery. Public seed reveal alone does not hide a deck permutation.

Validation: the 240-test package suite includes checks of both engine move
registries. A frontend regression passes generated seed commitments and reveals
through the actual game verifier. Those tests do not run a full peer match.

Engine setup now reads the context wrapper and returns state synchronously.
The main game enables concurrent setup seats per phase and binds deck loading
to the engine actor. Real-client regressions cover roster initialization and
rejecting another seat's deck load while accepting the caller's own deck.

Public-key publication binds the claimed seat to the engine actor in both game
definitions. Main-game shuffle commit/reveal uses that actor instead of a caller
ID supplied as a move argument. These checks assume the transport authenticates
the actor; they do not prevent a malicious host from replacing game state.
The unsupported always-true authenticateCredentials property has been removed.


The deck-loading game now initializes its public protocol state and completes
key admission while preserving board zones. Explicit `deck-loading`/`encrypted`
modes select peek behavior; old mode-less saves need a migration policy. Shared
handlers preserve the concrete state type and initial heartbeat state is zero,
not wall-clock dependent. All 247 package tests and strict frontend typechecking
pass. Encryption remains unavailable as a network move pending a validated
public-layer protocol; these checks do not establish secure full gameplay.
