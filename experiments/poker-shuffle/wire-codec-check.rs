//! Run as an example in the pinned candidate checkout; see README.md.
#[path = "wire-codec/wire-codec.rs"]
mod wire;
use ark_serialize::CanonicalDeserialize;
use wire::{WireError, encode};
use ziffle::{AggregateRevealToken, OwnershipProof, PublicKey, Shuffle};

fn malformed<T>(encoded: &[u8], decoder: impl Fn(&[u8]) -> Result<T, WireError>) {
    for length in 0..encoded.len() {
        assert!(decoder(&encoded[..length]).is_err());
    }
    let mut trailing = encoded.to_vec();
    trailing.push(0);
    assert!(matches!(decoder(&trailing), Err(WireError::Length)));
    assert!(decoder(&vec![255; encoded.len()]).is_err());
}
// Test-only RNG prefix controls the first scalar sampled by pinned arkworks.
// Remaining randomness comes from the OS-seeded thread RNG. Never use this for
// application key generation; it constructs two known cancelling test keys.
struct ScalarPrefix {
    words: std::vec::IntoIter<u64>,
    rest: rand::rngs::ThreadRng,
}
impl rand::RngCore for ScalarPrefix {
    fn next_u32(&mut self) -> u32 {
        self.next_u64() as u32
    }
    fn next_u64(&mut self) -> u64 {
        self.words.next().unwrap_or_else(|| self.rest.next_u64())
    }
    fn fill_bytes(&mut self, output: &mut [u8]) {
        for chunk in output.chunks_mut(8) {
            chunk.copy_from_slice(&self.next_u64().to_le_bytes()[..chunk.len()]);
        }
    }
    fn try_fill_bytes(&mut self, output: &mut [u8]) -> Result<(), rand::Error> {
        self.fill_bytes(output);
        Ok(())
    }
}
fn cancelling_roster(shuffle: &Shuffle<52>) {
    let one = ark_secp256k1::Fr::from(1u64);
    let contexts = [
        b"cancellation/seat/0".as_slice(),
        b"cancellation/seat/1".as_slice(),
    ];
    let keys: Vec<_> = [one, -one]
        .iter()
        .enumerate()
        .map(|(seat, scalar)| {
            let mut rng = ScalarPrefix {
                words: scalar.0.0.to_vec().into_iter(),
                rest: rand::thread_rng(),
            };
            shuffle.keygen(&mut rng, contexts[seat])
        })
        .collect();
    let verified: Vec<_> = keys
        .iter()
        .enumerate()
        .map(|(seat, (_, key, proof))| proof.verify(*key, contexts[seat]).unwrap())
        .collect();
    let aggregate = ziffle::AggregatePublicKey::new(&verified);
    assert_eq!(
        encode(&aggregate),
        encode(&ark_secp256k1::Affine::identity())
    );
    let encoded: Vec<_> = keys
        .iter()
        .map(|(_, key, proof)| (encode(key), encode(proof)))
        .collect();
    let entries: Vec<_> = encoded
        .iter()
        .enumerate()
        .map(|(seat, (key, proof))| (key.as_slice(), proof.as_slice(), contexts[seat]))
        .collect();
    for (key, _) in &encoded {
        assert!(wire::public_key(key).is_ok());
    }
    assert!(matches!(
        wire::admit_roster(&entries),
        Err(WireError::Identity)
    ));
}

fn main() {
    // The candidate's math verifier accepts identity + a zero-response proof.
    // Admission must reject it even though canonical point decoding succeeds.
    let identity = encode(&ark_secp256k1::Affine::identity());
    let zero_key = PublicKey::deserialize_compressed(identity.as_slice()).unwrap();
    let mut trivial = identity.clone();
    trivial.extend_from_slice(&[0; 32]);
    let proof = OwnershipProof::deserialize_compressed(trivial.as_slice()).unwrap();
    assert!(proof.verify(zero_key, b"any-session").is_some());
    assert!(matches!(
        wire::public_key(&identity),
        Err(WireError::Identity)
    ));

    let mut rng = rand::thread_rng();
    let shuffle = Shuffle::<52>::default();
    cancelling_roster(&shuffle);
    for seats in 2..=5 {
        let contexts: Vec<_> = (0..seats)
            .map(|seat| format!("wire-check/v1/session/{seats}/seat/{seat}"))
            .collect();
        let keys: Vec<_> = contexts
            .iter()
            .map(|ctx| shuffle.keygen(&mut rng, ctx.as_bytes()))
            .collect();
        let key_bytes: Vec<_> = keys.iter().map(|(_, key, _)| encode(key)).collect();
        let proofs: Vec<_> = keys.iter().map(|(_, _, proof)| encode(proof)).collect();
        let entries: Vec<_> = (0..seats)
            .map(|seat| {
                (
                    key_bytes[seat].as_slice(),
                    proofs[seat].as_slice(),
                    contexts[seat].as_bytes(),
                )
            })
            .collect();
        let (verified_keys, aggregate) = wire::admit_roster(&entries).unwrap();
        let mut duplicate = entries.clone();
        duplicate[1] = duplicate[0];
        assert!(matches!(
            wire::admit_roster(&duplicate),
            Err(WireError::Duplicate)
        ));
        let mut swapped = entries.clone();
        swapped[1].2 = contexts[0].as_bytes();
        assert!(matches!(
            wire::admit_roster(&swapped),
            Err(WireError::Proof)
        ));
        malformed(&key_bytes[0], wire::public_key);
        malformed(&proofs[0], wire::ownership);
        assert!(matches!(
            wire::admit_roster(&entries[..1]),
            Err(WireError::Roster)
        ));

        let context = format!("wire-check/v1/session/{seats}/shuffle/0");
        let (deck, proof) = shuffle.shuffle_initial_deck(&mut rng, aggregate, context.as_bytes());
        let encoded_deck = encode(&deck);
        let encoded_proof = encode(&proof);
        malformed(&encoded_deck, wire::deck);
        malformed(&encoded_proof, wire::shuffle_proof);
        // Reconstruct only from untrusted bytes, then obtain verification locally.
        let verified_deck = shuffle
            .verify_initial_shuffle(
                aggregate,
                wire::deck(&encoded_deck).unwrap(),
                wire::shuffle_proof(&encoded_proof).unwrap(),
                context.as_bytes(),
            )
            .unwrap();
        let card = verified_deck.get(0).unwrap();
        let reveal_context = format!("wire-check/v1/session/{seats}/position/0/recipient/0");
        let tokens: Vec<_> = keys
            .iter()
            .enumerate()
            .map(|(seat, (secret, public, _))| {
                let (token, proof) =
                    card.reveal_token(&mut rng, secret, *public, reveal_context.as_bytes());
                let token_bytes = encode(&token);
                let proof_bytes = encode(&proof);
                malformed(&token_bytes, wire::reveal_token);
                malformed(&proof_bytes, wire::reveal_proof);
                wire::reveal_proof(&proof_bytes)
                    .unwrap()
                    .verify(
                        verified_keys[seat],
                        wire::reveal_token(&token_bytes).unwrap(),
                        card,
                        reveal_context.as_bytes(),
                    )
                    .unwrap()
            })
            .collect();
        assert!(
            shuffle
                .reveal_card(AggregateRevealToken::new(&tokens[..seats - 1]), card)
                .is_none()
        );
        assert!(
            shuffle
                .reveal_card(AggregateRevealToken::new(&tokens), card)
                .is_some()
        );
        println!("seats={seats}: strict decoding, roster admission, shuffle and reveal verified");
    }
}
