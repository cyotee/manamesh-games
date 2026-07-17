# boardgameio-crypto review checklist

Copy into PR review when touching mental-poker or multiplayer crypto.

## Secrets

- [ ] No `privateKey` in `G` / serialized state  
- [ ] No `privateKey` in multiplayer move argument lists (board + game move defs)  
- [ ] Client uses `prepare*` then submits preEncrypted / peels only  

## Key exchange

- [ ] `keychainAdd` + `MENTAL_POKER_KEYCHAIN_POLICY` (or documented policy)  
- [ ] Invalid / infinity / duplicate pubkeys rejected  
- [ ] Stored keys are normalized (compressed)  

## Encrypt / decrypt

- [ ] sk↔pk binding on client before layer build  
- [ ] Coop complete requires real peels + `layers === 0`  
- [ ] Shares pass `validateEncryptedCard`  
- [ ] Moves use `validatePlayerIdentity`  

## Tests

- [ ] Invalid pubkey → INVALID_MOVE / reject  
- [ ] Duplicate pubkey across seats → reject  
- [ ] Wrong sk client prepare → throw / fail  
- [ ] Multiplayer path tested with `null` privateKey + preEncrypted  
